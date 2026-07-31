// THE FOUR TRANSACTIONAL EMAILS NOBODY WAS WATCHING.
//
//   node api/_confirm-email-lock.test.mjs        # exits non-zero on any difference
//
// The two GTA locks beside this one cover the DESIGNED templates (the ten vendored
// nurture/onboarding emails) and the automation STEP ROWS in the database. Between
// them they missed a third lane entirely: the transactional emails the confirm agent
// and the approvals inbox send around a booked free trial. Their copy lives in
// api/agent/confirm-automations.js and in the handlers themselves, not in a template
// module and not in the automations table, so neither lock could see them.
//
// WHAT THAT COST. All four shipped for weeks with a COMPLETELY BLANK FOOTER - no gold
// wordmark suffix, no city, no tagline, no domain, no Instagram link, and the line
//
//     "You're receiving this because you enquired about ."
//
// with the academy's name missing and a stray full stop. They were the three call
// sites that hand sendOn `vars: {}` on purpose (their merge tokens are resolved
// before the call), and until 30 Jul 2026 sendOn substituted location_email and
// nothing else - so every other academy fact rendered empty. Nothing threw, nothing
// was logged, and the one field with a guard behind it was the one field that was
// fine. MUTATE=novars below is that exact state, and it is the reason this file
// exists rather than a comment saying the fix is in.
//
// ─────────────────────────────────────────────────────────────────────────────
// WHAT IT RENDERS THROUGH, AND WHY THAT IS THE WHOLE VALUE
//
// The REAL send path, driven from as close to the real caller as each call site
// allows. Nothing here calls a renderer with hand-made arguments:
//
//   confirm-booking / same-day-check-in
//       The REAL fireScriptedStep() out of api/agent-confirm.js, driven end to end
//       against a stubbed wire: it reads the step out of getConfirmAutomations(),
//       resolves the appointment tokens, builds the vars, decides whether the step
//       emails at all, and calls the REAL sendOn(). Everything a change to that
//       function could break - the subject, the address chain, the parent's first
//       name, which steps email - moves a golden here. The function is not exported,
//       so the run imports a throwaway copy of the file with one `export` line added
//       (the .mutant- mechanism api/_public-ticket-intake.test.mjs and three other
//       suites already use). Nothing else in the copy is touched.
//
//       Since 30 Jul 2026 it also resolves THE BOOKED VENUE for real, through the
//       three hops the live code makes (open opportunity -> that offer's Blueprint
//       primary location -> the locations row). Everything a parent reads about
//       where to go comes off that last row: the address AND the entry directions.
//       Before that the stub answered [] and the goldens recorded GTA's REGISTERED
//       BUSINESS ADDRESS, which production has never sent - that is the exact bug
//       offerLocationVenue() exists to prevent, locked in as if it were correct.
//
//   card-approval / card-approval-legacy-subject
//       fireCardEmail's two-line body, with the card row taken from what the REAL
//       fireScriptedStep above actually wrote to agent_confirm_replies - so the
//       email an owner's ✓ sends is rendered from the row the detector produced,
//       not from a row somebody typed here.
//
//   approvals-confirm-book
//       The confirm-book branch of api/agent-approvals.js: a staff-edited draft with
//       the calendar links appended by the REAL buildIcalUrl / buildGoogleCalUrl,
//       then the REAL sendOn(). The draft itself is a fixture and says so below.
//
// The last three sit inside handlers behind auth, stage checks and GHL calls, so
// their sendOn() arguments are reconstructed rather than reached. CALL_SITES below
// PINS each one against the source: if a call site's arguments change shape, or one
// moves, or a NEW parent-facing email appears anywhere under api/, this run fails and
// says which. That is what keeps "the four" true instead of true-when-written.
//
// The fixture is BAM GTA's real row from scripts/snapshots/bam-gta.json - the same
// snapshot the two GTA locks and scripts/render-messages.mjs read, so all three locks
// agree about what GTA looks like. wordsOf() is imported from the message lock rather
// than reimplemented, for the same reason.
//
// THE CLOCK IS FROZEN (FAKE_NOW below). These sends are time-dependent in three
// places - which step is due, whether quiet hours defer the SMS, and how the times
// render - so a lock that used the wall clock would pass in the morning and fail at
// night.
//
// ─────────────────────────────────────────────────────────────────────────────
// TWO GOLDENS, because "changed" means two very different things (same split as
// api/_gta-message-lock.test.mjs):
//
//   WORDS  (__goldens__/confirm-emails/words/*.txt)
//     The From header, the subject, the inbox preheader, then the parent-visible
//     text and every link target with the tags stripped. Plus the SMS that rides
//     with the same touch, which no other lock covers. A failure here means a real
//     person receives different words.
//
//   MARKUP (__goldens__/confirm-emails/markup/*.html)
//     The full rendered HTML, byte for byte: colours, padding, table structure.
//
// A failure prints the WORDS diff first and then says what was markup-only, so
// whoever reads it can tell instantly whether a parent would notice.
//
// ─────────────────────────────────────────────────────────────────────────────
// RE-BLESSING (when a change to these emails IS intended)
//
//   Markup only, e.g. a shell change:
//     node api/_confirm-email-lock.test.mjs --bless-markup
//   The words lock still runs afterwards, so this can never quietly change copy.
//
//   Words, i.e. a booked family reads something different:
//     node api/_confirm-email-lock.test.mjs --bless-words I-AM-CHANGING-WHAT-GTA-PARENTS-READ
//   The confirmation phrase is required and deliberately unpleasant to type. Put the
//   reason and the person who decided it in the commit message. The git diff on
//   __goldens__/confirm-emails/ IS the record of what moved.
//
// ─────────────────────────────────────────────────────────────────────────────
// NEGATIVE CONTROLS. A suite that only ever passes tells you nothing. Each breaks ONE
// thing and must report NEGATIVE CONTROL PASSED, meaning the lock CAUGHT it:
//
//   MUTATE=novars   node api/_confirm-email-lock.test.mjs  # THE BUG. sendOn stops
//                   seeding the render from the academy's row, so the callers' empty
//                   vars are all that is left: the blank footer, verbatim. Two edits
//                   to a throwaway copy of api/_send.js, both pinned to the current
//                   lines. The second (the From display name) is carried for
//                   faithfulness and is INVISIBLE at GTA - it is the one academy whose
//                   sender is the pinned legacy string, so fromFor() returns before
//                   the name resolution either version would do. At any other academy
//                   it is the difference between the parent-facing name and "BAM ...".
//   MUTATE=copy     node api/_confirm-email-lock.test.mjs  # a word of the booking
//                   confirmation's own copy is edited
//   MUTATE=subject  node api/_confirm-email-lock.test.mjs  # the confirmation's
//                   subject line is edited
//   MUTATE=name     node api/_confirm-email-lock.test.mjs  # public_name goes, so
//                   clientVars falls back to the internal "BAM GTA"
//   MUTATE=tagline  node api/_confirm-email-lock.test.mjs  # ONE footer fact (the
//                   tagline) silently empties
//   MUTATE=email-on node api/_confirm-email-lock.test.mjs  # the same-day check-in
//                   starts emailing, i.e. a NEW parent-facing email appears
//   MUTATE=callsite node api/_confirm-email-lock.test.mjs  # a fifth sendOn email
//                   call site appears under api/ with nothing locking it
//
// If one reports FAILED, the lock is decorative there and must not be quoted as
// evidence.
//
// ─────────────────────────────────────────────────────────────────────────────
// WHAT THIS DOES NOT PROVE. It renders ONE academy (GTA). It does not drive the HTTP
// handlers around the last three call sites - auth, the Scheduled-Trial stage checks
// and the row claims are all untested here and belong to their own suites. And the
// staff draft in approvals-confirm-book is a fixture: what is locked about that email
// is the shell around it, which is what broke.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// ─── the stubbed wire ────────────────────────────────────────────────────────
// Set BEFORE api/_send.js is imported: it reads its Supabase / Resend config at
// module load. Everything downstream (Resend, GHL, Supabase REST) goes through global
// fetch, so one stub covers the whole path and no network or database is involved.
process.env.SUPABASE_URL = process.env.SUPABASE_URL || "https://stub.supabase.test";
process.env.VITE_SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "stub-service-key";
process.env.RESEND_API_KEY = process.env.RESEND_API_KEY || "stub-resend-key";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const GOLD = path.join(HERE, "__goldens__", "confirm-emails");
const WORDS_DIR = path.join(GOLD, "words");
const MARKUP_DIR = path.join(GOLD, "markup");
const SNAPSHOT_PATH = path.resolve(HERE, "../../../scripts/snapshots/bam-gta.json");
const MUTATE = process.env.MUTATE || "";

