// ─────────────────────────────────────────────────────────────────────────────
// scripts/check-no-hour12.mjs - portal source may not ask for `hour12`. At all.
// ─────────────────────────────────────────────────────────────────────────────
//
// WHY THIS GATE EXISTS.
// `hour12` is not a cycle you choose. It is a HINT the engine RESOLVES, and it
// does not resolve the same way everywhere. On the same ICU 78.2:
//
//     Node 20 resolves hour12:false to h24  ->  local midnight renders "24"
//     Node 24 resolves hour12:false to h23  ->  local midnight renders "00"
//
// Same ICU, different V8. Any code that then does arithmetic on that hour is
// exactly one day out at local midnight, in every zone at UTC+0 or ahead. CI runs
// Node 20; production runs whatever Vercel ships.
//
// This bit THREE TIMES IN ONE DAY, each time in a different place:
//   - it turned CI red;
//   - it put Europe/London's dashboard (a live academy) a day behind for the five
//     months a year London is UTC+0 - "trials today" showed yesterday;
//   - and it would have silently stopped the trial-summary cron for any academy
//     that picked a midnight send hour, with no error anywhere.
// Every one of those was fixed as an instance while the PATTERN stayed in the
// tree, which is why it kept coming back. A grep is cheaper than a fourth
// incident, and it is the only thing that catches the regression on an h23
// runtime, where the mistake is invisible to behaviour.
//
// THE RULE: `hourCycle: "h23"` (or "h12" for a 12-hour display), never `hour12`.
// They cannot coexist - per ECMA-402 `hour12` OVERRIDES `hourCycle` - so the hint
// must be REMOVED, not accompanied.
//
// NO ALLOWLIST, AND NO "DISPLAY IS FINE" CARVE-OUT. That was Zoran's explicit
// call when the alternative (a sanctioned exception list for display-only uses)
// was put to him. An exception list is a thing people add themselves to, and the
// display sites are not actually safe: `hour12: true` is the same unresolved hint
// in the other direction, h11 is a legal resolution, and h11 renders NOON as
// "0:00 PM". Banning the option outright also means a user can never be shown
// "24:00" on a screen.
//
// WHAT IS NOT SCANNED, and why it is not an allowlist:
//   - test/spec files. api/_local-day.test.mjs exists to PIN the absence of this
//     string, so it has to be able to name it, and its negative controls have to
//     be able to write it back. Scanning it would make the guard impossible to
//     write. This hides nothing today: every EXECUTABLE hour12 that was living in
//     a test file was converted in the same change that added this gate.
//   - comment lines. The fix notes on the converted helpers explain the rule and
//     necessarily quote it. A line whose trimmed form starts with // or * or /*
//     is prose, not an option bag.
//   - node_modules and build output, which are not ours.
//
// Run it:  node scripts/check-no-hour12.mjs     (from bam-ghl-agent/bam-portal)
//          MUTATE=probe node scripts/check-no-hour12.mjs   # the self-test's own control
// ─────────────────────────────────────────────────────────────────────────────

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SELF = fileURLToPath(import.meta.url);
const PORTAL = path.resolve(path.dirname(SELF), "..");
const ROOTS = ["api", "src", "scripts", "public"];
const EXTS = new Set([".js", ".mjs", ".cjs", ".jsx", ".ts", ".tsx", ".html"]);
const SKIP_DIRS = new Set(["node_modules", "dist", "build", ".vercel", ".git", "coverage", "__fixtures__", "snapshots"]);
const isTest = (f) => /\.(test|spec)\.[cm]?[jt]sx?$/.test(f);
const MUTATE = process.env.MUTATE || "";

// A line is prose if it is nothing but a comment. Deliberately simple: the whole
// portal writes `//` comments, and the alternative (a real comment stripper) gets
// URLs like https://... wrong, which is a worse failure than a rare false hit on
// a trailing comment. If you get flagged for a trailing `// hour12` comment, move
// the note above the function - that is the house convention anyway.
const isProse = (line) => {
  const t = line.trim();
  return t.startsWith("//") || t.startsWith("*") || t.startsWith("/*");
};

