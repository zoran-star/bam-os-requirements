// DIRECT-KEY CLI: the terminal path into an academy's own Stripe credentials.
//
//   node api/_direct-key-cli.test.mjs
//
// WHAT THIS IS ABOUT.
// scripts/save-direct-key.mjs is a second doorway into the same money path the
// staff panel drives: it imports probeKey/saveDirectKey from
// api/stripe/direct-key.js and runs them with the service-role key, with no auth
// of its own. Everything that makes that acceptable is a property of the SCRIPT,
// not of the contract it calls - the secret arrives by stdin, is refused unless
// its SHAPE could belong to a Stripe key, never leaves in output, nothing is
// written without --save, the actor is a named human and not a flag, and a save
// is not reported as done until PRODUCTION has read the row back. Those
// properties are what this suite pins.
//
// WHAT IT PROVES
//   1. STDIN ONLY. The secret is read from process.stdin and there is no
//      argv-based path into it - a flag would land the key in shell history and
//      in the process list.
//   2. NO LEAK. Every print call in the script is extracted and none of them can
//      reach the secret's identifier, on any path including the error paths -
//      and the shape guard that stops the key reaching fetch at all is written
//      before every fetch in the file and before every call site that prints an
//      error message. See THE LEAK SCAN below for what that does and does not
//      cover.
//   3. THE ACTOR. --as is required, non-empty, cannot be satisfied by the next
//      FLAG in argv, and becomes performedByName; performedBy and createdBy are
//      LITERAL null (a CLI has neither id space, and inventing a staff row would
//      put a fiction in the audit).
//   4. PROBE BY DEFAULT. A run without --save exits before the only
//      saveDirectKey call site.
//   5. SHAPE BEFORE FETCH. A key that is not entirely printable ASCII is refused
//      locally, before it can reach a fetch that would throw with the whole
//      "Bearer <key>" header value inside its message.
//   6. THE ENVIRONMENT IS CHECKED FIRST. --save pre-checks all three of
//      STRIPE_DIRECT_ENC_KEY, PORTAL_BASE_URL and CRON_SECRET before any Stripe
//      contact, so a missing one costs nothing instead of costing a live probe
//      and a credential written with no webhook and no proof.
//   7. STATUS MAPPING. 404 gets its own typo hint, 409 is printed VERBATIM and
//      is not re-looked-up here, 502 is phrased as retryable, and no HTTP number
//      is spoken at the operator.
//   8. THE PROOF. After a save, production is asked to read the row back, and
//      its three outcomes stay three: proved (exit 0), broken (exit 1),
//      could-not-ask (exit 2). Inconclusive can never print as success.
//   9. ONE DOORWAY. The direct-key table name does not appear in the script: the
//      audit scan in api/_stripe-transport-parity.test.mjs walks api/** and
//      src/views but NOT scripts/, so the name typed there would be a reference
//      no audit can see. The script needs no table name at all now.
//  10. THE WEBHOOK TRUTH. A webhook failure is reported AND the report says the
//      save still stands, because the contract does not roll it back.
//  11. THE REFUSAL PREMISE. The CLI reports every .status error as "refused",
//      i.e. as nothing happened. That is only true while every .status throw in
//      saveDirectKey fires BEFORE the first write, so this suite reads the
//      contract and pins its post-write region as throw-free.
//
// THE LEAK SCAN - WHAT IT COVERS AND WHAT IT DOES NOT.
//   COVERS: every console.*/process.std*.write/die call in the script, sliced
//   with balanced parens, checked for the secret's identifier; every other
//   mention of that identifier, against a declared whitelist; and the ordering
//   claim that the shape guard runs before any fetch and before any call site
//   that prints an error message.
//   DOES NOT COVER: the CONTENT of an error object at runtime. A print of
//   `e.message` is invisible to an identifier scan, which is exactly how the
//   embedded-newline leak got in (undici's throw carried "Bearer <whole key>").
//   Nothing here proves a given error is secret-free; what is pinned is that the
//   only known way for the key to end up inside one is closed before it can
//   happen. A new call that hands the secret to something else that throws would
//   need its own guard, not this suite's confidence.
//
// HOW IT RUNS. No network, no database, no node_modules. Importing the script
// would execute it (top-level await, env checks, a live Stripe probe), and
// importing api/stripe/direct-key.js pulls @sentry/node, so BOTH are read as
// SOURCE TEXT. Two things are executed rather than read: the script's own val()
// arrow and its own shape regex, both lifted out of the source and run against
// samples, because "the check is present" and "the check works" are different
// claims.
//
// ─────────────────────────────────────────────────────────────────────────────
// NEGATIVE CONTROLS. Each breaks one thing; the run must print
// NEGATIVE CONTROL PASSED (and "control caught: ..."), exit 0 only when caught:
//
//   MUTATE=keyflag     node api/_direct-key-cli.test.mjs
//                      # the script starts accepting the secret as --rk too -
//                      # the stdin-only pins must catch it
//   MUTATE=badshape    node api/_direct-key-cli.test.mjs
//                      # the printable-ASCII guard is removed, so a key pasted
//                      # with an embedded newline reaches fetch and undici
//                      # throws with the whole key in the message
//   MUTATE=flagactor   node api/_direct-key-cli.test.mjs
//                      # val() goes back to returning the next argv token
//                      # blindly, so `--as --save` names a flag as the actor
//   MUTATE=noreadback  node api/_direct-key-cli.test.mjs
//                      # the post-save production read-back is dropped and the
//                      # save reports itself as done
//   MUTATE=quietfail   node api/_direct-key-cli.test.mjs
//                      # an inconclusive read-back is reported as success

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const MUTATE = process.env.MUTATE || "";
const HERE = path.dirname(fileURLToPath(import.meta.url));