// ─── the frozen clock ────────────────────────────────────────────────────────
// 09:30 in GTA's own zone on the day of the trial. That is inside quiet hours (so the
// SMS sends rather than deferring), at/after the check-in's 9am send hour (so the
// morning-of step is due), and before the 7pm trial (so it has not passed).
const FAKE_NOW = Date.parse("2026-08-04T13:30:00.000Z");
const TRIAL_START = "2026-08-04T23:00:00.000Z";     // 7:00 PM in America/New_York
const TRIAL_END = "2026-08-05T00:00:00.000Z";
{
  const Real = Date;
  class Frozen extends Real {
    constructor(...a) { if (a.length === 0) super(FAKE_NOW); else super(...a); }
    static now() { return FAKE_NOW; }
  }
  globalThis.Date = Frozen;
}

const SNAPSHOT = JSON.parse(fs.readFileSync(SNAPSHOT_PATH, "utf8"));
const GTA_ROW = SNAPSHOT.client;
const DOMAIN = (GTA_ROW.website_setup || {}).domain || "";

// The lead. Same shape resolveContactInfo returns from GHL, and the same sample
// family the other two locks use, so a name in one golden means the same thing here.
const CONTACT = { firstName: "Maya", name: "Maya Alvarez", email: "maya@example.test", phone: "+15551234567" };

// The venue a GTA free trial is actually booked into: Linbrook, the primary location
// on GTA's Training offer. The ADDRESS and the ENTRY NOTE both come off this one row,
// which is the point - they used to come from two places, and the entry directions
// came from a sentence hardcoded in a SHARED automation step, so every academy told
// its parents about this door. Both values are read from the snapshot rather than
// typed here, so this lock and the other two cannot disagree about GTA's venue.
// (facts.location_entry_note is ahead of production; see the snapshot's own note.)
const GTA_OFFER_ID = "52a6285c-7832-44e1-b531-ab7ef9d8fc21";
const GTA_VENUE_ID = "615bce97-31d2-401e-8314-c07312b917f0";
const GTA_VENUE = { address: SNAPSHOT.facts.location_venue, entry_note: SNAPSHOT.facts.location_entry_note };
if (!GTA_VENUE.address || !GTA_VENUE.entry_note) {
  console.error("\n❌ STALE FIXTURE: scripts/snapshots/bam-gta.json is missing facts.location_venue or"
    + "\n   facts.location_entry_note. This lock renders the morning-of check-in through GTA's real venue;"
    + "\n   without them it would lock an academy with no address and no entry note, which is the exact"
    + "\n   degraded state the entry-note work exists to stop shipping. Re-capture the facts block.\n");
  process.exit(2);
}

