import { withSentryApiRoute } from "../_sentry.js";
import { pickGhlToken, sendSms, ghl } from "./_core.js";
import { notifyOwners } from "../_notify-owners.js";
import { respondedStage, contactInRespondedStage, scheduledTrialStage, interestedStage, nurtureStage } from "../agent/_stage.js";
import { markReopened } from "../agent/_reopen.js";
import { moveStage, pipelineFlags } from "../agent/_store.js";
import { agentMode, memberCareAgentMode, modeIsOn } from "../agent/_mode.js";
import { exitEnrollment } from "../automations.js";
import { cancelAllSalesOutbound } from "../agent/_cancel-outbound.js";
import { draftMemberCareForMember, cancelPendingMemberCards, MEMBER_CARE_SELECT } from "../agent/member-care.js";
import { notifyClientPush } from "../push/_send.js";
// Vercel Serverless Function — GHL inbound-message webhook  ("P1 Spine")
//
//   POST /api/ghl/inbound-webhook
//
// GoHighLevel calls this whenever a parent REPLIES (configured per academy as a
// Workflow "Webhook" action on the "Customer replied" trigger). It's the shared
// signal the later phases consume:
//   • Nudge engine → cancel pending scheduled sends the instant a lead replies
//   • Sales agent  → wake up and own the thread on the first reply
// For now P1 just records the reply event into `ghl_inbound_messages`; the
// consumers are built in later phases.
//
// Auth: a shared secret (NOT a GHL marketplace signature, so it works with a
// plain Workflow Webhook action). Set GHL_WEBHOOK_SECRET in env and send it on
// the webhook as the `X-Webhook-Secret` header (same convention as
// /api/members/intake) OR a `?key=` query param.
//
// Gating: only V1.5 / V2 academies (clients.v15_access OR v2_access). V1
// (GoHighLevel-native) academies are skipped — the spine never touches them.
//
// Always replies 200 (except auth/method) so GHL never retry-storms us; real
// problems are logged + returned in the body for inspection.

const SUPABASE_URL         = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;

async function sb(path, init = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: SUPABASE_SERVICE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
  });
  if (!res.ok) throw new Error(`Supabase ${res.status}: ${await res.text()}`);
  const txt = await res.text();
  return txt ? JSON.parse(txt) : null;
}

