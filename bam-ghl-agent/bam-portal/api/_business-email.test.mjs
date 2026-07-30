// THE ACADEMY'S EMAIL, NOT THE OWNER'S.
//
//   node api/_business-email.test.mjs
//
// WHAT WAS WRONG. There was no column for an academy's PUBLIC email, so
// clientVars() resolved `location_email` from `clients.email` - the OWNER's inbox,
// the address WE contact them on. One value then fed three things at once:
//   1. the footer contact line (the "Email" link in the black footer bar)
//   2. {{SUPPORT_EMAIL}}, which is that link's href
//   3. the UNSUBSCRIBE destination, mailto:<address>?subject=Unsubscribe
// BAM GTA's clients.email is zoran@byanymeansbball.com, a personal inbox, so every
// GTA email published it to parents and pointed their unsubscribes at it. DETAIL
// Miami and Johnson Bball both carry mike@byanymeansbball.com. GTA was saved from
// LOOKING wrong only by a hardcoded LOCATIONS entry in email-shells.js, which no
// other academy had - a per-academy patch over a shared bug. (That entry is gone
// entirely as of 29 Jul 2026; api/_email-identity-from-the-row.test.mjs is the suite
// that says so.)
//
// The fix is clients.business_email (migration 20260729T210000) with NO FALLBACK,
// and the no-fallback half is the part that needs a test. A fallback would have been
// the easy thing to ship: every academy keeps rendering something, nothing looks
// broken, and the owner's address is still on every email. "It renders" is exactly
// how this survived.
//
// WHY THIS SUITE RENDERS INSTEAD OF GREPPING. Standing rule in this repo: a
// literal-grep leak audit gives false answers, because a string can be absent from
// the file it was moved out of and still reach the output through a fallback. So
// every assertion below builds a REAL email through renderEmail / renderStepMessage,
// or drives the REAL sendOn against a stubbed wire, and inspects THAT.
//
// ─────────────────────────────────────────────────────────────────────────────
// WHAT IT PROVES
//   1. All three consumers render the BUSINESS email, at two real academies.
//   2. An academy with no business email gets the owner's address NOWHERE - and
//      renders no dead mailto: anchor in its place either.
//   3. The no-business-email case HOLDS instead of sending. An email with no
//      unsubscribe path at all is worse than one pointing at the wrong inbox, so
//      "render nothing" was not an acceptable answer here.
//   4. The hold TELLS the owner, once per 24h, and its cooldown is per reason - so
//      an academy already warned about its sending domain today still hears about
//      this.
//   5. The guard is CONNECTED to the outcome: three callers hand sendOn `vars: {}`
//      on purpose (their tokens are pre-resolved), so a guard that checked the row
//      and rendered from the caller's vars would pass and still put an
//      unsubscribe-less email on the wire.
//   6. The address rides the sender select - ONE clients read, naming the column -
//      not the separate temporary lookup that existed while the migration was pending.
//
// WHAT IT DOES NOT PROVE
//   - That the stored address can actually SEND or RECEIVE. Nothing in this build
//     verifies that; the Business Basics hint says what the field needs and shows
//     the one cheap signal that exists (clients.email_domain). An address that
//     bounces looks identical to a good one here.
//   - That academies HAVE one. DETAIL Miami, Johnson Bball and everyone else are
//     still empty, and empty now means their automation email holds.
//   - That the column is READABLE in production. It is not: migration 20260729T210000
//     is still unapplied as of 2026-07-29. What makes naming it safe anyway - the
//     pending-column retry in api/_send.js and in both loadClient select lists - is
//     proved in api/_pending-client-column.test.mjs, which simulates the 400.
//
// ─────────────────────────────────────────────────────────────────────────────
// NEGATIVE CONTROLS. Each breaks ONE thing and must print NEGATIVE CONTROL PASSED:
//
//   MUTATE=fallback      node api/_business-email.test.mjs  # fall back to the owner
//                                                           # email (the shipped bug)
//   MUTATE=borrow        node api/_business-email.test.mjs  # an unconfigured academy
//                                                           # inherits GTA's address
//                                                           # (the hardcode shape)
//   MUTATE=sendanyway    node api/_business-email.test.mjs  # skip the hold and send
//                                                           # with no unsubscribe
//   MUTATE=sharedcooldown node api/_business-email.test.mjs # one dedupe key for both
//                                                           # hold reasons, so the
//                                                           # domain warning mutes
//                                                           # this one
//   MUTATE=uncheckedvars node api/_business-email.test.mjs  # the guard checks the
//                                                           # row and the render uses
//                                                           # the caller's vars, so
//                                                           # the check describes an
//                                                           # email nobody sent
//
// `fallback` is the bug that actually shipped, so it is the one that matters most.
// If it ever reports FAILED, this suite is decorative.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const MUTATE = process.env.MUTATE || "";

