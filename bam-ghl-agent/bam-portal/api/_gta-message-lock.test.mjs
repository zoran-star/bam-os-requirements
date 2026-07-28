// BAM GTA MESSAGE LOCK.
//
// BAM GTA is live, with real paying members. Its automated emails must not change
// because we refactored something behind them. This test renders every GTA email
// through the REAL send path (renderEmail from api/email-shells.js) with GTA's real
// client row values, and fails if the output moved away from a committed golden.
//
// The client row comes from scripts/snapshots/bam-gta.json - the same snapshot
// scripts/render-messages.mjs renders from - so there is one source of truth for it,
// and fixtureProblems() below fails the run if that snapshot has gone stale.
//
//   node api/_gta-message-lock.test.mjs         # exits non-zero on any difference
//
// TWO LOCKS, because "changed" means two very different things:
//
//   WORDS  (__goldens__/bam-gta/words/*.txt)
//     The parent-visible text plus every link target, tags stripped. This is what a
//     parent actually reads and taps. Generated from origin/main - i.e. GTA's output
//     as it is in production - and it is the lock that matters. A failure here means
//     a real person receives different words.
//
//   MARKUP (__goldens__/bam-gta/markup/*.html)
//     The full rendered HTML, byte for byte. Catches everything the words lock
//     cannot see: colours, padding, table structure, the <title>, comments.
//
// A failure prints the WORDS diff first, then says whether anything else was
// markup-only, so whoever reads it can tell instantly whether a parent would notice.
//
// ─────────────────────────────────────────────────────────────────────────────
// RE-BLESSING (when a change to GTA IS intended)
//
//   Markup only, e.g. moving an email onto the shared shell:
//     node api/_gta-message-lock.test.mjs --bless-markup
//   The words lock still runs afterwards, so this can never quietly change copy.
//   Commit the regenerated files: the git diff IS the record of what moved.
//
//   Words, i.e. GTA's parents will read something different:
//     node api/_gta-message-lock.test.mjs --bless-words I-AM-CHANGING-WHAT-GTA-PARENTS-READ
//   The confirmation phrase is required and deliberately unpleasant to type. Put the
//   reason and the person who decided it in the commit message.
//
// A difference that is EXPECTED but small does not get a re-bless - it gets an entry
// in WORD_WAIVERS below, naming the decision and its date, so everything else in that
// same email stays locked.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { renderEmail, clientVars } from "./email-shells.js";
import { TEMPLATES as NURTURE } from "./email-templates/nurture-emails.js";
import { ONBOARDING_TEMPLATES } from "./email-templates/onboarding-emails.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const GOLD = path.join(HERE, "__goldens__", "bam-gta");
const WORDS_DIR = path.join(GOLD, "words");
const MARKUP_DIR = path.join(GOLD, "markup");

// ─── the fixture: BAM GTA's real client row ──────────────────────────────────
// READ FROM THE SNAPSHOT, not retyped here. scripts/snapshots/bam-gta.json is the
// committed copy of GTA's clients row and is already what scripts/render-messages.mjs
// renders from, so there is exactly ONE place that answers "what does GTA's row look
// like today". This used to be a hardcoded literal beside it, and the two drifted: a
// `public_name` column was added, production's value became "By Any Means Basketball",
// and the lock went on rendering "BAM GTA" against goldens of that same dead reality -
// green, and blind to a live copy change. Deriving it means a stale snapshot is the
// only way to be stale, and SNAPSHOT_FRESHNESS below shouts when it is.
const SNAPSHOT_PATH = path.resolve(HERE, "../../../scripts/snapshots/bam-gta.json");
const SNAPSHOT = JSON.parse(fs.readFileSync(SNAPSHOT_PATH, "utf8"));
export const GTA = SNAPSHOT.client;
// The facts that are not on the clients row (venue, weekly schedule, coach handles).
// api/_academy-facts.js reads them from other tables at send time; the snapshot carries
// what it resolved for GTA, so a golden locks the email a member actually receives
// rather than one with its schedule block silently missing.
export const FACTS = SNAPSHOT.facts || {};

