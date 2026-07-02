import { withSentryApiRoute } from "../_sentry.js";
// Contact-level click-to-call (portal-native, off-GHL).
//
//   POST /api/twilio/call  body: { client_id, phone, contact_name?, ghl_contact_id? }
//     → rings the academy's staff cell, then bridges to the contact (caller ID =
//       the academy number). Same spine as the member drawer's
//       /api/members?action=call, but keyed on a raw phone so the Inbox and
//       Pipeline can call ANY contact, member or not.
//
// Auth: Supabase JWT - BAM staff, or a member of the academy via client_users.

import { sb, loadVoiceConfig, startClickToCall, logCall } from "./_voice.js";

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;

async function resolveUser(req) {
  const token = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  if (!token) throw Object.assign(new Error("no token"), { status: 401 });
  const userRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: SUPABASE_SERVICE_KEY, Authorization: `Bearer ${token}` },
  });
  if (!userRes.ok) throw Object.assign(new Error("invalid token"), { status: 401 });
  const user = await userRes.json();

  let staff = await sb(`staff?user_id=eq.${user.id}&select=id&limit=1`);
  if ((!staff || !staff[0]) && user.email) {
    staff = await sb(`staff?email=eq.${encodeURIComponent(user.email)}&select=id&limit=1`);
  }
  const isStaff = Array.isArray(staff) && !!staff[0];

  const memberships = await sb(
    `client_users?user_id=eq.${user.id}&status=eq.active&select=client_id`
  );
  const clientIds = Array.isArray(memberships) ? memberships.map((m) => m.client_id) : [];
  return { user, isStaff, clientIds };
}

async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  let ctx;
  try {
    ctx = await resolveUser(req);
  } catch (e) {
    return res.status(e.status || 401).json({ error: e.message });
  }

  const body = (req.body && typeof req.body === "object") ? req.body : {};
  const clientId = String(body.client_id || "").trim();
  const phone = String(body.phone || "").trim();
  if (!clientId) return res.status(400).json({ error: "client_id required" });
  if (!phone) return res.status(400).json({ error: "phone required" });
  if (!ctx.isStaff && !ctx.clientIds.includes(clientId)) {
    return res.status(403).json({ error: "not your academy" });
  }

  const cfg = await loadVoiceConfig(clientId);
  if (!cfg || !cfg.voiceEnabled) return res.status(400).json({ error: "Calling isn't set up for this academy yet." });
  if (!cfg.ringNumbers.length) return res.status(400).json({ error: "No staff phone is configured to ring." });

  const call = await startClickToCall(cfg, { leadPhone: phone });
  await logCall({
    client_id: clientId, direction: "outbound", status: call.status || "queued",
    twilio_call_sid: call.sid, from_number: cfg.from, to_number: phone, contact_phone: phone,
    ghl_contact_id: body.ghl_contact_id ? String(body.ghl_contact_id) : null,
    contact_name: body.contact_name ? String(body.contact_name).slice(0, 120) : null,
    answered_by: call.staff || null, occurred_at: new Date().toISOString(),
    raw: { sid: call.sid, initiated_by: ctx.user?.id || null, via: "contact-call" },
  });
  return res.status(200).json({ ok: true, call_sid: call.sid, status: call.status, ringing: call.staff });
}

export default withSentryApiRoute(handler);