// The transport has to be stubbed BEFORE api/_send.js is imported: it reads its
// Supabase / Resend config at module load. Everything downstream (Resend, GHL,
// Supabase REST) goes through global fetch, so one stub covers the whole path and no
// network, database or dependency is involved.
process.env.SUPABASE_URL = process.env.SUPABASE_URL || "https://stub.supabase.test";
process.env.VITE_SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "stub-service-key";
process.env.RESEND_API_KEY = process.env.RESEND_API_KEY || "stub-resend-key";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SNAPSHOTS = path.resolve(HERE, "../../../scripts/snapshots");

let pass = 0, fail = 0;
const failures = [];
const ok = (cond, label) => {
  if (cond) { pass++; console.log("  ✅ " + label); }
  else { fail++; failures.push(label); console.log("  ❌ " + label); }
};

// ─── the stubbed wire ────────────────────────────────────────────────────────
// Captures what the send path hands to Resend and to GHL, plus every email_events
// write, so the hold's dedupe stamp and the owner's text are both observable.
// Anything the send path asks for that is NOT stubbed here THROWS rather than
// quietly returning empty, so the day sendOn grows a dependency this suite says so.
let WIRE = null;                 // the last email/SMS put on the wire
let SMS = [];                    // owner notifications that went out
let EVENTS = [];                 // email_events rows written
let SENDING_DOMAIN = "";
let BUSINESS_EMAIL = "";
let PRIOR_EVENT_TYPES = [];      // types already stamped in the last 24h
let SENDER_SELECTS = [];         // every `select=` the send path issued against clients

globalThis.fetch = async (url, init = {}) => {
  const u = String(url);
  const method = String(init.method || "GET").toUpperCase();
  const json = (v) => new Response(JSON.stringify(v), { status: 200, headers: { "content-type": "application/json" } });
  const body = init.body ? JSON.parse(init.body) : null;

  if (u === "https://api.resend.com/emails" && method === "POST") { WIRE = { channel: "email", subject: body.subject, html: body.html, from: body.from }; return json({ id: "stub-email" }); }
  if (u === "https://api.resend.com/domains") return json({ data: [{ name: SENDING_DOMAIN, status: "verified" }] });
  if (u.includes("/conversations/messages") && method === "POST") { SMS.push(body.message); return json({ messageId: "stub-sms" }); }
  // GHL contact lookup for the owner's phone (notifyOwners -> sendSms).
  if (u.includes("services.leadconnectorhq.com/contacts/")) return json({ contacts: [{ id: "stub-owner-contact" }] });

  if (u.includes("/rest/v1/email_events") && method === "POST") { EVENTS.push(body[0]); return json([{ id: "stub-event-" + EVENTS.length }]); }
  if (u.includes("/rest/v1/email_events") && method === "DELETE") return json(null);
  if (u.includes("/rest/v1/email_events")) {
    // The 24h dedupe read. MUTATE=sharedcooldown answers it as a SHARED key would:
    // any hold notice in the window suppresses any other. The two reasons have
    // different fixes (BAM staff finishing email setup vs the owner typing an
    // address), so sharing one key means an academy warned about the domain this
    // morning is never told why its email is still held this afternoon.
    const wanted = (/type=eq\.([a-z_]+)/.exec(u) || [])[1] || "";
    const hit = MUTATE === "sharedcooldown"
      ? PRIOR_EVENT_TYPES.length > 0
      : PRIOR_EVENT_TYPES.includes(wanted);
    return json(hit ? [{ id: "prior-event" }] : []);
  }
  if (u.includes("/rest/v1/email_suppressions")) return json([]);       // nobody is suppressed
  // The send path's ONE sender read: sending domain, academy name and public email off
  // a single row, in a single select. PROJECTED on purpose - the answer carries only
  // what the select asked for, so business_email dropping out of _send.js's column
  // list means the send path never sees an address and every send below HOLDS. A stub
  // that handed back the whole row regardless would let that change pass green.
  if (u.includes("/rest/v1/clients?") && u.includes("email_domain")) {
    const sel = new URL(u).searchParams.get("select") || "";
    SENDER_SELECTS.push(sel);
    const row = { email_domain: SENDING_DOMAIN, business_name: "stub" };
    if (sel.split(",").map(s => s.trim()).includes("business_email")) row.business_email = BUSINESS_EMAIL;
    return json([row]);
  }
  // The DELETED lookup. business_email used to be read by a second, separately-caught
  // query of its own, because the migration was not applied and a 400 folded into the
  // sender select would have taken the sending domain down with it. It is now one read
  // with a pending-column retry (api/_send.js, and api/_pending-client-column.test.mjs
  // proves the retry). Anything asking for it alone is that lookup coming back.
  if (u.includes("/rest/v1/clients?") && u.includes("select=business_email")) {
    SENDER_SELECTS.push("business_email");
    return json([{ business_email: BUSINESS_EMAIL }]);
  }
  if (u.includes("/rest/v1/clients?") && u.includes("messaging_provider")) return json([{ messaging_provider: "ghl" }]);
  // notifyOwners' own client read: V2 academy, no explicit prefs, GHL connected with
  // a token that is nowhere near expiry so no refresh call is attempted.
  if (u.includes("/rest/v1/clients?")) {
    return json([{
      id: "stub", business_name: "stub", v2_access: true, notification_prefs: {},
      ghl_location_id: "stub-loc", ghl_access_token: "stub-token",
      ghl_token_expires_at: new Date(Date.now() + 7 * 86400000).toISOString(),
      onboarding_setup: { owner_phone: "+15550001111" },
    }]);
  }
  if (u.includes("/rest/v1/client_users")) return json([{ id: "cu-1", name: "Owner", phone: "+15550001111", role: "owner" }]);
  if (u.includes("/rest/v1/messages") && method === "POST") return json([{ id: "m-1" }]);
  throw new Error(`UNSTUBBED CALL from the send path: ${method} ${u}`);
};

