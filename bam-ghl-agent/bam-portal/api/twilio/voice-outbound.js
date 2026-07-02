import { withSentryApiRoute } from "../_sentry.js";
// Twilio VOICE outbound bridge (click-to-call). We place a call to the staff cell;
// when they answer, Twilio fetches THIS url for what to do → bridge to the lead,
// showing the academy number as caller ID. Params: ?lead=<E164>&num=<academy E164>.
import { loadVoiceConfigByNumber, validSignature, requestUrl, sendTwiml, xmlEscape } from "./_voice.js";

async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  const p = (req.body && typeof req.body === "object") ? req.body : {};
  const lead = String(req.query.lead || "").trim();
  const num  = String(req.query.num || "").trim();

  const cfg = await loadVoiceConfigByNumber(num);
  if (!cfg || !cfg.voiceEnabled) {
    return sendTwiml(res, `<Response><Say voice="alice">This call cannot be completed.</Say><Hangup/></Response>`);
  }
  if (cfg.authToken && !validSignature(cfg.authToken, requestUrl(req), p, req.headers["x-twilio-signature"])) {
    return res.status(403).send("<Response><Reject/></Response>");
  }
  if (!lead) return sendTwiml(res, `<Response><Say voice="alice">No number to dial.</Say><Hangup/></Response>`);

  const record = cfg.voiceRecord ? ` record="record-from-answer"` : "";
  // Bridge the staff (already on the line) to the lead, caller ID = academy number.
  return sendTwiml(res,
    `<Response><Dial callerId="${xmlEscape(cfg.from)}" answerOnBridge="true"${record}>` +
    `<Number>${xmlEscape(lead)}</Number></Dial></Response>`);
}

export default withSentryApiRoute(handler);
