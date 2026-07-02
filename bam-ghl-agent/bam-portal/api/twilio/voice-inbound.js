import { withSentryApiRoute } from "../_sentry.js";
// Twilio VOICE inbound (cell-forwarding). Wired as the academy number's VoiceUrl:
//   https://portal.byanymeansbusiness.com/api/twilio/voice-inbound
//
// Flow (single endpoint, staged via ?stage=):
//   (initial)    incoming call → log it → <Dial> the academy's staff cell(s),
//                caller ID = the lead's number so staff see who's calling.
//   ?stage=dial  the <Dial> finished. Answered → hang up (bridged call is over).
//                Not answered + voicemail on → greet + <Record> (transcribed).
//   ?stage=vm    the voicemail recording finished → store it + text staff.
//   ?stage=txn   the transcription arrived → store the transcript.
//
// Security: validates X-Twilio-Signature with the academy's auth token
// (fail-closed, same as the SMS inbound webhook).

import {
  loadVoiceConfigByNumber, validSignature, requestUrl, absUrl, sendTwiml,
  xmlEscape, contactForPhone, logCall, updateCallBySid, sendSmsVia, sendMissedCallText,
} from "./_voice.js";

const DIAL_TIMEOUT = 20;   // seconds to ring the cell before voicemail
const VM_MAX_LEN   = 120;  // seconds of voicemail allowed

function say(msg) { return `<Say voice="alice">${xmlEscape(msg)}</Say>`; }

async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  const p = (req.body && typeof req.body === "object") ? req.body : {};
  const stage = String(req.query.stage || "").trim();

  const from = String(p.From || "").trim();   // the caller (lead) on the initial hit
  const to   = String(p.To || "").trim();      // the academy's number
  const callSid = p.CallSid || null;

  // Resolve the academy by the number that was called. For sub-stages the To/From
  // may be the bridged legs, so fall back to a ?num= we thread through the actions.
  const academyNumber = String(req.query.num || to || "").trim();
  const cfg = await loadVoiceConfigByNumber(academyNumber);
  if (!cfg || !cfg.voiceEnabled) {
    // Unknown/disabled number — say a neutral line and hang up (never dial).
    return sendTwiml(res, `<Response>${say("Sorry, this number is not available.")}<Hangup/></Response>`);
  }

  // Signature check (fail-closed).
  const url = requestUrl(req);
  if (cfg.authToken && !validSignature(cfg.authToken, url, p, req.headers["x-twilio-signature"])) {
    return res.status(403).send("<Response><Reject/></Response>");
  }

  const actionUrl = (s) => absUrl(req, `/api/twilio/voice-inbound?stage=${s}&num=${encodeURIComponent(cfg.from)}`);

  // ── Sub-stage: the <Dial> completed ────────────────────────────────────────
  if (stage === "dial") {
    const dialStatus = String(p.DialCallStatus || "").toLowerCase();
    if (dialStatus === "completed" || dialStatus === "answered") {
      await updateCallBySid(callSid, { status: "completed", answered_by: p.DialCallSid ? undefined : undefined });
      return sendTwiml(res, `<Response><Hangup/></Response>`);
    }
    // Missed call → auto-text the caller once, via the portal SMS spine (off-GHL, so
    // it threads in the portal inbox and their reply lands there). Best-effort.
    await sendMissedCallText(cfg, String(p.From || "").trim()).catch(() => {});
    // Not answered → voicemail (if enabled).
    if (cfg.voicemailEnabled) {
      await updateCallBySid(callSid, { status: "no-answer" });
      return sendTwiml(res,
        `<Response>` +
        say("Thanks for calling. We can't take your call right now. Please leave a message after the beep, and we'll get right back to you.") +
        `<Record maxLength="${VM_MAX_LEN}" playBeep="true" transcribe="true" ` +
        `transcribeCallback="${xmlEscape(actionUrl("txn"))}" action="${xmlEscape(actionUrl("vm"))}" method="POST"/>` +
        say("We didn't get a recording. Goodbye.") +
        `<Hangup/></Response>`);
    }
    await updateCallBySid(callSid, { status: dialStatus || "no-answer" });
    return sendTwiml(res, `<Response>${say("Sorry we missed you. Please try again later.")}<Hangup/></Response>`);
  }

  // ── Sub-stage: voicemail recording finished ────────────────────────────────
  if (stage === "vm") {
    const recUrl = p.RecordingUrl ? `${p.RecordingUrl}.mp3` : null;
    await updateCallBySid(callSid, { status: "voicemail", recording_url: recUrl, duration_seconds: p.RecordingDuration ? Number(p.RecordingDuration) : undefined });
    // Text staff that a voicemail landed (transcript follows separately).
    // No raw recording link - Twilio 401s media without creds; the portal's
    // voicemail inbox (Inbox → 📼 Voicemail) plays it through the auth proxy.
    const ring = cfg.ringNumbers[0];
    if (ring) await sendSmsVia(cfg, ring, `New voicemail from ${p.From || "a caller"} - listen in the portal inbox: https://portal.byanymeansbusiness.com`);
    return sendTwiml(res, `<Response><Hangup/></Response>`);
  }

  // ── Sub-stage: transcription arrived ───────────────────────────────────────
  if (stage === "txn") {
    const text = String(p.TranscriptionText || "").trim();
    if (text) {
      await updateCallBySid(callSid, { voicemail_transcript: text });
      const ring = cfg.ringNumbers[0];
      if (ring) await sendSmsVia(cfg, ring, `Voicemail transcript from ${p.From || "a caller"}:\n"${text}"`);
    }
    return res.status(200).send("ok"); // transcribeCallback ignores TwiML
  }

  // ── Initial inbound call ────────────────────────────────────────────────────
  if (!cfg.ringNumbers.length) {
    // No cell configured → straight to voicemail if enabled, else unavailable.
    if (cfg.voicemailEnabled) {
      return sendTwiml(res,
        `<Response>` +
        say("Thanks for calling. Please leave a message after the beep.") +
        `<Record maxLength="${VM_MAX_LEN}" playBeep="true" transcribe="true" transcribeCallback="${xmlEscape(actionUrl("txn"))}" action="${xmlEscape(actionUrl("vm"))}" method="POST"/>` +
        `<Hangup/></Response>`);
    }
    return sendTwiml(res, `<Response>${say("Sorry, we're unavailable right now.")}<Hangup/></Response>`);
  }

  // Log the inbound call (idempotent on CallSid).
  const ident = await contactForPhone(cfg.clientId, from);
  await logCall({
    client_id: cfg.clientId, direction: "inbound", status: "ringing", twilio_call_sid: callSid,
    from_number: from, to_number: to, contact_phone: from,
    ghl_contact_id: ident.ghlContactId || null, contact_name: ident.contactName || null,
    occurred_at: new Date().toISOString(), raw: { CallSid: callSid, From: from, To: to },
  });

  const record = cfg.voiceRecord ? ` record="record-from-answer"` : "";
  const numbers = cfg.ringNumbers.map((n) => `<Number>${xmlEscape(n)}</Number>`).join("");
  // answerOnBridge=true → caller hears ringing (not dead air) until staff picks up.
  // callerId = the lead's number so staff see who is calling.
  return sendTwiml(res,
    `<Response>` +
    `<Dial timeout="${DIAL_TIMEOUT}" answerOnBridge="true" callerId="${xmlEscape(from || cfg.from)}" ` +
    `action="${xmlEscape(actionUrl("dial"))}" method="POST"${record}>` +
    numbers +
    `</Dial></Response>`);
}

export default withSentryApiRoute(handler);
export const config = { api: { bodyParser: true } };