// GTA's row as the database would return it, with the two columns the snapshot does
// not carry filled in: `email_domain` (the sending domain - the snapshot predates that
// column, and api/_approval-render.test.mjs stubs it from the same place) and the
// provider switches, which decide whether the appointment is read from GHL or the
// portal spine. The MUTATE controls edit this COPY and nothing on disk.
function mutatedRow() {
  const row = { ...GTA_ROW, email_domain: DOMAIN, booking_provider: "ghl", messaging_provider: "ghl", tz_alert_at: null };
  if (MUTATE === "name") row.public_name = null;      // clientVars falls back to the internal label
  if (MUTATE === "tagline") row.tagline = "";         // one footer fact silently empties
  return row;
}

// Mutable per-run state the stub reads.
const STATE = {
  clientRow: mutatedRow(),
  priorReplies: [],
  cardRows: [],       // every row the real code POSTs to agent_confirm_replies
  wire: [],           // what actually reached Resend / GHL
  unstubbed: [],      // see the note below
};

globalThis.fetch = async (url, init = {}) => {
  const u = String(url);
  const method = String(init.method || "GET").toUpperCase();
  const body = init.body ? JSON.parse(init.body) : null;
  const json = (v) => new Response(JSON.stringify(v), { status: 200, headers: { "content-type": "application/json" } });

  if (u === "https://api.resend.com/emails" && method === "POST") {
    STATE.wire.push({ kind: "email", from: body.from, to: (body.to || []).join(", "), subject: body.subject, html: body.html });
    return json({ id: "stub-email" });
  }
  if (u === "https://api.resend.com/domains") return json({ data: [{ name: DOMAIN, status: "verified" }] });
  if (u.includes("/conversations/messages") && method === "POST") {
    STATE.wire.push({ kind: "sms", text: body.message });
    return json({ messageId: "stub-sms" });
  }
  // PROJECTED, deliberately: a column the SELECT does not ask for is not in the
  // answer. That is how the send path's own SENDER_COLS list stays load-bearing here
  // - dropping a column from it empties what that column renders, which is the 29 Jul
  // regression one layer down, and it moves a golden below.
  if (u.includes("/rest/v1/clients?")) {
    const sel = (new URL(u).searchParams.get("select") || "").split(",").filter(Boolean);
    const row = {};
    for (const c of sel) row[c] = STATE.clientRow[c];
    return json([row]);
  }
  if (u.includes("/rest/v1/agent_confirm_replies")) {
    if (method === "POST") { STATE.cardRows.push(...(Array.isArray(body) ? body : [body])); return json([]); }
    return json(STATE.priorReplies);
  }
  // THE BOOKED VENUE, in three hops, because that is how the real code finds it:
  // the lead's open opportunity -> that offer's Blueprint primary location -> the
  // locations row. Both facts a parent reads about WHERE to go come off the last
  // one - the address and the entry directions - so serving the chain is what makes
  // this lock render the address GTA actually sends.
  //
  // It used to return [] like everything else, and that was wrong in a way the
  // golden recorded: with no venue the address chain falls all the way through to
  // clients.address, and the same-day golden locked "2205 Rosemount Cres" - GTA's
  // REGISTERED BUSINESS ADDRESS, a house, not the gym. Production has never sent
  // that: all 43 open GTA opportunities carry the Training offer, whose primary
  // location is Linbrook (read-only select, 2026-07-30). Sending families to the
  // registered address is the exact 2026-07-04 regression offerLocationVenue()
  // exists to prevent, and this fixture was quietly locking it as correct.
  if (u.includes("/rest/v1/opportunities")) return json([{ offer_id: GTA_OFFER_ID }]);
  if (u.includes("/rest/v1/offers")) return json([{ data: { general_info: { location: GTA_VENUE_ID } } }]);
  if (u.includes("/rest/v1/locations") && u.includes(GTA_VENUE_ID)) {
    // Projected like the clients read above, and for the same reason: entry_note
    // ships ahead of its migration, so agent-confirm.js asks for it and falls back
    // to an address-only select if the column is not there. A stub that answered
    // both selects identically would hide that fallback being wrong.
    const sel = (new URL(u).searchParams.get("select") || "").split(",").filter(Boolean);
    const full = { address: GTA_VENUE.address, entry_note: GTA_VENUE.entry_note };
    const row = {};
    for (const c of sel) row[c] = full[c];
    return json([row]);
  }
  if (u.includes("/rest/v1/")) return json([]);          // email_events, trial_bookings...
  if (u.includes("/appointments")) return json({ events: [{ startTime: TRIAL_START, endTime: TRIAL_END, status: "confirmed", title: "Free Trial" }] });
  if (u.includes("/contacts/")) return json({ contact: CONTACT });
  // NOT a throw. Most of the calls on this path sit inside best-effort try/catch
  // blocks, so throwing here would be swallowed and the run would go quietly on with
  // a fact missing. Recorded instead, and reported as a guard problem below.
  STATE.unstubbed.push(`${method} ${u}`);
  return json([]);
};

// ─── mutated copies, for the negative controls ───────────────────────────────
// Same mechanism as api/_public-ticket-intake.test.mjs: the edit is applied to a
// throwaway sibling copy, imported, and deleted. Nothing in the tree is modified.
// This suite also uses it on an ORDINARY run, for one reason only - fireScriptedStep
// is not exported, and a lock that re-implemented its 60 lines of argument-building
// would be locking a copy of the send path instead of the send path.
let controlBroken = null;
let mutantCount = 0;
const MUTANT_FILES = [];
const cleanupMutants = () => { while (MUTANT_FILES.length) { try { fs.unlinkSync(MUTANT_FILES.pop()); } catch (_) { /* best effort */ } } };
process.on("exit", cleanupMutants);

