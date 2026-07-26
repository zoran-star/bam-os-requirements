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
import { renderEmail, resolveMergeVars, locFor } from "./email-shells.js";
import { notifyOwners } from "./_notify-owners.js";

// ── the from-address guardrail (email only) ─────────────────────────────────
// Every automation email goes out as the ACADEMY's own verified sender, resolved
// from its client row at runtime - never a hardcoded academy. If that academy has
// no usable sending domain the email is HELD (it never reaches Resend, nothing
// generic goes out in its place) and the owner is texted, at most once per 24h.
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
const _clientCache = new Map(); // clientId -> { at, domain, name }

// THROWS on a DB blip - the caller turns that into a hold WITHOUT an owner text.
async function clientSender(clientId) {
  const hit = _clientCache.get(clientId);
  if (hit && Date.now() - hit.at < CLIENT_TTL) return hit;
  const rows = await sb(`clients?id=eq.${encodeURIComponent(clientId)}&select=email_domain,business_name&limit=1`);
  const row = (Array.isArray(rows) && rows[0]) || {};
  const out = { at: Date.now(), domain: String(row.email_domain || "").trim().toLowerCase(), name: String(row.business_name || "").trim() };
  _clientCache.set(clientId, out);
  return out;
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
//   { from }                    -> safe to send
//   { hold:true, notify:true }  -> domain missing / unverified (owner gets the text)
//   { hold:true, notify:false } -> transient blip: fail CLOSED, but do NOT ping the
//                                  owner over something they cannot fix.
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

  const addr = `info@${row.domain}`;
  // BYTE-IDENTITY, by domain match and nothing else (no client-id, no academy-name
  // hardcode): the academy that already owns the legacy address keeps the legacy
  // string verbatim, so its parents see zero header drift.
  if (addr === LEGACY_ADDR) return { from: LEGACY_FROM };
  const name = String((vars && vars.location_name) || row.name || "").replace(/[<>"]/g, "").trim();
  return { from: name ? `${name} <${addr}>` : addr };
}

// ── owner heads-up, once per academy per 24h ────────────────────────────────
const HOLD_NOTICE_COOLDOWN_MS = 24 * 3600000;
const HOLD_NOTICE_MESSAGE =
  "Heads up: your automation emails are on hold because your academy's sending domain is not set up yet. Ping BAM staff to finish email setup, then held emails go out on their own.";
const _holdClaims = new Map(); // clientId -> ms claimed in THIS process

// Deduped through an email_events row (type 'domain_hold_notice') stamped BEFORE
// the text fires, so a crash between the two can only under-notify for one cycle,
// never spam. Best-effort and never throws.
async function noticeHeldOnce(clientId) {
  try {
    if (!clientId) return;
    // Claim SYNCHRONOUSLY, before the first await - one engine pass holds many
    // jobs for the same academy, and set any later they all read an empty stamp
    // and the owner gets texted once per held job.
    const prev = _holdClaims.get(clientId);
    if (prev && Date.now() - prev < HOLD_NOTICE_COOLDOWN_MS) return;
    _holdClaims.set(clientId, Date.now());

    const sinceIso = new Date(Date.now() - HOLD_NOTICE_COOLDOWN_MS).toISOString();
    let recent;
    try {
      recent = await sb(`email_events?client_id=eq.${encodeURIComponent(clientId)}&type=eq.domain_hold_notice&created_at=gte.${sinceIso}&select=id&limit=1`);
    } catch (_) { _holdClaims.delete(clientId); return; }
    if (Array.isArray(recent) && recent.length) return; // another instance already texted

    let stampId = null;
    try {
      const ins = await sb(`email_events`, {
        method: "POST", headers: { Prefer: "return=representation" },
        body: JSON.stringify([{ client_id: clientId, type: "domain_hold_notice" }]),
      });
      stampId = (Array.isArray(ins) && ins[0] && ins[0].id) || null;
    } catch (_) { _holdClaims.delete(clientId); return; }

    const r = await notifyOwners(clientId, "settings_alert", HOLD_NOTICE_MESSAGE);
    // Nobody actually got it (no owner phone on file): give the stamp back, so a
    // recipient-less academy is not silently muted for the next 24h.
    if (!r || !r.sent) {
      _holdClaims.delete(clientId);
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
// out AS THE ACADEMY (see the guardrail above - the engine re-queues those without
// burning an attempt), and THROWS on a hard failure so the worker can retry /
// record the error.
export async function sendOn({ channel, clientId, contactId, toEmail, toPhone, subject, body, ghlToken, vars } = {}) {
  const text = String(body || "").trim();
  if (!text) throw new Error("sendOn: empty body");

  if (channel === "email") {
    if (!toEmail) return { skipped: "no email on file" };
    // HARD GUARDRAIL, before anything is rendered or sent: no verified academy
    // sending domain = the email HOLDS. There is deliberately NO fallback sender.
    const sender = await fromFor(clientId, vars);
    if (!sender.from) {
      if (sender.notify) await noticeHeldOnce(clientId);
      return { held: "sending domain not set" };
    }
    // Wrap the step's text in the academy's branded shell so every automation
    // email is on-brand (the step body carries only the message copy). Subject
    // can carry merge tokens too, so resolve it against the same vars.
    const subj = resolveMergeVars(String(subject || ""), locFor(clientId, vars), vars || {});
    const html = renderEmail({ clientId, subject: subj, body: text, vars });
    const r = await sendEmail({ to: toEmail, subject: subj, html, from: sender.from, clientId });
    if (r && r.skipped) return { skipped: r.skipped };
    return { sent: true, id: (r && r.id) || null };
  }

  if (channel === "sms") {
    if (!contactId && !toPhone) return { skipped: "no contact for sms" };
    const message = resolveMergeVars(text, locFor(clientId, vars), vars || {});
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
