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
//   SMS   -> resolveMergeVars(body, L, vars), the same call api/_send.js makes.
//   EMAIL -> renderEmail(...), then reduced to the parent-visible words + link
//            targets by wordsOf() from the message lock. A `template:<key>` body
//            resolves to the designed email, so the two locks overlap there on
//            purpose: this one proves the ROW still points at that template.
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
// `domain` also has to bypass the hardcoded LOCATIONS entry, and that is worth knowing
// rather than hiding: BAM GTA is the ONE academy with an entry in that map, so blanking
// its website_setup.domain changes nothing - locFor() falls straight back to the
// hardcoded siteUrl. GTA's identity is therefore still half-pinned in code, which is a
// real gap in "GTA as if it was created FROM the template" and is filed as its own
// queue item. It is NOT fixed here: that entry also carries GTA's tagline, instagram,
// online-programs URL and referral offer, and the columns that would replace them
// (migration 20260727150000) are not applied, so deleting it today would silently
// shorten GTA's welcome email. The control models a NORMAL academy instead, by
// resolving through locFromVars the way every non-GTA academy already does.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { renderEmail, resolveMergeVars, locFor, clientVars } from "./email-shells.js";
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
// MUTATE=domain resolves through locFromVars (any id with no LOCATIONS entry), because
// GTA's hardcoded entry would otherwise supply the very site we just blanked. See the
// header: that override is a real gap, filed separately, deliberately not fixed here.
const L = MUTATE === "domain" ? locFor("00000000-0000-0000-0000-000000000000", VARS_USED) : locFor(CLIENT.id, VARS_USED);

// ─── render one step exactly as it sends ─────────────────────────────────────
const isEmail = (s) => String(s.channel || "").toLowerCase() === "email";

function renderStep(step) {
  const body = mutatedBody(step.body || "");
  if (isEmail(step)) {
    const html = renderEmail({ clientId: CLIENT.id, subject: step.subject || "", body, vars: VARS_USED });
    return `SUBJECT: ${step.subject || ""}\n\n${wordsOf(html)}`;
  }
  return resolveMergeVars(String(body), L, VARS_USED) + "\n";
}

// Every step in the snapshot, in send order, with a stable golden filename.
function allSteps() {
  const out = [];
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

  // 3. The parent-facing name reaches a parent, and the internal one does not.
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
