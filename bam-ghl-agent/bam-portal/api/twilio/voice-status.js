import { withSentryApiRoute } from "../_sentry.js";
// Twilio VOICE status callback — final call status + duration for the calls log
// (used mainly by outbound click-to-call; inbound status is set inline by the
// voice-inbound stages). Wired as StatusCallback on outbound Calls.create.
import { updateCallBySid } from "./_voice.js";

async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  const p = (req.body && typeof req.body === "object") ? req.body : {};
  const sid = p.CallSid || null;
  const status = String(p.CallStatus || "").toLowerCase() || null;
  if (sid && status) {
    const patch = { status };
    if (p.CallDuration) patch.duration_seconds = Number(p.CallDuration);
    // Don't clobber the more specific statuses the inbound stages already set:
    // a caller who rang out to voicemail still ends the PARENT call "completed".
    await updateCallBySid(sid, patch, ["voicemail", "no-answer", "busy", "failed"]);
  }
  return res.status(200).send("ok");
}

export default withSentryApiRoute(handler);