function mutateText(src, label, edits) {
  for (const [find, repl] of edits) {
    if (!src.includes(find)) {
      controlBroken = `MUTATE=${MUTATE} is pinned to text that is no longer in ${label}:\n\n${find}\n\n`
        + "The code it was written against has moved or been reformatted, so this control breaks NOTHING and "
        + "proves nothing. Re-point it at the current code, or delete it - do not leave it, because a control "
        + "that fails to apply looks exactly like a control that passed.";
      throw new Error(controlBroken);
    }
    src = src.split(find).join(repl);
  }
  return src;
}

function writeMutant(rel, edits, append = "") {
  const abs = path.join(HERE, rel);
  const src = mutateText(fs.readFileSync(abs, "utf8"), `api/${rel}`, edits) + append;
  const tmp = path.join(path.dirname(abs), `.mutant-${++mutantCount}-${path.basename(abs)}`);
  fs.writeFileSync(tmp, src);
  MUTANT_FILES.push(tmp);
  return tmp;
}

// THE BUG, as code. Both edits together are api/_send.js exactly as it stood before
// 30 Jul 2026: the render started from the caller's vars alone, and the From display
// name came from business_name (the internal label) rather than the parent-facing
// one. Every one of these emails is a `vars: {}` caller, so this empties all of them.
const NOVARS_EDITS = [
  [`const renderVars = { ...(sender.baseVars || {}), ...(vars || {}), location_email: sender.businessEmail };`,
   `const renderVars = { ...(vars || {}), location_email: sender.businessEmail };`],
  [`const name = String((vars && vars.location_name) || baseVars.location_name || "").replace(/[<>"]/g, "").trim();`,
   `const name = String((vars && vars.location_name) || row.name || "").replace(/[<>"]/g, "").trim();`],
];

// api/_send.js first (real, or the pre-fix copy), then the copy of agent-confirm.js
// that exports fireScriptedStep - pointed at whichever _send.js this run is using, so
// the scripted lane and the two reconstructed call sites always render through the
// same module instance.
const sendPath = MUTATE === "novars" ? writeMutant("_send.js", NOVARS_EDITS) : path.join(HERE, "_send.js");
const { sendOn } = await import(pathToFileURL(sendPath).href);

const AGENT_SRC = fs.readFileSync(path.join(HERE, "agent-confirm.js"), "utf8");
if (!AGENT_SRC.includes("async function fireScriptedStep(")) {
  console.error("\n❌ api/agent-confirm.js no longer defines fireScriptedStep(). This lock drives that function directly;\n"
    + "   re-point it at whatever replaced it rather than deleting the coverage.\n");
  process.exit(2);
}
const agentPath = writeMutant("agent-confirm.js",
  MUTATE === "novars" ? [[`import { sendOn } from "./_send.js";`, `import { sendOn } from "./${path.basename(sendPath)}";`]] : [],
  "\nexport { fireScriptedStep as __fireScriptedStep };\n");
const AGENT = await import(pathToFileURL(agentPath).href);
cleanupMutants();

const { getConfirmAutomations, DEFAULT_CONFIRM_AUTOMATIONS, buildIcalUrl, buildGoogleCalUrl } = await import("./agent/confirm-automations.js");
const { GTA, wordsOf } = await import("./_gta-message-lock.test.mjs");

// ─── the four call sites ─────────────────────────────────────────────────────
// PINNED against the source. These three lines are what this lock models, and a lock
// that models a call that is no longer there is worse than no lock: it is a green
// tick over an unlocked path. If one of these fails, do not delete it - re-point it
// and re-bless, because the arguments changing IS a change to what a parent receives.
const CALL_SITES = [
  { file: "agent-confirm.js", what: "the scripted booking confirmation (fireScriptedStep)", covers: ["confirm-booking", "same-day-check-in"],
    pin: `await sendOn({ channel: "email", clientId: client.id, toEmail: info.email, subject: emailSubject, body: emailBody, vars: {} });` },
  { file: "agent-confirm.js", what: "the confirm agent's card-approval confirmation (fireCardEmail)", covers: ["card-approval", "card-approval-legacy-subject"],
    pin: `await sendOn({ channel: "email", clientId, toEmail: info.email, subject: card.email_subject || "Your free trial is booked!", body: card.email_body, vars: {} });` },
  { file: "agent-approvals.js", what: "the approvals inbox confirmation (confirm-book)", covers: ["approvals-confirm-book"],
    pin: `await sendOn({ channel: "email", clientId, toEmail: info.email, subject: "Your free trial is booked!", body: confirmMsg, vars: {} });` },
];

// Every OTHER sendOn() under api/, declared. A new one fails this run until whoever
// added it says which lock covers it - which is the only thing that keeps the count
// in this file's header from rotting. Counted per file, comments stripped first.
const OTHER_SEND_SITES = {
  "automations.js": { count: 1, why: "the automation engine's own send, from an automation_steps row. Locked by api/_gta-step-lock.test.mjs (the row) and api/_approval-render.test.mjs (preview equals send)." },
  "_member-receipts.js": { count: 2, why: "the member receipt system's two sends - a new receipt (writeAndSend, used by both the paid-invoice and the refund path) and a staff-requested resend. Both render through renderReceipt() in the same file, and api/_member-receipts.test.mjs owns the words: it pins the receipt copy, proves the total-alone fallback, proves the portal line drops with no URL, proves a held send still writes the row, and pins the transactional FOOTER these two sends are the only callers to ask for (the joined sentence, and no unsubscribe anchor at all). Gated OFF for every academy until clients.receipt_mode is set." },
};

