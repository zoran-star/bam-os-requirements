import { withSentryApiRoute } from "../_sentry.js";
// Messaging spine (4/5): Twilio inbound-SMS webhook. The Twilio counterpart of
// api/ghl/inbound-webhook.js - when an academy runs its own Twilio, replies land
// here. Stores the message in the own-store and fires the SAME side-effects the
// GHL webhook does (cancel stale drafts, exit automations -> Responded, notify
// owner, wake the agent), keyed by the lead's GHL contact (still in GHL).
//
// Point each academy's Twilio number Messaging webhook at:
//   https://portal.byanymeansbusiness.com/api/twilio/inbound-webhook
//
// Security: validates X-Twilio-Signature with the academy's auth token.
// Compliance: STOP/UNSUBSCRIBE is recorded; Twilio's Advanced Opt-Out blocks
// further sends at the carrier level (enable it on the Messaging Service).
import crypto from "node:crypto";
import { pickGhlToken, sendSms, ghl } from "../ghl/_core.js";
import { notifyOwners } from "../_notify-owners.js";
import { respondedStage, contactInRespondedStage, interestedStage, nurtureStage, isRealInbound } from "../agent/_stage.js";
import { markReopened } from "../agent/_reopen.js";
import { moveStage, pipelineFlags } from "../agent/_store.js";
import { agentMode, memberCareAgentMode, modeIsOn } from "../agent/_mode.js";
import { exitEnrollment } from "../automations.js";
import { cancelAllSalesOutbound } from "../agent/_cancel-outbound.js";
import { draftMemberCareForMember, cancelPendingMemberCards, MEMBER_CARE_SELECT } from "../agent/member-care.js";
import { notifyClientPush } from "../push/_send.js";
import { decryptSecret } from "../messaging/_crypto.js";

const SB_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;

