// ─────────────────────────────────────────────────────────────────────────────
// scripts/lint-api-no-undef.mjs - the ONE eslint rule that gates CI on api/**
// ─────────────────────────────────────────────────────────────────────────────
//
// WHY ONLY no-undef.
// `api/automations.js` shipped `const client` declared inside a try and read
// from the catch. const is block-scoped, so every retryable send failure threw
// ReferenceError from inside the error handler. That crashed the cron run, and
// because the crash skipped the attempts counter, a 15-minute reaper kept
// re-claiming the same job - a send that could never fail out and could never
// stop. eslint reported that exact line as `'client' is not defined`. It
// shipped anyway, because api/ carried 1223 no-undef errors that were not bugs
// (api/*.js was being linted with BROWSER globals, so `process` and `Buffer`
// read as undefined), so nobody ran eslint and CI did not either.
//
// The fix was environment config, not a mass code edit: see the api/ block in
// eslint.config.js. That left exactly FOUR genuine no-undef errors, every one a
// live crash - this file exists so the next one cannot ship.
//
// WHY NOT THE WHOLE RECOMMENDED SET. api/ still has 943 no-unused-vars and
// no-empty errors. Gating on those means CI is red on day one, and a gate that
// is red for style reasons gets deleted by whoever needs to merge. no-undef is
// different in kind: it cannot fire on working code. Every hit is a name that
// does not exist at runtime, i.e. a ReferenceError waiting for the branch that
// reads it. Keep this gate at exactly one rule. If you want the other rules,
// add a SEPARATE advisory step - do not widen this one.
//
// Run it: npm run lint:api-no-undef   (from bam-ghl-agent/bam-portal)
// ─────────────────────────────────────────────────────────────────────────────

import { ESLint } from "eslint";
import path from "node:path";
import { fileURLToPath } from "node:url";

const RULE = "no-undef";
// Resolve relative to this file so the script behaves the same whether CI runs
// it from bam-portal/ or a human runs it from the repo root.
const PORTAL = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PATTERNS = ["api/**/*.js", "api/**/*.mjs"];

// MUTATE=probe proves the self-test below actually bites. See the block comment
// on selfTest(): a gate whose detector has quietly stopped detecting is worse
// than no gate, because the green check still gets quoted as evidence.
const MUTATE = process.env.MUTATE || "";

const eslint = new ESLint({ cwd: PORTAL });

// ── Self-test: can this gate still SEE an undefined name in api/? ───────────
// The gate's whole value is the failure it produces, and there are quiet ways
// to lose that: no-undef turned off in a later config block, the api/ block's
// `files` pattern drifting, a parser change. Every one of those makes this
// script exit 0 on a tree full of ReferenceErrors - passing because it checked
// nothing. So before trusting a clean run, feed it a name that is definitely
// undefined and require a no-undef back.
async function selfTest() {
  const probe = MUTATE === "probe"
    // The mutation: a DEFINED global instead of an undefined name. A working
    // detector reports nothing here, so the self-test must fail. If MUTATE=probe
    // still passes, this self-test is decorative.
    ? "process.exit(0)\n"
    : "__lint_gate_probe_undefined__()\n";
  const res = await eslint.lintText(probe, {
    filePath: path.join(PORTAL, "api", "__lint-gate-probe.js"),
    warnIgnored: false,
  });
  const saw = res.some((r) => r.messages.some((m) => m.ruleId === RULE));
  if (MUTATE === "probe") {
    if (saw) {
      console.error("NEGATIVE CONTROL FAILED: the probe reported no-undef on a DEFINED global.");
      return false;
    }
    console.log("NEGATIVE CONTROL PASSED: MUTATE=probe removed the undefined name and the self-test stopped firing.");
    return false; // never let a mutated run be mistaken for a real pass
  }
  if (!saw) {
    console.error(
      `SELF-TEST FAILED: ${RULE} did not fire on an obviously undefined name in api/.\n` +
      "This gate is not checking anything. Do not trust a green run. Check that the\n" +
      "api/ block in eslint.config.js still matches api/**/*.js and that nothing has\n" +
      `turned ${RULE} off.`
    );
    return false;
  }
  return true;
}

if (!(await selfTest())) process.exit(1);

const results = await eslint.lintFiles(PATTERNS);

// A glob that matches nothing lints nothing and exits clean. Fail instead.
if (results.length === 0) {
  console.error(`FAILED: ${PATTERNS.join(", ")} matched no files. The gate is pointed at nothing.`);
  process.exit(1);
}

// Collect on ruleId alone, NOT on severity. Downgrading no-undef to a warning
// somewhere would otherwise defeat this gate silently.
const hits = [];
for (const r of results) {
  for (const m of r.messages) {
    if (m.ruleId !== RULE) continue;
    hits.push({ file: path.relative(PORTAL, r.filePath), line: m.line, column: m.column, message: m.message });
  }
}

if (hits.length) {
  console.error(`\n${RULE} in api/ - each of these is a ReferenceError at runtime:\n`);
  for (const h of hits) {
    console.error(`  ${h.file}:${h.line}:${h.column}  ${h.message}`);
    // GitHub annotation: puts the red marker on the line in the PR diff.
    console.error(`::error file=bam-ghl-agent/bam-portal/${h.file},line=${h.line},col=${h.column}::${h.message} (${RULE})`);
  }
  console.error(
    `\n${hits.length} error(s). A name that does not exist throws the moment its branch runs.\n` +
    "If it is in a catch block or an error path, it turns a recoverable failure into a crash.\n" +
    "Fix the name. Do NOT add it to globals in eslint.config.js unless it genuinely is a\n" +
    "runtime global, and do NOT silence it with an eslint-disable comment.\n"
  );
  process.exit(1);
}

console.log(`${RULE} clean across ${results.length} files in api/ (self-test confirmed the rule fires).`);