const { sendOn } = await import("./_send.js");
const { renderEmail, renderStepMessage, clientVars, unsubscribeFor, locFor } = await import("./email-shells.js");

// ─── fixtures ────────────────────────────────────────────────────────────────
// Two REAL academies, from the same production snapshots the GTA locks read. Two on
// purpose: GTA WAS the one academy with a hardcoded LOCATIONS entry, so for as long as
// that entry existed a bug that only appears when identity resolves from the client row
// would hide behind it. The entry is gone (29 Jul 2026) and a second academy is still
// the cheapest way to keep proving that.
const snap = (f) => JSON.parse(fs.readFileSync(path.join(SNAPSHOTS, f), "utf8"));
const GTA = snap("bam-gta.json").client;
const SJ = snap("bam-san-jose.json").client;
// An academy that has entered nothing: no business email, and an owner email that
// must not stand in for it. Shaped like DETAIL Miami and Johnson Bball, which really
// do both carry mike@byanymeansbball.com.
const BARE = {
  id: "bare-academy-0000-0000-000000000000",
  business_name: "Johnson Bball",
  owner_name: "Mike Johnson",
  email: "mike@byanymeansbball.com",
  website_setup: { domain: "johnsonbball.example" },
};
// A DISTINCT academy per scenario. Both of the send path's per-academy memories are
// keyed by client id - the 30s sender cache and the 24h owner-notice claim - and they
// are correct behaviour, not test friction: one engine pass holds many jobs for one
// academy and the owner must hear once. So a scenario that needs a fresh answer is a
// fresh academy, exactly as production would be. Reusing one id here would have this
// suite silently assert the CACHE instead of the code.
let _n = 0;
const bare = (label) => ({ ...BARE, id: `bare-${String(++_n).padStart(4, "0")}-${label}` });

const FAMILY = { first_name: "Alex", full_name: "Alex Rivera", athlete: "Jordan Rivera", athlete_first: "Jordan", next_session: "" };
const BODY = "Hi {{contact.first_name}},\n\nJordan's spot is held for this week.\n\nSee you at training.";

