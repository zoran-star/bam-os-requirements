// BAM GTA STEP LOCK.
//
// Sibling of _gta-message-lock.test.mjs, and it covers the half that one deliberately
// does not. The message lock renders the ten VENDORED email templates - the designed
// HTML that lives in the repo. This one renders the AUTOMATION STEP ROWS: the message
// bodies that live in the database, which is where all of GTA's SMS copy sits and
// where the last hardcoded academy details were.
//
//   node api/_gta-step-lock.test.mjs      # exits non-zero on any difference
//
// WHY IT EXISTS. Templating GTA's rows means rewriting live copy that real parents
// receive, swapping typed-in details for merge tokens on the promise that the tokens
// resolve to exactly the same characters. "I ran it and it looked the same" is not a
// promise anybody can check six months from now. This turns it into something the
// repo checks: every step body rendered through the REAL send path, compared byte for
// byte against a golden captured from GTA's live copy.
//
// WHAT IT RENDERS THROUGH.
//   renderStepMessage() from api/email-shells.js, for BOTH channels - the single
//   function api/_send.js calls at send time and the owner's approval surface
//   (api/automations.js `approval-queue`) calls to show an owner what will send.
//   Email output is reduced to the parent-visible words + link targets by wordsOf()
//   from the message lock. A `template:<key>` body resolves to the designed email,
//   so the two locks overlap there on purpose: this one proves the ROW still points
//   at that template.
//
//   IT MUST STAY renderStepMessage, AND THAT IS THE POINT OF THIS NOTE. This lock
//   used to call renderEmail / resolveMergeVars directly - the same operations
//   renderStepMessage performs, one layer down. That made it a RELATIVE anchor: it
//   proved the step bodies had not changed, but it could not see a bug inside
//   renderStepMessage itself, and neither could api/_approval-render.test.mjs,
//   which compares two callers of that function against each other. Between them
//   they left the function that renders every academy's live sends unanchored.
//   Deleting the subject merge, or forcing `empty` to false (which kills the
//   empty-after-merge skip - the 28 Jul review-ask bug, and empty SMS bodies
//   reaching the provider and burning all three retries), passed every suite in the
//   repo. Now those goldens carry the SUBJECT, the EMPTY flag and the body that
//   function returns, so either mutation moves a golden here.
//
// The golden therefore records all three parts of what renderStepMessage returns:
//   SUBJECT:  the RESOLVED subject (email only - it is what reaches the inbox and
//             what seeds the preheader inside the email)
//   EMPTY:    whether the copy resolved to nothing, which is what makes the send
//             path skip the step and the approval surface say so
//   the body: parent-visible words + link targets (email) or the exact text (SMS)
//
// The fixture is scripts/snapshots/bam-gta.json - the same snapshot the message lock
// and scripts/render-messages.mjs read, so "what GTA looks like today" has exactly one
// answer. fixtureProblems() below fails the run if that snapshot has stopped
// describing production.
//
// ─────────────────────────────────────────────────────────────────────────────
// RE-BLESSING (when a change to GTA IS intended)
//
//   node api/_gta-step-lock.test.mjs --bless I-AM-CHANGING-WHAT-GTA-PARENTS-READ
//
// The phrase is required and deliberately unpleasant to type, because unlike the
// markup half of the message lock there is nothing cosmetic in here: every byte of a
// step body is read by a person. Put the reason and who decided it in the commit
// message. The git diff on __goldens__/bam-gta-steps/ IS the record of what moved.
//
// ─────────────────────────────────────────────────────────────────────────────
// NEGATIVE CONTROL. A suite that only ever passes tells you nothing:
//
//   MUTATE=token   node api/_gta-step-lock.test.mjs   # edits one body's web address
//   MUTATE=domain  node api/_gta-step-lock.test.mjs   # blanks the academy's domain
//   MUTATE=name    node api/_gta-step-lock.test.mjs   # falls back to the internal name
//
// Each must report NEGATIVE CONTROL PASSED, meaning the lock CAUGHT it. `token` proves
// the lock notices a body being edited, `domain` proves it notices identity going
// missing, and `name` proves it notices "BAM GTA" reaching a parent. If one reports
// FAILED, the lock is decorative there and should not be quoted as evidence.
//
// `domain` USED to need a workaround here, and the workaround is gone, which is the one
// thing worth recording about it. BAM GTA was the ONE academy with an entry in a
// hardcoded LOCATIONS map in api/email-shells.js, so blanking its website_setup.domain
// changed nothing - locFor() fell straight back to the pinned siteUrl - and the control
// had to render under a DIFFERENT client id to model a normal academy. That map was
// deleted on 29 Jul 2026 (api/_email-identity-from-the-row.test.mjs is the suite that
// says so, migration 20260729T235000 is the data half). GTA now resolves through
// locFromVars like everybody else, so the control blanks the row and renders under
// GTA's OWN id, and the lock catches it. Re-verified after the deletion, not assumed.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { renderStepMessage, clientVars } from "./email-shells.js";
import { GTA, VARS, FACTS, wordsOf } from "./_gta-message-lock.test.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const GOLD = path.join(HERE, "__goldens__", "bam-gta-steps");
const SNAPSHOT_PATH = path.resolve(HERE, "../../../scripts/snapshots/bam-gta.json");
const SNAPSHOT = JSON.parse(fs.readFileSync(SNAPSHOT_PATH, "utf8"));

