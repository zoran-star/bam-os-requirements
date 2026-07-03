import { withSentryApiRoute } from "./_sentry.js";
// Vercel Serverless Function — Quiet-Lead → Ghosted (the "went cold" detector)
//
//   GET  /api/agent-followups?action=detect   (Bearer CRON_SECRET)
//        → scan each enabled academy for Responded leads who've gone quiet (no
//          reply in ~a day) and queue a "Send to Ghosted" card in Hawkeye
//          (agent_ready_replies, kind='ghost', status='pending'). We no longer
//          draft one-off nudge SMS — the academy's Ghosted automation handles the
//          multi-touch follow-up once a human approves the card.
//   GET  /api/agent-followups?action=work     (Bearer CRON_SECRET)
//        → send every APPROVED follow-up whose time has come (skips any whose
//          lead replied since it was drafted). Approve-each: pending never sends.
//
//   POST /api/agent-followups { action, ... }  (staff bearer)
//     "list"     { client_id? }                 → the timeline (upcoming + recent)
//     "approve"  { id }                         → pending → approved (will auto-send)
//     "skip"     { id }                         → drop it
//     "edit"     { id, message?, goal?, scheduled_at? }
//     "snooze"   { id, hours }                  → push the send time out
//     "send-now" { id }                         → send immediately
//     "detect-now" { client_id? }              → manually run the detector once
//     "draft-one" { client_id, contact_id, conversation_id?, contact_name? }
//                                               → draft+queue ONE follow-up for a
//                                                 single lead (the forced 2-step
//                                                 after a Hawkeye reply). Idempotent.
//                                                 {stop:true} = brain says no f/u.
//
// Engine is per-academy gated by clients.ghl_kpi_config.followup_engine_enabled.

import { pickGhlToken, ghl } from "./ghl/_core.js";
import { maybeSendSmsViaProvider, smsProvider } from "./messaging/provider.js";
import { readStoreThreadAgent, listStoreThreads } from "./messaging/read-thread.js";
import { toIso, respondedContactIds, respondedContactIdSetCached, peekRespondedIdSet } from "./agent/_stage.js";
import { withinQuietHours, nextSendableTime } from "./agent/_quiet.js";
import { agentMode, modeIsOn, shouldAutoSend } from "./agent/_mode.js";
import { resolveAgentActor } from "./agent/_auth.js";

const SUPABASE_URL         = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
const DEFAULT_CLIENT_ID    = "39875f07-0a4b-4429-a201-2249bc1f24df"; // BAM GTA

// A lead is "quiet" if OUR last message is older than this (≈a day with no reply)
// → we queue a "Send to Ghosted" card for a human. No upper age cap: a lead that's
// been cold for weeks/months in Responded is the BEST candidate to ghost (the
// Ghosted automation is built for cold leads), so we surface them all.
const MIN_QUIET_HOURS = 24;
const DRAFT_CAP       = 12;   // max new ghost cards per academy per detector run

