import { withSentryApiRoute } from "./_sentry.js";
// Vercel Serverless Function - Member Care agent (approve-only proposal cards)
//
//   GET  /api/agent-member-care?action=detect          (Bearer CRON_SECRET)
//        Sweep every V2 academy with the agent on: for members whose parent
//        messaged recently, draft a proposal card (action + reply + to-dos).
//
//   POST /api/agent-member-care { action, ... }        (staff OR academy bearer)
//     "list"             { client_id, member_id? }  → pending cards (per member for the drawer)
//     "counts"           { client_id }              → { member_id: n } for the roster dot
//     "mark-action-done" { id }                     → the human ran the action via PATCH /api/members
//     "mark-reply-sent"  { id, final_text? }        → the human sent the (possibly edited) reply
//     "mark-items-added" { id }                     → the human copied the to-dos into action_items
//     "dismiss"          { id, part, lesson? }      → dismiss 'action'|'reply'|'items'|'all'; optional teach-why
//     "detect-now"       { client_id }              → run the detector for one academy on demand
//
// SAFETY MODEL: this endpoint never writes billing and never sends messages. The
// action part executes ONLY when the human clicks "Do action" in the UI, which
// fires the proven PATCH /api/members path with the user's own bearer; the reply
// sends ONLY via the UI's /api/ghl/send-message call. The mark-* actions here
// just record what the human already did. See api/agent/member-care.js (draft core).

import { pickGhlToken } from "./ghl/_core.js";
import { smsProvider } from "./messaging/provider.js";
import { memberCareAgentMode, modeIsOn } from "./agent/_mode.js";
import { resolveAgentActor } from "./agent/_auth.js";
import { notifyClientPush } from "./push/_send.js";
import { draftMemberCareForMember, cancelPendingMemberCards, MEMBER_CARE_SELECT } from "./agent/member-care.js";

const SUPABASE_URL         = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
const DETECT_CAP           = 10;   // max cards drafted per academy per run
const LOOKBACK_HOURS       = 48;   // how far back an inbound counts as "recent"