// ─── the negative control ────────────────────────────────────────────────────
// Applied to a COPY of the inputs, so nothing on disk is touched.
const MUTATE = process.env.MUTATE || "";
function mutatedClient() {
  const c = { ...GTA };
  if (MUTATE === "domain") c.website_setup = { ...(c.website_setup || {}), domain: "" };
  if (MUTATE === "name") c.public_name = null; // clientVars falls back to business_name
  return c;
}
function mutatedBody(body) {
  // Change the web address a body carries, whichever form it is in. Works before the
  // templating swap (the literal) and after it (the token), so the control keeps
  // proving the same thing - that an edit to a body cannot slip through - rather than
  // silently becoming a no-op the day the bodies change shape.
  if (MUTATE !== "token") return body;
  return String(body)
    .replace("{{location.domain}}", "byanymeansTYPO.ca")
    .replace("byanymeanstoronto.ca", "byanymeansTYPO.ca");
}

const CLIENT = mutatedClient();
const VARS_USED = MUTATE ? { ...clientVars(CLIENT), ...FACTS, first_name: "Maya", full_name: "Maya Alvarez", athlete: "Jordan Alvarez" } : VARS;
// ALWAYS GTA'S OWN ID, including under MUTATE=domain. Until 29 Jul 2026 that control had
// to render under a stranger's id, because GTA's pinned LOCATIONS entry would have
// supplied the very site the control had just blanked and the control would have proved
// nothing. The pin is gone, so the id no longer changes anything for any academy - and
// rendering under GTA's real id is now the STRONGER form, because it is the id a pin
// would be keyed by.
const RENDER_CLIENT_ID = CLIENT.id;

// The hidden preheader - the line an inbox shows NEXT TO the subject. It is derived
// from the subject inside renderEmail, and wordsOf() strips it (it lives in a
// display:none span), so without recording it here the goldens could not see a
// render that passed the RAW subject into renderEmail while returning the resolved
// one: the subject line would read correctly and the inbox preview would show a
// literal {{token}}.
function preheaderOf(html) {
  const m = /<span style="display:none[^"]*">([\s\S]*?)<\/span>/.exec(String(html));
  return m ? m[1].trim() : "(none)";
}

// ─── render one step exactly as it sends ─────────────────────────────────────
function renderStep(step) {
  const body = mutatedBody(step.body || "");
  const m = renderStepMessage({
    channel: String(step.channel || "").toLowerCase(),
    clientId: RENDER_CLIENT_ID, subject: step.subject, body, vars: VARS_USED,
  });
  if (m.channel === "email") {
    return `SUBJECT: ${m.subject}\nPREHEADER: ${m.empty ? "(none)" : preheaderOf(m.html)}\nEMPTY: ${m.empty}\n\n${m.empty ? "(resolves to nothing - this step does not send)\n" : wordsOf(m.html)}`;
  }
  // JSON so whitespace is VISIBLE in the golden: a body that resolves to "\n\n" and
  // one that resolves to "" are different outcomes and must not look identical here.
  return `EMPTY: ${m.empty}\nTEXT: ${JSON.stringify(m.text)}\n`;
}