// Soft opt-out phrases inside a longer message ("please stop texting me", "leave
// me alone") - an opt-out signal even without a carrier STOP keyword. Deliberately
// conservative: verbs require the texting/contacting object or a me/us target so
// chatty phrases like "can't stop talking about it" never match ("stop talking"
// only matches with "to me/us"). Shared shape with api/twilio/inbound-webhook.js.
const SOFT_OPTOUT_RE = /\b(?:stop\s+(?:texting|messaging|contacting)(?:\s+(?:me|us))?|stop\s+talking\s+to\s+(?:me|us)|leave\s+(?:me|us)\s+alone|(?:don'?t|do\s+not)\s+(?:text|message|contact|call)\s+(?:me|us)|remove\s+(?:me|us|my\s+number)|take\s+(?:me|us)\s+off\s+(?:your|the|this)\s+list|unsubscribe)\b/i;

// Persistent opt-out note → agent contact memory. The lead said some form of
// "stop contacting me": do NOT block the normal flow (the bounce + Hawkeye draft
// still run so a human sees it), but stamp agent_contact_notes so the agent
// suggests MARK UNQUALIFIED even if the model misses the phrasing. One active
// note per contact (no dupes). Best-effort - never blocks the webhook 200.
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

// GHL's webhook payload keys vary by trigger/marketplace-vs-workflow, so read
// each value from a small list of likely field names.
function pick(obj, keys) {
  for (const k of keys) {
    const v = obj[k];
    if (v != null && v !== "") return v;
  }
  return null;
}

async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  // Auth: two callers. (1) Per-academy GHL Workflow webhook passes our shared
  // secret (header or ?key=). (2) The FC app-level "InboundMessage" webhook uses
  // a PLAIN URL (no secret) — GHL controls the payload. So reject only an
  // explicitly WRONG secret; allow no-secret (app webhook) and correct-secret.
  // Every request still resolves a known academy by locationId + gates below.
  const expected = (process.env.GHL_WEBHOOK_SECRET || "").trim();
  const provided = (req.headers["x-webhook-secret"] || req.query.key || "").toString().trim();
  if (expected && provided && provided !== expected) return res.status(401).json({ error: "unauthorized" });

  const p = req.body && typeof req.body === "object" ? req.body : {};

  // Only inbound replies. The "Customer replied" trigger only fires inbound, but
  // guard anyway in case the academy wired a broader trigger.
  const direction = String(pick(p, ["direction"]) || "").toLowerCase();
  if (direction === "outbound") return res.status(200).json({ skipped: "outbound" });

  // GHL's standard "contact's details" webhook nests fields under objects
  // (location, contact, message) and also merges any Custom Data at the top
  // level. Custom-data merge fields like {{location.id}} don't always resolve,
  // so read from the top level AND the known nested objects.
  const nested = (key, ...paths) => {
    const top = pick(p, key);
    if (top != null && top !== "") return top;
    for (const path of paths) {
      const obj = p[path];
      if (obj && typeof obj === "object") {
        const v = pick(obj, key);
        if (v != null && v !== "") return v;
      }
    }
    return null;
  };

  const locationId =
    nested(["locationId", "location_id"], "customData", "contact", "extras") ||
    (p.location && typeof p.location === "object" ? pick(p.location, ["id", "_id", "locationId"]) : pick(p, ["location"]));
  const contactId =
    nested(["contactId", "contact_id"], "customData", "extras") ||
    (p.contact && typeof p.contact === "object" ? pick(p.contact, ["id", "_id", "contactId"]) : null);
  const conversationId  = nested(["conversationId", "conversation_id"], "customData", "message");
  const messageId       = nested(["messageId", "message_id"], "customData", "message")
    || (p.message && typeof p.message === "object" ? pick(p.message, ["id"]) : null);
  // Body: string-only. Never fall back to the `message` object key (that stored
  // "[object Object]"). On contact-detail triggers it's often empty — the agent
  // fetches the full thread from the inbox later; P1 only needs the event.
  const bodyRaw         = nested(["body"], "customData", "message");
  const body            = typeof bodyRaw === "string" ? bodyRaw : "";
  // A tapback ("Liked ...") never registers as a reply: no draft-cancel, no
  // Ghosted/Nurture bounce (Zoran 2026-07-09). Only filterable when the
  // payload carries text - contact-detail triggers with an empty body pass.
  if (/^Liked\b/.test(body.trim())) {
    return res.status(200).json({ ok: true, skipped: "tapback" });
  }
  const channelRaw      = nested(["messageType", "message_type", "channel"], "customData", "message");
  const channel         = channelRaw != null && channelRaw !== "" ? String(channelRaw).replace(/^TYPE_/i, "").toLowerCase() : null;
  const occurredAtRaw   = nested(["dateAdded", "createdAt", "timestamp", "date", "date_created"], "message");

  // No academy id anywhere → echo what GHL sent (visible in GHL's webhook
  // execution log) so the payload shape can be diagnosed in one shot.
  if (!locationId) {
    return res.status(200).json({ skipped: "no locationId in payload", payload_keys: Object.keys(p), raw: p });
  }

  // Resolve the academy by GHL location, and GATE to V1.5/V2 only.
  let client;
  try {
    const rows = await sb(
      `clients?ghl_location_id=eq.${encodeURIComponent(String(locationId))}` +
      `&select=id,business_name,v15_access,v2_access,ghl_access_token,ghl_refresh_token,ghl_token_expires_at,ghl_location_id,ghl_kpi_config&limit=1`
    );
    client = Array.isArray(rows) && rows[0];
  } catch (e) {
    console.error("ghl inbound-webhook lookup error:", e.message);
    return res.status(200).json({ error: e.message });
  }
  if (!client) return res.status(200).json({ skipped: "no academy for location", locationId });
  if (!client.v15_access && !client.v2_access) {
    return res.status(200).json({ skipped: "V1 academy — spine disabled", client_id: client.id });
  }

  // ── Appointment events ──
  // The FC app posts AppointmentCreate to this same webhook URL. Fire the
  // "calendar_booking" owner text with the contact + booking details, then stop
  // (appointments don't go through the message spine). Best-effort.
  const _evtType = nested(["type", "event", "eventType"], "customData", "message") || p.type || "";
  const _appt = p.appointment || (p.customData && p.customData.appointment) || null;
  if (/appointment/i.test(String(_evtType)) || _appt) {
    try {
      const a = _appt || {};
      const apptContactId = a.contactId || a.contact_id || contactId || null;
      let cName = "", cPhone = "", cEmail = "";
      if (apptContactId) {
        try {
          const creds = await pickGhlToken(client);
          if (creds) {
            const cr = await ghl("GET", `/contacts/${apptContactId}`, { token: creds.token });
            const c2 = (cr && (cr.contact || cr)) || {};
            cName = c2.name || [c2.firstName, c2.lastName].filter(Boolean).join(" ") || "";
            cPhone = c2.phone || "";
            cEmail = c2.email || "";
          }
        } catch (_) { /* best-effort - details are a bonus */ }
      }
      const startRaw = a.startTime || a.start_time || a.selectedSlot || a.appointmentStartTime || null;
      let when = "";
      if (startRaw) { const d = new Date(startRaw); if (!isNaN(d.getTime())) when = d.toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" }); }
      const what = a.title || a.calendarName || a.calendar || "appointment";
      const lines = [
        `📅 New booking - ${what}`,
        cName ? `Who: ${cName}${cPhone ? " · " + cPhone : ""}${cEmail ? " · " + cEmail : ""}` : "",
        when ? `When: ${when}` : "",
      ].filter(Boolean);
      notifyOwners(client.id, "calendar_booking", lines.join("\n")).catch(() => {});
    } catch (e) { console.error("ghl inbound-webhook appointment error:", e.message); }

    // A booking is a hard exit from the sales drip: a lead who books a trial
    // shouldn't keep getting nudges (nurture / ghosted / contact_form / trial_form),
    // and their card should land in Scheduled Trial so the Confirm agent owns it -
    // even if they booked without ever texting first. No-key exit clears ALL active
    // enrollments. Both halves are best-effort and never block the webhook 200.
    try {
      const apptContactId = (_appt && (_appt.contactId || _appt.contact_id)) || contactId || null;
      if (apptContactId) {
        try { await exitEnrollment({ clientId: client.id, contactId: String(apptContactId), reason: "booked" }); } catch (_) {}
        try {
          const creds = await pickGhlToken(client);
          if (creds) {
            const sts = await scheduledTrialStage(creds.token, creds.locationId);
            if (sts) {
              const d = await ghl("GET", `/opportunities/search?${new URLSearchParams({ location_id: creds.locationId, contact_id: String(apptContactId), limit: "20" })}`, { token: creds.token });
              const opps = d.opportunities || d.data || [];
              // ONLY move an OPEN opp. A member booking a training session also hits this
              // webhook - they have no open sales opp (theirs is won), so we must NOT grab
              // opps[0] and shove a won/closed card into Scheduled Trial. Open-only = no-op
              // for members + already-closed leads. (We keep this raw open-only find rather
              // than findOpenOpp, whose ghl branch falls back to opps[0] - that fallback
              // would reintroduce the exact won-member bug this guard prevents.) The MOVE
              // itself goes through the provider-aware store; on ghl it is the identical PUT.
              const oppId = (opps.find(o => String(o.status || "").toLowerCase() === "open") || null)?.id || null;
              if (oppId) await moveStage({ clientId: client.id, sb, ghl, token: creds.token, oppRef: { ghlOpportunityId: oppId }, stage: sts, role: "scheduled_trial", contactId: String(apptContactId) });
            }
          }
        } catch (e) { console.error("ghl inbound-webhook appointment stage-move error:", e.message); }
      }
    } catch (e) { console.error("ghl inbound-webhook appointment exit error:", e.message); }

    return res.status(200).json({ ok: true, type: "appointment", client_id: client.id });
  }

  // Record the reply event (idempotent on client_id + GHL message id).
  let occurredAt;
  try { occurredAt = occurredAtRaw ? new Date(occurredAtRaw).toISOString() : new Date().toISOString(); }
  catch (_) { occurredAt = new Date().toISOString(); }

  // return=representation so a DUPLICATE delivery (same client_id + ghl_message_id)
  // comes back as 0 rows: GHL retries webhooks, and re-firing the owner/agent
  // notify SMS on every retry spammed the academy. Only a genuinely NEW row runs
  // the side-effects below. A missing message id can't dedup, so it's treated as
  // new (fires once, same as before).
  let isNewMessage = true;
  try {
    const ins = await sb(`ghl_inbound_messages?on_conflict=client_id,ghl_message_id`, {
      method: "POST",
      headers: { Prefer: "resolution=ignore-duplicates,return=representation" },
      body: JSON.stringify([{
        client_id:           client.id,
        ghl_location_id:     String(locationId),
        ghl_contact_id:      contactId ? String(contactId) : null,
        ghl_conversation_id: conversationId ? String(conversationId) : null,
        ghl_message_id:      messageId ? String(messageId) : null,
        channel,
        direction:           direction || "inbound",
        body:                String(body).slice(0, 8000),
        occurred_at:         occurredAt,
        raw:                 p,
      }]),
    });
    if (messageId) isNewMessage = Array.isArray(ins) && ins.length > 0;
  } catch (e) {
    console.error("ghl inbound-webhook insert error:", e.message);
    return res.status(200).json({ error: e.message });
  }
  // A duplicate delivery: the row already exists and every side-effect already
  // ran on the first delivery. Ack and stop so nothing re-fires.
  if (!isNewMessage) return res.status(200).json({ ok: true, client_id: client.id, duplicate: true });

  // Owner/staff SMS (V1.5/V2, per notification_prefs). Non-fatal. A snippet of
  // the reply so the owner knows someone messaged the academy.
  try {
    const snip = String(body || "").trim().slice(0, 120);
    notifyOwners(client.id, "inbox_message",
      `💬 New ${channel || "message"} in your inbox${snip ? `: "${snip}"` : "."}`).catch(() => {});
  } catch (_) { /* non-fatal */ }

  // Soft opt-out ("please stop texting me", "leave me alone"): flag it into the
  // agent's contact memory. Never blocks the flow - bounce + draft still run.
  if (contactId && body) await flagSoftOptOut(client.id, String(contactId), body, "ghl-inbound-webhook");

  // Lead just replied → cancel any pending/approved drafts for them (don't text
  // someone who's already talking to us): every agent queue (followups, ready,
  // confirm, closing) PLUS any parked "yes, but later" reignition, in one sweep.
  // Shared helper (api/agent/_cancel-outbound.js) so the reply path, the Twilio
  // reply path, and the signup path can never drift on which queues get cleared.
  try {
    if (contactId) {
      await cancelAllSalesOutbound({
        clientId: client.id, contactId,
        sendError: "lead replied",
        // A reply pulls the queued cards but NOT the park: "circle back on the
        // 28th" is a decision, not something a logistics text should erase.
        keepReignition: true,
      });
    }
  } catch (e) { console.error("ghl inbound-webhook draft-cancel error:", e.message); }

  // Member Care (V2): if this inbound is from a MEMBER's parent, any pending
  // member-care card no longer reflects the thread - cancel it, then best-effort
  // draft a fresh one so staff see a current card within seconds instead of
  // waiting for the 15-min cron. TWO separate try/catch blocks on purpose: if
  // webhook latency ever becomes a problem, delete the draft block below and the
  // cron picks up the redraft (cancel-only degradation).
  let careMember = null;
  try {
    if (contactId && client.v2_access) {
      const mem = await sb(`members?client_id=eq.${client.id}&ghl_contact_id=eq.${encodeURIComponent(String(contactId))}&select=${MEMBER_CARE_SELECT}&limit=1`);
      careMember = Array.isArray(mem) && mem[0] ? mem[0] : null;
      if (careMember) await cancelPendingMemberCards(client.id, careMember.id, "parent replied again");
    }
  } catch (e) { console.error("ghl inbound member-care cancel:", e.message); }
  try {
    if (careMember && modeIsOn(memberCareAgentMode(client))) {
      const creds = await pickGhlToken(client);
      const out = await draftMemberCareForMember(client, careMember, { token: creds?.token, locationId: creds?.locationId, createdBy: "webhook-fastpath" });
      if (out?.inserted) notifyClientPush(client.id, "member-care-ready", { count: 1, view: "members" }).catch(() => {});
    }
  } catch (e) { console.error("ghl inbound member-care draft:", e.message); }

  // Lead replied while in a portal automation (any EXCEPT 🎉 onboarding: the form-intro
  // 📝 contact_form / 🏀 trial_form first touches, 👻 Ghosted, 💔 Lead Nurture) → exit the
  // sequence (keyless exitEnrollment exits all active enrollments but spares onboarding)
  // and bounce them to Booking (Responded) so the booking agent picks them up warm
  // (mirrors the GHL ghosted "reply -> Responded" behavior). Best-effort.
  // GUARD: ONLY move the card when its open opp is currently in a NUDGE/GHOST stage
  // (Interested/ghosted or Lead Nurture). A reply from a paid member, a booked
  // Scheduled-Trial lead, an attended Done-Trial lead, or any won/closed opp must NOT
  // be yanked back to Booking - leave those put.
  try {
    if (contactId) {
      const { exited } = await exitEnrollment({ clientId: client.id, contactId, reason: "replied" });
      if (exited > 0) {
        const creds = await pickGhlToken(client);
        if (creds) {
          const rs = await respondedStage(creds.token, creds.locationId);
          const { provider } = await pipelineFlags(client.id).catch(() => ({ provider: "ghl" }));
          if (rs && provider === "portal") {
            // Portal store: the GHL board is frozen on these academies - read the
            // open opp + its role from the store (mirrors twilio/inbound-webhook).
            // Same guard: bounce to Responded ONLY from a ghost/nurture stage.
            const rows = await sb(`opportunities?client_id=eq.${encodeURIComponent(client.id)}&ghl_contact_id=eq.${encodeURIComponent(String(contactId))}&status=eq.open&select=id,ghl_opportunity_id,stage_role&limit=1`);
            const opp = Array.isArray(rows) && rows[0];
            if (opp && (opp.stage_role === "ghosted" || opp.stage_role === "interested" || opp.stage_role === "nurture")) {
              await moveStage({ clientId: client.id, sb, ghl, token: creds.token, oppRef: { id: opp.id, ghlOpportunityId: opp.ghl_opportunity_id }, stage: rs, role: "responded", contactId: String(contactId) });
              await markReopened({ clientId: client.id, sb, oppRef: { id: opp.id, ghlOpportunityId: opp.ghl_opportunity_id } });
            }
          } else if (rs) {
            const d = await ghl("GET", `/opportunities/search?${new URLSearchParams({ location_id: creds.locationId, contact_id: String(contactId), limit: "20" })}`, { token: creds.token });
            const opps = d.opportunities || d.data || [];
            const opp = opps.find(o => String(o.status || "").toLowerCase() === "open") || null;
            if (opp) {
              const curStageId = opp.pipelineStageId || opp.stageId || null;
              const [is, ns] = await Promise.all([
                interestedStage(creds.token, creds.locationId).catch(() => null),
                nurtureStage(creds.token, creds.locationId).catch(() => null),
              ]);
              const ghostStageIds = new Set([is && is.stageId, ns && ns.stageId].filter(Boolean));
              if (ghostStageIds.has(curStageId)) {
                // Guard preserved exactly (open opp currently in Interested/Nurture). The
                // move runs through the provider-aware store; on ghl it is the identical PUT.
                await moveStage({ clientId: client.id, sb, ghl, token: creds.token, oppRef: { ghlOpportunityId: opp.id }, stage: rs, role: "responded", contactId: String(contactId) });
                await markReopened({ clientId: client.id, sb, oppRef: { ghlOpportunityId: opp.id } });
              }
            }
          }
        }
      }
    }
  } catch (e) { console.error("ghl inbound-webhook automation-exit error:", e.message); }

  // Instant notify: when a Responded-stage lead replies (a chat that needs
  // approval), text the academy's configured number. Best-effort — never blocks.
  try {
    const cfg = client.ghl_kpi_config || {};
    if (client.v2_access && modeIsOn(agentMode(client)) && cfg.agent_notify_phone && contactId) {
      const creds = await pickGhlToken(client);
      if (creds) {
        const rs = await respondedStage(creds.token, creds.locationId);
        if (rs && await contactInRespondedStage(creds.token, creds.locationId, String(contactId), rs)) {
          const who = pick(p, ["full_name", "fullName", "contactName", "name", "first_name"]) || "a lead";
          await sendSms({ client, toPhone: cfg.agent_notify_phone, message: `🤖 New chat to approve - ${who} just replied (${client.business_name || "academy"}). Portal → Inbox → 👁 Hawkeye.`, contactName: "BAM Agent" });
        }
      }
    }
  } catch (e) { console.error("ghl inbound-webhook notify error:", e.message); }

  return res.status(200).json({ ok: true, client_id: client.id, recorded: true });
}

export default withSentryApiRoute(handler);
