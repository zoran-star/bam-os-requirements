import { withSentryApiRoute } from "../_sentry.js";
// Voicemail inbox for the portal (Twilio voice spine).
//
//   GET  /api/twilio/voicemails?client_id=<uuid>
//     → { enabled, voicemails: [...], unheard } newest first (limit 50).
//   GET  /api/twilio/voicemails?client_id=<uuid>&recording=<call_id>
//     → streams the recording as audio/mpeg. Twilio enforces HTTP basic auth
//       on recording media, so the browser can't play the raw URL - this
//       proxies it with the academy's own creds.
//   POST /api/twilio/voicemails  body: { action: "mark-heard", client_id, id }
//   POST /api/twilio/voicemails  body: { action: "mark-all-heard", client_id }
//
// Auth: Supabase JWT - BAM staff, or a member of the academy via client_users.
// `enabled` mirrors client_twilio_config.voice_enabled so the UI can hide the
// button entirely for academies without the voice spine.

import { sb, loadVoiceConfig, twilioAuthHeader } from "./_voice.js";

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

  let staff = await sb(`staff?user_id=eq.${user.id}&select=id,role,name&limit=1`);
  if ((!staff || !staff[0]) && user.email) {
    staff = await sb(`staff?email=eq.${encodeURIComponent(user.email)}&select=id,role,name&limit=1`);
  }
  const isStaff = Array.isArray(staff) && !!staff[0];

  const memberships = await sb(
    `client_users?user_id=eq.${user.id}&status=eq.active&select=client_id`
  );
  const clientIds = Array.isArray(memberships) ? memberships.map((m) => m.client_id) : [];
  return { user, isStaff, staffName: (isStaff && staff[0].name) || null, clientIds };
}

const VM_COLS = "id,contact_name,contact_phone,ghl_contact_id,duration_seconds,recording_url,voicemail_transcript,occurred_at,heard_at,heard_by";

async function handler(req, res) {
  let ctx;
  try {
    ctx = await resolveUser(req);
  } catch (e) {
    return res.status(e.status || 401).json({ error: e.message });
  }

  const clientId = String((req.method === "GET" ? req.query.client_id : req.body && req.body.client_id) || "").trim();
  if (!clientId) return res.status(400).json({ error: "client_id required" });
  if (!ctx.isStaff && !ctx.clientIds.includes(clientId)) {
    return res.status(403).json({ error: "not your academy" });
  }

  if (req.method === "GET") {
    const cfg = await loadVoiceConfig(clientId).catch(() => null);
    if (!cfg || !cfg.voiceEnabled) return res.status(200).json({ enabled: false, voicemails: [], unheard: 0 });

    // Recording proxy - stream the mp3 with the academy's Twilio creds.
    if (req.query.recording) {
      const rows = await sb(
        `calls?id=eq.${encodeURIComponent(req.query.recording)}&client_id=eq.${encodeURIComponent(clientId)}&select=recording_url&limit=1`
      ).catch(() => []);
      const url = rows && rows[0] && rows[0].recording_url;
      if (!url || !/^https:\/\/api\.twilio\.com\//.test(url)) return res.status(404).json({ error: "no recording" });
      const auth = twilioAuthHeader(cfg);
      if (!auth) return res.status(500).json({ error: "twilio creds missing" });
      const r = await fetch(url, { headers: { Authorization: auth } });
      if (!r.ok) return res.status(502).json({ error: `Twilio ${r.status}` });
      const buf = Buffer.from(await r.arrayBuffer());
      res.setHeader("Content-Type", "audio/mpeg");
      res.setHeader("Cache-Control", "private, max-age=3600");
      return res.status(200).send(buf);
    }
    const rows = await sb(
      `calls?client_id=eq.${encodeURIComponent(clientId)}&status=eq.voicemail&recording_url=not.is.null` +
      `&select=${VM_COLS}&order=occurred_at.desc&limit=50`
    ).catch(() => []);
    const voicemails = Array.isArray(rows) ? rows : [];
    return res.status(200).json({
      enabled: true,
      voicemails,
      unheard: voicemails.filter((v) => !v.heard_at).length,
    });
  }

  if (req.method === "POST") {
    const body = (req.body && typeof req.body === "object") ? req.body : {};
    const heard = {
      heard_at: new Date().toISOString(),
      heard_by: ctx.staffName || ctx.user.email || null,
      updated_at: new Date().toISOString(),
    };
    if (body.action === "mark-heard") {
      if (!body.id) return res.status(400).json({ error: "id required" });
      await sb(
        `calls?id=eq.${encodeURIComponent(body.id)}&client_id=eq.${encodeURIComponent(clientId)}&heard_at=is.null`,
        { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify(heard) }
      );
      return res.status(200).json({ ok: true });
    }
    if (body.action === "mark-all-heard") {
      await sb(
        `calls?client_id=eq.${encodeURIComponent(clientId)}&status=eq.voicemail&heard_at=is.null`,
        { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify(heard) }
      );
      return res.status(200).json({ ok: true });
    }
    return res.status(400).json({ error: "unknown action" });
  }

  return res.status(405).json({ error: "GET or POST only" });
}

export default withSentryApiRoute(handler);