// THE DETECTOR. One function, used on real files and on the self-test probe, so
// the self-test cannot pass by exercising something the real scan does not.
export function hour12Hits(src, file = "<probe>") {
  const out = [];
  src.split("\n").forEach((line, i) => {
    if (!line.includes("hour12")) return;
    if (isProse(line)) return;
    out.push({ file, line: i + 1, text: line.trim() });
  });
  return out;
}

function* walk(dir) {
  let entries = [];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (_) { return; }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (SKIP_DIRS.has(e.name)) continue;
      yield* walk(full);
    } else if (full !== SELF && EXTS.has(path.extname(e.name)) && !isTest(e.name)) {
      // Skipping THIS file is not an exemption anyone else can claim. A gate that
      // hunts a string cannot avoid containing it - its probe, its identifiers and
      // its own error message all say `hour12` - so on its first run it reported
      // eleven hits, every one of them itself. That run is worth recording,
      // because it is the cheapest possible proof the detector really reads files
      // and really fails the process rather than just printing.
      yield full;
    }
  }
}

// ── Self-test: can this gate still SEE an hour12? ────────────────────────────
// A grep-shaped gate has quiet ways to stop gripping: the roots drift, the
// extension list misses a new one, someone "tidies" isProse into swallowing
// everything. All of those exit 0 on a tree full of hints - green because it
// checked nothing. So feed it a line that must be caught, and require the catch.
// MUTATE=probe feeds the CORRECT form instead, so a working detector reports
// nothing and the self-test must fail. If MUTATE=probe still passes, this
// self-test is decorative and the gate cannot be quoted as evidence.
function selfTest() {
  const probe = MUTATE === "probe"
    ? 'const f = new Intl.DateTimeFormat("en-US", { hour: "2-digit", hourCycle: "h23" });\n'
    : 'const f = new Intl.DateTimeFormat("en-US", { hour: "2-digit", hour12: false });\n';
  const hits = hour12Hits(probe, "<self-test probe>");
  if (hits.length > 0) return true;
  if (MUTATE === "probe") {
    console.log("\nNEGATIVE CONTROL PASSED - MUTATE=probe fed the gate a correct line and it stayed quiet, so the detector is really detecting.");
    process.exit(0);
  }
  console.error("SELF-TEST FAILED: check-no-hour12 could not see `hour12: false` in its own probe. The gate is not checking anything - fix it before trusting a green run.");
  process.exit(1);
}

// It must also NOT fire on the prose that explains the rule, or the fix comments
// on every converted helper would make this gate permanently red and it would be
// deleted within the week.
function proseTest() {
  const hits = hour12Hits("  // hourCycle: \"h23\", NOT hour12: false - see the note above.\n", "<prose probe>");
  if (hits.length === 0) return true;
  console.error("SELF-TEST FAILED: check-no-hour12 fired on a comment line. It would be red on every file that explains the rule, which is how a gate gets switched off.");
  process.exit(1);
}

selfTest();
proseTest();

const hits = [];
let scanned = 0;
for (const root of ROOTS) {
  for (const file of walk(path.join(PORTAL, root))) {
    scanned++;
    hits.push(...hour12Hits(fs.readFileSync(file, "utf8"), path.relative(PORTAL, file)));
  }
}

if (MUTATE === "probe") {
  console.log("\nNEGATIVE CONTROL FAILED - MUTATE=probe should have made the self-test fail, and it did not.");
  process.exit(1);
}

if (hits.length) {
  console.error(`\n${hits.length} use(s) of \`hour12\` in portal source. Use hourCycle instead:\n`);
  for (const h of hits) {
    console.error(`::error file=bam-ghl-agent/bam-portal/${h.file},line=${h.line}::\`hour12\` is a hint the engine resolves - Node 20 resolves hour12:false to h24 and renders local midnight as "24". Use hourCycle: "h23" (or "h12" for 12-hour display) and REMOVE hour12; per ECMA-402 hour12 overrides hourCycle, so they cannot coexist.`);
    console.error(`  ${h.file}:${h.line}\n    ${h.text}`);
  }
  console.error("\nSee the note on todayBoundsMs in api/ghl/calendars-v15.js, and api/_local-day.test.mjs.");
  process.exit(1);
}

console.log(`No \`hour12\` in portal source (${scanned} files scanned across ${ROOTS.join(", ")}).`);