// Blank out comments while preserving length and newlines, so a call named in prose
// does not read as a call. (Every file in this repo names sendOn in comments.)
function codeOnly(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
    .replace(/(^|[^:])\/\/[^\n]*/g, (m, p) => p + " ".repeat(m.length - p.length));
}

// ─── driving the real thing ──────────────────────────────────────────────────
const AUTOS = () => {
  const autos = getConfirmAutomations(STATE.clientRow);
  if (MUTATE === "copy") autos.steps[0].template = autos.steps[0].template.replace("bring a basketball", "bring a water bottle");
  if (MUTATE === "subject") autos.steps[0].email_subject = "You're booked in!";
  if (MUTATE === "email-on") autos.steps.find((s) => s.key === "same_day").email = true;
  return autos;
};

async function driveScriptedStep({ receiptOnly, priorReplies }) {
  STATE.wire = [];
  STATE.priorReplies = priorReplies;
  const result = await AGENT.__fireScriptedStep({
    client: { ...STATE.clientRow }, token: "stub-token", locationId: "stub-location",
    mode: "self_drive", autos: AUTOS(), cfg: {},
    item: { name: "Maya Alvarez", last_at: null }, contactId: "stub-contact", receiptOnly,
  });
  return { result, wire: STATE.wire };
}

// fireCardEmail, on a row the REAL detector wrote. `card` is that row; the two-field
// read and the fallback subject are the call site's own, pinned above.
async function fireCardEmail(card) {
  STATE.wire = [];
  if (!card || !card.email_body) return { result: "no email body on the card", wire: [] };
  const r = await sendOn({ channel: "email", clientId: STATE.clientRow.id, toEmail: CONTACT.email,
    subject: card.email_subject || "Your free trial is booked!", body: card.email_body, vars: {} });
  return { result: JSON.stringify(r), wire: STATE.wire };
}

// The approvals inbox's own confirmation. THE DRAFT IS A FIXTURE - on this path it is
// whatever staff typed into the deck (or the detector's draft), so there is no fixed
// copy to lock. It is deliberately free of any academy detail, so everything
// identifying in this golden comes from the shell, which is the part that broke.
const STAFF_DRAFT = "You're all set - the free trial is booked. See you there!";
async function approvalsConfirmBook() {
  STATE.wire = [];
  const startMs = new Date(TRIAL_START).getTime();
  const cal = { startMs, endMs: startMs + 3600000, title: "Free Trial" };
  const confirmMsg = STAFF_DRAFT + `\n\nAdd it to your calendar:\n\nApple: ${buildIcalUrl(cal)}\n\nGoogle: ${buildGoogleCalUrl(cal)}`;
  const r = await sendOn({ channel: "email", clientId: STATE.clientRow.id, toEmail: CONTACT.email,
    subject: "Your free trial is booked!", body: confirmMsg, vars: {} });
  return { result: JSON.stringify(r), wire: STATE.wire };
}

// A card row as it stood before email_subject existed on it, so the `||` fallback in
// the call site above is a locked branch rather than an untested one.
const stripSubject = (row) => (row ? { ...row, email_subject: null } : row);

const CASES = [
  { key: "confirm-booking", site: "api/agent-confirm.js fireScriptedStep -> sendOn (the immediate booking receipt)",
    run: () => driveScriptedStep({ receiptOnly: true, priorReplies: [] }) },
  { key: "same-day-check-in", site: "api/agent-confirm.js fireScriptedStep -> sendOn (the morning_of check-in)",
    // The confirmation already went, exactly as the detector would see it: same
    // trial, kind confirm_auto, so nextDueStep moves on to the check-in.
    run: () => driveScriptedStep({ receiptOnly: false, priorReplies: [{ kind: "confirm_auto", status: "sent", step_key: "confirm", trial_at: TRIAL_START }] }) },
  { key: "card-approval", site: "api/agent-confirm.js fireCardEmail -> sendOn (owner ✓ on a queued card)",
    run: () => fireCardEmail(CARD_ROW) },
  { key: "card-approval-legacy-subject", site: "api/agent-confirm.js fireCardEmail -> sendOn (a card row with no email_subject)",
    run: () => fireCardEmail(stripSubject(CARD_ROW)) },
  { key: "approvals-confirm-book", site: "api/agent-approvals.js confirm-book -> sendOn (portal booking, staff ✓)",
    run: () => approvalsConfirmBook() },
];
let CARD_ROW = null;   // filled by the first case, from what the real code wrote

// ─── what the golden records ─────────────────────────────────────────────────
// The hidden preheader is the line an inbox shows NEXT TO the subject. wordsOf()
// strips it (it lives in a display:none span), so it is recorded here.
function preheaderOf(html) {
  const m = /<span style="display:none[^"]*">([\s\S]*?)<\/span>/.exec(String(html));
  return m ? m[1].trim() : "(none)";
}

function wordsFor(c, out) {
  const emails = out.wire.filter((w) => w.kind === "email");
  const sms = out.wire.filter((w) => w.kind === "sms");
  const lines = [`CALL SITE: ${c.site}`, `RESULT: ${out.result}`, `EMAILS: ${emails.length}`];
  // The SMS that rides with the same touch. No other lock covers this copy - it lives
  // in api/agent/confirm-automations.js, not in an automation_steps row - and it is
  // the only evidence in the no-email case that the step really ran.
  for (const s of sms) lines.push(`SMS: ${JSON.stringify(s.text)}`);
  for (const e of emails) {
    lines.push("", `FROM: ${e.from}`, `TO: ${e.to}`, `SUBJECT: ${e.subject}`, `PREHEADER: ${preheaderOf(e.html)}`, "", wordsOf(e.html));
  }
  return lines.join("\n") + "\n";
}
const markupFor = (out) => out.wire.filter((w) => w.kind === "email").map((e) => e.html).join("\n<!-- next email -->\n");