// The ONE seam the mutations act on: how a caller turns a client row into vars.
// MUTATE=fallback restores the exact expression that shipped
// (`c.business_email || c.email`); MUTATE=borrow restores the per-client-id-hardcode
// shape, where an academy with nothing of its own inherits GTA's address.
function varsFor(client) {
  const v = { ...FAMILY, ...clientVars(client) };
  if (MUTATE === "fallback") v.location_email = client.business_email || client.email || "";
  if (MUTATE === "borrow") v.location_email = client.business_email || GTA.business_email || "";
  return v;
}

const emailFor = (client) => renderEmail({ clientId: client.id, subject: "Your spot this week", body: BODY, vars: varsFor(client) });

// ─── 1. all three consumers render the BUSINESS email ────────────────────────
console.log("\n── 1. footer link, {{SUPPORT_EMAIL}} and unsubscribe all use the business email ──");
for (const c of [GTA, SJ]) {
  const biz = c.business_email;
  const html = emailFor(c);
  ok(!!biz, `${c.business_name}: the row carries a business email (${biz})`);
  // 1 and 2 are the same anchor in the shell: {{SUPPORT_EMAIL}} IS the href of the
  // footer contact line. Asserted as both because they are two claims about it - the
  // placeholder is filled, and it is filled with the right address.
  ok(!html.includes("{{SUPPORT_EMAIL}}"), `${c.business_name}: {{SUPPORT_EMAIL}} is filled, not left as a placeholder`);
  ok(html.includes(`<a href="mailto:${biz}"`), `${c.business_name}: the footer contact line links the business email`);
  ok(html.includes(`href="mailto:${biz}?subject=Unsubscribe"`), `${c.business_name}: the unsubscribe points at the business email`);
  ok(unsubscribeFor({ clientId: c.id, vars: varsFor(c) }) === `mailto:${biz}?subject=Unsubscribe`,
    `${c.business_name}: the send path's unsubscribe resolver agrees with the rendered email`);
  ok(locFor(c.id, varsFor(c)).email === biz, `${c.business_name}: the resolved location config carries it too`);
}
{
  // The two academies must not be interchangeable. GTA's address in San Jose's email
  // is the leak the old per-client-id fallback used to guarantee for everyone else.
  const gtaHtml = emailFor(GTA), sjHtml = emailFor(SJ);
  ok(!sjHtml.includes(GTA.business_email), "San Jose's email contains NO trace of GTA's address");
  ok(!gtaHtml.includes(SJ.business_email), "and GTA's contains none of San Jose's");
}