async function sb(path, init = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: { apikey: SUPABASE_SERVICE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`, "Content-Type": "application/json", ...(init.headers || {}) },
  });
  if (!res.ok) throw new Error(`Supabase ${res.status}: ${await res.text()}`);
  const txt = await res.text();
  return txt ? JSON.parse(txt) : null;
}

async function requireStaff(req) {
  const bearer = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  if (!bearer) return null;
  const r = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { apikey: SUPABASE_SERVICE_KEY, Authorization: `Bearer ${bearer}` } });
  if (!r.ok) return null;
  const user = await r.json();
  if (!user?.id) return null;
  let staff = await sb(`staff?user_id=eq.${user.id}&select=role&limit=1`);
  if ((!staff || !staff[0]) && user.email) staff = await sb(`staff?email=eq.${encodeURIComponent(user.email)}&select=role&limit=1`);
  return Array.isArray(staff) && staff[0] ? (user.email || "staff") : null;
}

async function loadClient(clientId) {
  const rows = await sb(`clients?id=eq.${clientId}&select=id,business_name,ghl_location_id,ghl_access_token,ghl_refresh_token,ghl_token_expires_at,ghl_kpi_config&limit=1`);
  return Array.isArray(rows) && rows[0];
}

// ── GHL thread helpers ──
async function threadMessages(token, conversationId) {
  const data = await ghl("GET", `/conversations/${encodeURIComponent(conversationId)}/messages`, { token });
  const raw = data.messages?.messages || data.messages || data.data || [];
  const msgs = raw.map(m => ({
    text: m.body || m.message || "",
    direction: (m.direction || "").toLowerCase(),
    date: m.dateAdded || m.createdAt || m.timestamp || null,
  })).filter(m => m.text);
  msgs.sort((a, b) => new Date(a.date || 0) - new Date(b.date || 0));
  return msgs.map(m => ({ role: m.direction === "outbound" ? "agent" : "parent", text: m.text, date: m.date }));
}

const hoursSince = (d) => d ? (Date.now() - new Date(d).getTime()) / 3600000 : Infinity;

// ── Detector: find quiet leads (no reply in ~a day) and queue a Ghost card ──
// We no longer draft nudge messages. For each Responded lead whose last message
// is OURS and who's been quiet ≥MIN_QUIET_HOURS, we drop a "Send to Ghosted" card
// in the Hawkeye queue (agent_ready_replies, kind='ghost'). A human approves it →
// the lead is enrolled in the academy's Ghosted automation (which does the actual
// multi-touch follow-up). No Claude call needed — the card shows the real thread.
async function detectForClient(client) {
  if (!modeIsOn(agentMode(client))) return { client_id: client.id, skipped: "mode off" };
  // Twilio academies read conversations from the own-store (sms_threads/sms_messages).
  // Their GHL conversations froze at the messaging flip, so reading GHL here would
  // surface stale threads and mark every lead "quiet". GHL academies keep the
  // byte-identical GHL path below.
  const usingStore = (await smsProvider(client.id)) === "twilio";
  const creds = await pickGhlToken(client);
  if (!usingStore && !creds) return { client_id: client.id, skipped: "no GHL token" };
  const { token, locationId } = creds || {};

  // The sales agent ONLY works leads in the Responded stage.
  const { rs, ids: respondedIds } = await respondedContactIds(token, locationId, { clientId: client.id, sb });
  if (!rs) return { client_id: client.id, skipped: "no Responded stage" };

  // Find EVERY Responded-stage lead that's gone quiet ≥ a day and has no pending
  // action — regardless of who messaged last. Iterate the actual Responded roster
  // (respondedIds), NOT just the recent-conversations list: a cold lead's
  // conversation is old and falls outside the bulk top-100 window, so for anyone
  // missing from it we fetch their conversation directly.
  //
  // IMPORTANT: we deliberately do NOT require our-last-message-outbound. A lead who
  // replied days ago and was never followed up (inbound-last) is ALSO a ghost
  // candidate — the reply engine only sees the recent window, so otherwise these
  // leads fall through both engines and silently read "All good". The fresh inbound
  // leads (quiet < a day) still go to the reply engine; this is the ≥24h fallback.
  const byContact = new Map();
  if (usingStore) {
    try {
      for (const t of await listStoreThreads(client.id)) {
        if (t.contactId) byContact.set(t.contactId, { id: t.id, contactId: t.contactId, fullName: t.contactName, lastMessageDate: t.lastMessageDate, lastMessageDirection: t.lastMessageDirection });
      }
    } catch (e) { return { client_id: client.id, error: `threads: ${e.message}` }; }
  } else {
    try {
      const cd = await ghl("GET", `/conversations/search?${new URLSearchParams({ locationId, limit: "100" })}`, { token });
      for (const c of (cd.conversations || cd.data || [])) if (c.contactId) byContact.set(c.contactId, c);
    } catch (e) { return { client_id: client.id, error: `conversations: ${e.message}` }; }
  }

  const candidates = [];
  for (const cid of respondedIds) {
    let c = byContact.get(cid);
    if (!c && usingStore) {
      // Cold lead outside the newest-200 window: look their thread up directly.
      try {
        const rows = await sb(`sms_threads?client_id=eq.${client.id}&ghl_contact_id=eq.${encodeURIComponent(cid)}&select=id,contact_name,last_message_at&limit=1`);
        const t = Array.isArray(rows) && rows[0];
        if (t) c = { id: t.id, contactId: cid, fullName: t.contact_name, lastMessageDate: t.last_message_at };
      } catch (_) {}
    } else if (!c) {
      try {
        const s = await ghl("GET", `/conversations/search?${new URLSearchParams({ locationId, contactId: cid })}`, { token });
        c = (s.conversations || s.data || [])[0] || null;
      } catch (_) {}
    }
    if (!c) continue;
    if (hoursSince(c.lastMessageDate || c.dateUpdated) < MIN_QUIET_HOURS) continue;     // quiet < a day → still fresh (reply engine / 🟢)
    candidates.push(c);
    if (candidates.length >= DRAFT_CAP) break;
  }

  let queued = 0, skipped = 0;

  // INTRO HANDOFF GUARD: when an academy runs the form INTRO automation
  // (contact_form / trial_form), that timed first-touch owns the lead's first
  // contact. The ghost engine must NOT also queue a "Send to Ghosted" card while
  // the intro is still scheduling/sending, or the lead gets double-texted once an
  // intro is edited to span past the 24h quiet threshold (audit finding C2). The
  // intro owns the first touch; the agent/ghost take over only on reply (reply
  // engine) or after the intro completes and the lead still stays quiet. Skip any
  // contact with an intro enrollment that's active (scheduled, mid-delay) or
  // completed (sent). Loaded ONCE per client. Best-effort: a query failure leaves
  // introSet empty so detection still runs. Naturally dormant when no
  // contact_form/trial_form automations exist (introSet empty -> no behavior change).
  let introSet = new Set();
  try {
    const introAutos = await sb(`automations?client_id=eq.${client.id}&automation_key=in.(contact_form,trial_form)&select=id`);
    const introIds = (Array.isArray(introAutos) ? introAutos : []).map(a => a.id);
    if (introIds.length) {
      const enr = await sb(`automation_enrollments?client_id=eq.${client.id}&automation_id=in.(${introIds.join(",")})&status=in.(active,completed)&select=contact_id`);
      introSet = new Set((Array.isArray(enr) ? enr : []).map(e => String(e.contact_id)));
    }
  } catch (_) { introSet = new Set(); }

  for (const c of candidates) {
    const contactId = c.contactId;
    if (!contactId) { skipped++; continue; }
    // Mid-intro lead: the form-intro automation owns the first touch. Don't ghost it.
    if (introSet.has(String(contactId))) { skipped++; continue; }
    // Skip if this lead already has ANY active card (reply / ghost / lost / book).
    try {
      const existing = await sb(`agent_ready_replies?client_id=eq.${client.id}&ghl_contact_id=eq.${encodeURIComponent(contactId)}&status=in.(pending,approved)&select=id&limit=1`);
      if (Array.isArray(existing) && existing.length) { skipped++; continue; }
    } catch (_) {}

    let thread;
    try { thread = usingStore ? await readStoreThreadAgent(client.id, contactId) : await threadMessages(token, c.id); } catch (_) { skipped++; continue; }
    if (!thread.length) { skipped++; continue; }
    // The lead's last message + OUR last message (so the card shows both sides).
    const lastLeadMsg = [...thread].reverse().find(m => m.role === "parent");
    const lastOurMsg  = [...thread].reverse().find(m => m.role === "agent");
    const quietH = Math.round(hoursSince(c.lastMessageDate || c.dateUpdated));
    const quietStr = quietH >= 48 ? `${Math.round(quietH / 24)} days` : `${quietH}h`;
    try {
      await sb(`agent_ready_replies`, {
        method: "POST", headers: { Prefer: "return=minimal" },
        body: JSON.stringify([{
          client_id: client.id, ghl_contact_id: String(contactId), ghl_conversation_id: c.id,
          contact_name: c.fullName || c.contactName || "Lead",
          kind: "ghost", draft_message: "",
          reasoning: `Quiet for about ${quietStr}. Send them to the Ghosted automation?`,
          last_message: lastLeadMsg ? String(lastLeadMsg.text).slice(0, 500) : null,
          last_outbound: lastOurMsg ? String(lastOurMsg.text).slice(0, 500) : null,
          thread_tail: thread.slice(-6).map(m => ({ role: m.role === "agent" ? "agent" : "lead", text: String(m.text).slice(0, 320), at: toIso(m.date) })),
          last_lead_at: toIso(c.lastMessageDate || c.dateUpdated),
          status: "pending", created_by: "detector",
        }]),
      });
      queued++;
    } catch (_) { skipped++; }  // unique-violation race etc.
  }
  return { client_id: client.id, business: client.business_name, candidates: candidates.length, queued, skipped };
}

async function runDetect(res, onlyClientId) {
  let clients = [];
  try {
    clients = onlyClientId
      ? [await loadClient(onlyClientId)].filter(Boolean)
      : await sb(`clients?select=id,business_name,ghl_location_id,ghl_access_token,ghl_refresh_token,ghl_token_expires_at,ghl_kpi_config&v2_access=eq.true`);
  } catch (_) {}
  const out = [];
  for (const client of (Array.isArray(clients) ? clients : [])) {
    try { out.push(await detectForClient(client)); }
    catch (e) { out.push({ client_id: client.id, error: e.message }); }
  }
  return res.status(200).json({ ok: true, academies: out });
}

// ── Worker: send approved follow-ups whose time has come ──
// Did the lead reply after `sinceISO`? The Supabase mirror (`ghl_inbound_messages`)
// is only populated by the inbound webhook, which may not be firing — so it can't
// be trusted alone. We check LIVE GHL first (the source of truth) and fall back to
// the mirror. Either says "replied" → we cancel the queued send.
async function leadRepliedLiveGHL(token, locationId, contactId, sinceISO) {
  if (!token || !locationId || !contactId || !sinceISO) return false;
  try {
    const s = await ghl("GET", `/conversations/search?${new URLSearchParams({ locationId, contactId })}`, { token });
    const conv = (s.conversations || s.data || [])[0];
    if (!conv) return false;
    const dir = String(conv.lastMessageDirection || "").toLowerCase();
    const at = conv.lastMessageDate || conv.dateUpdated;
    return dir === "inbound" && at != null && new Date(at).getTime() > new Date(sinceISO).getTime();
  } catch (_) { return false; }
}
async function leadRepliedSince(clientId, contactId, sinceISO) {
  try {
    const rows = await sb(`ghl_inbound_messages?client_id=eq.${clientId}&ghl_contact_id=eq.${encodeURIComponent(contactId)}&occurred_at=gt.${sinceISO}&select=id&limit=1`);
    return Array.isArray(rows) && rows.length > 0;
  } catch (_) { return false; }
}
// Store variant for Twilio academies: their inbound SMS lands in sms_messages (via
// the Twilio webhook), NOT in GHL or the ghl_inbound_messages mirror — so both
// checks above are blind for them and would let a nudge fire at a lead who already
// replied. Any inbound store message after `sinceISO` cancels the send.
async function leadRepliedStore(clientId, contactId, sinceISO) {
  if (!clientId || !contactId || !sinceISO) return false;
  try {
    const t = await sb(`sms_threads?client_id=eq.${clientId}&ghl_contact_id=eq.${encodeURIComponent(contactId)}&select=id&limit=1`);
    if (!Array.isArray(t) || !t[0]) return false;
    const rows = await sb(`sms_messages?thread_id=eq.${t[0].id}&direction=eq.inbound&occurred_at=gt.${encodeURIComponent(sinceISO)}&select=id&limit=1`);
    return Array.isArray(rows) && rows.length > 0;
  } catch (_) { return false; }
}

async function sendOne(row, clientCache, respondedCache = {}) {
  let client = clientCache[row.client_id];
  if (!client) { client = await loadClient(row.client_id); clientCache[row.client_id] = client; }
  if (!client) return { id: row.id, error: "client gone" };

  // Hard guard: the sales agent only messages Responded-stage leads. If they've
  // left the stage since this was scheduled, cancel instead of sending.
  const credsGuard = await pickGhlToken(client);
  if (credsGuard) {
    let rset = respondedCache[row.client_id];
    if (rset === undefined) { try { rset = (await respondedContactIds(credsGuard.token, credsGuard.locationId, { clientId: row.client_id, sb })).ids; } catch (_) { rset = null; } respondedCache[row.client_id] = rset; }
    if (rset && row.ghl_contact_id && !rset.has(row.ghl_contact_id)) {
      await sb(`agent_followups?id=eq.${row.id}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ status: "canceled", send_error: "left Responded stage", updated_at: new Date().toISOString() }) });
      return { id: row.id, canceled: "left Responded stage" };
    }
  }

  // Cancel if the lead replied after this was drafted. Twilio academies check the
  // own-store (their replies never reach GHL); GHL academies check LIVE GHL first
  // (source of truth), then the Supabase mirror as a cheap backup.
  const since = row.last_lead_at || row.created_at;
  if (since) {
    const usingStore = (await smsProvider(row.client_id)) === "twilio";
    const repliedLive = usingStore
      ? await leadRepliedStore(row.client_id, row.ghl_contact_id, since)
      : (credsGuard && await leadRepliedLiveGHL(credsGuard.token, credsGuard.locationId, row.ghl_contact_id, since));
    const replied = repliedLive || await leadRepliedSince(row.client_id, row.ghl_contact_id, since);
    if (replied) {
      await sb(`agent_followups?id=eq.${row.id}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ status: "canceled", send_error: "lead replied", updated_at: new Date().toISOString() }) });
      return { id: row.id, canceled: "lead replied" };
    }
  }
  // Provider gate: a Twilio academy sends via Twilio + own-store (no GHL token needed).
  const tw = await maybeSendSmsViaProvider(row.client_id, { ghlContactId: row.ghl_contact_id, body: row.draft_message, sentBy: "ghosted" });
  if (tw.handled) {
    if (!tw.ok) { await markFailed(row.id, tw.error); return { id: row.id, error: tw.error }; }
    await sb(`agent_followups?id=eq.${row.id}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ status: "sent", sent_at: new Date().toISOString(), updated_at: new Date().toISOString() }) });
    return { id: row.id, sent: true };
  }
  const creds = credsGuard || await pickGhlToken(client);
  if (!creds) { await markFailed(row.id, "no GHL token"); return { id: row.id, error: "no token" }; }
  try {
    await ghl("POST", `/conversations/messages`, { token: creds.token, body: { type: "SMS", contactId: row.ghl_contact_id, message: row.draft_message } });
    await sb(`agent_followups?id=eq.${row.id}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ status: "sent", sent_at: new Date().toISOString(), updated_at: new Date().toISOString() }) });
    return { id: row.id, sent: true };
  } catch (e) { await markFailed(row.id, e.message); return { id: row.id, error: e.message }; }
}
async function markFailed(id, msg) {
  try { await sb(`agent_followups?id=eq.${id}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ status: "failed", send_error: String(msg).slice(0, 400), updated_at: new Date().toISOString() }) }); } catch (_) {}
}