// ─── the empty-case probes ───────────────────────────────────────────────────
// Two SYNTHETIC steps, blessed alongside the real ones. They are not GTA copy and
// nothing sends them; they exist because recording the EMPTY flag only anchors it
// if some golden actually carries EMPTY: true.
//
// This was measured, not assumed. With the flag recorded but every real GTA step
// resolving to something, forcing `empty = false` inside renderStepMessage still
// passed this lock - all 21 goldens already said EMPTY: false. That mutation is the
// 28 Jul bug (the review-ask email sending with no review link) plus empty SMS
// bodies reaching the provider and burning all three retries, so it is exactly the
// one that must not slip through.
//
// `{{next_session}}` is the token used because it is empty by construction: the
// worker fills it at send time from the academy's next open slot, and it is NOT in
// DROP_WHEN_EMPTY, so a body that is only that token resolves to "" for every
// academy, whatever data it has. That keeps the probes stable if GTA's row changes.
// A probe also exists for each of the OTHER things renderStepMessage returns that
// GTA's real rows happen not to exercise. Each one was added because a mutation
// survived without it, not on principle:
//
//   _probe-subject-email  A TOKENISED subject with a non-empty body. Before it,
//                         `onboarding-8` was the only golden whose subject carried a
//                         token - and it is in the onboarding sequence, which the
//                         sales approval does not even cover. De-tokenising that one
//                         subject (an ordinary copy edit) and re-blessing left the
//                         subject merge free to be deleted again with every suite
//                         green. Its preheader is also derived from the subject, so
//                         this probe anchors both.
//   _probe-blank-sms      A body that resolves to WHITESPACE, not "". `empty` is
//                         `!msg.trim()`; without this, weakening it to `!msg` shipped
//                         green, and a whitespace-only body reaches the provider,
//                         gets rejected and burns all three retries.
const EMPTY_PROBES = [
  { key: "_probe-empty-sms", automation: "_probe", step: { channel: "sms", position: 0, body: "{{next_session}}" } },
  { key: "_probe-empty-email", automation: "_probe", step: { channel: "email", position: 0, subject: "Probe", body: "{{next_session}}" } },
  // Two empty tokens either side of a blank line resolve to "\n\n" - truthy, but
  // nothing a person could read.
  { key: "_probe-blank-sms", automation: "_probe", step: { channel: "sms", position: 0, body: "{{next_session}}\n\n{{next_session}}" } },
  { key: "_probe-subject-email", automation: "_probe", step: { channel: "email", position: 0,
    subject: "{{contact.first_name}}, {{location.name}} has a spot for {{contact.athlete_first_name}}",
    body: "Hi {{contact.first_name}}, see you at {{location.venue}} in {{location.city}}." } },
  // A LONG tokenised subject, with a token straddling character 140.
  //
  // renderEmail builds the hidden preheader as `subject.slice(0, 140)` BEFORE any
  // merge pass, so whether the subject arrives resolved or raw is invisible for a
  // short one (the final whole-document resolveMergeVars fills it either way) and
  // very visible for a long one: the raw form truncates mid-token and the inbox
  // preview line ends in a dangling "{{". renderStepMessage passes the RESOLVED
  // subject, so shipped behaviour is correct - this probe is what keeps it that way.
  { key: "_probe-longsubject-email", automation: "_probe", step: { channel: "email", position: 0,
    subject: "A quick note about your athlete's upcoming free trial session with our coaches this week, and everything worth bringing along - {{contact.first_name}}",
    body: "Hi {{contact.first_name}}, details below." } },
  // WHITESPACE AROUND THE BODY. renderStepMessage trims the body before rendering;
  // the lock that preceded it did not. Every GTA row happens to be clean, so the
  // byte-identity when this build landed was real rather than lucky - but the trim
  // itself was untested, and a future row pasted in with a leading newline would have
  // shifted silently. This pins it: the trim is the send path's behaviour and both
  // the approval surface and the goldens must show the trimmed form.
  { key: "_probe-untrimmed-sms", automation: "_probe", step: { channel: "sms", position: 0,
    body: "\n\n  Hi {{contact.first_name}}, see you Tuesday.  \n\n" } },
];