// ─── 2. no business email means no OWNER email, anywhere ─────────────────────
console.log("\n── 2. an academy with no business email borrows nobody's ──");
{
  const html = emailFor(BARE);
  ok(!html.includes(BARE.email), "the owner's address appears NOWHERE in the rendered email");
  ok(!html.includes("byanymeansbball.com"), "not even the owner's domain leaks in");
  ok(!html.includes(GTA.business_email) && !html.includes("byanymeanstoronto"),
    "and it does not inherit GTA's address either");
  ok(!/mailto:[^"]*\?subject=Unsubscribe/.test(html), "there is no unsubscribe mailto at all (which is why the SEND must hold - see 3)");
  // Nothing dead is left behind: dropEmptyShellLinks takes the empty anchors out
  // with their separators rather than shipping a link to nowhere.
  ok(!html.includes('href="mailto:"') && !html.includes('href=""'),
    "no dead mailto: or empty href is rendered in its place");
  ok(!html.includes("{{SUPPORT_EMAIL}}") && !html.includes("{{UNSUBSCRIBE}}"),
    "and no raw placeholder is left showing");
  // The email still renders - this is about the ADDRESS, not about breaking the send.
  ok(html.includes("Jordan's spot is held"), "the message body itself still renders");
  ok(renderStepMessage({ channel: "email", clientId: BARE.id, subject: "s", body: BODY, vars: varsFor(BARE) }).empty === false,
    "and the step does not report itself as empty (the copy is there, the identity is not)");
}

// ─── 3. the send HOLDS rather than going out with no unsubscribe ──────────────
console.log("\n── 3. no business email, no unsubscribe: the send HOLDS ──");
// Rendering nothing was not enough. An email with NO unsubscribe path is worse than
// one pointing at the wrong inbox: the parent has no way out and we have no record
// of asking. So the send stops at the same gate the unverified-sending-domain check
// uses - held, never sent generic, engine re-queues without burning an attempt.
async function sendStep(client, { businessEmail, vars }) {
  WIRE = null; SMS = []; EVENTS = []; SENDER_SELECTS = [];
  SENDING_DOMAIN = (client.website_setup || {}).domain || "";
  BUSINESS_EMAIL = businessEmail;
  const args = { channel: "email", clientId: client.id, toEmail: "parent@example.test", subject: "Your spot this week", body: BODY, vars };
  if (MUTATE === "uncheckedvars") {
    // The DISCONNECTED shape, and the one worth fearing most: the guard consults the
    // client row, is satisfied, and then the render uses whatever vars the caller
    // happened to pass. It looks like a guard, it passes its own check, and the email
    // still goes out with no unsubscribe in it for the three callers that pass
    // `vars: {}`. Section 5 is the only thing that can tell the difference.
    if (!businessEmail) return { held: "no business email, so no unsubscribe link" };
    const msg = renderStepMessage({ channel: "email", ...args, vars });
    WIRE = { channel: "email", subject: msg.subject, html: msg.html };
    return { sent: true };
  }
  if (MUTATE === "sendanyway") {
    // The shape before the hold existed: render and put it on the wire regardless of
    // whether the academy has an address for it. The assertions below must notice
    // that an email went out with no unsubscribe in it.
    const msg = renderStepMessage({ channel: "email", ...args, vars: { ...vars, location_email: businessEmail } });
    WIRE = { channel: "email", subject: msg.subject, html: msg.html };
    return { sent: true };
  }
  return sendOn(args);
}
{
  PRIOR_EVENT_TYPES = [];
  const none = bare("nomail");
  const r = await sendStep(none, { businessEmail: "", vars: varsFor(none) });
  ok(!!r.held, `the send reports HELD (${JSON.stringify(r)})`);
  ok(!r.sent, "it does not report itself as sent");
  ok(WIRE === null, "and NOTHING reached Resend");
  ok(/unsubscribe/i.test(String(r.held || "")), "the hold reason names the unsubscribe, so a held row is diagnosable");

  // The same academy the moment it has an address: it sends, and it sends WITH one.
  const addr = "info@johnsonbball.example";
  const has = bare("hasmail");
  const r2 = await sendStep(has, { businessEmail: addr, vars: varsFor(has) });
  ok(!!r2.sent, "with an address on the row the same send goes out");
  ok(WIRE && WIRE.html.includes(`href="mailto:${addr}?subject=Unsubscribe"`),
    "and the bytes on the wire carry that address as the unsubscribe");
  ok(WIRE && WIRE.html.includes(`<a href="mailto:${addr}"`), "and as the footer contact line");
  ok(WIRE && !WIRE.html.includes(BARE.email), "and the owner's address is still nowhere in it");
}

// ─── 4. the hold is LOUD: the owner is told, once, per reason ─────────────────
console.log("\n── 4. a held send tells the owner, once per reason per 24h ──");
{
  PRIOR_EVENT_TYPES = [];
  const told = bare("notified");
  const r = await sendStep(told, { businessEmail: "", vars: varsFor(told) });
  ok(!!r.held, "held (setup for the notification checks)");
  const stamped = EVENTS.filter(e => e.type === "business_email_hold_notice");
  ok(stamped.length === 1, `exactly one dedupe stamp was written (saw ${stamped.length})`);
  ok(SMS.length >= 1, `the owner was texted (${SMS.length} message(s))`);
  ok(SMS.some(m => /public email/i.test(m)), "and the text says WHICH thing is missing");
  ok(SMS.some(m => /held|hold/i.test(m)), "and that the emails are held rather than lost");
  ok(!SMS.some(m => m.includes(BARE.email)), "the text does not tell them to use their personal address");

  // Second held job for the SAME academy: the in-memory claim alone must suppress it,
  // before any DB read - one engine pass holds many jobs for one academy, and set the
  // claim any later and they each read an empty stamp and each text the owner.
  const before = SMS.length;
  SMS = []; EVENTS = [];
  const r2 = await sendStep(told, { businessEmail: "", vars: varsFor(told) });
  ok(!r2.sent && !!r2.held, "a second job for the same academy also holds");
  ok(SMS.length === 0 && EVENTS.length === 0, `and does NOT text again (was ${before}, now ${SMS.length})`);

  // A DIFFERENT hold reason must still get through. The cooldowns are per reason
  // because the two fixes are different people's jobs: BAM staff finish the sending
  // domain, the owner types their public address.
  PRIOR_EVENT_TYPES = ["domain_hold_notice"];
  const alsoWarned = bare("bothreasons");
  const r3 = await sendStep(alsoWarned, { businessEmail: "", vars: varsFor(alsoWarned) });
  ok(!!r3.held, "still held with a domain notice already on file today");
  ok(EVENTS.some(e => e.type === "business_email_hold_notice"),
    "and the owner IS told about the missing public email, because the two reasons have their own cooldowns");
  PRIOR_EVENT_TYPES = [];
}

// ─── 5. the guard is connected to what actually goes out ─────────────────────
console.log("\n── 5. the callers that pass vars:{} still get an unsubscribe ──");
{
  // The confirm agent's booking confirmation and check-in, and the approvals
  // inbox's confirmation email, all call sendOn with `vars: {}` on purpose: their
  // merge tokens are resolved before the call. A guard that read the row and then
  // rendered from the caller's vars would PASS for them and still put an email on
  // the wire with no unsubscribe. Which is why the send path renders from the value
  // it checked, and why this is asserted on the WIRE and not on a render.
  const addr = "info@johnsonbball.example";
  const blind = bare("novars");
  const r = await sendStep(blind, { businessEmail: addr, vars: {} });
  ok(!!r.sent, "a vars:{} send still goes out");
  ok(WIRE && WIRE.html.includes(`href="mailto:${addr}?subject=Unsubscribe"`),
    "and carries the academy's unsubscribe even though the caller supplied no identity vars");
  ok(WIRE && !WIRE.html.includes(BARE.email), "and not the owner's address");

  const blindNone = bare("novars-nomail");
  const r2 = await sendStep(blindNone, { businessEmail: "", vars: {} });
  ok(!!r2.held && WIRE === null, "and with no address on the row it holds, rather than sending one without");
}

// ─── 6. it comes off the sender row, in ONE read ──────────────────────────────
console.log("\n── 6. the public email rides the sender select, not a lookup of its own ──");
{
  // While migration 20260729T210000 was unapplied, business_email was read by a
  // SECOND query with a catch of its own: a 400 folded into the sender select would
  // have taken the sending domain down with it, and a domain failure holds WITHOUT
  // texting the owner - so every academy's email would have stopped silently. It is
  // now one read plus a pending-column retry (api/_pending-client-column.test.mjs is
  // where the retry is proven). Two reads of one row is two failure modes, and the
  // second one used to swallow everything it saw.
  const addr = "info@johnsonbball.example";
  const one = bare("oneread");
  const r = await sendStep(one, { businessEmail: addr, vars: {} });
  ok(!!r.sent, "the send goes out (setup for the read checks)");
  ok(SENDER_SELECTS.length === 1,
    `the send path read the clients row ONCE for the sender (saw ${SENDER_SELECTS.length}: ${JSON.stringify(SENDER_SELECTS)})`);
  ok(SENDER_SELECTS[0] !== "business_email",
    "and not through the deleted separate business_email lookup");
  const cols = String(SENDER_SELECTS[0] || "").split(",").map(s => s.trim());
  ok(cols.includes("business_email"), `that one select NAMES business_email (${SENDER_SELECTS[0]})`);
  ok(cols.includes("email_domain"), "alongside the sending domain it has always carried");
  ok(WIRE && WIRE.html.includes(`href="mailto:${addr}?subject=Unsubscribe"`),
    "and the address that read returned is the one on the wire");
}

console.log("");
if (MUTATE) {
  const caught = fail > 0;
  console.log(caught
    ? `✅ NEGATIVE CONTROL PASSED: MUTATE=${MUTATE} was caught by ${fail} assertion(s):\n   - ${failures.slice(0, 4).join("\n   - ")}`
    : `❌ NEGATIVE CONTROL FAILED: MUTATE=${MUTATE} broke a real guarantee and every assertion still passed. That check is decorative.`);
  process.exit(caught ? 0 : 1);
}
console.log(fail ? `❌ ${pass} passed, ${fail} failed.` : `✅ ${pass} passed, 0 failed.`);
process.exit(fail ? 1 : 0);
