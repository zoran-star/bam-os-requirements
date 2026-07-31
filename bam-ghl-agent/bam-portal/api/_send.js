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
import { renderStepMessage, unsubscribeFor, clientVars } from "./email-shells.js";
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
  // 400 chars, not 200: PostgREST's undefined-column body is what
  // pendingColsBlamedBy() reads to tell "this column is not migrated yet" apart from
  // a real outage, and a truncated body would turn a safe retry into a silent hold.
  if (!res.ok) throw new Error(`Supabase ${res.status}: ${(await res.text()).slice(0, 400)}`);
  const txt = await res.text();
  return txt ? JSON.parse(txt) : null;
}

const CLIENT_TTL = 30_000;
const _clientCache = new Map(); // clientId -> { at, domain, name, businessEmail, client }

// ONE row read, EVERY academy fact an email renders from. Two groups, ONE list and one
// query, because the send path must never ask twice for one row:
//   sender identity  - can this go out AS the academy (email_domain), and under what
//                      display name (business_name)
//   clientVars()     - everything the shell and the copy render: the public email, the
//                      parent-facing name, the site, the footer tagline and Instagram,
//                      the city, the phone, the community / review links, the optional
//                      content facts. Every column clientVars(client) reads is here.
//
// THE SECOND GROUP IS WHY THE FOOTER IS NOT BLANK. Three callers hand sendOn
// `vars: {}` on purpose (their merge tokens are resolved before the call), so until
// 30 Jul 2026 their emails rendered the tagline, the Instagram link and everything
// else clientVars supplies as EMPTY - only location_email was substituted here. The
// render now starts from THIS row for every caller (see sendOn), so those columns have
// to be on it.
//
// ⚠️ A column read by clientVars() and missing from this list arrives undefined and
// renders as nothing, silently - that is the exact regression of 29 Jul 2026, one layer
// down. api/_email-select-coverage.test.mjs derives the required set from clientVars()'s
// own source and fails naming any column this list does not cover.
// business_email moved up from SENDER_COLS_PENDING on 30 Jul 2026, once migration
// 20260729T210000 was confirmed applied to production. stripe_portal_url joined on
// 31 Jul 2026 the same way, once 20260731T090000 was applied.
const SENDER_COLS = ["email_domain", "business_name",
  "business_email", "public_name", "owner_name", "website_setup", "address", "phone",
  "community_group_url", "community_group_platform", "google_review_url",
  "online_programs_url", "referral_offer", "tagline", "instagram_url", "stripe_portal_url"];
// ⚠️ INTENTIONALLY EMPTY, AND DELIBERATELY NOT DELETED. A column listed here is asked
// for optimistically and dropped on the one error that means "its migration is not
// applied yet" (see the retry in clientSender). Same shape and same rule as
// CLIENT_COLS_PENDING in api/automations.js, which is where the reasoning is written
// out in full - including why the window it is meant to cover is hours, not weeks.
//
// It matters more here than anywhere, which is why the mechanism stays: clientSender
// THROWING holds the send WITHOUT texting the owner, so an unhandled 400 on this
// select would stop every academy's automation email silently. Dropping the column
// instead degrades to "no business email", which holds AND tells the owner. The next
// column that needs to ship ahead of its migration goes here, with its migration file
// on a comment line, and moves into SENDER_COLS the day that migration lands.
const SENDER_COLS_PENDING = [];

// Only an undefined-column error (PostgREST 42703) that NAMES a pending column earns
// the retry. A transient 5xx stays a throw: silently degrading to a row with no
// business_email would hold an academy's email over an outage rather than over its
// own missing data, and tell the owner to go fix a field that is already filled in.
function pendingColsBlamedBy(err) {
  const msg = String((err && err.message) || err || "");
  if (!/42703|does not exist/i.test(msg)) return [];
  return SENDER_COLS_PENDING.filter((c) => msg.includes(c));
}

