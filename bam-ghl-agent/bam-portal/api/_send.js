// Unified channel dispatcher for portal-native automations. A thin send layer:
// it picks SMS vs email and nothing else - quiet hours, scheduling, retries, and
// dedupe are the engine's job (api/automations.js), NOT this file's.
//
// SMS goes to a KNOWN GHL contact (by contactId) the same way the agents send -
// ghl POST /conversations/messages. NOTE: this is deliberately NOT ghl/_core.js
// `sendSms`, which upserts a NEW contact by phone (that helper is for staff
// notifications, not for messaging an existing lead).
import { ghl } from "./ghl/_core.js";
import { maybeSendSmsViaProvider } from "./messaging/provider.js";
import { sendEmail } from "./_email.js";
import { renderStepMessage, unsubscribeFor } from "./email-shells.js";
import { notifyOwners } from "./_notify-owners.js";

// ── the academy-identity guardrails (email only) ────────────────────────────
// TWO conditions, both resolved from the academy's own client row at runtime and
// both fail CLOSED. An email that cannot satisfy either is HELD: it never reaches
// Resend, nothing generic goes out in its place, and the owner is texted at most
// once per 24h (one cooldown per reason - see HOLD_NOTICES).
//   1. no verified SENDING DOMAIN  -> it cannot go out as the academy
//   2. no BUSINESS EMAIL           -> it cannot carry the academy's own contact
//      address or unsubscribe destination. clients.business_email, never
//      clients.email: that one is the OWNER's inbox, and publishing it to parents
//      as the reply-and-unsubscribe address is the bug the column removed.
// Nothing here falls back to another academy, to a generic BAM address, or to the
// owner. A fallback would make an unconfigured academy look configured.
// Mirrors resolveEmail() in api/messaging/email-provider.js (the human 1:1 lane),
// which stays untouched, and adds the Resend "is it actually verified" check.
const SUPABASE_URL         = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
const RESEND_API_KEY       = process.env.RESEND_API_KEY;
// Same expression as DEFAULT_FROM in api/_email.js (which stays untouched): the
// legacy hardcoded sender every automation email used to go out as. Kept here
// ONLY to recognise it - see the byte-identity rule in fromFor().
const LEGACY_FROM = process.env.RESEND_FROM || "BAM Toronto <info@byanymeanstoronto.ca>";
const addrOf = (s) => { const m = /<([^>]+)>/.exec(String(s || "")); return (m ? m[1] : String(s || "")).trim().toLowerCase(); };
const LEGACY_ADDR = addrOf(LEGACY_FROM);