// ─── is the guard still describing production? ───────────────────────────────
// Goldens only ever prove today's render equals yesterday's render. If a fact stops
// rendering AND the golden is re-blessed, both sides move together and the diff comes
// out empty. These compare the render against what it is supposed to contain, which
// is the one thing a self-consistent snapshot test cannot do for itself - and between
// them they are the assertion that would have caught the blank footer on its own,
// with no golden at all.
function guardProblems(renders) {
  const out = [];
  const htmls = renders.flatMap((r) => r.out.wire.filter((w) => w.kind === "email"));
  if (!htmls.length) { out.push("NOTHING RENDERED: no email reached the wire from any call site. This lock is locking nothing."); return out; }

  // EVERY email, not some. All four carried the blank footer, and a check that
  // accepted "one of them has a tagline" would have passed on the day it shipped.
  //
  // ONE OF THE SIX IS WEAKER THAN THE REST, measured rather than assumed: the city is
  // also inside the venue address three of these emails print in their body, so under
  // MUTATE=novars it fires on one email out of four while the other five needles fire
  // on all four. It stays because it is the only check on the header block's city
  // line, but do not read "city present" as "the footer rendered".
  const FOOTER_FACTS = [
    ["the academy's parent-facing name", GTA_ROW.public_name],
    ["its city", "Oakville"],
    ["its tagline", GTA_ROW.tagline],
    ["its Instagram link", GTA_ROW.instagram_url],
    ["its own domain", DOMAIN],
    ["an unsubscribe pointed at its public email", `mailto:${GTA_ROW.business_email}?subject=Unsubscribe`],
  ];
  for (const [what, needle] of FOOTER_FACTS) {
    if (!needle) { out.push(`STALE FIXTURE: the snapshot has no value for ${what}.`); continue; }
    const missing = htmls.filter((e) => !String(e.html).includes(needle));
    if (missing.length) {
      out.push(`BLANK FOOTER: ${missing.length} of ${htmls.length} rendered email(s) do not contain ${what} (${JSON.stringify(needle)}). `
        + "That is the 29 Jul 2026 regression: these callers pass `vars: {}`, so every academy fact has to come from the "
        + "client row the send path reads for itself. See the header of api/_send.js.");
    }
  }
  // The From header is parent-visible too, and it broke the same way (the display
  // name came off the caller's vars, so these callers sent as the INTERNAL label).
  //
  // GTA IS THE ONE ACADEMY WHERE THE NAME HALF CANNOT BE ASSERTED, and pretending
  // otherwise would be the decorative version of this check. fromFor() in api/_send.js
  // returns the pinned legacy string byte for byte when the academy's address IS the
  // legacy address - "BAM Toronto <info@byanymeanstoronto.ca>", the sender GTA's
  // parents have always seen - so that branch returns before any name resolution
  // happens. What is asserted is what is still assertable and still true for every
  // academy: it goes out from the academy's OWN domain, and never under our internal
  // shorthand. The exact string is in the goldens, so a change to it moves one.
  for (const e of htmls) {
    const addr = (/<([^>]+)>/.exec(String(e.from)) || [null, String(e.from)])[1].trim().toLowerCase();
    if (DOMAIN && !addr.endsWith(`@${DOMAIN}`)) {
      out.push(`FROM HEADER: an email goes out from ${JSON.stringify(e.from)}, which is not on the academy's own domain (${DOMAIN}). `
        + "There is deliberately no shared or fallback sender: an email that cannot go out AS the academy must hold, not borrow.");
    }
  }
  // The owner's personal inbox must appear NOWHERE in a parent-facing email, and our
  // own internal shorthand must never be read back to a paying family.
  const all = htmls.map((e) => `${e.from}\n${e.html}`).join("\n");
  if (GTA_ROW.email && all.includes(GTA_ROW.email)) {
    out.push(`OWNER EMAIL PUBLISHED: ${JSON.stringify(GTA_ROW.email)} is clients.email - the address WE contact the owner on - `
      + "and it is in a parent-facing email. No public field may fall back to it.");
  }
  if (GTA_ROW.public_name !== GTA_ROW.business_name && all.includes(GTA_ROW.business_name)) {
    out.push(`INTERNAL LABEL LEAKED: ${JSON.stringify(GTA_ROW.business_name)} is our own shorthand. Parents should only ever `
      + `read ${JSON.stringify(GTA_ROW.public_name)}.`);
  }

  // The two locks must agree about what GTA is. They read the same file, so this can
  // only fire if one of them starts reading somewhere else.
  if (GTA.id !== GTA_ROW.id) out.push("FIXTURE SPLIT: this lock and api/_gta-message-lock.test.mjs are no longer rendering the same academy.");

  if (STATE.unstubbed.length) {
    out.push(`UNSTUBBED CALL from the send path: ${[...new Set(STATE.unstubbed)].join(", ")}. Something on this path now asks for `
      + "data this harness does not serve, so part of what is rendered above is a stub's empty answer rather than GTA's.");
  }
  return out;
}