// A fixed sample family, so the merge fields resolve to something stable and the
// golden is not full of "there" / "your athlete" fallbacks. Same names the render
// harness uses (scripts/render-messages.mjs).
const FAMILY = { first_name: "Maya", full_name: "Maya Alvarez", athlete: "Jordan Alvarez" };

export const VARS = { ...clientVars(GTA), ...FACTS, ...FAMILY };

// Every template GTA can send. Taken from the modules themselves, not hardcoded, so a
// NEW template cannot be added without a golden: an unblessed key fails below.
export const KEYS = [...Object.keys(NURTURE), ...Object.keys(ONBOARDING_TEMPLATES)].sort();

// Rendering is parameterised by renderEmail so the SAME fixture can be pointed at
// another checkout's email-shells.js. That is how the goldens were bootstrapped from
// origin/main: identical inputs, a different implementation. See __goldens__/README.md.
export function renderWith(renderEmailFn, key) {
  return renderEmailFn({ clientId: GTA.id, subject: key, body: `template:${key}`, vars: VARS });
}
const render = (key) => renderWith(renderEmail, key);

// ─── what a parent actually sees ─────────────────────────────────────────────
// Tags stripped, entities decoded, whitespace normalised. <head> goes: <title> and the
// meta tags never reach a reader (the markup lock covers those). The hidden preheader
// span STAYS - it is the line shown next to the subject in an inbox.
function parentText(html) {
  const s = String(html)
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<head[\s\S]*?<\/head>/i, " ")
    .replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|h1|h2|h3|h4|div|td|tr|table|li|ul|ol)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&middot;/g, "·")
    .replace(/&rarr;/g, "->")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
  return s.split("\n").map((l) => l.replace(/\s+/g, " ").trim()).filter(Boolean);
}

// Where every link goes, in order. A button that still says "Join the WhatsApp group"
// but points somewhere else is a change a parent very much notices.
function links(html) {
  return [...String(html).matchAll(/<a\b[^>]*\bhref="([^"]*)"/gi)].map((m) => m[1]);
}

// The words golden is text + link targets in one file, so both are locked together.
export function wordsOf(html) {
  return parentText(html).join("\n") + "\n\n--- LINKS ---\n" + links(html).join("\n") + "\n";
}

// ─── expected differences ────────────────────────────────────────────────────
// A difference the owner DECIDED on. Each entry is an exact find/replace applied to
// the GOLDEN before comparing, so it covers that one change and nothing else: if a
// future edit touches anything else in the same email, the test still fails.
//
// Every entry must apply. A waiver whose `from` is no longer in the golden is a stale
// waiver and fails the run - they cannot rot into a blanket exemption.
// EMPTY, deliberately. The six entries that used to sit here excused the welcome
// email's "online programs" and "bring a friend" items being dropped, plus the
// renumbering that followed. Those two items are back (27 Jul 2026): they are now
// gated on a per-academy fact rather than deleted, GTA has both facts, so GTA's words
// are once again identical to production and no waiver is needed to say so.
const WORD_WAIVERS = {};