// Service-role Supabase REST helper (same shape as api/messaging/email-provider.js).
async function sb(path, init = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: { apikey: SUPABASE_SERVICE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`, "Content-Type": "application/json", ...(init.headers || {}) },
  });
  if (!res.ok) throw new Error(`Supabase ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const txt = await res.text();
  return txt ? JSON.parse(txt) : null;
}

const CLIENT_TTL = 30_000;
const _clientCache = new Map(); // clientId -> { at, domain, name, businessEmail }

// THROWS on a DB blip - the caller turns that into a hold WITHOUT an owner text.
async function clientSender(clientId) {
  const hit = _clientCache.get(clientId);
  if (hit && Date.now() - hit.at < CLIENT_TTL) return hit;
  const rows = await sb(`clients?id=eq.${encodeURIComponent(clientId)}&select=email_domain,business_name&limit=1`);
  const row = (Array.isArray(rows) && rows[0]) || {};
  const out = {
    at: Date.now(),
    domain: String(row.email_domain || "").trim().toLowerCase(),
    name: String(row.business_name || "").trim(),
    businessEmail: await businessEmailOf(clientId),
  };
  _clientCache.set(clientId, out);
  return out;
}

// The academy's PUBLIC email (clients.business_email) - the footer contact line, the
// footer Email link, and the unsubscribe destination. Resolved HERE, at the one
// choke point every automation email passes through, because three callers hand
// sendOn `vars: {}` on purpose (their tokens are already resolved: the confirm
// agent's booking confirmation and same-day check-in, and the approvals inbox's
// confirmation email). Reading it off the caller's vars would leave those three
// unable to carry an unsubscribe link at all, which is precisely the state the
// hold below exists to refuse.
//
// ⚠️ SEPARATE QUERY, SEPARATE CATCH, AND TEMPORARY. Migration
// 20260729T210000_clients_business_email.sql is not applied yet, and naming a column
// that does not exist makes PostgREST 400 the WHOLE select - the rule written at
// loadClient() in api/automations.js. Folded into the select above it would take the
// sending domain down with it, and a domain failure holds WITHOUT texting the owner,
// so every academy's email would stop silently. On its own it degrades to "no
// business email", which holds and DOES tell the owner. Once that migration is
// applied: add business_email to the select above, delete this function, and add the
// column to the two loadClient select lists as well.
// Never throws: an unreadable answer is the same as no answer, and both hold.
async function businessEmailOf(clientId) {
  try {
    const rows = await sb(`clients?id=eq.${encodeURIComponent(clientId)}&select=business_email&limit=1`);
    const row = (Array.isArray(rows) && rows[0]) || {};
    return String(row.business_email || "").trim();
  } catch (e) {
    console.error("[_send] business_email lookup failed (holding):", e.message);
    return "";
  }
}

const DOMAINS_TTL = 300_000;
let _domains = { at: 0, set: null };

// The domains Resend will actually accept mail from. Cheap (one GET per 5 min per
// warm instance) and checked BEFORE the send, so an unverified domain holds
// instead of burning retries on a 403. THROWS on a fetch blip.
async function verifiedDomains() {
  if (_domains.set && Date.now() - _domains.at < DOMAINS_TTL) return _domains.set;
  if (!RESEND_API_KEY) throw new Error("RESEND_API_KEY not configured");
  const res = await fetch("https://api.resend.com/domains", { headers: { Authorization: `Bearer ${RESEND_API_KEY}` } });
  if (!res.ok) throw new Error(`Resend domains ${res.status}: ${(await res.text()).slice(0, 120)}`);
  const j = await res.json();
  const list = Array.isArray(j) ? j : (j && Array.isArray(j.data) ? j.data : []);
  const set = new Set(list.filter(d => String(d && d.status || "").toLowerCase() === "verified").map(d => String(d.name || "").trim().toLowerCase()));
  _domains = { at: Date.now(), set };
  return set;
}

// Resolve the From header for one academy.
//   { from, businessEmail }     -> safe to send
//   { hold:true, notify:true }  -> domain missing / unverified (owner gets the text)
//   { hold:true, notify:false } -> transient blip: fail CLOSED, but do NOT ping the
//                                  owner over something they cannot fix.
// `businessEmail` rides along because it comes off the same row read and is needed
// by the same caller for the same reason: an email that cannot go out AS the academy
// and an email that cannot carry the academy's own reply-to / unsubscribe address are
// two halves of one question.
async function fromFor(clientId, vars) {
  if (!clientId) return { hold: true, notify: false };
  let row;
  try { row = await clientSender(clientId); }
  catch (e) { console.error("[_send] sender lookup failed (holding):", e.message); return { hold: true, notify: false }; }
  if (!row.domain) return { hold: true, notify: true };
  let verified;
  try { verified = await verifiedDomains(); }
  catch (e) { console.error("[_send] Resend domain list failed (holding):", e.message); return { hold: true, notify: false }; }
  if (!verified.has(row.domain)) return { hold: true, notify: true };

  const businessEmail = row.businessEmail;
  const addr = `info@${row.domain}`;
  // BYTE-IDENTITY, by domain match and nothing else (no client-id, no academy-name
  // hardcode): the academy that already owns the legacy address keeps the legacy
  // string verbatim, so its parents see zero header drift.
  if (addr === LEGACY_ADDR) return { from: LEGACY_FROM, businessEmail };
  const name = String((vars && vars.location_name) || row.name || "").replace(/[<>"]/g, "").trim();
  return { from: name ? `${name} <${addr}>` : addr, businessEmail };
}

// ── owner heads-up, once per academy per 24h ────────────────────────────────
const HOLD_NOTICE_COOLDOWN_MS = 24 * 3600000;
// One entry per REASON a send can hold. Each carries its own email_events type and
// its own cooldown, because they are different problems with different fixes: one is
// BAM staff finishing email setup, the other is the owner typing an address into
// their own portal. Sharing a dedupe key would mean an academy that hit the domain
// hold this morning is silently muted about the missing public email this afternoon.
const HOLD_NOTICES = {
  domain: {
    type: "domain_hold_notice",
    message: "Heads up: your automation emails are on hold because your academy's sending domain is not set up yet. Ping BAM staff to finish email setup, then held emails go out on their own.",
  },
  business_email: {
    type: "business_email_hold_notice",
    message: "Heads up: your automation emails are on hold because your academy's public email is not set yet. That address is what parents see and what their unsubscribe link uses, so we will not send without it. Add it in your portal under Business blueprint > Business basics and held emails go out on their own.",
  },
};
const _holdClaims = new Map(); // clientId|reason -> ms claimed in THIS process

// Deduped through an email_events row (one type per reason, see HOLD_NOTICES)
// stamped BEFORE the text fires, so a crash between the two can only under-notify
// for one cycle, never spam. Best-effort and never throws.
async function noticeHeldOnce(clientId, reason = "domain") {
  try {
    if (!clientId) return;
    const notice = HOLD_NOTICES[reason];
    if (!notice) return;
    const claimKey = clientId + "|" + reason;
    // Claim SYNCHRONOUSLY, before the first await - one engine pass holds many
    // jobs for the same academy, and set any later they all read an empty stamp
    // and the owner gets texted once per held job.
    const prev = _holdClaims.get(claimKey);
    if (prev && Date.now() - prev < HOLD_NOTICE_COOLDOWN_MS) return;
    _holdClaims.set(claimKey, Date.now());

    const sinceIso = new Date(Date.now() - HOLD_NOTICE_COOLDOWN_MS).toISOString();
    let recent;
    try {
      recent = await sb(`email_events?client_id=eq.${encodeURIComponent(clientId)}&type=eq.${notice.type}&created_at=gte.${sinceIso}&select=id&limit=1`);
    } catch (_) { _holdClaims.delete(claimKey); return; }
    if (Array.isArray(recent) && recent.length) return; // another instance already texted

    let stampId = null;
    try {
      const ins = await sb(`email_events`, {
        method: "POST", headers: { Prefer: "return=representation" },
        body: JSON.stringify([{ client_id: clientId, type: notice.type }]),
      });
      stampId = (Array.isArray(ins) && ins[0] && ins[0].id) || null;
    } catch (_) { _holdClaims.delete(claimKey); return; }

    const r = await notifyOwners(clientId, "settings_alert", notice.message);
    // Nobody actually got it (no owner phone on file): give the stamp back, so a
    // recipient-less academy is not silently muted for the next 24h.
    if (!r || !r.sent) {
      _holdClaims.delete(claimKey);
      if (stampId) { try { await sb(`email_events?id=eq.${stampId}`, { method: "DELETE", headers: { Prefer: "return=minimal" } }); } catch (_) {} }
    }
  } catch (_) { /* a notifier problem must never break the send path */ }
}

// Send one message on one channel.
//   { channel:'sms',   contactId, body, ghlToken, vars }
//   { channel:'email', toEmail, subject, body, clientId, vars }
// `vars` carries the lead's resolved details ({first_name, full_name, athlete})
// so {{contact.first_name}} / {{contact.fullName}} fill in at send time. GHL does
// NOT process merge tokens on raw /conversations/messages sends, so SMS tokens are
// resolved here (email tokens resolve inside renderEmail).
// Returns { sent:true, id } on success, { skipped:reason } when nothing went out
// (e.g. a suppressed email address), { held:reason } when an email could not go
// out AS THE ACADEMY or could not carry the academy's own unsubscribe address (see
// the two guardrails above - the engine re-queues those without burning an
// attempt), and THROWS on a hard failure so the worker can retry / record the
// error.
// A step body that resolves to nothing once merge fields are filled. Reported as
// a SKIP (the engine advances past it) rather than a failure, because there is
// no message to send and no retry that could change that.
const EMPTY_AFTER_MERGE = "empty after merge fields resolved";

// "Does this render to anything at all" is asked of the RESOLVED content, not the
// raw body, and renderStepMessage answers it as `empty`. That matters for a
// "template:<key>" ref, which is never an empty string however empty the email
// behind it turns out to be: since 28 Jul 2026 a template may return "" when the
// academy lacks the one fact that gives the email its purpose (the review ask with
// no Google review link renders three paragraphs asking for a review and no way to
// leave one).

export async function sendOn({ channel, clientId, contactId, toEmail, toPhone, subject, body, ghlToken, vars } = {}) {
  const text = String(body || "").trim();
  if (!text) throw new Error("sendOn: empty body");

  if (channel === "email") {
    if (!toEmail) return { skipped: "no email on file" };
    // HARD GUARDRAIL, before anything is rendered or sent: no verified academy
    // sending domain = the email HOLDS. There is deliberately NO fallback sender.
    const sender = await fromFor(clientId, vars);
    if (!sender.from) {
      if (sender.notify) await noticeHeldOnce(clientId, "domain");
      return { held: "sending domain not set" };
    }
    // SECOND HARD GUARDRAIL: the academy's own public email, rendered from the value
    // resolved above rather than from whatever the caller happened to pass. That
    // substitution is the guard being CONNECTED to its outcome: three callers send
    // `vars: {}` deliberately (tokens pre-resolved), so a check against the row plus
    // a render from the vars would pass and still put an email on the wire with no
    // unsubscribe link in it.
    const renderVars = { ...(vars || {}), location_email: sender.businessEmail };
    // No public email means no unsubscribe destination, and an email with NO
    // unsubscribe path is worse than the bug this replaced (which pointed it at the
    // owner's personal inbox). So it HOLDS, exactly like an unverified sending
    // domain: nothing generic goes out in its place, the engine re-queues without
    // burning an attempt, and the owner is texted at most once per 24h.
    //
    // sendOn takes no unsubscribeUrl and renderStepMessage cannot carry one, so on
    // THIS path "no business email" and "no unsubscribe" are the same condition. If
    // either ever grows that parameter it has to reach BOTH the check and the render,
    // or the check stops describing what goes out.
    if (!unsubscribeFor({ clientId, vars: renderVars })) {
      await noticeHeldOnce(clientId, "business_email");
      return { held: "no business email, so no unsubscribe link" };
    }
    // Wrap the step's text in the academy's branded shell so every automation
    // email is on-brand (the step body carries only the message copy). Subject
    // can carry merge tokens too, so resolve it against the same vars.
    // ONE RENDER PATH: this is the SAME call the owner's approval surface makes,
    // so the email an owner approved is byte-for-byte the email that goes out.
    const msg = renderStepMessage({ channel: "email", clientId, subject, body: text, vars: renderVars });
    if (msg.empty) return { skipped: EMPTY_AFTER_MERGE };
    const r = await sendEmail({ to: toEmail, subject: msg.subject, html: msg.html, from: sender.from, clientId });
    if (r && r.skipped) return { skipped: r.skipped };
    return { sent: true, id: (r && r.id) || null };
  }

  if (channel === "sms") {
    if (!contactId && !toPhone) return { skipped: "no contact for sms" };
    // ONE RENDER PATH, same as the email branch above: the text an owner approved
    // in the wizard is the text that reaches the phone.
    const msg = renderStepMessage({ channel: "sms", clientId, body: text, vars });
    const message = msg.text;
    // A step whose copy resolved to NOTHING (every sentence it had depended on a
    // merge field this academy has not filled in yet) is a no-op, not a failure:
    // skip it so the engine advances the sequence instead of handing an empty
    // body to the provider, eating a rejection, and burning all 3 retries.
    if (msg.empty) return { skipped: EMPTY_AFTER_MERGE };
    // Provider gate: Twilio academies send via Twilio + own-store; else GHL.
    const g = await maybeSendSmsViaProvider(clientId, { ghlContactId: contactId, toPhone, body: message, sentBy: "automation" });
    if (g.handled) { if (!g.ok) throw new Error(g.error); return { sent: true, via: "twilio", id: g.sid }; }
    if (!ghlToken) throw new Error("sendOn(sms): ghlToken required");
    if (!contactId) return { skipped: "no contact for sms" };
    const resp = await ghl("POST", `/conversations/messages`, { token: ghlToken, body: { type: "SMS", contactId, message } });
    return { sent: true, id: (resp && resp.messageId) || null };
  }

  throw new Error(`sendOn: unknown channel '${channel}'`);
}
