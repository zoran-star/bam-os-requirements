import { withSentryApiRoute } from "../_sentry.js";
// One-time ops endpoint: point an academy's Twilio number VoiceUrl at our inbound
// handler (today it hits Twilio's demo). Gated by Bearer CRON_SECRET.
//   GET/POST /api/twilio/wire-voice?client_id=<uuid>
import { loadVoiceConfig, twilioAuthHeader } from "./_voice.js";

const PROD = "https://portal.byanymeansbusiness.com";

async function handler(req, res) {
  const got = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  if (!process.env.CRON_SECRET) return res.status(500).json({ error: "CRON_SECRET not configured" });
  if (got !== process.env.CRON_SECRET) return res.status(401).json({ error: "unauthorized" });

  const clientId = String(req.query.client_id || (req.body && req.body.client_id) || "").trim();
  if (!clientId) return res.status(400).json({ error: "client_id required" });

  const cfg = await loadVoiceConfig(clientId);
  if (!cfg) return res.status(404).json({ error: "no active twilio config for client" });
  if (!cfg.accountSid || !cfg.from) return res.status(400).json({ error: "config missing account_sid / from_number" });
  const auth = twilioAuthHeader(cfg);
  if (!auth) return res.status(400).json({ error: "twilio auth creds missing" });

  const acct = encodeURIComponent(cfg.accountSid);
  // 1) find the IncomingPhoneNumber SID for this number
  const listRes = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${acct}/IncomingPhoneNumbers.json?PhoneNumber=${encodeURIComponent(cfg.from)}`, { headers: { Authorization: auth } });
  const list = await listRes.json().catch(() => ({}));
  if (!listRes.ok) return res.status(502).json({ error: `Twilio list ${listRes.status}: ${list.message || ""}` });
  const pn = (list.incoming_phone_numbers || [])[0];
  if (!pn || !pn.sid) return res.status(404).json({ error: `number ${cfg.from} not found in Twilio account` });

  // 2) set VoiceUrl + StatusCallback on it
  const form = new URLSearchParams({
    VoiceUrl: `${PROD}/api/twilio/voice-inbound`,
    VoiceMethod: "POST",
    StatusCallback: `${PROD}/api/twilio/voice-status`,
    StatusCallbackMethod: "POST",
  });
  const upRes = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${acct}/IncomingPhoneNumbers/${encodeURIComponent(pn.sid)}.json`, {
    method: "POST",
    headers: { Authorization: auth, "Content-Type": "application/x-www-form-urlencoded" },
    body: form.toString(),
  });
  const up = await upRes.json().catch(() => ({}));
  if (!upRes.ok) return res.status(502).json({ error: `Twilio update ${upRes.status}: ${up.message || ""}` });

  return res.status(200).json({
    ok: true, client_id: clientId, number: cfg.from, phone_number_sid: pn.sid,
    voice_url: up.voice_url || null, status_callback: up.status_callback || null,
  });
}

export default withSentryApiRoute(handler);