// ─── is the fixture still describing production? ─────────────────────────────
// The bug this exists to catch is NOT "the copy changed". It is "the fixture went
// stale and the lock kept saying ✅". That happened on 27 Jul 2026: the `public_name`
// column was added, GTA's became "By Any Means Basketball", and because the fixture
// still only carried `business_name`, clientVars()'s `public_name || business_name`
// fallback quietly resolved to the old value. Everything rendered, everything matched,
// everything passed - against a version of reality that no longer existed. A green
// lock that cannot see a live change is worse than no lock, because it is trusted.
//
// So the lock now also asserts that the fixture is CARRYING the parent-facing name and
// that the name is REACHING a parent. These look redundant next to 10 golden compares.
// They are not: goldens only prove today's render equals yesterday's render. If the
// fixture drops a field, BOTH sides of that compare move together and the diff is
// empty. These checks compare the fixture against what it is supposed to be, which is
// the one thing a self-consistent snapshot test can never do for itself.
//
// If a future column matters as much as this one did, add it here the same way.
function fixtureProblems(renders) {
  const out = [];
  const pub = GTA.public_name;
  const vars = clientVars(GTA);

  // 1. The snapshot carries the parent-facing name at all.
  if (!pub) {
    out.push("STALE FIXTURE: scripts/snapshots/bam-gta.json has no `public_name`. Production has one "
      + '("By Any Means Basketball"). Without it clientVars() falls back to business_name and every '
      + "golden below locks the WRONG name while still passing. Re-capture the snapshot.");
    return out;
  }

  // 2. It is what clientVars actually resolves {{location.name}} to - i.e. the
  //    fallback is not silently standing in for it.
  if (vars.location_name !== pub) {
    out.push(`STALE FIXTURE: clientVars() resolves location_name to ${JSON.stringify(vars.location_name)}, `
      + `but the snapshot's public_name is ${JSON.stringify(pub)}. The render is not using the row's own name.`);
  }

  // 3. It reaches a parent. A fixture field nothing renders is a field nobody is
  //    locking, so the goldens would keep passing however wrong it got.
  if (!renders.some((h) => h.includes(pub))) {
    out.push(`STALE FIXTURE: no rendered GTA message contains ${JSON.stringify(pub)}. `
      + "Either {{location.name}} left the templates or the fixture is not feeding them - "
      + "either way these goldens are no longer locking the academy's name.");
  }

  // 4. And the INTERNAL label is not leaking the other way. "BAM GTA" is our own
  //    shorthand; a paying parent must never read it back. This is the rule the
  //    27 Jul change was made to enforce, so the lock enforces it too.
  const leaked = renders.filter((h) => h.includes(GTA.business_name));
  if (pub !== GTA.business_name && leaked.length) {
    out.push(`INTERNAL LABEL LEAKED: ${leaked.length} rendered message(s) still contain `
      + `${JSON.stringify(GTA.business_name)}, the internal name. Parents should only ever read `
      + `${JSON.stringify(pub)}.`);
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

function printDiff(expected, actual, indent = "    ") {
  const ops = lcsOps(expected.split("\n"), actual.split("\n"));
  let run = 0;
  ops.forEach((op, idx) => {
    if (op[0] === "=") { run++; return; }
    // one line of context above a change, so the diff is readable
    if (run > 0) {
      const prev = ops[idx - 1];
      if (prev && prev[0] === "=") console.log(indent + "  " + trunc(prev[1]));
      run = 0;
    }
    console.log(indent + (op[0] === "-" ? "- was:  " : "+ now:  ") + trunc(op[1]));
  });
}
const trunc = (s) => (s.length > 220 ? s.slice(0, 217) + "..." : s);

// ─── waiver application ──────────────────────────────────────────────────────
function applyWaivers(key, golden, problems) {
  let out = golden;
  for (const w of WORD_WAIVERS[key] || []) {
    if (!out.includes(w.from)) {
      problems.push(`STALE WAIVER on ${key} (decided ${w.decided}): the golden no longer contains ${JSON.stringify(trunc(w.from))}. `
        + "Remove or re-word the waiver - it is no longer describing a real difference.");
      continue;
    }
    out = out.replace(w.from, w.to);
  }
  return out;
}

// ─── run ─────────────────────────────────────────────────────────────────────
// Only when executed directly. Imported (to reuse the fixture), this file is inert.
const RUN = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (RUN) main();

function main() {
const argv = process.argv.slice(2);
const BLESS_MARKUP = argv.includes("--bless-markup");
const BLESS_WORDS_AT = argv.indexOf("--bless-words");
const WORDS_PHRASE = "I-AM-CHANGING-WHAT-GTA-PARENTS-READ";

if (BLESS_WORDS_AT >= 0) {
  if (argv[BLESS_WORDS_AT + 1] !== WORDS_PHRASE) {
    console.error(`\n--bless-words rewrites the record of what BAM GTA's parents read today.\n`
      + `If that is really what you mean, run:\n\n  node api/_gta-message-lock.test.mjs --bless-words ${WORDS_PHRASE}\n`);
    process.exit(2);
  }
  fs.mkdirSync(WORDS_DIR, { recursive: true });
  for (const k of KEYS) fs.writeFileSync(path.join(WORDS_DIR, `${k}.txt`), wordsOf(render(k)));
  console.log(`\n⚠️  WORDS goldens rewritten for ${KEYS.length} templates.`);
  console.log("   Read `git diff` line by line before committing. Every changed line is a line a BAM GTA parent will read.\n");
}

if (BLESS_MARKUP) {
  fs.mkdirSync(MARKUP_DIR, { recursive: true });
  for (const k of KEYS) fs.writeFileSync(path.join(MARKUP_DIR, `${k}.html`), render(k));
  console.log(`\n📐 MARKUP goldens rewritten for ${KEYS.length} templates. The words lock still runs below.\n`);
}

console.log("\n── BAM GTA message lock ──");
console.log(`   ${KEYS.length} templates, rendered through renderEmail() with GTA's real client row`);
console.log(`   (scripts/snapshots/bam-gta.json, public_name ${JSON.stringify(GTA.public_name || null)}).\n`);

const wordFails = [];
const markupFails = [];
const problems = [];
const renders = [];

for (const key of KEYS) {
  const html = render(key);
  renders.push(html);
  const wPath = path.join(WORDS_DIR, `${key}.txt`);
  const mPath = path.join(MARKUP_DIR, `${key}.html`);

  if (!fs.existsSync(wPath) || !fs.existsSync(mPath)) {
    problems.push(`NO GOLDEN for "${key}". A new GTA message must be blessed deliberately - see the header of this file.`);
    continue;
  }

  const goldenWords = fs.readFileSync(wPath, "utf8");
  const goldenMarkup = fs.readFileSync(mPath, "utf8");
  const expectedWords = applyWaivers(key, goldenWords, problems);
  const actualWords = wordsOf(html);

  const wordsSame = expectedWords === actualWords;
  const markupSame = goldenMarkup === html;

  if (wordsSame && markupSame) { console.log(`  ✅ ${key}`); continue; }
  if (!wordsSame) { wordFails.push({ key, expectedWords, actualWords, markupSame }); console.log(`  ❌ ${key}  WORDS CHANGED`); }
  else { markupFails.push({ key, goldenMarkup, html }); console.log(`  ⚠️  ${key}  markup only`); }
}

// Runs LAST, and runs under --bless-* too: re-blessing rewrites the goldens, so it is
// the one moment a stale fixture would be baked in permanently and silently.
problems.push(...fixtureProblems(renders));

// ─── report ──────────────────────────────────────────────────────────────────
if (wordFails.length) {
  console.log("\n\n════ WHAT A PARENT WOULD READ CHANGED ════");
  console.log("These are the differences a real BAM GTA parent would notice.\n");
  for (const f of wordFails) {
    console.log(`  ${f.key}${f.markupSame ? "" : "   (the markup around them moved too)"}`);
    printDiff(f.expectedWords, f.actualWords);
    console.log("");
  }
}

if (markupFails.length) {
  console.log("\n════ MARKUP ONLY ════");
  console.log("The parent-visible text and every link target are IDENTICAL in these.");
  console.log("Only the HTML around them moved (colours, padding, structure, <title>).\n");
  for (const f of markupFails) {
    const g = f.goldenMarkup.split("\n"), a = f.html.split("\n");
    const changed = lcsOps(g, a).filter((o) => o[0] !== "=").length;
    console.log(`  ${f.key}: ${changed} changed line(s), ${f.goldenMarkup.length} -> ${f.html.length} bytes`);
    printDiff(f.goldenMarkup, f.html, "      ");
    console.log("");
  }
}

if (problems.length) {
  console.log("\n════ PROBLEMS WITH THE GUARD ITSELF ════\n");
  for (const p of problems) console.log("  " + p);
  console.log("");
}

const failed = wordFails.length + markupFails.length + problems.length;
if (failed) {
  console.log(`\n❌ FAILED: ${wordFails.length} with changed words, ${markupFails.length} markup-only, ${problems.length} guard problem(s).`);
  console.log("   Intended? See RE-BLESSING at the top of api/_gta-message-lock.test.mjs.\n");
  process.exit(1);
}
console.log(`\n✅ All ${KEYS.length} BAM GTA messages are byte-identical to their goldens.\n`);
}
