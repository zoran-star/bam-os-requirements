// Unified channel dispatcher for portal-native automations. A thin send layer:
// it picks SMS vs email and nothing else - quiet hours, scheduling, retries, and
// dedupe are the engine's job (api/automations.js), NOT this file's.
//
// SMS goes to a KNOWN GHL contact (by contactId) the same way the agents send -
// ghl POST /conversations/messages. NOTE: this is deliberately NOT ghl/_core.js
// `sendSms`, which upserts a NEW contact by phone (that helper is for staff
// notifications, not for messaging an existing lead).
import { ghl } from "./ghl/_core.js";
import { sendEmail } from "./_email.js";
import { renderEmail, resolveMergeVars, locFor } from "./email-shells.js";

// Send one message on one channel.
//   { channel:'sms',   contactId, body, ghlToken, vars }
//   { channel:'email', toEmail, subject, body, clientId, vars }
// `vars` carries the lead's resolved details ({first_name, full_name, athlete})
// so {{contact.first_name}} / {{contact.fullName}} fill in at send time. GHL does
// NOT process merge tokens on raw /conversations/messages sends, so SMS tokens are
// resolved here (email tokens resolve inside renderEmail).
// Returns { sent:true, id } on success, { skipped:reason } when nothing went out
// (e.g. a suppressed email address), and THROWS on a hard failure so the worker
// can retry / record the error.
export async function sendOn({ channel, clientId, contactId, toEmail, toPhone, subject, body, ghlToken, vars } = {}) {
  const text = String(body || "").trim();
  if (!text) throw new Error("sendOn: empty body");

  if (channel === "email") {
    if (!toEmail) return { skipped: "no email on file" };
    // Wrap the step's text in the academy's branded shell so every automation
    // email is on-brand (the step body carries only the message copy). Subject
    // can carry merge tokens too, so resolve it against the same vars.
    const subj = resolveMergeVars(String(subject || ""), locFor(clientId), vars || {});
    const html = renderEmail({ clientId, subject: subj, body: text, vars });
    const r = await sendEmail({ to: toEmail, subject: subj, html, clientId });
    if (r && r.skipped) return { skipped: r.skipped };
    return { sent: true, id: (r && r.id) || null };
  }

  if (channel === "sms") {
    if (!ghlToken) throw new Error("sendOn(sms): ghlToken required");
    if (!contactId) return { skipped: "no contact for sms" };
    const message = resolveMergeVars(text, locFor(clientId), vars || {});
    const resp = await ghl("POST", `/conversations/messages`, { token: ghlToken, body: { type: "SMS", contactId, message } });
    return { sent: true, id: (resp && resp.messageId) || null };
  }

  throw new Error(`sendOn: unknown channel '${channel}'`);
}