// THROWS on a DB blip - the caller turns that into a hold WITHOUT an owner text.
//
// `businessEmail` is the academy's PUBLIC email (clients.business_email) - the footer
// contact line, the footer Email link, and the unsubscribe destination. Resolved HERE,
// at the one choke point every automation email passes through, because three callers
// hand sendOn `vars: {}` on purpose (their tokens are already resolved: the confirm
// agent's scripted booking confirmation and same-day check-in, and the two approval
// surfaces' confirmation email). Reading it off the caller's vars would leave those
// unable to carry an unsubscribe link at all, which is precisely the state the hold
// below exists to refuse.
//
// `client` is the WHOLE row, kept for the same reason and used the same way: sendOn
// turns it into the base merge vars every email renders from (clientVars). The address
// was resolved here first only because it is the one with a hold attached; the tagline
// and the Instagram link had no guard to make anybody notice they were missing.
async function clientSender(clientId) {
  const hit = _clientCache.get(clientId);
  if (hit && Date.now() - hit.at < CLIENT_TTL) return hit;
  const cols = SENDER_COLS.concat(SENDER_COLS_PENDING);
  const read = (list) => sb(`clients?id=eq.${encodeURIComponent(clientId)}&select=${list.join(",")}&limit=1`);
  let rows;
  try {
    rows = await read(cols);
  } catch (e) {
    const blamed = pendingColsBlamedBy(e);
    if (!blamed.length) throw e;
    console.warn(`[_send] clientSender: ${blamed.join(", ")} not in the schema yet (migration pending) - re-reading without ${blamed.length > 1 ? "them" : "it"}`);
    rows = await read(cols.filter((c) => !SENDER_COLS_PENDING.includes(c)));   // ALL of them, not just `blamed` - Postgres names only the first
  }
  const row = (Array.isArray(rows) && rows[0]) || {};
  const out = {
    at: Date.now(),
    domain: String(row.email_domain || "").trim().toLowerCase(),
    name: String(row.business_name || "").trim(),
    // NO FALLBACK, ON PURPOSE. A column that is not there yet, a NULL, and an empty
    // string are all the SAME answer here - "this academy has no public email" - and
    // that answer HOLDS the send rather than borrowing clients.email (the owner's
    // inbox, which is the bug the column removed). See guardrail 2 at the top.
    businessEmail: String(row.business_email || "").trim(),
    // The row itself, exactly as it came back. Projected by SENDER_COLS, so a column
    // that list forgot is ABSENT here rather than null - which reads to clientVars as
    // "this academy has no tagline" and renders as nothing. Same shape, same silence,
    // as the loadClient regression this list is built to avoid repeating.
    client: row,
  };
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
//   { from, businessEmail, baseVars } -> safe to send
//   { hold:true, notify:true }  -> domain missing / unverified (owner gets the text)
//   { hold:true, notify:false } -> transient blip: fail CLOSED, but do NOT ping the
//                                  owner over something they cannot fix.
// `businessEmail` rides along because it comes off the same row read and is needed
// by the same caller for the same reason: an email that cannot go out AS the academy
// and an email that cannot carry the academy's own reply-to / unsubscribe address are
// two halves of one question.
// `baseVars` is clientVars(row) - the SAME object the From display name is chosen from
// and the SAME object the body is rendered from, built once. One resolution path: the
// name on the envelope and the footer inside it cannot disagree about which academy
// this is, whatever the caller passed.
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
  const baseVars = clientVars(row.client);
  const addr = `info@${row.domain}`;
  // BYTE-IDENTITY, by domain match and nothing else (no client-id, no academy-name
  // hardcode): the academy that already owns the legacy address keeps the legacy
  // string verbatim, so its parents see zero header drift.
  if (addr === LEGACY_ADDR) return { from: LEGACY_FROM, businessEmail, baseVars };
  // The academy's PARENT-FACING name (clientVars resolves public_name, falling back to
  // business_name), not the internal label. `row.name` is business_name - "BAM San
  // Jose", our own shorthand - and it was what the three `vars: {}` callers put in the
  // From header while the worker sent "By Any Means San Jose" from the same row. Same
  // bug as the blank footer, one header up: the caller's vars were the only source.
  const name = String((vars && vars.location_name) || baseVars.location_name || "").replace(/[<>"]/g, "").trim();
  return { from: name ? `${name} <${addr}>` : addr, businessEmail, baseVars };
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

// `footerReason` / `noUnsubscribe` (email only) are the TRANSACTIONAL pair, threaded
// to renderStepMessage -> renderEmail -> fillShell and nowhere else. A caller that
// passes neither - every sales drip, every confirmation, the welcome email - gets the
// byte-identical email it got before they existed. Today the only caller that passes
// them is api/_member-receipts.js, and the reasoning for each is written where it
// belongs: FOOTER_REASON.joined and stripUnsubscribe in api/email-templates/_shell.js.
//
// ⚠️ NEITHER IS A PERMISSION. `noUnsubscribe` changes what the footer RENDERS. It does
// not lift the business-email hold below, and it must never be made to - see the note
// there.
export async function sendOn({ channel, clientId, contactId, toEmail, toPhone, subject, body, ghlToken, vars, footerReason, noUnsubscribe } = {}) {
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
    // THE ACADEMY'S OWN ROW IS THE BASE. Every email rendered here starts from
    // clientVars(the row this send just read) and the caller's vars go ON TOP, so a
    // caller that supplies a value still wins and a caller that supplies nothing still
    // gets the whole academy: name, site, city, owner, phone, community and review
    // links, the optional content facts, and the footer's tagline and Instagram.
    //
    // ONE resolution path for every sender, which is the point. Until 30 Jul 2026 only
    // location_email was substituted here, so the three callers that pass `vars: {}`
    // deliberately (the confirm agent's scripted booking confirmation and same-day
    // check-in, and the two approval surfaces' confirmation email) shipped a footer
    // with a blank tagline and no Instagram link - live, at an academy that has both on
    // its row. Nothing threw, nothing was logged, and the one field with a guard behind
    // it was the one field that was fine. The fix is not another substitution per
    // caller; it is that there is no per-caller resolution left to get wrong.
    //
    // location_email stays FORCED LAST, after the caller's vars, and that is not
    // redundancy with the base: it is the SECOND HARD GUARDRAIL staying connected to its
    // outcome. The address checked below is the address rendered, whatever the caller
    // passed - so a check against the row and a render from the vars can never describe
    // two different emails.
    const renderVars = { ...(sender.baseVars || {}), ...(vars || {}), location_email: sender.businessEmail };
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
    //
    // ⚠️ ONE CALLER NOW RENDERS WITHOUT AN UNSUBSCRIBE, and the hold STILL applies to
    // it. A receipt passes `noUnsubscribe` (31 Jul 2026), so for that caller the
    // sentence above is no longer the whole truth: the render carries no opt-out link
    // whether or not the academy has a public email. The hold is kept anyway, because
    // the unsubscribe was only ever HALF its reason - read guardrail 2 at the top of
    // this file. clients.business_email is ALSO the footer's contact line and the
    // footer's mailto "Email" link, and with no address on the row those are dropped
    // by dropEmptyShellLinks. Lifting the hold would send a paying parent a receipt
    // for their own money with no way to reach the academy that took it, which is a
    // worse document than a nurture email with the same gap.
    //
    // It is also the wrong shape of change. `noUnsubscribe` is a RENDERING flag any
    // future caller may set to fix a footer sentence; making it bypass a fail-closed
    // identity guard would silently hand that caller the right to send as an academy
    // that is not set up. If receipts ever genuinely need to send without a public
    // email, that is its own explicit parameter with its own proof, not a side effect
    // of this one.
    //
    // The cost today is nothing and it is visible: a held receipt still WRITES its row
    // (api/_member-receipts.js writeAndSend), is labelled email_status 'held', texts
    // the owner at most once per 24h, and can be resent the moment the address is
    // filled in. A receipt sent with a hollow footer would be none of those things.
    if (!unsubscribeFor({ clientId, vars: renderVars })) {
      await noticeHeldOnce(clientId, "business_email");
      return { held: "no business email, so no unsubscribe link" };
    }
    // Wrap the step's text in the academy's branded shell so every automation
    // email is on-brand (the step body carries only the message copy). Subject
    // can carry merge tokens too, so resolve it against the same vars.
    // ONE RENDER PATH: this is the SAME call the owner's approval surface makes,
    // so the email an owner approved is byte-for-byte the email that goes out.
    const msg = renderStepMessage({ channel: "email", clientId, subject, body: text, vars: renderVars, footerReason, noUnsubscribe });
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