async function runWork(res) {
  // Approved rows always send (human said yes). In SELF-DRIVE, high-confidence
  // pending rows send themselves too; low-confidence ones stay pending for the
  // inbox ("unsure → a human"). Hawkeye pending rows never auto-send.
  // Quiet hours guard: even if a row came due, never send outside 8:00am-9:30pm.
  // Cron lag (a row scheduled for 9:25pm picked up at 9:40pm) lands here — leave the
  // rows pending; the next in-window run sends them.
  if (!withinQuietHours()) return res.status(200).json({ ok: true, processed: 0, deferred: "quiet hours" });
  let due = [];
  try {
    due = await sb(`agent_followups?status=in.(pending,approved)&scheduled_at=lte.${new Date().toISOString()}&select=*&order=scheduled_at.asc&limit=80`);
  } catch (e) { return res.status(500).json({ error: e.message }); }
  const cache = {}, rcache = {};
  const out = [];
  for (const row of (Array.isArray(due) ? due : [])) {
    if (row.status === "pending") {
      let client = cache[row.client_id];
      if (client === undefined) { client = await loadClient(row.client_id); cache[row.client_id] = client; }
      // shouldAutoSend honors the global self-drive kill-switch (returns false while disabled).
      const auto = client && shouldAutoSend(agentMode(client), { confidence: row.confidence });
      if (!auto) continue;   // hawkeye, or self-drive-but-unsure → wait for approval
      out.push({ ...(await sendOne(row, cache, rcache)), auto_sent: true });
    } else {
      out.push(await sendOne(row, cache, rcache));
    }
  }
  return res.status(200).json({ ok: true, processed: out.length, results: out });
}