// EVERY parent-facing email that leaves api/ has to be one of the ones locked here or
// declared elsewhere. Without this the header's "four" is a claim about the day it was
// written; with it, a fifth cannot appear unnoticed.
function callSiteProblems() {
  const out = [];
  for (const cs of CALL_SITES) {
    const src = codeOnly(fs.readFileSync(path.join(HERE, cs.file), "utf8"));
    if (!src.includes(cs.pin)) {
      out.push(`CALL SITE MOVED: api/${cs.file} no longer contains the call this lock models for ${cs.what}:\n      ${cs.pin}\n    `
        + `The goldens ${cs.covers.map((k) => `"${k}"`).join(", ")} are rendered from those arguments. Re-point the pin and re-bless - `
        + "the arguments changing IS a change to what a parent receives.");
    }
  }
  const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return e.name === "node_modules" || e.name.startsWith("__") ? [] : walk(p);
    return e.isFile() && /\.js$/.test(e.name) && !/^\.mutant-/.test(e.name) ? [p] : [];
  });
  const declared = new Map();
  for (const cs of CALL_SITES) declared.set(cs.file, (declared.get(cs.file) || 0) + 1);
  for (const [f, d] of Object.entries(OTHER_SEND_SITES)) declared.set(f, (declared.get(f) || 0) + d.count);

  for (const file of walk(HERE)) {
    const rel = path.relative(HERE, file).split(path.sep).join("/");
    if (rel === "_send.js") continue;                       // where sendOn is defined
    let src = codeOnly(fs.readFileSync(file, "utf8"));
    // The control models what actually happens: a new lane starts emailing parents
    // and nobody thinks about who is watching the words.
    if (MUTATE === "callsite" && rel === "agent-approvals.js") src += `\nawait sendOn({ channel: "email", clientId, toEmail: e, subject: "Welcome!", body: b, vars: {} });\n`;
    const found = (src.match(/\bsendOn\s*\(/g) || []).length;
    const want = declared.get(rel) || 0;
    if (found === want) continue;
    out.push(found > want
      ? `UNLOCKED SEND SITE: api/${rel} calls sendOn() ${found} time(s); this lock accounts for ${want}.\n    Every one of those can put words in front of a parent. Lock the new one here (add it to CASES and CALL_SITES), or `
        + "declare it in OTHER_SEND_SITES naming the suite that already covers it."
      : `STALE INVENTORY: api/${rel} calls sendOn() ${found} time(s); this lock claims ${want}. A call site has gone - delete or re-point its entry, `
        + "because the spare slot it leaves behind is a free pass for the next one.");
  }
  return out;
}

// The set of scripted steps that email, taken from the shipped config rather than
// from this file, so a NEW step - or an existing one starting to email - cannot ship
// without a golden. This is what makes the same-day check-in's "EMAILS: 0" a lock
// rather than a note.
function stepCoverageProblems() {
  const out = [];
  const keys = DEFAULT_CONFIRM_AUTOMATIONS.steps.map((s) => s.key);
  const expected = { confirm: "confirm-booking", same_day: "same-day-check-in" };
  for (const k of keys) {
    if (!expected[k]) out.push(`NO GOLDEN: api/agent/confirm-automations.js ships a step "${k}" that this lock does not render. `
      + "A new scripted touch reaches booked families; give it a case here and bless it deliberately.");
  }
  for (const k of Object.keys(expected)) {
    if (!keys.includes(k)) out.push(`STALE CASE: this lock renders the "${k}" step but the shipped sequence no longer has one.`);
  }
  return out;
}

// ─── diff ────────────────────────────────────────────────────────────────────
function lcsOps(a, b) {
  const n = a.length, m = b.length;
  const dp = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--)
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const ops = [];
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) { ops.push(["=", a[i]]); i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) ops.push(["-", a[i++]]);
    else ops.push(["+", b[j++]]);
  }
  while (i < n) ops.push(["-", a[i++]]);
  while (j < m) ops.push(["+", b[j++]]);
  return ops;
}
const trunc = (s) => (s.length > 220 ? s.slice(0, 217) + "..." : s);
function printDiff(expected, actual, indent = "    ") {
  const ops = lcsOps(expected.split("\n"), actual.split("\n"));
  let run = 0;
  ops.forEach((op, idx) => {
    if (op[0] === "=") { run++; return; }
    if (run > 0) {
      const prev = ops[idx - 1];
      if (prev && prev[0] === "=") console.log(indent + "  " + trunc(prev[1]));
      run = 0;
    }
    console.log(indent + (op[0] === "-" ? "- was:  " : "+ now:  ") + trunc(op[1]));
  });
}

// ─── run ─────────────────────────────────────────────────────────────────────
await main();