async function sb(path, init = {}) {
  const r = await fetch(`${SB_URL}/rest/v1/${path}`, { ...init, headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, "Content-Type": "application/json", ...(init.headers || {}) } });
  if (!r.ok) throw new Error(`Supabase ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const t = await r.text(); return t ? JSON.parse(t) : null;
}

const STOP_WORDS  = new Set(["stop", "stopall", "stop all", "unsubscribe", "cancel", "end", "quit", "revoke", "optout", "opt out", "opt-out"]);

// Soft opt-out phrases inside a longer message ("please stop texting me", "leave
// me alone") - the exact-match STOP_WORDS above miss these. Deliberately
// conservative: verbs require the texting/contacting object or a me/us target so
// chatty phrases like "can't stop talking about it" never match ("stop talking"
// only matches with "to me/us"). Shared shape with api/ghl/inbound-webhook.js.
const SOFT_OPTOUT_RE = /\b(?:stop\s+(?:texting|messaging|contacting)(?:\s+(?:me|us))?|stop\s+talking\s+to\s+(?:me|us)|leave\s+(?:me|us)\s+alone|(?:don'?t|do\s+not)\s+(?:text|message|contact|call)\s+(?:me|us)|remove\s+(?:me|us|my\s+number)|take\s+(?:me|us)\s+off\s+(?:your|the|this)\s+list|unsubscribe)\b/i;

// Persistent opt-out note → agent contact memory. The lead said some form of
// "stop contacting me" without hitting a carrier STOP word: do NOT block the
// normal flow (the bounce + Hawkeye draft still run so a human sees it), but
// stamp the contact notes so the agent suggests MARK UNQUALIFIED even if the
// model misses the phrasing. One active note per contact (no dupes). Best-effort.
async function flagSoftOptOut(clientId, contactId, text, createdBy) {
  try {
    if (!clientId || !contactId || !SOFT_OPTOUT_RE.test(String(text || ""))) return;
    const prefix = "Lead appears to have OPTED OUT";
    const existing = await sb(`agent_contact_notes?client_id=eq.${clientId}&ghl_contact_id=eq.${encodeURIComponent(String(contactId))}&active=eq.true&note=ilike.${encodeURIComponent(prefix)}*&select=id&limit=1`);
    if (Array.isArray(existing) && existing.length) return;
    const snip = String(text || "").trim().slice(0, 120);
    await sb(`agent_contact_notes`, { method: "POST", headers: { Prefer: "return=minimal" }, body: JSON.stringify([{
      client_id: clientId, ghl_contact_id: String(contactId), active: true,
      note: `${prefix} ("${snip}") - suggest mark unqualified, do not keep messaging`,
      created_by: createdBy,
    }]) });
  } catch (e) { console.error("soft opt-out note:", e.message); }
}

// Twilio request signature: base64(HMAC-SHA1(authToken, url + sorted(k+v)…)).
function validSignature(authToken, url, params, signature) {
  if (!authToken || !signature) return false;
  const data = url + Object.keys(params).sort().map((k) => k + params[k]).join("");
  const expected = crypto.createHmac("sha1", authToken).update(Buffer.from(data, "utf-8")).digest("base64");
  try { return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(String(signature))); } catch { return false; }
}

function xmlOk(res) {
  res.setHeader("Content-Type", "text/xml");
  return res.status(200).send("<Response/>");
}

async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  const p = (req.body && typeof req.body === "object") ? req.body : {};
  const from = String(p.From || "").trim();
  const to   = String(p.To || "").trim();
  const bodyText = String(p.Body || "");
  const sid  = p.MessageSid || p.SmsSid || null;
  if (!from || !to) return xmlOk(res);

  // Resolve the academy by the receiving number (their own Twilio number).
  let cfg = null;
  try {
    const rows = await sb(`client_twilio_config?from_number=eq.${encodeURIComponent(to)}&status=eq.active&select=client_id,auth_token_enc,api_key_secret_enc&limit=1`);
    cfg = rows && rows[0];
  } catch (_) { cfg = null; }
  if (!cfg) return xmlOk(res); // unknown / inactive number — ack so Twilio doesn't retry

  // Verify the signature with the academy's auth token.
  const authToken = cfg.auth_token_enc ? decryptSecret(cfg.auth_token_enc)
    : (cfg.api_key_secret_enc ? decryptSecret(cfg.api_key_secret_enc) : null);
  const url = `https://${req.headers["x-forwarded-host"] || req.headers.host}${req.url}`;
  if (authToken && !validSignature(authToken, url, p, req.headers["x-twilio-signature"])) {
    return res.status(403).json({ error: "bad signature" });
  }

  const clientId = cfg.client_id;
  let client = null;
  try {
    const rows = await sb(`clients?id=eq.${clientId}&select=id,business_name,v2_access,ghl_kpi_config,ghl_location_id,ghl_access_token,ghl_refresh_token,ghl_token_expires_at&limit=1`);
    client = rows && rows[0];
  } catch (_) {}

  // Upsert the thread + record the inbound message.
  let thread = null;
  try {
    const rows = await sb(`sms_threads?on_conflict=client_id,contact_phone`, {
      method: "POST", headers: { Prefer: "resolution=merge-duplicates,return=representation" },
      body: JSON.stringify([{ client_id: clientId, contact_phone: from }]),
    });
    thread = Array.isArray(rows) ? rows[0] : null;
  } catch (e) { console.error("twilio inbound thread upsert:", e.message); }

  const occurred = new Date().toISOString();
  if (thread) {
    try {
      await sb(`sms_messages`, { method: "POST", headers: { Prefer: "return=minimal" },
        body: JSON.stringify([{ thread_id: thread.id, client_id: clientId, provider: "twilio", direction: "inbound", channel: "sms", body: bodyText.slice(0, 8000), status: "received", twilio_sid: sid, occurred_at: occurred, raw: p }]) });
      await sb(`sms_threads?id=eq.${thread.id}`, { method: "PATCH", headers: { Prefer: "return=minimal" },
        body: JSON.stringify({ last_message_at: occurred, last_preview: bodyText.trim().slice(0, 160), last_direction: "inbound", unread: true, updated_at: occurred }) });
    } catch (e) { console.error("twilio inbound store:", e.message); }
  }

  const ghlContactId = thread?.ghl_contact_id || null;

  // Compliance: a STOP is recorded but never wakes an agent (Twilio's Advanced
  // Opt-Out already blocks further sends at the carrier level). START-style
  // opt-in keywords are deliberately NOT swallowed: a bare "Yes" is one of the
  // most common REAL replies ("still interested?" -> "Yes") and the old early
  // return threw the hottest signal away - no automation exit, no bounce to
  // Responded, no Hawkeye card (caught live on GTA 2026-07-10: lead Augustina
  // answered a ghost nudge with "Yes" and stayed stuck in Interested). A true
  // re-opt-in ("start"/"unstop") re-engaging the agent is desired behavior.
  const norm = bodyText.trim().toLowerCase().replace(/\s+/g, " ");
  if (STOP_WORDS.has(norm)) return xmlOk(res);

  // 'Liked' tapback rule (Zoran 2026-07-09, parity with the GHL webhook): a
  // tapback is stored above but NEVER wakes an agent, cancels approved cards,
  // exits an automation, or bounces a Ghosted/Nurture lead.
  if (!isRealInbound(bodyText)) return xmlOk(res);

  if (!client) return xmlOk(res);

  // ── Same side-effects as the GHL inbound webhook ───────────────────────────
  try {
    const snip = bodyText.trim().slice(0, 120);
    notifyOwners(client.id, "inbox_message", `💬 New message in your inbox${snip ? `: "${snip}"` : "."}`).catch(() => {});
  } catch (_) {}

  if (ghlContactId) {
    // Soft opt-out ("please stop texting me", "leave me alone"): flag it into the
    // agent's contact memory. Never blocks the flow - bounce + draft still run.
    await flagSoftOptOut(client.id, ghlContactId, bodyText, "twilio-inbound-webhook");

    // Lead replied → cancel pending/approved drafts across every agent queue +
    // any parked reignition (shared helper, same sweep as the GHL reply webhook
    // and the signup path). The detector re-drafts against what they just said.
    try {
      await cancelAllSalesOutbound({
        clientId: client.id, contactId: ghlContactId,
        sendError: "lead replied",
        reigniteReason: "lead replied before the reignition date",
      });
    } catch (e) { console.error("twilio inbound draft-cancel:", e.message); }

    // Member Care (V2): same fast path as the GHL webhook - cancel a stale
    // member-care card, then best-effort redraft (own-store thread read, no GHL
    // creds needed). Two separate blocks so the draft can degrade to cancel-only.
    let careMember = null;
    try {
      if (client.v2_access) {
        const mem = await sb(`members?client_id=eq.${client.id}&ghl_contact_id=eq.${encodeURIComponent(String(ghlContactId))}&select=${MEMBER_CARE_SELECT}&limit=1`);
        careMember = Array.isArray(mem) && mem[0] ? mem[0] : null;
        if (careMember) await cancelPendingMemberCards(client.id, careMember.id, "parent replied again");
      }
    } catch (e) { console.error("twilio inbound member-care cancel:", e.message); }
    try {
      if (careMember && modeIsOn(memberCareAgentMode(client))) {
        const out = await draftMemberCareForMember(client, careMember, { createdBy: "webhook-fastpath" });
        if (out?.inserted) notifyClientPush(client.id, "member-care-ready", { count: 1, view: "members" }).catch(() => {});
      }
    } catch (e) { console.error("twilio inbound member-care draft:", e.message); }

    // Replied while in a portal automation → exit (keyless exit spares 🎉 onboarding) +
    // bounce to Responded. GUARD: only move when the open opp is currently in a NUDGE/
    // GHOST stage (Interested/ghosted or Lead Nurture). Never yank a paid member, a
    // booked Scheduled-Trial lead, an attended Done-Trial lead, or a won/closed opp back
    // to Booking on a single reply.
    try {
      const { exited } = await exitEnrollment({ clientId: client.id, contactId: ghlContactId, reason: "replied" });
      if (exited > 0) {
        const creds = await pickGhlToken(client);
        if (creds) {
          const rs = await respondedStage(creds.token, creds.locationId);
          const { provider } = await pipelineFlags(client.id).catch(() => ({ provider: "ghl" }));
          if (rs && provider === "portal") {
            // Store: read the open opp + its role; bounce to Responded ONLY from a ghost/
            // nurture stage (same guard, read from the store where the true stage lives).
            const rows = await sb(`opportunities?client_id=eq.${encodeURIComponent(client.id)}&ghl_contact_id=eq.${encodeURIComponent(String(ghlContactId))}&status=eq.open&select=id,ghl_opportunity_id,stage_role&limit=1`);
            const opp = Array.isArray(rows) && rows[0];
            if (opp && (opp.stage_role === "ghosted" || opp.stage_role === "interested" || opp.stage_role === "nurture")) {
              await moveStage({ clientId: client.id, sb, ghl, token: creds.token, oppRef: { id: opp.id, ghlOpportunityId: opp.ghl_opportunity_id }, stage: rs, role: "responded", contactId: String(ghlContactId) });
              await markReopened({ clientId: client.id, sb, oppRef: { id: opp.id, ghlOpportunityId: opp.ghl_opportunity_id } });
            }
          } else if (rs) {
            const d = await ghl("GET", `/opportunities/search?${new URLSearchParams({ location_id: creds.locationId, contact_id: String(ghlContactId), limit: "20" })}`, { token: creds.token });
            const opps = d.opportunities || d.data || [];
            const opp = opps.find((o) => String(o.status || "").toLowerCase() === "open") || null;
            if (opp) {
              const curStageId = opp.pipelineStageId || opp.stageId || null;
              const [is, ns] = await Promise.all([
                interestedStage(creds.token, creds.locationId).catch(() => null),
                nurtureStage(creds.token, creds.locationId).catch(() => null),
              ]);
              const ghostStageIds = new Set([is && is.stageId, ns && ns.stageId].filter(Boolean));
              if (ghostStageIds.has(curStageId)) {
                await moveStage({ clientId: client.id, sb, ghl, token: creds.token, oppRef: { ghlOpportunityId: opp.id }, stage: rs, role: "responded", contactId: String(ghlContactId) });
                await markReopened({ clientId: client.id, sb, oppRef: { ghlOpportunityId: opp.id } });
              }
            }
          }
        }
      }
    } catch (e) { console.error("twilio inbound automation-exit:", e.message); }

    // Instant notify when a Responded-stage lead replies + the agent is on.
    try {
      const k = client.ghl_kpi_config || {};
      if (client.v2_access && modeIsOn(agentMode(client)) && k.agent_notify_phone) {
        const creds = await pickGhlToken(client);
        if (creds) {
          const rs = await respondedStage(creds.token, creds.locationId);
          if (rs && await contactInRespondedStage(creds.token, creds.locationId, String(ghlContactId), rs)) {
            await sendSms({ client, toPhone: k.agent_notify_phone, message: `🤖 New chat to approve - ${thread?.contact_name || "a lead"} just replied (${client.business_name || "academy"}). Portal → Inbox → 👁 Hawkeye.`, contactName: "BAM Agent" });
          }
        }
      }
    } catch (e) { console.error("twilio inbound notify:", e.message); }
  }

  return xmlOk(res);
}

export default withSentryApiRoute(handler);