let pass = 0, fail = 0;
const failures = [];
let controlBroken = null;
const ok = (cond, label) => {
  if (cond) { pass++; console.log("  ✅ " + label); }
  else { fail++; failures.push(label); console.log("  ❌ " + label); }
};
function pinned(cond, what) {
  if (cond) return true;
  controlBroken = `This suite is pinned to text that is no longer in the source:\n\n${what}\n\n` +
    "The code it was written against has moved or been renamed, so it proves nothing. Re-point it, or delete it.";
  console.log(`\n❌ ${controlBroken}`);
  process.exit(1);
}

const CLI_PATH = path.join(HERE, "..", "scripts", "save-direct-key.mjs");
const DK_PATH = path.join(HERE, "stripe", "direct-key.js");
let CLI = fs.readFileSync(CLI_PATH, "utf8");
const DK = fs.readFileSync(DK_PATH, "utf8");

// ─── the table name, cut out of the shipped upsert (never typed here) ────────
const TABLE_PIN = /await sb\(\s*`([a-z_]+)\?on_conflict=client_id`/;
const tableMatch = DK.match(TABLE_PIN);
pinned(tableMatch, `the direct-key upsert in api/stripe/direct-key.js, matched by ${TABLE_PIN}`);
const TABLE = tableMatch[1];

// ─── the mutations, expressed against the real source text ───────────────────
if (MUTATE === "keyflag") {
  const pin = "const secretFromStdin = await readStdin();";
  pinned(CLI.includes(pin), pin);
  CLI = CLI.replace(pin, 'const secretFromStdin = val("--rk") || await readStdin();   // MUTATED: flag path');
}
if (MUTATE === "badshape") {
  const start = CLI.indexOf("const shapeOk = PRINTABLE_ASCII.test(");
  const end = CLI.indexOf("// ── supabase ─");
  pinned(start > -1 && end > start,
    "the shape guard block in scripts/save-direct-key.mjs, from `const shapeOk = PRINTABLE_ASCII.test(` to the supabase section");
  CLI = CLI.slice(0, start) +
    "// MUTATED: shape guard deleted - a key pasted with an embedded newline now reaches fetch\n" +
    CLI.slice(end);
}
if (MUTATE === "flagactor") {
  const start = CLI.indexOf("const val = (flag) => {");
  const end = CLI.indexOf("const has = (flag) =>");
  pinned(start > -1 && end > start, "val()'s definition in scripts/save-direct-key.mjs, up to `const has = (flag) =>`");
  CLI = CLI.slice(0, start) +
    "const val = (flag) => { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : null; };   // MUTATED: a flag can be read as a value\n" +
    CLI.slice(end);
}
if (MUTATE === "noreadback") {
  const start = CLI.indexOf("const RETRY_PROOF =");
  pinned(start > -1, "the post-save production read-back in scripts/save-direct-key.mjs, from `const RETRY_PROOF =` to the end of the file");
  CLI = CLI.slice(0, start) +
    "// MUTATED: the production read-back is gone - the save now reports itself\nprocess.exit(0);\n";
}
if (MUTATE === "quietfail") {
  const start = CLI.indexOf("function proofInconclusive(detail) {");
  pinned(start > -1, "proofInconclusive() in scripts/save-direct-key.mjs");
  const end = CLI.indexOf("\n}", start) + 2;
  CLI = CLI.slice(0, start) +
    "function proofInconclusive(detail) {   // MUTATED: could-not-ask now reads as success\n" +
    "  console.log(`\\nPROVED - production read the key back (${detail}).`);\n" +
    "  process.exit(0);\n}" +
    CLI.slice(end);
}

// ─── helpers over the script's source ────────────────────────────────────────
const codeLines = (src) => src.split("\n").filter((l) => !l.trim().startsWith("//"));
const CODE = codeLines(CLI).join("\n");

// Every call to a printing function, sliced with balanced parens. Parens inside
// string and template literals are NOT counted (the script prints sentences
// containing brackets), but their bytes ARE kept in the slice - a leak would
// live inside a template literal, so blanking strings would blind the scan.
function printCalls(src) {
  const NAMES = ["console.log(", "console.error(", "console.warn(", "console.info(",
    "process.stdout.write(", "process.stderr.write(", "die("];
  const out = [];
  for (const name of NAMES) {
    let from = 0;
    for (;;) {
      const at = src.indexOf(name, from);
      if (at === -1) break;
      from = at + name.length;
      // `function die(msg)` and the like are declarations, not calls; harmless
      // to include, so no special case. Walk to the matching close paren.
      let i = at + name.length - 1, depth = 0, quote = null;
      for (; i < src.length; i++) {
        const c = src[i];
        if (quote) {
          if (c === "\\") { i++; continue; }
          if (c === quote) quote = null;
          continue;
        }
        if (c === '"' || c === "'" || c === "`") { quote = c; continue; }
        if (c === "(") depth++;
        else if (c === ")") { depth--; if (depth === 0) { i++; break; } }
      }
      out.push(src.slice(at, i));
    }
  }
  return out;
}

// All indices of `needle` in CODE that are CALLS, not declarations.
function callIndices(needle) {
  const out = [];
  let from = 0;
  for (;;) {
    const at = CODE.indexOf(needle, from);
    if (at === -1) break;
    from = at + needle.length;
    const before = CODE.slice(Math.max(0, at - 9), at);
    if (/function\s$/.test(before)) continue;
    out.push(at);
  }
  return out;
}

// The source of a named function declaration, brace-balanced from its header.
function fnSource(name) {
  const at = CLI.indexOf(`function ${name}(`);
  if (at === -1) return "";
  let i = CLI.indexOf("{", at), depth = 0;
  for (; i < CLI.length; i++) {
    if (CLI[i] === "{") depth++;
    else if (CLI[i] === "}") { depth--; if (depth === 0) { i++; break; } }
  }
  return CLI.slice(at, i);
}

const SECRET = "secretFromStdin";
const IDX_PROBE = CODE.indexOf("probeKey(" + SECRET);
const IDX_SAVE = CODE.indexOf("saveDirectKey({");
const IDX_GUARD = CODE.indexOf(`PRINTABLE_ASCII.test(${SECRET})`);

// ─── 1. the secret comes from stdin, and only from stdin ─────────────────────
console.log("\n── 1. the restricted key is read from STDIN, never from a flag ──");
{
  ok(/for await \(const chunk of process\.stdin\)/.test(CODE),
    "the script reads process.stdin to the end");
  ok(/process\.stdin\.isTTY/.test(CODE) && /pbpaste \| node scripts\/save-direct-key\.mjs/.test(CLI),
    "a TTY (nothing piped) is refused with a usage line showing how to pipe the key in");
  const decls = CODE.split("\n").filter((l) => new RegExp(`(const|let|var)\\s+${SECRET}\\b`).test(l));
  ok(decls.length === 1 && /=\s*await readStdin\(\);\s*$/.test(decls[0]),
    `the secret is assigned exactly once, straight from readStdin() (saw: ${JSON.stringify(decls)})`);
  ok(!decls.some((l) => l.includes("val(") || l.includes("argv") || l.includes("args")),
    "and no argv/flag value ever reaches it - a flag lands the key in shell history and the process list");
  const flagNames = [...CLI.matchAll(/(?:val|has)\("(--[a-z-]+)"\)/g)].map((m) => m[1]);
  ok(!flagNames.some((f) => /rk|key|secret|sk/.test(f) && f !== "--pk"),
    `no secret-shaped flag is parsed at all (flags: ${[...new Set(flagNames)].join(" ")})`);
}

// ─── 2. the secret cannot reach output, on any path ──────────────────────────
console.log("\n── 2. no print statement anywhere can echo the key ──");
{
  const calls = printCalls(CODE);
  ok(calls.length > 5, `the scan found the script's print calls to check (${calls.length} of them)`);
  const leaky = calls.filter((c) => c.includes(SECRET));
  ok(leaky.length === 0,
    `no print call can interpolate the key${leaky.length ? `: ${leaky[0].slice(0, 120)}` : ""}`);
  // Whitelist every other mention, so a future non-print leak (an error object
  // carrying it, a JSON.stringify of a payload) has to be added here on purpose.
  const ALLOWED = [
    new RegExp(`^const ${SECRET} = await readStdin\\(\\);$`),
    new RegExp(`^const gotSecret = ${SECRET}\\.length > 0;$`),
    new RegExp(`^const shapeOk = PRINTABLE_ASCII\\.test\\(${SECRET}\\);$`),
    new RegExp(`^report = await probeKey\\(${SECRET}, publishableKey\\);$`),
    new RegExp(`^secretKey: ${SECRET},$`),
  ];
  const mentions = CODE.split("\n").map((l) => l.trim()).filter((l) => l.includes(SECRET));
  const stray = mentions.filter((l) => !ALLOWED.some((rx) => rx.test(l)));
  ok(stray.length === 0,
    `the key identifier appears ONLY in its ${ALLOWED.length} declared uses${stray.length ? `; stray: ${JSON.stringify(stray)}` : ""}`);
  ok(/only the last 4 characters/i.test(CLI) && /report\.key_last4|saved\.key_last4/.test(CODE),
    "what the operator sees instead is the last4 the contract hands back");

  // The widened half. An identifier scan cannot see a secret that arrives inside
  // e.message, so what is pinned instead is that nothing which prints an error
  // message is REACHED before the shape guard has run.
  const printErrors = ["failUnknownBeforeSave(", "failUnknownDuringSave(", "failExpected("]
    .flatMap((n) => callIndices(n));
  ok(printErrors.length > 0, `the error-printing handlers are called (${printErrors.length} call sites)`);
  ok(IDX_GUARD > -1 && printErrors.every((i) => i > IDX_GUARD),
    "every call site that prints a raw error message sits AFTER the shape guard - the probe's own throw is only printable because a key that could poison it was already refused");
  const firstFetch = CODE.indexOf("fetch(");
  ok(IDX_GUARD > -1 && firstFetch > IDX_GUARD,
    "and no fetch call is even written before the guard, so nothing can be in flight while the key is still unverified");
}

// ─── 3. the actor ────────────────────────────────────────────────────────────
console.log("\n── 3. --as is a named human, and a flag is not a name ──");
{
  ok(/const actor = String\(val\("--as"\) \|\| ""\)\.trim\(\);/.test(CODE),
    "--as is trimmed before it counts, so whitespace cannot pass as a name");
  ok(/if \(!actor\) die\(/.test(CODE),
    "an empty or whitespace-only --as is refused with a message, not defaulted");
  const call = CODE.slice(IDX_SAVE);
  ok(/performedByName: actor,/.test(call), "the trimmed --as value is passed as performedByName");
  ok(/performedBy: null,/.test(call) && /createdBy: null,/.test(call),
    "performedBy and createdBy are LITERAL null - a CLI has neither id space, and no staff row is invented");
  ok(!/performedBy: [^n]/.test(call) && !/createdBy: [^n]/.test(call),
    "and neither is quietly filled from somewhere else");

  // val() is EXECUTED, not just read. `--as --save` (the operator never typed
  // their name) must not make the actor the string "--save" while --save is
  // still in argv and the save still goes through.
  const valSrc = CLI.match(/const val = (\(flag\) => \{[\s\S]*?\n\};|\(flag\) => \{[^\n]*\};)/);
  ok(!!valSrc, "val() can be lifted out of the source and run");
  if (valSrc) {
    const mk = new Function("args", `return ${valSrc[1].replace(/;$/, "")};`);
    const v = mk(["--client", "abc", "--as", "--save", "--save"]);
    ok(v("--as") === null,
      `val("--as") returns null when the next token is a flag (got ${JSON.stringify(v("--as"))}) - otherwise a flag lands in the audit as the human who armed a live payment credential`);
    ok(String(v("--as") || "").trim() === "",
      "so the existing blank-actor guard is what catches it, and the run cannot save");
    const v2 = mk(["--client", "abc", "--as", "Zoran", "--save"]);
    ok(v2("--as") === "Zoran" && v2("--client") === "abc",
      "and a real value is still read normally");
    ok(v2("--nope") === null, "a flag that is not present is still null");
  }
}

// ─── 4. probe by default, write only on --save ───────────────────────────────
console.log("\n── 4. a default run writes nothing ──");
{
  const callSites = [...CODE.matchAll(/saveDirectKey\(\{/g)];
  ok(callSites.length === 1, `there is exactly ONE saveDirectKey call site (found ${callSites.length})`);
  const guard = CODE.indexOf("if (!doSave) {");
  const exitAt = CODE.indexOf("process.exit(0)", guard);
  ok(guard > -1 && exitAt > guard && callSites.length === 1 && exitAt < callSites[0].index,
    "a run without --save exits BEFORE that call site");
  ok(/PROBE ONLY\. Nothing was written\./.test(CLI),
    "and it says so plainly: probe only, nothing written");
  ok(/const doSave = has\("--save"\);/.test(CODE),
    "--save is the only thing that turns the run into a write");
}

// ─── 5. the shape guard, before the key can reach a fetch ────────────────────
console.log("\n── 5. a key that is not printable ASCII never reaches fetch ──");
{
  ok(IDX_GUARD > -1, "the script tests the pasted key against a printable-ASCII shape");
  ok(IDX_GUARD > -1 && IDX_PROBE > -1 && IDX_GUARD < IDX_PROBE,
    "the guard runs BEFORE probeKey - a key with an embedded newline makes undici throw while BUILDING the request, with the whole `Bearer <key>` header value in a message that has no .status");
  ok(IDX_GUARD > -1 && IDX_SAVE > -1 && IDX_GUARD < IDX_SAVE,
    "and before saveDirectKey, which hands the same value to the same transport");
  const block = IDX_GUARD > -1 ? CODE.slice(IDX_GUARD, IDX_GUARD + 1200) : "";
  ok(/if \(!shapeOk\) \{[\s\S]*die\(/.test(block),
    "a bad shape DIES - it is not warned about, sanitised, or repaired");
  ok(/paste artefact|PASTE ARTEFACT/i.test(CLI) && /ONE unbroken line/i.test(CLI),
    "the message tells the operator what actually happened (a wrapped email or PDF paste) and what to do (re-copy as one line)");
  ok(!/replace\([^)]*rk_live|scrub|redact/i.test(CODE),
    "and nothing tries to scrub the key back OUT of a message afterwards - the newline splits the key, so a key-shaped pattern stops at the break and leaves the tail on screen");

  // The regex itself is lifted out and run. "A guard exists" and "the guard
  // rejects what it must" are different claims.
  const rxLit = CLI.match(/const PRINTABLE_ASCII = \/(.+?)\/;/);
  ok(!!rxLit, "the shape pattern can be lifted out of the source and run");
  if (rxLit) {
    const RX = new RegExp(rxLit[1]);
    // ASSEMBLED FROM PARTS ON PURPOSE. Written as one literal, this fixture is a
    // valid-looking live restricted key, and GitHub push protection blocks the
    // push - correctly, since it cannot know a key-shaped string is invented.
    // Assembling it keeps the assertion honest (the regex still sees the real
    // shape) without putting a key-shaped literal in the repo. Do not "tidy"
    // this back into one string, and never resolve such a block by allowlisting
    // the secret.
    const REAL = "rk_" + "live_" + "51QxAbCdEfGhIjKlMnOpQrStUvWxYz0123456789";
    ok(RX.test(REAL), "it accepts a real rk_live_ key shape");
    // Written as ESCAPES on purpose: a literal NUL or zero-width space in this
    // file would make the file itself non-text and unreadable to the very tools
    // that have to review it.
    const bad = {
      "an embedded LF": "rk_live_51QxAbCd\nEfGhIjKlMnOp",
      "an embedded CR": "rk_live_51QxAbCd\rEfGhIjKlMnOp",
      "a NUL": "rk_live_51QxAbCd\u0000EfGhIjKlMnOp",
      "a tab": "rk_live_51QxAbCd\tEfGhIjKlMnOp",
      "a space": "rk_live_51QxAbCd EfGhIjKlMnOp",
      "a zero-width space": "rk_live_51QxAbCd\u200bEfGhIjKlMnOp",
      "a non-breaking space": "rk_live_51QxAbCd\u00a0EfGhIjKlMnOp",
      "a byte-order mark": "\ufeffrk_live_51QxAbCdEfGhIjKlMnOp",
      "an accented character": "rk_live_51QxAbCd\u00e9",
    };
    const survivors = Object.entries(bad).filter(([, s]) => RX.test(s)).map(([k]) => k);
    ok(survivors.length === 0,
      `it rejects LF, CR, NUL, tab, space, ZWSP, NBSP, BOM and accents${survivors.length ? ` (SURVIVED: ${survivors.join(", ")})` : ""}`);
  }
  ok(/transport-level|api\/_stripe-transport\.js is getting its own/.test(CLI) && /LOCAL half|local guard|stays/i.test(CLI),
    "the header says this is the LOCAL half of a two-part fix, so nobody deletes it later as redundant");
}

// ─── 6. the environment --save needs is checked before any Stripe contact ────
console.log("\n── 6. --save pre-checks every env var it needs, up front ──");
{
  const at = CODE.indexOf("if (doSave) {");
  ok(at > -1, "there is a --save pre-check block");
  const block = at > -1 ? CODE.slice(at, CODE.indexOf("\n}", at)) : "";
  ok(/STRIPE_DIRECT_ENC_KEY/.test(block), "STRIPE_DIRECT_ENC_KEY is pre-checked (nothing can be encrypted at rest without it)");
  ok(/PORTAL_BASE_URL/.test(block),
    "PORTAL_BASE_URL is pre-checked too - without it the save writes the credential and then fails webhook registration EVERY time, and the proof has nowhere to go");
  ok(/CRON_SECRET/.test(block), "CRON_SECRET is pre-checked - it is the only credential this CLI can use to ask production anything");
  ok(/die\(/.test(block), "a missing one refuses the run rather than warning");
  ok(at > -1 && IDX_PROBE > -1 && at < IDX_PROBE,
    "and the whole block runs BEFORE the key is probed against live Stripe");
  ok(/vercel env pull/.test(CLI) && /hand-copy/i.test(CLI),
    "the operator is told to pull these from Vercel production rather than hand-copy them (a typo in the enc key is silent until a payment fails)");
}

// ─── 7. what an operator is told when the contract says no ───────────────────
console.log("\n── 7. the contract's refusals, in a CLI's vocabulary ──");
{
  const fe = fnSource("failExpected");
  ok(fe.length > 0, "failExpected() is where every .status error is reported");
  ok(!/\$\{e\.status\}/.test(fe) && !/refused \(/.test(fe),
    "the HTTP status NUMBER is never printed at the operator - this is a CLI, not a protocol");
  ok(/e\.status === 404/.test(fe) && /NOT_FOUND_HINT/.test(fe),
    "404 gets its OWN hint instead of the generic refusal");
  ok(/typo/i.test(CLI) && /client id/i.test(CLI),
    "and that hint says what it almost always is: a typo in the client id");
  const at409 = fe.indexOf("e.status === 409");
  ok(at409 > -1, "409 has its own branch");
  const branch409 = at409 > -1 ? fe.slice(at409, fe.indexOf("} else", at409)) : "";
  ok(/console\.error\(`\\nrefused: \$\{msg\}`\)/.test(branch409),
    "and it prints the contract's message VERBATIM, with nothing added or re-worded");
  ok(!/academyName|otherName|is already on file for/.test(CLI),
    "the CLI does NOT run its own lookup for the other academy's name - the contract already resolved it where it could, and already fell back to a client_id where it could not, so a second answer here could only be a differently-worded one");
  ok(/e\.status === 502/.test(fe) && /RETRYABLE/.test(fe),
    "502 is phrased as RETRYABLE - Stripe did not answer, which says nothing about the key");
  ok(/same command again/i.test(fe) && !/permanent|invalid key/i.test(fe),
    "and it says to run the same command again, not that anything is permanently wrong");
  ok(/could not complete, unchanged:/.test(CLI) && /may have PARTLY landed/.test(CLI),
    "three outcomes throughout: success, an expected failure with a .status, and an unknown that is never reported as a clean no");
}

// ─── 8. the post-save proof, and its three outcomes ──────────────────────────
console.log("\n── 8. a save is not finished until PRODUCTION reads it back ──");
{
  const idxCall = CODE.indexOf("/api/stripe/cron-key-health`");
  ok(idxCall > -1, "the CLI asks production's cron-key-health endpoint (the only prod surface it can authenticate to)");
  ok(idxCall > -1 && IDX_SAVE > -1 && idxCall > IDX_SAVE, "it does so AFTER the save, on the row that was just written");
  ok(/Authorization: `Bearer \$\{CRON_SECRET\}`/.test(CODE),
    "authenticated with CRON_SECRET, which is what makes production willing to answer");
  ok(/health\.results/.test(CODE) && /String\(row\.client_id\) === String\(client\.id\)/.test(CODE),
    "and it filters production's results array down to OUR academy, not to whatever else was swept");
  ok(!/encryptSecret|decryptSecret/.test(CODE),
    "there is no local encrypt-then-decrypt round trip - both halves would use the same possibly-wrong key, so it could only ever agree with itself");

  // REQUIRED: the only way out of a --save run with exit 0 is through the proof.
  const after = CODE.slice(IDX_SAVE);
  const zeroExits = [...after.matchAll(/process\.exit\(0\)/g)];
  ok(zeroExits.length === 1, `after the save there is exactly ONE exit-0 path (found ${zeroExits.length})`);
  const proved = fnSource("proofProved");
  ok(zeroExits.length === 1 && proved.includes("process.exit(0)"),
    "and it is inside proofProved() - a save cannot report success without production having read the key back");

  const failed = fnSource("proofFailed");
  const incon = fnSource("proofInconclusive");
  ok(proved.length > 0 && failed.length > 0 && incon.length > 0,
    "the three outcomes are three separate reports, not one function with a flag");
  ok(/production decrypted the stored key/i.test(proved) && /process\.exit\(0\)/.test(proved),
    "PROVED says plainly that production decrypted and used the key, and exits 0");
  ok(/PAYMENTS FOR THIS ACADEMY WILL NOT WORK/.test(failed) && /process\.exit\(1\)/.test(failed),
    "BROKEN is loud, says payments will not work, and exits nonzero");
  ok(/Do NOT treat this academy as live/i.test(failed),
    "and tells the operator not to rely on the academy until it is fixed");
  ok(/process\.exit\(2\)/.test(incon),
    "COULD-NOT-ASK exits with its own nonzero code, so a script cannot read it as either of the others");
  ok(!/PROVED/.test(incon.replace(/NOT PROVED/g, "")),
    "and it never prints a success verdict - the save landed, but nothing was proved about it");
  ok(/NOT a success and NOT a failure/i.test(incon),
    "it says so in as many words: not a success, not a failure");
  ok(/RETRY_PROOF/.test(incon) && /curl -sS -X POST/.test(CODE),
    "and it hands over the exact command to retry the proof on its own");

  // The classification itself: a decrypt-shaped failure and a network blip must
  // not land in the same branch.
  const credRx = CODE.match(/const CREDENTIAL_SHAPED = \/(.+?)\/i;/);
  const netRx = CODE.match(/const NETWORK_SHAPED = \/(.+?)\/i;/);
  ok(!!credRx && !!netRx, "the two error shapes are declared separately and can be lifted out");
  if (credRx && netRx) {
    const CRED = new RegExp(credRx[1], "i"), NET = new RegExp(netRx[1], "i");
    ok(CRED.test("Unsupported state or unable to authenticate data"),
      "a wrong STRIPE_DIRECT_ENC_KEY in production surfaces as AES-GCM refusing the blob, and that reads as credential-shaped");
    ok(CRED.test("STRIPE_DIRECT_ENC_KEY not set"), "so does production having no enc key at all");
    ok(NET.test("fetch failed") && NET.test("ETIMEDOUT") && NET.test("Stripe 503"),
      "a timeout, a dropped connection and a Stripe 5xx read as network-shaped");
    ok(!CRED.test("fetch failed") && !CRED.test("ETIMEDOUT"),
      "and a blip is NEVER classified as a credential failure - that would tell an operator payments are broken because the wifi dropped");
  }
  ok(/probes ALL direct-key academies|no per-academy scope/i.test(CLI),
    "the header notes the endpoint has no per-academy scope and sweeps every direct-key academy on every call");
}

// ─── 9. one doorway: the table name is not in scripts/ at all ────────────────
console.log("\n── 9. the direct-key table name never appears in scripts/ ──");
{
  ok(!CLI.includes(TABLE),
    "the script does not contain the table name (the audit scan walks api/** and src/views, NOT scripts/, so a name typed there is an unaudited reference)");
  ok(!/["']client_|_direct["']|["']_stripe/.test(CODE),
    "the name is not string-concatenated back together out of quoted halves either");
  // The whole reason a table name was ever needed here is gone: the collision
  // pre-check now lives inside saveDirectKey and arrives as a .status 409.
  ok(!/directTableName|src\.match|String\(saveDirectKey\)/.test(CODE),
    "and no table name is derived from the contract's source either - the script needs none");
  ok(!/stripe_account_id=eq\./.test(CODE),
    "the account-collision pre-check is gone from the CLI (it moved INTO saveDirectKey, which throws .status 409)");
  ok(!/storedAcct/.test(CODE),
    "so is the stored-account mirror refusal - one refusal, in one place, worded once");
  ok((CODE.match(/clients\?id=eq\./g) || []).length === 1,
    "exactly one clients query remains: the cheap academy lookup that keeps a typo'd uuid away from live Stripe");
}

// ─── 10. the webhook truth ───────────────────────────────────────────────────
console.log("\n── 10. a webhook failure does not un-say the save ──");
{
  ok(/wh\.ok/.test(CODE) && /webhook: FAILED/.test(CLI),
    "a failed webhook registration is reported, not swallowed");
  ok(/THE SAVE STILL STANDS/.test(CLI),
    "and the report says the save still stands, because the contract does not roll it back");
  ok(!/rolled back|rollback|undone|nothing was saved/i.test(CLI),
    "nothing in the script claims a rollback that never happens");
  ok(/webhook: \$\{wh\.skipped \|\| wh\.action/.test(CLI),
    "a successful registration reports which action the ensure step took");
}

// ─── 11. the header's operator prerequisites ─────────────────────────────────
console.log("\n── 11. the header states what carries no auth, and what the operator must do first ──");
{
  ok(/NO AUTH OF ITS OWN/i.test(CLI) && /saveDirectKey/.test(CLI.slice(0, 4000)),
    "the file header says saveDirectKey carries no auth of its own");
  ok(/401|403/.test(CLI.slice(0, 4000)),
    "and that the route's 401/403 lived outside it");
  ok(/runs LOCALLY|runs locally/.test(CLI) && /SUPABASE_SERVICE_ROLE_KEY/.test(CLI.slice(0, 4000)),
    "so the safety is local execution with the service-role key, and any future HTTP caller inherits zero auth");
  ok(/npm install/.test(CLI) && /@sentry\/node/.test(CLI) && /ERR_MODULE_NOT_FOUND/.test(CLI),
    "the header warns that a missing npm install dies on a bare ERR_MODULE_NOT_FOUND via @sentry/node");
  ok(/pbcopy/.test(CLI) && /clipboard/i.test(CLI),
    "and that `pbpaste |` leaves the live key in the clipboard, with the command to clear it");
  // Printed, not just documented: which Supabase project this is about to write to.
  const hostPrint = CODE.indexOf("SB_HOST");
  ok(/console\.log\(`\s*supabase\s+\$\{SB_HOST\}/.test(CODE),
    "the Supabase host is PRINTED, so nobody can save a live key into the wrong project unknowingly");
  ok(hostPrint > -1 && IDX_SAVE > -1 && CODE.indexOf("${SB_HOST}") < IDX_SAVE,
    "and printed BEFORE any write");
}

// ─── 12. the premise under every "refused" line ──────────────────────────────
console.log("\n── 12. the contract's post-write region stays throw-free ──");
{
  // The CLI reports every .status error as a refusal, which an operator reads as
  // "nothing happened". That is a claim about the CONTRACT, not about the CLI:
  // it holds only while every .status throw fires before the first write. Pin it
  // where it can actually break.
  const start = DK.indexOf("export async function saveDirectKey(");
  const end = DK.indexOf("const ROW_SELECT");
  pinned(start > -1 && end > start, "saveDirectKey in api/stripe/direct-key.js, up to `const ROW_SELECT`");
  const body = DK.slice(start, end);
  const write = body.indexOf("?on_conflict=client_id`");
  pinned(write > -1, "the client_stripe_direct upsert inside saveDirectKey (`?on_conflict=client_id`)");
  const before = body.slice(0, write);
  const after = body.slice(write);
  ok(/throw bad\(/.test(before), "every deliberate refusal in the contract is thrown BEFORE the first write");
  const lateThrows = after.split("\n").map((l) => l.trim()).filter((l) => /(^|\s)throw\b/.test(l));
  ok(lateThrows.length === 0,
    `and NOTHING throws after it (found: ${JSON.stringify(lateThrows)}). If a .status throw ever lands here, this CLI would tell an operator "refused, nothing happened" while a live key sits in the table - fix the CLI's wording, do not delete this pin`);
}

// ─── footer ──────────────────────────────────────────────────────────────────
console.log("");
if (MUTATE) {
  if (controlBroken) {
    console.log(`❌ NEGATIVE CONTROL FAILED: ${controlBroken}`);
    process.exit(1);
  }
  const caught = fail > 0;
  console.log(caught
    ? `✅ NEGATIVE CONTROL PASSED: control caught: the ${MUTATE} mutation tripped ${fail} assertion(s):\n   - ${failures.slice(0, 4).join("\n   - ")}`
    : `❌ NEGATIVE CONTROL FAILED: the ${MUTATE} mutation changed nothing this suite noticed. That check is decorative.`);
  process.exit(caught ? 0 : 1);
}
console.log(fail ? `❌ ${pass} passed, ${fail} failed.` : `✅ ${pass} passed, 0 failed.`);
process.exit(fail ? 1 : 0);