// Every step in the snapshot, in send order, with a stable golden filename.
function allSteps() {
  const out = [...EMPTY_PROBES];
  for (const a of [...SNAPSHOT.automations].sort((x, y) => x.automation_key.localeCompare(y.automation_key))) {
    for (const s of [...(a.steps || [])].sort((x, y) => x.position - y.position)) {
      out.push({ key: `${a.automation_key}-${s.position}`, automation: a.automation_key, step: s });
    }
  }
  return out;
}

// ─── is the fixture still describing production? ─────────────────────────────
// Same job as the message lock's version, aimed at what THIS lock depends on. Goldens
// only ever prove today's render equals yesterday's render; if the fixture loses a
// field, both sides of that compare move together and the diff comes out empty. These
// compare the fixture against what it is supposed to be.
function fixtureProblems(rendered) {
  const out = [];
  const all = rendered.map((r) => r.text).join("\n");

  if (!SNAPSHOT.automations || !SNAPSHOT.automations.length) {
    out.push("STALE FIXTURE: scripts/snapshots/bam-gta.json carries no automations. This lock has nothing to lock.");
    return out;
  }

  // 1. Every automation GTA actually runs is present. The previous snapshot was
  //    hand-abridged down to four, so three whole sequences - including every
  //    remaining hardcoded literal - were invisible to anything reading it.
  const REQUIRED = ["contact_form", "ghosted", "missed_trial", "nurture", "onboarding", "summer_special", "trial_form"];
  const have = new Set(SNAPSHOT.automations.map((a) => a.automation_key));
  const absent = REQUIRED.filter((k) => !have.has(k));
  if (absent.length) {
    out.push(`STALE FIXTURE: no ${absent.join(", ")} automation in the snapshot. GTA runs it in production. `
      + "Re-capture, or this lock is quietly not covering it.");
  }

  // 2. The onboarding sequence is still 8 steps. It is the one place a template can be
  //    dropped without any other test noticing, and the 7-vs-8 gap against the master
  //    is a DELIBERATE, recorded divergence (the testimonials step). If GTA's own count
  //    moves, somebody has closed that gap from the wrong end.
  const onb = SNAPSHOT.automations.find((a) => a.automation_key === "onboarding");
  if (onb && (onb.steps || []).length !== 8) {
    out.push(`STALE FIXTURE: GTA's onboarding has ${(onb.steps || []).length} steps in the snapshot, production has 8. `
      + "If that is a real change, say which step went and why in the commit; the testimonials step is held on purpose.");
  }

  // 3. The facts block is present AND reaching output. It is the newest way this
  //    fixture can lie: venue, weekly schedule and coach handles live in other
  //    tables, so nothing in the client row hints at them. Deleting the block would
  //    show up as a golden diff, but DRIFT would not - the goldens and the render
  //    would move together and both locks would stay green while claiming byte
  //    identity with what a member actually receives. Same failure as the
  //    `public_name` incident, one table further out.
  //
  //    Re-capture with scripts/render-messages.mjs --client <uuid>, which now builds
  //    this block by calling api/_academy-facts.js - the same function the send path
  //    calls - so it is derived rather than typed.
  const facts = SNAPSHOT.facts;
  if (!facts || !facts.location_venue || !(facts.location_schedule || []).length) {
    out.push("STALE FIXTURE: scripts/snapshots/bam-gta.json has no `facts` venue or schedule. GTA has both in "
      + "production (a locations row and 86 live schedule_slots), so the welcome email and the schedule SMS "
      + "below are locking a version of GTA that sends neither. Re-capture the snapshot.");
  } else {
    const firstGroup = ((facts.location_schedule[0] || {}).groups || [])[0] || {};
    for (const [what, needle] of [
      ["the training venue", facts.location_venue],
      ["the weekly schedule", firstGroup.name],
      ["the coaches to follow", ((facts.location_coaches || [])[0] || {}).name],
    ]) {
      if (!needle) { out.push(`STALE FIXTURE: the facts block has no ${what}.`); continue; }
      if (!all.includes(needle)) {
        out.push(`STALE FIXTURE: ${what} (${JSON.stringify(needle)}) is in the snapshot's facts block but reaches no `
          + "rendered message. Either the templates stopped reading it or the fixture is not feeding them - either "
          + "way these goldens are no longer locking it.");
      }
    }
  }


  // 5. GTA's own domain and owner reach the output at all. A staleness check, and it
  //    is IMPORTANT to be honest about what it is not.
  //
  //    It was written to answer "is this actually GTA's render", because the
  //    parent-facing name stopped being able to on 28 Jul 2026: BAM San Jose's
  //    public_name became the identical string, by a ruling that the name is the brand
  //    and the city lives in the domain. (That ruling was reversed on 29 Jul 2026 by
  //    migration 20260729T235000 - the name now drives the gold wordmark, so the bare
  //    brand made every academy's wordmark read BY ANY MEANS BASKETBALL. San Jose is
  //    "By Any Means San Jose" again. The name CAN discriminate once that is applied;
  //    it cannot today, because production still holds the old value on both rows.)
  //
  //    IT STILL DOES NOT ANSWER THAT, and a negative control proved it rather than
  //    anyone reasoning about it. Swapping GTA's whole row and facts for San Jose's
  //    and re-rendering leaves BOTH needles in the output. The REASON changed on
  //    29 Jul 2026 and was re-measured, not assumed:
  //      - the domain. This used to be the hardcoded LOCATIONS entry supplying the
  //        email footer's site instead of the row. That entry is DELETED and the footer
  //        now follows the row. The domain survives the swap because FOUR SMS bodies
  //        hand-type it: onboarding step 1 and all three summer_special steps.
  //      - "Coach Zoran", because GTA's onboarding step 1 SMS is STILL a hand-typed
  //        wall of GTA literals (the WhatsApp invite, the online-programs URL, three
  //        Instagram handles, the merch shop, the phone number). Templating the
  //        welcome EMAIL did not touch it; it is the same content in SMS form.
  //
  //    So both needles now trace to typed COPY rather than to pinned identity, which is
  //    a smaller and more tractable gap - but it is still a gap, so no row-based check
  //    can discriminate yet and the control that tried was deleted rather than left
  //    passing for a weaker reason. What survives is worth keeping: if either needle
  //    DISAPPEARS, something that used to carry BAM GTA's identity has stopped, which
  //    is a real staleness signal.
  const IDENTITY = [
    ["its own domain", (GTA.website_setup || {}).domain],
    ["its owner's first name", String(GTA.owner_name || "").trim().split(/\s+/)[0]],
  ];
  for (const [what, needle] of IDENTITY) {
    if (!needle) { out.push(`STALE FIXTURE: the snapshot has no ${what}.`); continue; }
    if (!all.includes(needle)) {
      out.push(`LOST FACT: nothing rendered here contains ${what} (${JSON.stringify(needle)}). `
        + "Something that used to carry BAM GTA's identity has stopped. Read the note above before "
        + "assuming this proves the wrong academy was rendered - it cannot, and it says why.");
    }
  }

  // 4. The parent-facing name reaches a parent, and the internal one does not.
  if (!MUTATE && GTA.public_name && !all.includes(GTA.public_name)) {
    out.push(`STALE FIXTURE: no rendered GTA step contains ${JSON.stringify(GTA.public_name)}. `
      + "Either the name token left the rows or the fixture is not feeding them.");
  }
  if (!MUTATE && GTA.public_name !== GTA.business_name && all.includes(GTA.business_name)) {
    out.push(`INTERNAL LABEL LEAKED: a rendered step contains ${JSON.stringify(GTA.business_name)}, our own shorthand. `
      + `Parents should only ever read ${JSON.stringify(GTA.public_name)}.`);
  }
  return out;
}