async function sb(path, init = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: { apikey: SUPABASE_SERVICE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`, "Content-Type": "application/json", ...(init.headers || {}) },
  });
  if (!res.ok) throw new Error(`Supabase ${res.status}: ${await res.text()}`);
  const txt = await res.text();
  return txt ? JSON.parse(txt) : null;
}

async function loadClient(clientId) {
  const rows = await sb(`clients?id=eq.${clientId}&select=id,business_name,v2_access,ghl_location_id,ghl_access_token,ghl_refresh_token,ghl_token_expires_at,ghl_kpi_config,time_zone&limit=1`);
  return Array.isArray(rows) && rows[0];
}

// Contacts with a recent INBOUND, newest timestamp per contact. GHL academies
// come from the ghl_inbound_messages webhook log; Twilio own-store academies
// from sms_threads (last_direction=inbound). One map, contactId → ISO time.
async function recentInboundContacts(clientId) {
  const since = new Date(Date.now() - LOOKBACK_HOURS * 3600000).toISOString();
  const map = new Map();
  try {
    const rows = await sb(
      `ghl_inbound_messages?client_id=eq.${clientId}&direction=eq.inbound&occurred_at=gte.${since}` +
      `&select=ghl_contact_id,occurred_at&order=occurred_at.desc&limit=500`
    );
    for (const r of (Array.isArray(rows) ? rows : [])) {
      if (r.ghl_contact_id && !map.has(String(r.ghl_contact_id))) map.set(String(r.ghl_contact_id), r.occurred_at);
    }
  } catch (_) {}
  try {
    const threads = await sb(
      `sms_threads?client_id=eq.${clientId}&ghl_contact_id=not.is.null&last_direction=eq.inbound` +
      `&last_message_at=gte.${since}&select=ghl_contact_id,last_message_at&limit=500`
    );
    for (const t of (Array.isArray(threads) ? threads : [])) {
      const cid = String(t.ghl_contact_id);
      const prev = map.get(cid);
      if (!prev || new Date(t.last_message_at) > new Date(prev)) map.set(cid, t.last_message_at);
    }
  } catch (_) {}
  return map;
}

// ── Detector: draft cards for members whose parent messaged recently ──
async function detectForClient(client) {
  const mode = memberCareAgentMode(client);
  if (!modeIsOn(mode)) return { client_id: client.id, skipped: "mode off" };

  const provider = await smsProvider(client.id).catch(() => "ghl");
  const creds = provider === "twilio" ? null : await pickGhlToken(client);
  if (provider !== "twilio" && !creds) return { client_id: client.id, skipped: "no GHL token" };

  const inbound = await recentInboundContacts(client.id);
  if (!inbound.size) return { client_id: client.id, drafted: 0, candidates: 0 };

  // Candidates: MEMBERS whose contact has a recent inbound. (Leads without a
  // members row belong to the sales agents, not member care.)
  const ids = [...inbound.keys()].slice(0, 200).map(encodeURIComponent).join(",");
  const members = await sb(
    `members?client_id=eq.${client.id}&ghl_contact_id=in.(${ids})&select=${MEMBER_CARE_SELECT}`
  ).catch(() => []);
  const candidates = Array.isArray(members) ? members : [];

  // Prune: a pending card superseded by a NEWER inbound is stale - cancel it so
  // a fresh draft (below) reflects the full thread. Belt + suspenders with the
  // inbound-webhook fast path, which does the same instantly.
  let pruned = 0;
  try {
    const pend = await sb(`agent_member_cards?client_id=eq.${client.id}&status=eq.pending&select=id,member_id,ghl_contact_id,last_inbound_at`);
    for (const row of (Array.isArray(pend) ? pend : [])) {
      const newest = row.ghl_contact_id ? inbound.get(String(row.ghl_contact_id)) : null;
      if (newest && row.last_inbound_at && new Date(newest) > new Date(row.last_inbound_at)) {
        await cancelPendingMemberCards(client.id, row.member_id, "parent replied again");
        pruned++;
      }
    }
  } catch (_) {}

  let drafted = 0, skipped = 0, errors = 0;
  const reasons = [];
  let first = true;
  for (const member of candidates.slice(0, DETECT_CAP)) {
    if (!first) await new Promise(r => setTimeout(r, 300));   // smooth GHL bursts
    first = false;
    try {
      const out = await draftMemberCareForMember(client, member, {
        token: creds?.token, locationId: creds?.locationId, createdBy: "detector",
      });
      if (out.inserted) drafted++;
      else { skipped++; if (out.skipped || out.error) reasons.push(`${member.athlete_name || member.id}: ${out.skipped || out.error}`); }
    } catch (e) {
      errors++; reasons.push(`${member.athlete_name || member.id}: ${e.message}`);
    }
  }

  if (drafted > 0) notifyClientPush(client.id, "member-care-ready", { count: drafted, view: "members" }).catch(() => {});
  return { client_id: client.id, candidates: candidates.length, drafted, skipped, pruned, errors, reasons: reasons.slice(0, 10) };
}

async function runDetect(res, onlyClientId) {
  const path = onlyClientId
    ? `clients?id=eq.${onlyClientId}&select=id,business_name,v2_access,ghl_location_id,ghl_access_token,ghl_refresh_token,ghl_token_expires_at,ghl_kpi_config,time_zone`
    : `clients?v2_access=eq.true&select=id,business_name,v2_access,ghl_location_id,ghl_access_token,ghl_refresh_token,ghl_token_expires_at,ghl_kpi_config,time_zone`;
  const clients = await sb(path);
  const results = [];
  for (const client of (Array.isArray(clients) ? clients : [])) {
    if (!client.v2_access) { results.push({ client_id: client.id, skipped: "not V2" }); continue; }
    try { results.push(await detectForClient(client)); }
    catch (e) { results.push({ client_id: client.id, error: e.message }); }
  }
  return res.status(200).json({ ok: true, results });
}

// A card is resolved once no part is still pending.
async function maybeResolve(id) {
  const [card] = await sb(`agent_member_cards?id=eq.${id}&select=action_status,reply_status,action_items_status,status&limit=1`) || [];
  if (!card || card.status !== "pending") return;
  const open = [card.action_status, card.reply_status, card.action_items_status].includes("pending");
  if (!open) {
    await sb(`agent_member_cards?id=eq.${id}`, {
      method: "PATCH", headers: { Prefer: "return=minimal" },
      body: JSON.stringify({ status: "resolved", updated_at: new Date().toISOString() }),
    });
  }
}

async function loadCard(id) {
  const rows = await sb(`agent_member_cards?id=eq.${encodeURIComponent(id)}&select=*&limit=1`);
  return Array.isArray(rows) && rows[0];
}

async function handler(req, res) {
  // Cron (Vercel sends Bearer CRON_SECRET): sweep every V2 academy.
  if (req.method === "GET" && req.query.action === "detect") {
    const got = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
    if (!process.env.CRON_SECRET || got !== process.env.CRON_SECRET) return res.status(401).json({ error: "unauthorized" });
    try { return await runDetect(res, null); }
    catch (e) { console.error("[member-care detect]", e); return res.status(500).json({ error: e.message }); }
  }

  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  const b = req.body && typeof req.body === "object" ? req.body : {};

  const actor = await resolveAgentActor(req);
  if (!actor) return res.status(401).json({ error: "sign in required" });

  try {
    if (b.action === "list") {
      if (!b.client_id) return res.status(400).json({ error: "client_id required" });
      if (!actor.canActOn(b.client_id)) return res.status(403).json({ error: "not your academy" });
      const memberFilter = b.member_id ? `&member_id=eq.${encodeURIComponent(b.member_id)}` : "";
      const rows = await sb(
        `agent_member_cards?client_id=eq.${encodeURIComponent(b.client_id)}&status=eq.pending${memberFilter}` +
        `&select=id,member_id,ghl_contact_id,member_name,parent_name,action,action_body,action_summary,action_status,` +
        `draft_reply,reply_channel,reply_status,action_items,action_items_status,reasoning,confidence,escalate,` +
        `escalate_reason,summary,last_message,created_at&order=created_at.desc&limit=50`
      );
      return res.status(200).json({ cards: Array.isArray(rows) ? rows : [] });
    }

    if (b.action === "counts") {
      if (!b.client_id) return res.status(400).json({ error: "client_id required" });
      if (!actor.canActOn(b.client_id)) return res.status(403).json({ error: "not your academy" });
      const rows = await sb(`agent_member_cards?client_id=eq.${encodeURIComponent(b.client_id)}&status=eq.pending&select=member_id`);
      const counts = {};
      for (const r of (Array.isArray(rows) ? rows : [])) counts[r.member_id] = (counts[r.member_id] || 0) + 1;
      return res.status(200).json({ counts });
    }

    // The mark-* actions record what the human already did through the proven
    // execution paths (PATCH /api/members, /api/ghl/send-message, POST /api/action-items).
    if (["mark-action-done", "mark-reply-sent", "mark-items-added", "dismiss"].includes(b.action)) {
      if (!b.id) return res.status(400).json({ error: "id required" });
      const card = await loadCard(b.id);
      if (!card) return res.status(404).json({ error: "card not found" });
      if (!actor.canActOn(card.client_id)) return res.status(403).json({ error: "not your academy" });
      const now = new Date().toISOString();

      if (b.action === "mark-action-done") {
        if (card.action_status !== "pending") return res.status(409).json({ error: `action part is ${card.action_status}` });
        await sb(`agent_member_cards?id=eq.${card.id}`, {
          method: "PATCH", headers: { Prefer: "return=minimal" },
          body: JSON.stringify({ action_status: "done", action_done_by: actor.email, action_done_at: now, updated_at: now }),
        });
      } else if (b.action === "mark-reply-sent") {
        if (card.reply_status !== "pending") return res.status(409).json({ error: `reply part is ${card.reply_status}` });
        const patch = { reply_status: "sent", reply_sent_by: actor.email, reply_sent_at: now, updated_at: now };
        // Keep the FINAL (possibly human-edited) text on the card - the edit is
        // also the teach-why training signal for /consolidate-lessons.
        if (b.final_text && String(b.final_text).trim()) patch.draft_reply = String(b.final_text).trim();
        await sb(`agent_member_cards?id=eq.${card.id}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify(patch) });
      } else if (b.action === "mark-items-added") {
        if (card.action_items_status !== "pending") return res.status(409).json({ error: `to-dos part is ${card.action_items_status}` });
        await sb(`agent_member_cards?id=eq.${card.id}`, {
          method: "PATCH", headers: { Prefer: "return=minimal" },
          body: JSON.stringify({ action_items_status: "added", updated_at: now }),
        });
      } else {   // dismiss
        const part = ["action", "reply", "items", "all"].includes(b.part) ? b.part : "all";
        const patch = { updated_at: now };
        if ((part === "action" || part === "all") && card.action_status === "pending") patch.action_status = "dismissed";
        if ((part === "reply" || part === "all") && card.reply_status === "pending") patch.reply_status = "dismissed";
        if ((part === "items" || part === "all") && card.action_items_status === "pending") patch.action_items_status = "dismissed";
        await sb(`agent_member_cards?id=eq.${card.id}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify(patch) });
        // Teach-why: an optional lesson rides the dismissal. Insert directly into
        // agent_lessons (NOT via /api/agent-train - its pickAgent falls back to
        // 'booking' and would misfile the bucket). Thread snapshot = training signal.
        if (b.lesson && String(b.lesson).trim()) {
          await sb(`agent_lessons`, {
            method: "POST", headers: { Prefer: "return=minimal" },
            body: JSON.stringify([{
              client_id: card.client_id,
              agent: "member_care",
              kind: "fix",
              lesson: String(b.lesson).trim(),
              context: { card_id: card.id, member_id: card.member_id, dismissed_part: part },
              thread_snapshot: card.thread_tail || null,
              scope: "academy",
              promotion_status: "none",
              created_by: actor.email || "client-trainer",
            }]),
          }).catch(e => console.error("[member-care teach]", e.message));
        }
      }
      await maybeResolve(card.id);
      const fresh = await loadCard(card.id);
      return res.status(200).json({ ok: true, card: fresh });
    }

    // Manual, per-conversation "Ask the agent" button in the member drawer. Runs
    // the SAME AI draft on demand for ONE member, and works regardless of the
    // academy's member_care_agent_mode toggle - the toggle only governs the
    // background cron/webhook sweep; an explicit human click always runs.
    if (b.action === "draft-now") {
      const clientId = b.client_id;
      if (!clientId) return res.status(400).json({ error: "client_id required" });
      if (!b.member_id) return res.status(400).json({ error: "member_id required" });
      if (!actor.canActOn(clientId)) return res.status(403).json({ error: "not your academy" });
      const client = await loadClient(clientId);
      if (!client) return res.status(404).json({ error: "academy not found" });
      const rows = await sb(`members?id=eq.${encodeURIComponent(b.member_id)}&client_id=eq.${clientId}&select=${MEMBER_CARE_SELECT}&limit=1`);
      const member = Array.isArray(rows) && rows[0];
      if (!member) return res.status(404).json({ error: "member not found for this academy" });
      const provider = await smsProvider(clientId).catch(() => "ghl");
      const creds = provider === "twilio" ? null : await pickGhlToken(client);
      const result = await draftMemberCareForMember(client, member, {
        token: creds?.token, locationId: creds?.locationId, createdBy: "manual", manual: true,
      });
      return res.status(200).json({ ok: true, result });
    }

    if (b.action === "detect-now") {
      const clientId = b.client_id;
      if (!clientId) return res.status(400).json({ error: "client_id required" });
      if (!actor.canActOn(clientId)) return res.status(403).json({ error: "not your academy" });
      const client = await loadClient(clientId);
      if (!client) return res.status(404).json({ error: "academy not found" });
      const result = await detectForClient(client);
      return res.status(200).json({ ok: true, result });
    }

    return res.status(400).json({ error: "unknown action" });
  } catch (e) {
    console.error("[agent-member-care]", e);
    return res.status(500).json({ error: e.message || "internal error" });
  }
}

export default withSentryApiRoute(handler);
