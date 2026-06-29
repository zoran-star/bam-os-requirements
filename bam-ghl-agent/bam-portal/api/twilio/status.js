import { withSentryApiRoute } from "../_sentry.js";
// Messaging spine (4/5): Twilio delivery-status callback. Twilio POSTs here as a
// message moves queued -> sent -> delivered / failed / undelivered (the
// StatusCallback URL set by the outbound sender). We stamp the matching
// sms_messages row by its Twilio SID so the inbox can show delivery state.
const SB_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;

async function sb(path, init = {}) {
  const r = await fetch(`${SB_URL}/rest/v1/${path}`, { ...init, headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, "Content-Type": "application/json", ...(init.headers || {}) } });
  if (!r.ok) throw new Error(`Supabase ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const t = await r.text(); return t ? JSON.parse(t) : null;
}

async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  const p = (req.body && typeof req.body === "object") ? req.body : {};
  const sid = p.MessageSid || p.SmsSid || null;
  const status = p.MessageStatus || p.SmsStatus || null;
  if (!sid || !status) return res.status(204).end();
  try {
    const patch = { status };
    if (p.ErrorCode) patch.error = `Twilio ${p.ErrorCode}`;
    await sb(`sms_messages?twilio_sid=eq.${encodeURIComponent(sid)}`, {
      method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify(patch),
    });
  } catch (e) { console.error("twilio status update:", e.message); }
  return res.status(204).end();
}

export default withSentryApiRoute(handler);
