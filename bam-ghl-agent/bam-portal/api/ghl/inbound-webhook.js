import { withSentryApiRoute } from "../_sentry.js";
import { pickGhlToken, sendSms, ghl } from "./_core.js";
import { notifyOwners } from "../_notify-owners.js";
import { respondedStage, contactInRespondedStage, scheduledTrialStage } from "../agent/_stage.js";
import { agentMode, modeIsOn } from "../agent/_mode.js";
import { exitEnrollment } from "../automations.js";
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
        `📅 New booking — ${what}`,
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
              // for members + already-closed leads.
              const oppId = (opps.find(o => String(o.status || "").toLowerCase() === "open") || null)?.id || null;
              if (oppId) await ghl("PUT", `/opportunities/${encodeURIComponent(oppId)}`, { token: creds.token, body: { pipelineId: sts.pipelineId, pipelineStageId: sts.stageId } });
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

  try {
    await sb(`ghl_inbound_messages?on_conflict=client_id,ghl_message_id`, {
      method: "POST",
      headers: { Prefer: "resolution=ignore-duplicates,return=minimal" },
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
  } catch (e) {
    console.error("ghl inbound-webhook insert error:", e.message);
    return res.status(200).json({ error: e.message });
  }

  // Owner/staff SMS (V1.5/V2, per notification_prefs). Non-fatal. A snippet of
  // the reply so the owner knows someone messaged the academy.
  try {
    const snip = String(body || "").trim().slice(0, 120);
    notifyOwners(client.id, "inbox_message",
      `💬 New ${channel || "message"} in your inbox${snip ? `: "${snip}"` : "."}`).catch(() => {});
  } catch (_) { /* non-fatal */ }

  // Lead just replied → cancel any pending/approved drafts for them (don't text
  // someone who's already talking to us): scheduled follow-ups AND ready replies
  // (the old ready draft was for their previous message; the detector re-drafts).
  try {
    if (contactId) {
      const cid = encodeURIComponent(String(contactId));
      const patch = { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ status: "canceled", send_error: "lead replied", updated_at: new Date().toISOString() }) };
      await sb(`agent_followups?client_id=eq.${client.id}&ghl_contact_id=eq.${cid}&status=in.(pending,approved)`, patch);
      await sb(`agent_ready_replies?client_id=eq.${client.id}&ghl_contact_id=eq.${cid}&status=in.(pending,approved)`, patch);
      // Same for the confirm agent: a stale opener/confirm card is for their prior
      // state; the confirm detector re-drafts against what they just said.
      await sb(`agent_confirm_replies?client_id=eq.${client.id}&ghl_contact_id=eq.${cid}&status=in.(pending,approved)`, patch);
    }
  } catch (e) { console.error("ghl inbound-webhook draft-cancel error:", e.message); }

  // Lead replied while in a portal automation (any: the form-intro 📝 contact_form /
  // 🏀 trial_form first touches, 👻 Ghosted, 💔 Lead Nurture) → exit the sequence
  // (exitEnrollment with no automationKey exits ALL active enrollments) and bounce them
  // to Booking (Responded) so the booking agent picks them up warm (mirrors the GHL
  // ghosted "reply -> Responded" behavior). Best-effort.
  try {
    if (contactId) {
      const { exited } = await exitEnrollment({ clientId: client.id, contactId, reason: "replied" });
      if (exited > 0) {
        const creds = await pickGhlToken(client);
        if (creds) {
          const rs = await respondedStage(creds.token, creds.locationId);
          const d = await ghl("GET", `/opportunities/search?${new URLSearchParams({ location_id: creds.locationId, contact_id: String(contactId), limit: "20" })}`, { token: creds.token });
          const opps = d.opportunities || d.data || [];
          const oppId = (opps.find(o => String(o.status || "").toLowerCase() === "open") || opps[0] || null)?.id || null;
          if (rs && oppId) await ghl("PUT", `/opportunities/${encodeURIComponent(oppId)}`, { token: creds.token, body: { pipelineId: rs.pipelineId, pipelineStageId: rs.stageId } });
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