// ─── diff ────────────────────────────────────────────────────────────────────
function printDiff(expected, actual, indent = "    ") {
  const e = expected.split("\n"), a = actual.split("\n");
  const n = Math.max(e.length, a.length);
  for (let i = 0; i < n; i++) {
    if (e[i] === a[i]) continue;
    if (e[i] !== undefined) console.log(indent + "- was:  " + JSON.stringify(e[i]));
    if (a[i] !== undefined) console.log(indent + "+ now:  " + JSON.stringify(a[i]));
  }
}

// ─── run ─────────────────────────────────────────────────────────────────────
const RUN = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (RUN) main();

function main() {
  const argv = process.argv.slice(2);
  const BLESS_AT = argv.indexOf("--bless");
  const PHRASE = "I-AM-CHANGING-WHAT-GTA-PARENTS-READ";
  const steps = allSteps();

  if (BLESS_AT >= 0) {
    if (argv[BLESS_AT + 1] !== PHRASE) {
      console.error("\n--bless rewrites the record of what BAM GTA's parents read today."
        + `\nIf that is really what you mean, run:\n\n  node api/_gta-step-lock.test.mjs --bless ${PHRASE}\n`);
      process.exit(2);
    }
    if (MUTATE) { console.error("\nRefusing to bless goldens while MUTATE is set. That would enshrine the mutation.\n"); process.exit(2); }
    fs.mkdirSync(GOLD, { recursive: true });
    for (const s of steps) fs.writeFileSync(path.join(GOLD, `${s.key}.txt`), renderStep(s.step));
    console.log(`\n⚠️  Step goldens rewritten for ${steps.length} steps.`);
    console.log("   Read `git diff` line by line before committing. Every changed line is a line a BAM GTA parent will read.\n");
  }

  console.log("\n── BAM GTA step lock ──");
  console.log(`   ${steps.length} automation steps, rendered through the real send path with GTA's real client row`);
  console.log(`   (scripts/snapshots/bam-gta.json, public_name ${JSON.stringify(GTA.public_name || null)}).`);
  if (MUTATE) console.log(`   MUTATE=${MUTATE} - this run is a negative control and MUST fail.`);
  console.log("");

  const fails = [];
  const problems = [];
  const rendered = [];
  let mutationBit = false;

  for (const s of steps) {
    const text = renderStep(s.step);
    rendered.push({ key: s.key, text });
    const p = path.join(GOLD, `${s.key}.txt`);
    if (!fs.existsSync(p)) {
      problems.push(`NO GOLDEN for "${s.key}". A new GTA step must be blessed deliberately - see the header of this file.`);
      continue;
    }
    const golden = fs.readFileSync(p, "utf8");
    if (golden === text) { console.log(`  ✅ ${s.key}`); continue; }
    mutationBit = true;
    fails.push({ key: s.key, golden, text });
    console.log(`  ❌ ${s.key}`);
  }

  problems.push(...fixtureProblems(rendered));

  for (const f of fails) {
    console.log(`\n── ${f.key} ──`);
    printDiff(f.golden, f.text);
  }
  for (const p of problems) console.log(`\n⚠️  ${p}`);

  if (MUTATE) {
    // The control has to prove the lock CAUGHT it, not merely that the run went red
    // for some unrelated reason - and not that the mutation quietly did nothing.
    const caught = fails.length > 0 || problems.length > 0;
    console.log(caught
      ? `\n✅ NEGATIVE CONTROL PASSED: MUTATE=${MUTATE} was caught (${fails.length} step(s) changed, ${problems.length} fixture problem(s)).`
      : `\n❌ NEGATIVE CONTROL FAILED: MUTATE=${MUTATE} changed nothing the lock noticed. This lock is decorative.`);
    process.exit(caught ? 0 : 1);
  }

  if (!fails.length && !problems.length) {
    console.log(`\n✅ All ${steps.length} BAM GTA automation steps are byte-identical to their goldens.`);
    process.exit(0);
  }
  console.log(`\n❌ ${fails.length} step(s) differ, ${problems.length} fixture problem(s).`);
  console.log("   If the change is intended: node api/_gta-step-lock.test.mjs --bless I-AM-CHANGING-WHAT-GTA-PARENTS-READ\n");
  process.exit(1);
  void mutationBit;
}