async function main() {
  const argv = process.argv.slice(2);
  const BLESS_MARKUP = argv.includes("--bless-markup");
  const BLESS_WORDS_AT = argv.indexOf("--bless-words");
  const PHRASE = "I-AM-CHANGING-WHAT-GTA-PARENTS-READ";
  const blessWords = BLESS_WORDS_AT >= 0;

  if (blessWords && argv[BLESS_WORDS_AT + 1] !== PHRASE) {
    console.error("\n--bless-words rewrites the record of what a booked family reads today."
      + `\nIf that is really what you mean, run:\n\n  node api/_confirm-email-lock.test.mjs --bless-words ${PHRASE}\n`);
    process.exit(2);
  }
  if ((blessWords || BLESS_MARKUP) && MUTATE) {
    console.error("\nRefusing to bless goldens while MUTATE is set. That would enshrine the mutation.\n");
    process.exit(2);
  }

  console.log("\n── The confirm agent's transactional emails ──");
  console.log(`   ${CASES.length} goldens across ${CALL_SITES.length} call sites, rendered through the real send path with`);
  console.log(`   GTA's real client row (scripts/snapshots/bam-gta.json, public_name ${JSON.stringify(GTA_ROW.public_name || null)}).`);
  if (MUTATE) console.log(`   MUTATE=${MUTATE} - this run is a negative control and MUST be caught.`);
  console.log("");

  // ── render everything, in order: case 3 uses the row case 1 really wrote ──
  const renders = [];
  for (const c of CASES) {
    let out;
    try { out = await c.run(); }
    catch (e) { out = { result: `THREW: ${e && e.message}`, wire: [] }; }
    if (c.key === "confirm-booking") CARD_ROW = STATE.cardRows.find((r) => r.kind === "confirm_auto" && r.email_body) || null;
    renders.push({ c, out });
  }

  if (blessWords) {
    fs.mkdirSync(WORDS_DIR, { recursive: true });
    for (const r of renders) fs.writeFileSync(path.join(WORDS_DIR, `${r.c.key}.txt`), wordsFor(r.c, r.out));
    console.log(`⚠️  WORDS goldens rewritten for ${renders.length} cases.`);
    console.log("   Read `git diff` line by line before committing. Every changed line is a line a booked family will read.\n");
  }
  if (BLESS_MARKUP) {
    fs.mkdirSync(MARKUP_DIR, { recursive: true });
    for (const r of renders) { const m = markupFor(r.out); if (m) fs.writeFileSync(path.join(MARKUP_DIR, `${r.c.key}.html`), m); }
    console.log(`📐 MARKUP goldens rewritten. The words lock still runs below.\n`);
  }

  const wordFails = [];
  const markupFails = [];
  const problems = [];

  for (const { c, out } of renders) {
    const words = wordsFor(c, out);
    const markup = markupFor(out);
    const wPath = path.join(WORDS_DIR, `${c.key}.txt`);
    const mPath = path.join(MARKUP_DIR, `${c.key}.html`);
    if (!fs.existsSync(wPath)) {
      problems.push(`NO GOLDEN for "${c.key}". A new email to a booked family must be blessed deliberately - see the header of this file.`);
      continue;
    }
    // A case that sends no email has no markup golden, by construction. If it GROWS
    // one, that is a NEW email in front of a booked family: it is reported here AND
    // the words compare below still runs, because "EMAILS: 0 -> 1" plus the whole
    // email is the readable half and a bare "no golden" line is not.
    const missingMarkupGolden = !!markup && !fs.existsSync(mPath);
    if (missingMarkupGolden) {
      problems.push(`NO MARKUP GOLDEN for "${c.key}", which now renders an email where it used to render none. `
        + "Read the words diff below first - a new parent-facing email is a decision, not a formatting change - then bless it with --bless-markup.");
    }
    const goldenWords = fs.readFileSync(wPath, "utf8");
    const wordsSame = goldenWords === words;
    const markupSame = !markup ? !fs.existsSync(mPath) : (!missingMarkupGolden && fs.readFileSync(mPath, "utf8") === markup);

    if (wordsSame && markupSame) { console.log(`  ✅ ${c.key}`); continue; }
    if (!wordsSame) { wordFails.push({ key: c.key, expected: goldenWords, actual: words, markupSame }); console.log(`  ❌ ${c.key}  WORDS CHANGED`); }
    else if (missingMarkupGolden) console.log(`  ❌ ${c.key}  no markup golden`);
    else { markupFails.push({ key: c.key, expected: fs.readFileSync(mPath, "utf8"), actual: markup }); console.log(`  ⚠️  ${c.key}  markup only`); }
  }

  // Runs under --bless-* too: re-blessing rewrites the goldens, so it is the one
  // moment a blank footer would be baked in permanently and silently.
  problems.push(...guardProblems(renders));
  problems.push(...callSiteProblems());
  problems.push(...stepCoverageProblems());

  if (wordFails.length) {
    console.log("\n\n════ WHAT A BOOKED FAMILY WOULD READ CHANGED ════");
    console.log("These are the differences a real parent would notice.\n");
    for (const f of wordFails) {
      console.log(`  ${f.key}${f.markupSame ? "" : "   (the markup around them moved too)"}`);
      printDiff(f.expected, f.actual);
      console.log("");
    }
  }
  if (markupFails.length) {
    console.log("\n════ MARKUP ONLY ════");
    console.log("The parent-visible text, the subject, the From header and every link target are IDENTICAL in these.");
    console.log("Only the HTML around them moved (colours, padding, structure).\n");
    for (const f of markupFails) {
      const changed = lcsOps(f.expected.split("\n"), f.actual.split("\n")).filter((o) => o[0] !== "=").length;
      console.log(`  ${f.key}: ${changed} changed line(s), ${f.expected.length} -> ${f.actual.length} bytes`);
      printDiff(f.expected, f.actual, "      ");
      console.log("");
    }
  }
  if (problems.length) {
    console.log("\n════ PROBLEMS WITH THE GUARD ITSELF ════\n");
    for (const p of problems) console.log("  " + p + "\n");
  }

  if (MUTATE) {
    if (controlBroken) { console.log(`\n❌ NEGATIVE CONTROL BROKEN: ${controlBroken}`); process.exit(1); }
    const caught = wordFails.length + markupFails.length + problems.length > 0;
    console.log(caught
      ? `\n✅ NEGATIVE CONTROL PASSED: MUTATE=${MUTATE} was caught (${wordFails.length} with changed words, ${markupFails.length} markup-only, ${problems.length} guard problem(s)).`
      : `\n❌ NEGATIVE CONTROL FAILED: MUTATE=${MUTATE} changed nothing this lock noticed. It is decorative here.`);
    process.exit(caught ? 0 : 1);
  }

  const failed = wordFails.length + markupFails.length + problems.length;
  if (failed) {
    console.log(`\n❌ FAILED: ${wordFails.length} with changed words, ${markupFails.length} markup-only, ${problems.length} guard problem(s).`);
    console.log("   Intended? See RE-BLESSING at the top of api/_confirm-email-lock.test.mjs.\n");
    process.exit(1);
  }
  console.log(`\n✅ All ${CASES.length} transactional emails are byte-identical to their goldens, and every one carries the academy's own footer.\n`);
  process.exit(0);
}