async function handler(req, res) {
  // Cron endpoints (Vercel sends Bearer CRON_SECRET).
  if (req.method === "GET" && (req.query.action === "detect" || req.query.action === "work")) {
    const got = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
    if (!process.env.CRON_SECRET || got !== process.env.CRON_SECRET) return res.status(401).json({ error: "unauthorized" });
    return req.query.action === "detect" ? await runDetect(res, null) : await runWork(res);
  }

  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  // BAM staff OR the academy's own owner / can_train_agent member.
  const actor = await resolveAgentActor(req);
  if (!actor) return res.status(401).json({ error: "sign in required" });

  const b = req.body && typeof req.body === "object" ? req.body : {};
  const staffEmail = actor.email;
  // Academy (non-staff) actors must scope every action to their own academy;
  // staff may omit client_id to act across academies. `clientScope` is appended
  // to each row mutation so an academy actor can never touch another's rows.
  if (!actor.isStaff && (!b.client_id || !actor.canActOn(b.client_id))) {
    return res.status(403).json({ error: "not your academy" });
  }
  const clientScope = b.client_id ? `&client_id=eq.${b.client_id}` : "";

  try {
    if (b.action === "list") {
      const clientFilter = clientScope;
      const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString();
      // Upcoming (pending/approved) + recent terminal (sent/skipped/canceled/failed in last 7d).
      const rows = await sb(`agent_followups?select=*,clients(business_name)&or=(status.in.(pending,approved),and(status.in.(sent,skipped,canceled,failed),updated_at.gte.${weekAgo}))${clientFilter}&order=scheduled_at.asc&limit=300`);
      let list = (Array.isArray(rows) ? rows : []).map(r => ({ ...r, business_name: r.clients?.business_name || null, clients: undefined }));
      // Read-time Responded gate (same as agent-approvals list-ready): hide
      // pending/approved nudges whose lead has left the Responded stage before the
      // cron prunes them. Terminal rows (sent/skipped/...) are history — left as-is.
      // Per academy, since a staff view can span clients. Fail OPEN on any GHL error.
      try {
        const clientIds = [...new Set(list.filter(r => r.status === "pending" || r.status === "approved").map(r => r.client_id).filter(Boolean))];
        const idsByClient = {};
        for (const cid of clientIds) {
          try {
            const client = await loadClient(cid);
            const loc = client && client.ghl_location_id;
            let ids = loc ? peekRespondedIdSet(loc) : undefined;   // hot path: skip token fetch
            if (ids === undefined && loc) {
              const creds = await pickGhlToken(client);
              ids = creds ? await respondedContactIdSetCached(creds.token, loc, 60000, { clientId: cid, sb }) : null;
            }
            idsByClient[cid] = ids ?? null;
          } catch (_) { idsByClient[cid] = null; }   // fail open for this academy
        }
        list = list.filter(r => {
          if (r.status !== "pending" && r.status !== "approved") return true;   // keep history
          const ids = idsByClient[r.client_id];
          if (!ids) return true;                       // no gate available → keep
          return !r.ghl_contact_id || ids.has(r.ghl_contact_id);
        });
      } catch (_) { /* fail open */ }
      return res.status(200).json({ followups: list });
    }
    if (b.action === "approve") {
      if (!b.id) return res.status(400).json({ error: "id required" });
      await sb(`agent_followups?id=eq.${encodeURIComponent(b.id)}&status=eq.pending${clientScope}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ status: "approved", approved_by: staffEmail, approved_at: new Date().toISOString(), updated_at: new Date().toISOString() }) });
      return res.status(200).json({ ok: true });
    }
    if (b.action === "skip") {
      if (!b.id) return res.status(400).json({ error: "id required" });
      await sb(`agent_followups?id=eq.${encodeURIComponent(b.id)}${clientScope}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ status: "skipped", updated_at: new Date().toISOString() }) });
      return res.status(200).json({ ok: true });
    }
    if (b.action === "edit") {
      if (!b.id) return res.status(400).json({ error: "id required" });
      const patch = { updated_at: new Date().toISOString() };
      if (typeof b.message === "string" && b.message.trim()) patch.draft_message = b.message.trim();
      if (typeof b.goal === "string") patch.goal = b.goal;
      if (b.scheduled_at) patch.scheduled_at = new Date(b.scheduled_at).toISOString();
      await sb(`agent_followups?id=eq.${encodeURIComponent(b.id)}${clientScope}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify(patch) });
      return res.status(200).json({ ok: true });
    }
    if (b.action === "snooze") {
      if (!b.id || !b.hours) return res.status(400).json({ error: "id + hours required" });
      const [row] = await sb(`agent_followups?id=eq.${encodeURIComponent(b.id)}${clientScope}&select=scheduled_at`);
      if (!row) return res.status(404).json({ error: "not found" });
      const base = new Date(row.scheduled_at).getTime() || Date.now();
      await sb(`agent_followups?id=eq.${encodeURIComponent(b.id)}${clientScope}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ scheduled_at: new Date(base + Number(b.hours) * 3600000).toISOString(), updated_at: new Date().toISOString() }) });
      return res.status(200).json({ ok: true });
    }
    if (b.action === "send-now") {
      if (!b.id) return res.status(400).json({ error: "id required" });
      const [row] = await sb(`agent_followups?id=eq.${encodeURIComponent(b.id)}${clientScope}&select=*`);
      if (!row) return res.status(404).json({ error: "not found" });
      if (!["pending", "approved"].includes(row.status)) return res.status(409).json({ error: `already ${row.status}` });
      // QUIET HOURS: a human hit "send now" after 9:30pm / before 8am. Don't text
      // the parent now — approve it and reschedule to the morning so the send cron
      // picks it up in-window.
      if (!withinQuietHours()) {
        const sendAfter = nextSendableTime().toISOString();
        await sb(`agent_followups?id=eq.${encodeURIComponent(b.id)}${clientScope}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ status: "approved", scheduled_at: sendAfter, approved_by: staffEmail, approved_at: new Date().toISOString(), updated_at: new Date().toISOString() }) });
        return res.status(200).json({ ok: true, deferred: true, send_after: sendAfter });
      }
      const r = await sendOne(row, {});
      if (r.error) return res.status(502).json({ error: r.error });
      return res.status(200).json({ ok: true, result: r });
    }
    if (b.action === "detect-now") {
      // Academy actors can only scan their own academy; staff may scan the default.
      return await runDetect(res, b.client_id || (actor.isStaff ? DEFAULT_CLIENT_ID : actor.academyClientIds[0]));
    }
    return res.status(400).json({ error: "unknown action" });
  } catch (e) {
    console.error("[agent-followups]", e);
    return res.status(500).json({ error: e.message || "internal error" });
  }
}

export default withSentryApiRoute(handler);
