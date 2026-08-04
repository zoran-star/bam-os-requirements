// A CREDENTIAL WITH A LINE BREAK IN IT MUST NEVER REACH A RESPONSE BODY.
//
//   node api/_credential-leak.test.mjs
//
// THE BUG CLASS, once shipped from the staff panel. A secret arrives with a
// break IN THE MIDDLE (a wrapped email, a Slack code block, `echo` instead of
// `printf` into a secret store). .trim() cannot see it - trim only touches the
// ends - so it passes every shape check and reaches fetch, where undici refuses
// the header with
//
//   TypeError: Headers.append: "Bearer svc_AAAA\nBBBB" is an invalid header value.
//
// That TypeError QUOTES THE WHOLE HEADER and carries no .status, so a route
// doing `res.status(e.status || 500).json({ error: e.message })` - or assigning
// e.message into a field of a JSON body, which is what api/health.js did - hands
// a live credential to whoever asked. Regex scrubbing does not save you: the
// break splits the credential, the pattern stops at the break, and the tail
// stays on screen. Every leak assertion below therefore checks a TWO-PART
// canary, so truncation fails HERE instead of passing here and leaking in prod.
//
// api/_stripe-transport.js closed this for the Stripe seam. This suite covers
// the raw-fetch call sites that deliberately do not route through that seam.
//
// WHAT THIS PROVES
//   1. api/health.js - THE CONFIRMED DEFECT. The Supabase ping refuses a service
//      key with an embedded break, never reaches fetch, and the string it puts
//      in checks.supabase_url.error is one this file WROTE. A trailing newline
//      (production's SUPABASE_SERVICE_KEY carries one) is still trimmed and
//      USED, in both the apikey and the bearer header, exactly.
//   2. api/stripe/overview.js - its catch is res.status(500).json({error: err.message}).
//   3. api/commissions.js - its catch is res.status(e.status || 500).json({error: e.message}),
//      the exact shape that leaked once. The refusal is STATUSLESS so that catch
//      answers 500: a broken env var is our fault, not the caller's request.
//   4. api/website/ch3-checkout.js - PUBLIC endpoint, catch echoes err.message.
//   5. api/clients.js - RULED SAFE, and the ruling is executed rather than
//      asserted in prose: an embedded-break key drives the real shipped
//      getStripeRevenue and the bindingless catch returns null, so nothing the
//      runtime wrote can reach a body. The control clientsleak widens that catch
//      and this suite must go red.
//   6. DEFECT B - the mode check and the credential are ONE reading of
//      ONBOARDING_STRIPE_SECRET_KEY. A LEADING space on an sk_test key used to
//      give isTestMode()=false while the transport sent "Bearer sk_test_...":
//      live branches, test money, and no 401 to make it visible. Driven through
//      the REAL transport, so the assertion is on the bytes in the header.
//
// WHAT IT DOES NOT PROVE
//   - Anything about api/parent/_stripe.ts at RUNTIME. It is TypeScript and this
//     suite is plain node with no build step, so that file is covered by source
//     pins (section 6c) plus the shared helper's own runtime section. Said out
//     loud because a pin is weaker than an execution.
//   - That the handlers' catch blocks are wired to the functions extracted here.
//     Those wirings are source-pinned (each section says which line), not run.
//   - Anything about network, database or Stripe behavior. Every remote answer
//     is an in-memory stub whose header validation is the runtime's own
//     `new Headers()`, so the failure this suite exists for happens inside it.
//
// ─────────────────────────────────────────────────────────────────────────────
// NEGATIVE CONTROLS. Each reverts ONE fix in an in-memory copy of shipped source
// behind a loud pin, and MUST PRINT its banner:
//
//   MUTATE=healthraw       api/health.js's ping goes back to the raw key header
//                          + `error: e.message`. This is the exact code the
//                          adversarial tester executed to get a service-role key
//                          into a JSON body.
//   MUTATE=overviewraw     the overview guard + safeFetch are removed.
//   MUTATE=commissionsraw  same, on the invoicing half of commissions.js.
//   MUTATE=ch3raw          same, on the public CH3 checkout.
//   MUTATE=clientsleak     api/clients.js's bindingless catch is widened to
//                          return e.message - the ONLY thing keeping that file's
//                          raw header out of a body. Proves the safe ruling is a
//                          measurement, not an opinion.
//   MUTATE=notrim          the shared normalizeCredential stops trimming, so a
//                          key whose only sin is a TRAILING newline is refused.
//                          Section 1b/2b must catch it or "trim first" is
//                          decorative and we have swapped a leak for an outage.
//   MUTATE=modedrift       the three JS checkout routes go back to judging the
//                          RAW env var while handing the transport the trimmed
//                          one - defect B, restored. Section 6 must catch it.
//   MUTATE=onbfallthrough  a configured-but-EMPTY ONBOARDING_STRIPE_SECRET_KEY
//                          silently means "no override" again, so the transport
//                          falls through to the PLATFORM key and an intended
//                          test sandbox charges live money. Section 6b.
//   MUTATE=scanblind       a brand-new unguarded raw-key fetch is APPENDED to a
//                          file this task closed. Every spelling pin stays
//                          green; only section 7's counting scan notices.
//   MUTATE=namefilter      the e.name allowlist goes back to the permissive
//                          single grammar that accepted a credential-shaped
//                          name (sk_live_A_B is [A-Za-z][A-Za-z0-9_]*).
//   MUTATE=throwgetter     the defensive property reads are removed, so a
//                          throwing getter escapes the sanitiser as a new,
//                          unsanitised error. Section 8.
//   MUTATE=emptycred       the not-configured refusal is removed, so a missing
//                          credential becomes "Bearer " and a misleading 401.
//   MUTATE=handlerescape   a guard is moved back OUTSIDE a handler's try, so an
//                          absent credential crashes the function instead of
//                          answering JSON. Section 9.
//
// EVERY control above is written as MUTATE=<name> ON PURPOSE: portal-ci.yml
// discovers them with `grep -ohE 'MUTATE=[A-Za-z][A-Za-z0-9_-]*'` over this
// file. Five of these existed only as `MUTATE === "name"` in code and were
// therefore never run by CI - including onbfallthrough, the one guarding the
// live-money fall-through. A control CI never runs is not a control.
//
// A control run exits ZERO when the mutation IS caught. CI greps for the banner,
// not the exit code.
// ─────────────────────────────────────────────────────────────────────────────

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const MUTATE = process.env.MUTATE || "";
const HERE = path.dirname(fileURLToPath(import.meta.url));

let pass = 0, fail = 0;
const failures = [];
let controlBroken = null;
const ok = (cond, label) => {
  if (cond) { pass++; console.log("  ✅ " + label); }
  else { fail++; failures.push(label); console.log("  ❌ " + label); }
};

// ── console capture, so "it was only logged" still counts as escaped ─────────
let consoleBuffer = "";
for (const m of ["log", "info", "warn", "error", "debug"]) {
  const real = console[m].bind(console);
  console[m] = (...args) => { consoleBuffer += args.map(String).join(" ") + "\n"; real(...args); };
}

// ── TWO-PART CANARIES, assembled from pieces ────────────────────────────────
// Never a real credential, and never a key-shaped literal in the file: GitHub
// push protection blocks those, and a suite that cannot be committed protects
// nothing. Two parts because a split credential defeats naive scanning - that is
// precisely why the original leak worked, so every assertion checks BOTH halves.
const SVC_HEAD = "svc_" + "PROBEHEAD";
const SVC_TAIL = "PROBETAIL" + "_9Xq7";
const SK_HEAD = "sk_" + "live_FAKE_LEAK_CANARY";
const SK_TAIL = "SECOND_LINE_TAIL" + "_7Zt2";
const brokenSvc = () => `${SVC_HEAD}\n${SVC_TAIL}`;
const brokenSk = () => `${SK_HEAD}\n${SK_TAIL}`;
// The clean values the trim cases must produce, EXACTLY.
const CLEAN_SVC = "svc_" + "CLEAN_SERVICE_KEY";
const CLEAN_SK = "sk_" + "live_CLEAN_PLATFORM_KEY";

const hasCanary = (s, head, tail) => String(s).includes(head) || String(s).includes(tail);
// message + every own property + the STACK. The stack matters on its own: Node
// builds err.stack from the message, so an error whose message was cleaned after
// construction still carries the original inside its stack.
const dumpError = (e) => (e
  ? [String(e.message), String(e.stack || ""), JSON.stringify(e, Object.getOwnPropertyNames(e)), JSON.stringify(e)].join("\n")
  : "");

// ── the fetch stub, validating headers the way the runtime does ──────────────
// Without `new Headers(init.headers)` a stub simply accepts a credential with a
// line break in it and every assertion below passes for the wrong reason.
let CALLS = [];
globalThis.fetch = async (url, init = {}) => {
  new Headers(init.headers || {});
  CALLS.push({ url: String(url), method: String(init.method || "GET").toUpperCase(), headers: init.headers || {}, body: init.body });
  return new Response(JSON.stringify({ data: [], ok_stub: true }), { status: 200, headers: { "content-type": "application/json" } });
};
const lastCall = () => CALLS[CALLS.length - 1] || { headers: {} };
const authOf = (c) => String((c.headers || {}).Authorization || "");

// ── shipped-source extraction (the parity suite's cut() technique) ───────────
const readSource = (rel) => fs.readFileSync(path.join(HERE, rel), "utf8");
function cut(src, pin, where) {
  const at = src.indexOf(pin);
  if (at === -1) {
    controlBroken = `This suite is pinned to text that is no longer in api/${where}:\n\n${pin}\n\nRe-point it, or delete the section that uses it - a pin that fails to apply looks exactly like a check that passed.`;
    throw new Error(controlBroken);
  }
  if (!pin.endsWith("{")) { controlBroken = `cut() pin must end with "{": ${pin}`; throw new Error(controlBroken); }
  let depth = 1;
  for (let i = at + pin.length; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}") { depth--; if (depth === 0) return src.slice(at, i + 1) + ";\n"; }
  }
  controlBroken = `unbalanced braces after ${pin} in api/${where}`;
  throw new Error(controlBroken);
}
function cutLine(src, line, where) {
  if (!src.split("\n").some((l) => l === line)) {
    controlBroken = `This suite is pinned to a line that is no longer in api/${where}:\n\n${line}`;
    throw new Error(controlBroken);
  }
  return line + "\n";
}
// An in-memory revert, behind a pin that must apply.
function revert(src, edits, where) {
  let out = src;
  for (const [find, repl] of edits) {
    if (!out.includes(find)) {
      controlBroken = `MUTATE=${MUTATE} is pinned to text that is no longer in api/${where}:\n\n${find}\n\nRe-point it or delete it - a pin that fails to apply looks exactly like a check that passed.`;
      throw new Error(controlBroken);
    }
    out = out.split(find).join(repl);
  }
  return out;
}

const TEMP = [];
process.on("exit", () => { for (const f of TEMP) { try { fs.unlinkSync(f); } catch (_) { /* best effort */ } } });
async function importTemp(name, source) {
  // Leading dot on purpose: the one-doorway parity scan skips dotfiles, so a
  // probe module that exists for milliseconds can never be mistaken for a new
  // Stripe call site.
  const p = path.join(HERE, name);
  fs.writeFileSync(p, source);
  TEMP.push(p);
  try { return await import(pathToFileURL(p).href); }
  finally { try { fs.unlinkSync(p); } catch (_) { /* best effort */ } }
}

// ── the shared helpers, real or mutated ──────────────────────────────────────
// MUTATE=notrim writes a copy with the trim removed and points every probe
// module at THAT, so the control exercises the same code path the fix does.
let HELPER_SPEC = "./_header-safe-credential.js";
const HELPER_MUTATIONS = {
  // e.name back to the permissive single grammar that let the canary through.
  namefilter: [["const SAFE_ERROR_NAME = /^[A-Za-z][A-Za-z0-9]{0,31}$/;",
                "const SAFE_ERROR_NAME = /^[A-Za-z][A-Za-z0-9_]*$/; // (control namefilter) permissive again"]],
  // reading a hostile property escapes the guard as a different error.
  throwgetter: [[`function safeRead(fn) {
  try { const v = fn(); return v == null ? "" : String(v); } catch { return ""; }
}`,
                 `function safeRead(fn) {
  const v = fn(); return v == null ? "" : String(v); // (control throwgetter) undefended
}`]],
  // "not configured" collapses back into a silent empty bearer.
  emptycred: [[`  if (normalized === "") {
    throw Object.assign(
      new Error(\`\${what} is not configured (missing, empty, or whitespace only)\`),
      { credentialMissing: true }
    );
  }`, "  // (control emptycred) the missing-credential refusal was removed"]],
};
if (HELPER_MUTATIONS[MUTATE]) {
  const mutated = revert(readSource("_header-safe-credential.js"), HELPER_MUTATIONS[MUTATE], "_header-safe-credential.js");
  fs.writeFileSync(path.join(HERE, ".leakprobe-helper.mjs"), mutated);
  TEMP.push(path.join(HERE, ".leakprobe-helper.mjs"));
  HELPER_SPEC = "./.leakprobe-helper.mjs";
}
if (MUTATE === "notrim") {
  const mutated = revert(readSource("_header-safe-credential.js"), [
    ['  return String(v ?? "").trim();', '  return String(v ?? ""); // (control notrim) trim removed'],
  ], "_header-safe-credential.js");
  fs.writeFileSync(path.join(HERE, ".leakprobe-helper.mjs"), mutated);
  TEMP.push(path.join(HERE, ".leakprobe-helper.mjs"));
  HELPER_SPEC = "./.leakprobe-helper.mjs";
}

process.env.STRIPE_DIRECT_ENC_KEY = "leak-suite-enc-key-not-a-real-one";

// ═════════════════════════════════════════════════════════════════════════════
console.log("\n── 1. api/health.js: the confirmed leak - a service key in a JSON body ──");
{
  let HEALTH_SRC = readSource("health.js");
  if (MUTATE === "healthraw") {
    // EXACTLY the pre-fix code the adversarial tester executed.
    HEALTH_SRC = revert(HEALTH_SRC, [
      [`  let credential;
  try {
    credential = assertHeaderSafeCredential(key, "the Supabase service key (SUPABASE_SERVICE_ROLE_KEY)");
  } catch (e) {
    // The guard's own sentences: they name the variable and never the value.
    return { live: false, error: e.message };
  }`,
        "  const credential = key; // (control healthraw) trim + refusal removed"],
      ['    return { live: false, error: describeFetchFailure(e, "Supabase") };',
        "    return { live: false, error: e.message }; // (control healthraw) the runtime's message again"],
    ], "health.js");
  }
  const H = await importTemp(".leakprobe-health.mjs", [
    `import { assertHeaderSafeCredential, describeFetchFailure } from "${HELPER_SPEC}";`,
    cut(HEALTH_SRC, "async function pingSupabase(url, key) {", "health.js"),
    "export { pingSupabase };\n",
  ].join("\n"));

  // ── 1a. an EMBEDDED break: refused, nothing on the wire, nothing in the body ─
  CALLS = [];
  let threw = null, ping = null;
  try { ping = await H.pingSupabase("https://stub.supabase.test", brokenSvc()); }
  catch (e) { threw = e; }

  // The body /api/health actually returns, rebuilt from the value the handler
  // assigns (the assignment itself is pinned in 1c).
  const body = JSON.stringify({ ok: false, checks: { supabase_url: { live: ping && ping.live, error: ping && ping.error } } });
  ok(!threw, `the ping answers rather than throwing (saw ${threw ? String(threw.message).slice(0, 60) : "no throw"})`);
  ok(!!ping && ping.live === false, "a service key with an embedded break reads NOT live");
  ok(!hasCanary(body, SVC_HEAD, SVC_TAIL),
    "and NEITHER canary half is anywhere in the JSON body /api/health returns");
  ok(!hasCanary(dumpError(threw), SVC_HEAD, SVC_TAIL),
    "nor in any message, property or stack if it did throw");
  ok(CALLS.length === 0, "and the broken key never reached the wire at all");
  ok(!!ping && /without the break/.test(String(ping.error || "")),
    `with the sentence that tells the operator what to actually do (saw ${JSON.stringify(ping && ping.error)})`);

  // ── 1b. a TRAILING newline is a PASTE ARTIFACT, not a broken key ───────────
  // Production's SUPABASE_SERVICE_KEY carries exactly this today. Refusing it
  // would trade a leak for an outage, and /api/health going red on a working
  // key is how an uptime monitor gets muted.
  for (const [label, dirty] of [
    ["a trailing newline", `${CLEAN_SVC}\n`],
    ["trailing whitespace and a CRLF", `${CLEAN_SVC}  \r\n`],
    ["a leading space", ` ${CLEAN_SVC}`],
    ["whitespace at BOTH ends", `\n\t ${CLEAN_SVC} \r\n`],
  ]) {
    CALLS = [];
    let p = null, t = null;
    try { p = await H.pingSupabase("https://stub.supabase.test", dirty); } catch (e) { t = e; }
    ok(!!p && p.live === true && !t,
      `a service key with ${label} is ACCEPTED and reads live (saw ${t ? String(t.message).slice(0, 50) : JSON.stringify(p)})`);
    // EXACT equality, not includes: a header built from the untrimmed value
    // would still "contain" the key, which is the bug where the trimmed value is
    // checked and the raw one is sent.
    ok(CALLS.length === 1 && authOf(lastCall()) === `Bearer ${CLEAN_SVC}`,
      `and the bearer is exactly "Bearer <trimmed>" - no whitespace rides along (${label})`);
    ok(String((lastCall().headers || {}).apikey || "") === CLEAN_SVC,
      `and the apikey header carries the same trimmed value (${label})`);
  }

  // ── 1b-ii. WHY the two ends are not symmetric at a bearer header ──────────
  // api/_header-safe-credential.js makes a claim about the RUNTIME, and a claim
  // nobody executes is exactly how this class of bug survives review. So it is
  // measured here. WHATWG Headers strips whitespace from the ends of the header
  // VALUE before validating - but an Authorization value is "Bearer <key>", so a
  // LEADING break on the key is interior to it and a trailing one is not.
  const headerShape = (v) => {
    try { return { ok: true, stored: new Headers({ Authorization: v }).get("Authorization") }; }
    catch (e) { return { ok: false, message: String(e.message) }; }
  };
  ok(headerShape(`Bearer ${CLEAN_SVC}\n`).stored === `Bearer ${CLEAN_SVC}`,
    "runtime: a TRAILING newline is stripped before validation - that shape never threw and never reached the wire");
  const leading = headerShape(`Bearer \n${CLEAN_SVC}`);
  ok(leading.ok === false && leading.message.includes(CLEAN_SVC),
    "runtime: a LEADING newline is INTERIOR to \"Bearer <key>\" - it throws AND quotes the key, which is the real leak shape");
  ok(headerShape(`Bearer  ${CLEAN_SVC}`).stored === `Bearer  ${CLEAN_SVC}`,
    "runtime: a leading SPACE throws nothing and travels attached - a silent 401, which no refusal would ever catch and only the trim fixes");

  // ── 1c. the wiring, and the CLAIM ─────────────────────────────────────────
  ok(HEALTH_SRC.includes("if (ping.error) checks.supabase_url.error = ping.error;"),
    "the handler assigns the ping's OWN string into checks.supabase_url.error");
  ok(!/checks\.supabase_url\.error = e\.message/.test(HEALTH_SRC),
    "and no longer assigns the runtime's e.message anywhere");
  // A comment broader than what is enforced is how the original bug read as safe
  // while being unsafe. This file's header claimed the body was booleans only
  // while it returned an error string built from a runtime exception. The claim
  // must be RETRACTED, not just softened - so both halves are pinned: the old
  // sentence is gone, and the file now says what it actually enforces.
  ok(!HEALTH_SRC.includes("// NEVER leaks secret values"),
    "the header's blanket 'NEVER leaks secret values' claim is gone - it was false, and being false is what hid this");
  ok(/WHAT THIS BODY MAY CONTAIN, stated as narrowly as it is actually enforced/.test(HEALTH_SRC),
    "and is replaced by a claim scoped to what the code enforces");
}

// ═════════════════════════════════════════════════════════════════════════════
console.log("\n── 2. api/stripe/overview.js: catch is res.status(500).json({error: err.message}) ──");
{
  let SRC = readSource("stripe/overview.js");
  if (MUTATE === "overviewraw") {
    SRC = revert(SRC, [
      ['  const key = assertHeaderSafeCredential(process.env.STRIPE_SECRET_KEY, "the platform Stripe key (STRIPE_SECRET_KEY)");',
        "  const key = process.env.STRIPE_SECRET_KEY; // (control overviewraw) guard removed"],
      ["  const res = await safeFetch(`${STRIPE_API}${path}`, {\n    headers: { Authorization: `Bearer ${key}` },\n  }, \"Stripe\");",
        "  const res = await fetch(`${STRIPE_API}${path}`, {\n    headers: { Authorization: `Bearer ${key}` },\n  }); // (control overviewraw) sanitiser removed"],
    ], "stripe/overview.js");
  }
  const M = await importTemp(".leakprobe-overview.mjs", [
    `import { assertHeaderSafeCredential, safeFetch } from "${HELPER_SPEC}";`,
    cutLine(SRC, 'const STRIPE_API = "https://api.stripe.com/v1";', "stripe/overview.js"),
    cut(SRC, "async function stripeFetch(path) {", "stripe/overview.js"),
    "export { stripeFetch };\n",
  ].join("\n"));

  const realKey = process.env.STRIPE_SECRET_KEY;
  process.env.STRIPE_SECRET_KEY = brokenSk();
  CALLS = [];
  let e = null;
  try { await M.stripeFetch("/balance"); } catch (err) { e = err; }
  // The handler's catch, executed rather than described.
  const body = JSON.stringify({ error: e ? e.message : null });
  ok(!!e, "a platform key with an embedded break is refused rather than sent");
  ok(!hasCanary(body, SK_HEAD, SK_TAIL), "and NEITHER canary half reaches the 500 body the handler builds");
  ok(!hasCanary(dumpError(e), SK_HEAD, SK_TAIL), "nor its properties, nor its stack");
  ok(CALLS.length === 0, "and it never reached the wire");
  ok(!!e && e.status === undefined,
    `the refusal is STATUSLESS so the catch answers 500 - our misconfiguration is not a caller's bad request (saw ${JSON.stringify(e && e.status)})`);
  ok(SRC.includes("return res.status(500).json({ error: err.message });"),
    "and that catch really is the shape this section is defending (pin)");

  // 2b. a trailing newline still works, trimmed, exactly.
  process.env.STRIPE_SECRET_KEY = `${CLEAN_SK}\n`;
  CALLS = [];
  let t = null;
  try { await M.stripeFetch("/balance"); } catch (err) { t = err; }
  ok(!t && CALLS.length === 1, `a platform key with a trailing newline still works (saw ${t ? String(t.message).slice(0, 60) : "ok"})`);
  ok(authOf(lastCall()) === `Bearer ${CLEAN_SK}`, 'and the bearer is exactly "Bearer <trimmed>"');
  if (realKey === undefined) delete process.env.STRIPE_SECRET_KEY; else process.env.STRIPE_SECRET_KEY = realKey;
}

// ═════════════════════════════════════════════════════════════════════════════
console.log("\n── 3. api/commissions.js: catch is res.status(e.status || 500).json({error: e.message}) ──");
{
  let SRC = readSource("commissions.js");
  if (MUTATE === "commissionsraw") {
    SRC = revert(SRC, [
      ['  const key = assertHeaderSafeCredential(raw, "the platform Stripe key (STRIPE_SECRET_KEY)");',
        "  const key = raw; // (control commissionsraw) guard removed"],
      ["  const res = await safeFetch(`${STRIPE_API}${path}`, {", "  const res = await fetch(`${STRIPE_API}${path}`, {"],
      ["    body: new URLSearchParams(params).toString(),\n  }, \"Stripe\");",
        "    body: new URLSearchParams(params).toString(),\n  }); // (control commissionsraw) sanitiser removed"],
    ], "commissions.js");
  }
  const M = await importTemp(".leakprobe-commissions.mjs", [
    `import { assertHeaderSafeCredential, safeFetch } from "${HELPER_SPEC}";`,
    cutLine(SRC, 'const STRIPE_API = "https://api.stripe.com/v1";', "commissions.js"),
    cut(SRC, "async function stripeForm(path, params, extraHeaders = {}) {", "commissions.js"),
    "export { stripeForm };\n",
  ].join("\n"));

  const realKey = process.env.STRIPE_SECRET_KEY;
  process.env.STRIPE_SECRET_KEY = brokenSk();
  CALLS = [];
  let e = null;
  try { await M.stripeForm("/invoices", { customer: "cus_x" }); } catch (err) { e = err; }
  const status = e && e.status ? e.status : 500;
  const body = JSON.stringify({ error: e ? e.message : null });
  ok(!!e, "a platform key with an embedded break is refused rather than sent");
  ok(!hasCanary(body, SK_HEAD, SK_TAIL), "and NEITHER canary half reaches the body that catch builds");
  ok(!hasCanary(dumpError(e), SK_HEAD, SK_TAIL), "nor its properties, nor its stack");
  ok(CALLS.length === 0, "and it never reached the wire");
  ok(status === 500, `the catch answers 500, not a reassuring 4xx (saw ${status})`);
  ok(SRC.includes("return res.status(e.status || 500).json({ error: e.message });"),
    "and that catch really is the shape this section is defending (pin)");

  process.env.STRIPE_SECRET_KEY = ` ${CLEAN_SK}\n`;
  CALLS = [];
  let t = null;
  try { await M.stripeForm("/invoices", { customer: "cus_x" }); } catch (err) { t = err; }
  ok(!t && CALLS.length === 1 && authOf(lastCall()) === `Bearer ${CLEAN_SK}`,
    `whitespace at both ends is trimmed and used, exactly (saw ${t ? String(t.message).slice(0, 60) : authOf(lastCall())})`);
  if (realKey === undefined) delete process.env.STRIPE_SECRET_KEY; else process.env.STRIPE_SECRET_KEY = realKey;
}

// ═════════════════════════════════════════════════════════════════════════════
console.log("\n── 4. api/website/ch3-checkout.js: PUBLIC endpoint, catch echoes err.message ──");
{
  let SRC = readSource("website/ch3-checkout.js");
  if (MUTATE === "ch3raw") {
    SRC = revert(SRC, [
      ['  const key = assertHeaderSafeCredential(stripeKey(), "the CH3 Stripe key (CH3_STRIPE_SECRET_KEY)");\n  const headers = { Authorization: `Bearer ${key}` };',
        "  const headers = { Authorization: `Bearer ${stripeKey()}` }; // (control ch3raw) guard removed"],
      ['  const res = await safeFetch(`${STRIPE_API}${path}`, { method, headers, body: encoded }, "Stripe");',
        "  const res = await fetch(`${STRIPE_API}${path}`, { method, headers, body: encoded }); // (control ch3raw) sanitiser removed"],
    ], "website/ch3-checkout.js");
  }
  const M = await importTemp(".leakprobe-ch3.mjs", [
    `import { assertHeaderSafeCredential, safeFetch } from "${HELPER_SPEC}";`,
    cutLine(SRC, 'const STRIPE_API = "https://api.stripe.com/v1";', "website/ch3-checkout.js"),
    cut(SRC, "function stripeKey() {", "website/ch3-checkout.js"),
    cut(SRC, 'async function stripeFetch(path, { method = "GET", body } = {}) {', "website/ch3-checkout.js"),
    "export { stripeFetch };\n",
  ].join("\n"));

  const real = process.env.CH3_STRIPE_SECRET_KEY;
  process.env.CH3_STRIPE_SECRET_KEY = brokenSk();
  CALLS = [];
  let e = null;
  try { await M.stripeFetch("/payment_intents", { method: "POST", body: { amount: 100 } }); } catch (err) { e = err; }
  const body = JSON.stringify({ ok: false, error: e ? (e.message || "Internal error") : null });
  ok(!!e, "a CH3 key with an embedded break is refused rather than sent");
  ok(!hasCanary(body, SK_HEAD, SK_TAIL), "and NEITHER canary half reaches the body a parent's browser gets");
  ok(!hasCanary(dumpError(e), SK_HEAD, SK_TAIL), "nor its properties, nor its stack");
  ok(CALLS.length === 0, "and it never reached the wire");
  ok(SRC.includes('return res.status(500).json({ ok: false, error: err.message || "Internal error" });'),
    "and that catch really is the shape this section is defending (pin)");

  process.env.CH3_STRIPE_SECRET_KEY = `${CLEAN_SK}\n`;
  CALLS = [];
  let t = null;
  try { await M.stripeFetch("/payment_intents", { method: "POST", body: { amount: 100 } }); } catch (err) { t = err; }
  ok(!t && CALLS.length === 1 && authOf(lastCall()) === `Bearer ${CLEAN_SK}`,
    `a trailing newline is trimmed and used, exactly (saw ${t ? String(t.message).slice(0, 60) : authOf(lastCall())})`);
  if (real === undefined) delete process.env.CH3_STRIPE_SECRET_KEY; else process.env.CH3_STRIPE_SECRET_KEY = real;
}

// ═════════════════════════════════════════════════════════════════════════════
console.log("\n── 5. api/clients.js: RULED SAFE, and the ruling is EXECUTED ──");
{
  // getStripeRevenue builds a raw bearer from STRIPE_SECRET_KEY with no guard.
  // The claim is that it still cannot leak, because the whole fetch sits inside
  // a try whose catch takes NO BINDING and returns null. A claim like that is
  // worth exactly as much as the test that drives it, so it is driven.
  let SRC = readSource("clients.js");
  if (MUTATE === "clientsleak") {
    SRC = revert(SRC, [
      ["  } catch {\n    // THE ONLY THING KEEPING STRIPE_KEY OUT OF A RESPONSE BODY",
        "  } catch (e) {\n    return { revenueLabel: e.message }; // (control clientsleak) the catch was widened\n    /* THE ONLY THING KEEPING STRIPE_KEY OUT OF A RESPONSE BODY"],
      ["    // leak.test.mjs drives an embedded-break key through this exact shipped\n    // function and asserts neither canary half escapes.\n    return null;",
        "    leak.test.mjs drives an embedded-break key through this exact shipped\n    function and asserts neither canary half escapes. */\n    return null;"],
    ], "clients.js");
  }
  const realKey = process.env.STRIPE_SECRET_KEY;
  process.env.STRIPE_SECRET_KEY = brokenSk();
  const M = await importTemp(".leakprobe-clients.mjs", [
    cutLine(SRC, "const STRIPE_KEY = process.env.STRIPE_SECRET_KEY;", "clients.js"),
    cutLine(SRC, 'const STRIPE_API = "https://api.stripe.com/v1";', "clients.js"),
    cutLine(SRC, "const revenueCache = new Map();", "clients.js"),
    cutLine(SRC, "const REVENUE_TTL_MS = 60 * 1000;", "clients.js"),
    cut(SRC, "async function getStripeRevenue(customerId) {", "clients.js"),
    "export { getStripeRevenue };\n",
  ].join("\n"));

  CALLS = [];
  let out = null, threw = null;
  try { out = await M.getStripeRevenue("cus_probe"); } catch (e) { threw = e; }
  // The client row this value lands in, serialized the way /api/clients does.
  const row = JSON.stringify({ id: "client-x", revenue: out });
  ok(!threw, `getStripeRevenue swallows the runtime error rather than propagating it (saw ${threw ? String(threw.message).slice(0, 50) : "no throw"})`);
  ok(out === null, `and answers null, which every caller reads as "no revenue data" (saw ${JSON.stringify(out)})`);
  ok(!hasCanary(row, SK_HEAD, SK_TAIL), "so NEITHER canary half is in the client row /api/clients serializes");
  ok(!hasCanary(dumpError(threw), SK_HEAD, SK_TAIL), "nor in anything it threw");
  ok(!hasCanary(consoleBuffer, SK_HEAD, SK_TAIL), "and nothing printed either half to the console");
  if (realKey === undefined) delete process.env.STRIPE_SECRET_KEY; else process.env.STRIPE_SECRET_KEY = realKey;
}

// ═════════════════════════════════════════════════════════════════════════════
console.log("\n── 6. DEFECT B: the mode the route believes and the key it sends ──");
{
  // Executed failure, before the fix:
  //   isTestMode()=false   sent="Bearer sk_test_ABC"   Stripe-Account="acct_LIVE..."
  // The route takes its LIVE branches (live account header, live idempotency-key
  // namespace) while authenticating with a TEST credential. Before the transport
  // trimmed, this same paste produced a 401 - visibly broken. Half-working is
  // worse, because nobody goes looking.
  let ONB_SPEC = "./_stripe-onboarding-key.js";
  if (MUTATE === "onbfallthrough") {
    // THE REGRESSION THIS FIX INTRODUCED AND THEN CLOSED: a configured-but-empty
    // sandbox key returns undefined, the transport falls through to the PLATFORM
    // key, and an academy that believed it was in test mode charges real money.
    ONB_SPEC = "./.leakprobe-onbfall.mjs";
    fs.writeFileSync(path.join(HERE, ".leakprobe-onbfall.mjs"), [
      'export function onboardingStripeKey() { return String(process.env.ONBOARDING_STRIPE_SECRET_KEY ?? "").trim(); }',
      "// (control onbfallthrough) empty silently means 'no override' again",
      "export function onboardingKeyOverride() { return onboardingStripeKey() || undefined; }",
      'export function isOnboardingTestMode() { return onboardingStripeKey().startsWith("sk_test"); }',
    ].join("\n"));
    TEMP.push(path.join(HERE, ".leakprobe-onbfall.mjs"));
  }
  if (MUTATE === "modedrift") {
    // Not a mutation of the helper - a revert of the CALL SITES, which is where
    // the defect lived. Each goes back to judging the RAW env var.
    ONB_SPEC = "./.leakprobe-onbkey.mjs";
    fs.writeFileSync(path.join(HERE, ".leakprobe-onbkey.mjs"), [
      'export function onboardingStripeKey() { return String(process.env.ONBOARDING_STRIPE_SECRET_KEY ?? "").trim(); }',
      "export function onboardingKeyOverride() { return onboardingStripeKey() || undefined; }",
      "// (control modedrift) the RAW value again, as all four routes used to read it",
      'export function isOnboardingTestMode() { return String(process.env.ONBOARDING_STRIPE_SECRET_KEY || "").indexOf("sk_test") === 0; }',
    ].join("\n"));
    TEMP.push(path.join(HERE, ".leakprobe-onbkey.mjs"));
  }

  const TEST_KEY = "sk_" + "test_MODE_PROBE_KEY";
  for (const [rel, where] of [
    ["website/checkout.js", "website/checkout.js"],
    ["website/camp-checkout.js", "website/camp-checkout.js"],
    ["onboarding/checkout.js", "onboarding/checkout.js"],
  ]) {
    const SRC = readSource(rel);
    const M = await importTemp(`.leakprobe-mode-${where.replace(/[/.]/g, "-")}.mjs`, [
      // The REAL transport, so the assertion below is on the bytes that actually
      // become the header - not on a stub agreeing with the route.
      'import { stripeFetch as transportStripeFetch } from "./_stripe-transport.js";',
      `import { isOnboardingTestMode, onboardingKeyOverride } from "${ONB_SPEC}";`,
      cut(SRC, "function isTestMode() {", where),
      cut(SRC, 'async function stripeFetch(path, { method = "GET", body, stripeAccount, idempotencyKey } = {}) {', where),
      "export { isTestMode, stripeFetch };\n",
    ].join("\n"));

    for (const [label, dirty] of [
      ["a leading space", ` ${TEST_KEY}`],
      ["a leading newline", `\n${TEST_KEY}`],
      ["a trailing newline", `${TEST_KEY}\n`],
    ]) {
      process.env.ONBOARDING_STRIPE_SECRET_KEY = dirty;
      CALLS = [];
      let t = null;
      try { await M.stripeFetch("/customers?limit=1"); } catch (e) { t = e; }
      const sent = authOf(lastCall());
      ok(M.isTestMode() === true,
        `${where}: isTestMode() is TRUE for a test key with ${label} (saw ${M.isTestMode()})`);
      ok(!t && sent === `Bearer ${TEST_KEY}`,
        `${where}: and the credential actually sent is exactly that trimmed test key (${label}, saw ${JSON.stringify(sent)})`);
      // THE PROPERTY, stated as one thing: whatever the mode check judged IS the
      // credential. Asserting the two agree is the point; asserting each in
      // isolation is how they drifted apart in the first place.
      ok(M.isTestMode() === sent.startsWith("Bearer sk_test"),
        `${where}: the mode decision and the credential AGREE (${label})`);
    }
    delete process.env.ONBOARDING_STRIPE_SECRET_KEY;
    CALLS = [];
    ok(M.isTestMode() === false, `${where}: an unset key is not test mode`);
  }

  // 6b. the helper itself, once, so the property is pinned at its source.
  {
    const K = await import(pathToFileURL(path.resolve(HERE, ONB_SPEC)).href);
    process.env.ONBOARDING_STRIPE_SECRET_KEY = ` ${TEST_KEY}\n`;
    ok(K.isOnboardingTestMode() === true && K.onboardingKeyOverride() === TEST_KEY,
      "the shared helper: one normalized reading answers BOTH the mode and the credential");
    // ── THE ASSERTION THAT WAS WRONG, and the regression it blessed ──────────
    // This used to read: "a whitespace-only value is no credential at all, so it
    // stops overriding rather than sending a blank bearer" - and it PASSED,
    // which is how the fix shipped a payment-path regression under a green tick.
    // Returning undefined does not mean "no override"; it means the transport
    // falls THROUGH to the platform key. A misconfigured test sandbox silently
    // became live money on BAM's own account, with isTestMode() false so the
    // route took its live branches too. An assertion has to change with the code
    // it describes, or it is just the old bug's alibi.
    //
    // ABSENT and SET-TO-NOTHING are different states and are asserted apart.
    for (const [label, v] of [["whitespace only", "   "], ["an empty string", ""], ["a lone newline", "\n"]]) {
      process.env.ONBOARDING_STRIPE_SECRET_KEY = v;
      let credThrew = null, modeThrew = null;
      try { K.onboardingKeyOverride(); } catch (e) { credThrew = e; }
      try { K.isOnboardingTestMode(); } catch (e) { modeThrew = e; }
      ok(!!credThrew && !!modeThrew,
        `a configured-but-empty key (${label}) FAILS LOUDLY on both the credential and the mode - it never falls through to the platform key`);
      const msg = String(credThrew && credThrew.message);
      ok(!!credThrew && /ONBOARDING_STRIPE_SECRET_KEY is set but empty or whitespace only/.test(msg)
        && !hasCanary(msg, SK_HEAD, SK_TAIL) && !msg.includes(CLEAN_SK),
        `and names the variable to fix without carrying any credential material (${label})`);
    }
    delete process.env.ONBOARDING_STRIPE_SECRET_KEY;
    ok(K.onboardingKeyOverride() === undefined && K.isOnboardingTestMode() === false,
      "while ABSENT stays silent and overrides nothing - nobody asked for a sandbox, so the resolver picks normally");
  }

  // 6b-ii. AND WHAT REACHES THE WIRE, through the real transport, because the
  // damage was never in the helper's return value - it was in which account got
  // charged. Driven with a PLATFORM key present and an academy account, exactly
  // the production shape.
  {
    const M = await importTemp(".leakprobe-wire-fallthrough.mjs", [
      'import { stripeFetch as transportStripeFetch } from "./_stripe-transport.js";',
      `import { isOnboardingTestMode, onboardingKeyOverride } from "${ONB_SPEC}";`,
      cut(readSource("website/checkout.js"), "function isTestMode() {", "website/checkout.js"),
      cut(readSource("website/checkout.js"), 'async function stripeFetch(path, { method = "GET", body, stripeAccount, idempotencyKey } = {}) {', "website/checkout.js"),
      "export { isTestMode, stripeFetch };\n",
    ].join("\n"));
    const PLATFORM = "sk_" + "live_PLATFORM_REAL_MONEY";
    const realPlat = process.env.STRIPE_CONNECT_SECRET_KEY;
    process.env.STRIPE_CONNECT_SECRET_KEY = PLATFORM;
    process.env.ONBOARDING_STRIPE_SECRET_KEY = "   ";
    CALLS = [];
    let e = null;
    try { await M.stripeFetch("/customers?limit=1"); } catch (err) { e = err; }
    ok(!!e, "a whitespace-only sandbox key STOPS the request rather than quietly re-aiming it");
    ok(CALLS.length === 0 && !authOf(lastCall()).includes(PLATFORM),
      `and the PLATFORM key never reaches the wire (saw ${CALLS.length} call(s), auth ${JSON.stringify(authOf(lastCall()))})`);
    if (realPlat === undefined) delete process.env.STRIPE_CONNECT_SECRET_KEY; else process.env.STRIPE_CONNECT_SECRET_KEY = realPlat;
    delete process.env.ONBOARDING_STRIPE_SECRET_KEY;
  }

  // 6c. api/parent/_stripe.ts - TypeScript, so PINS, and said plainly.
  // This suite is plain node with no build step; it cannot execute this file.
  // What it can do is prove the file no longer reads the raw env var for either
  // decision, which is the whole content of the fix.
  {
    const TS = readSource("parent/_stripe.ts");
    ok(TS.includes("return isOnboardingTestMode();"),
      "parent/_stripe.ts: isTestMode() reads the shared normalized value (source pin - not executed here)");
    ok(TS.includes("keyOverride: onboardingKeyOverride(),"),
      "parent/_stripe.ts: the keyOverride is that same value (source pin - not executed here)");
  }

  // 6d. and nowhere else silently grew one back. ONE raw read is expected and
  // correct in each file: stripeKey()'s configured-at-all precedence chain,
  // which is a presence gate and never becomes a header. A second one is the
  // defect coming back.
  for (const rel of ["website/checkout.js", "website/camp-checkout.js", "onboarding/checkout.js", "parent/_stripe.ts"]) {
    const code = readSource(rel).replace(/^\s*\/\/.*$/gm, "");
    const raws = (code.match(/process\.env\.ONBOARDING_STRIPE_SECRET_KEY/g) || []).length;
    ok(raws === 1, `${rel}: exactly one raw env read left, the configured-at-all gate in stripeKey() (saw ${raws})`);
  }
}

// ═════════════════════════════════════════════════════════════════════════════
console.log("\n── 7. THE COUNTING SCAN: pins that survive an ADDITION ──");
{
  // WHY THIS SECTION REPLACED FOUR PAGES OF SPELLING PINS. Everything above
  // inspects code that is already there: "this file still has the leaky catch",
  // "this file no longer assigns e.message", "isTestMode reads the helper". Every
  // one of those is beaten by ADDING code rather than changing it -
  //
  //   - append a SECOND probe to health.js that writes checks.supabase_url.detail
  //     from a raw-key fetch: all four wiring pins stay green, the file leaks;
  //   - append any new unguarded raw-key fetch to overview / commissions / ch3:
  //     zero assertions fail, because nothing was counting fetch sites;
  //   - add `if (raw !== raw.trim()) return false;` above parent/_stripe.ts's
  //     `return isOnboardingTestMode();`: the drift is back and every substring
  //     pin passes, because a substring cannot see control flow.
  //
  // So this counts instead. scripts/credential-header-scan.mjs enumerates every
  // line in api/** that builds a credential-bearing header, marks each GUARDED
  // (the value came through api/_header-safe-credential.js) or RAW, and compares
  // the RAW population to a committed manifest. Adding a raw site anywhere moves
  // a number and fails the run.
  const S = await import(pathToFileURL(path.resolve(HERE, "../scripts/credential-header-scan.mjs")).href);
  const byFile = S.scanPortal();

  // MUTATE=scanblind plants THE ADDITION every earlier pin was blind to: a brand
  // new unguarded raw-key fetch APPENDED to a file this task already closed.
  // Nothing existing changes, so every spelling pin in sections 1-6 stays green -
  // the scan has to be what notices. Planted into the scan's INPUT so the ordinary
  // assertions below are the ones that fail; a control with its own private
  // assertion would only be testing the control.
  if (MUTATE === "scanblind") {
    const planted = readSource("health.js") + [
      "",
      "async function secondProbe(url) {",
      "  const r = await fetch(`${url}/rest/v1/staff?select=id`, {",
      "    headers: { apikey: process.env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}` },",
      "  });",
      "  return r.ok;",
      "}",
    ].join("\n");
    byFile.set("api/health.js", S.scanFile("api/health.js", planted));
  }
  const sum = S.summarize(byFile);
  const manifestText = fs.readFileSync(S.MANIFEST, "utf8");

  console.log(`  (scan: ${sum.sites} credential header site(s) across ${sum.files} file(s) - ${sum.guarded} guarded, ${sum.rawSites} raw)`);
  ok(sum.sites > 400, `the scan actually found the population it is supposed to police (saw ${sum.sites} site(s))`);
  ok(S.checkAgainstManifest(byFile, manifestText).length === 0,
    "every raw credential header site matches the committed manifest - no new unguarded site, no stale line");

  // THE FILES THIS TASK CLOSED must be at ZERO raw sites, and that is a count,
  // not a spelling. Appending a new unguarded fetch to any of them breaks this.
  const CLOSED = [
    "api/health.js", "api/stripe/overview.js", "api/commissions.js",
    "api/website/checkout.js", "api/website/camp-checkout.js", "api/website/ch3-checkout.js",
    "api/asana/tasks.js", "api/notion/query.js",
  ];
  for (const rel of CLOSED) {
    const sites = byFile.get(rel) || [];
    const raw = sites.filter((s) => !s.guarded);
    ok(sites.length > 0 && raw.length === 0,
      `${rel}: ${sites.length} credential header site(s), ALL guarded (raw: ${raw.map((r) => r.line).join(",") || "none"})`);
  }

  // A file that is not on the manifest and has no raw site is the only clean
  // state; assert the manifest never lists a closed file (a leftover line would
  // quietly re-permit it).
  const listed = S.parseManifest(manifestText).counts;
  ok(CLOSED.every((r) => !listed.has(r)),
    "and none of them is still carried on the manifest as a known-raw file");
}

// ═════════════════════════════════════════════════════════════════════════════
console.log("\n── 8. the sanitiser's own belt: nothing the runtime wrote gets through ──");
{
  // DEFECT: describeFetchFailure allowlisted e.cause.code and passed e.name
  // through raw, while the comment above it claimed the discipline for the whole
  // function. e.name is writable, so anything reaching that catch could name
  // itself a credential and be printed.
  const HS = await import(pathToFileURL(path.join(HERE, HELPER_SPEC.replace("./", ""))).href);
  // NO newline in this one, deliberately. A hostile name containing a break is
  // rejected by ANY of these regexes, so testing that would prove nothing about
  // the allowlist. THE REAL GAP is a credential-shaped name with no break at all:
  // sk_live_ABC_DEF is exactly [A-Za-z][A-Za-z0-9_]*, which the first version of
  // this allowlist accepted while looking careful.
  const hostile = new Error("boom");
  hostile.name = `${SK_HEAD}_${SK_TAIL}`;
  const outName = HS.describeFetchFailure(hostile, "Stripe");
  ok(!hasCanary(outName, SK_HEAD, SK_TAIL),
    `a credential-shaped e.name with NO line break is still dropped (saw ${JSON.stringify(outName)})`);
  const broken = new Error("boom");
  broken.name = `${SK_HEAD}\n${SK_TAIL}`;
  ok(!hasCanary(HS.describeFetchFailure(broken, "Stripe"), SK_HEAD, SK_TAIL),
    "and so is one that does contain a break");

  const hostileCode = new Error("boom");
  hostileCode.cause = { code: `${SK_HEAD}_${SK_TAIL}` };
  ok(!hasCanary(HS.describeFetchFailure(hostileCode, "Stripe"), SK_HEAD, SK_TAIL),
    "and so is a hostile cause.code");

  // A THROWING GETTER escapes the guard's own catch as a different error - a
  // leak through the exit door of the leak guard.
  const booby = {};
  Object.defineProperty(booby, "name", { get() { throw new Error(`${SK_HEAD}\n${SK_TAIL}`); } });
  Object.defineProperty(booby, "cause", { get() { throw new Error("nope"); } });
  let described = null, threw = null;
  try { described = HS.describeFetchFailure(booby, "Stripe"); } catch (e) { threw = e; }
  ok(!threw, `reading a throwing property does not escape as a new error (saw ${threw ? String(threw.message).slice(0, 40) : "no throw"})`);
  ok(!hasCanary(String(described), SK_HEAD, SK_TAIL), "and nothing it carried is printed");

  // A NORMAL error still says something useful, or the sanitiser is just a mute.
  const dns = Object.assign(new Error("getaddrinfo"), { name: "TypeError", cause: { code: "ENOTFOUND" } });
  ok(/TypeError/.test(HS.describeFetchFailure(dns, "Supabase")) && /ENOTFOUND/.test(HS.describeFetchFailure(dns, "Supabase")),
    `an ordinary failure still reports its name and code (saw ${JSON.stringify(HS.describeFetchFailure(dns, "Supabase"))})`);

  // MISSING IS ITS OWN ANSWER, not a blank bearer.
  for (const [label, v] of [["undefined", undefined], ["null", null], ["empty", ""], ["whitespace", "  \n "]]) {
    let e = null;
    try { HS.assertHeaderSafeCredential(v, "the probe key (PROBE_KEY)"); } catch (err) { e = err; }
    ok(!!e && e.credentialMissing === true && /not configured/.test(String(e.message)),
      `a ${label} credential is refused as NOT CONFIGURED rather than becoming "Bearer " (saw ${e ? JSON.stringify(e.message) : "no error"})`);
  }
}

// ═════════════════════════════════════════════════════════════════════════════
console.log("\n── 9. a guard that throws must never escape a handler ──");
{
  // THE CLASS, not the two instances. Adding a credential guard turns a silent
  // bad-credential path into a throw, which is the point - but a throw raised
  // where nothing catches it does not fail closed, it CRASHES the function:
  // withSentryApiRoute captures and rethrows, Vercel answers
  // FUNCTION_INVOCATION_FAILED with no body, and Sentry takes an event per
  // request. A route that answered 401 cleanly now answers nothing.
  //
  // This change shipped that shape THREE times - the onboarding key, the
  // not-configured refusal, and verifyStaffForImport / requireStaff - which is
  // why it is now a check instead of a promise to remember.
  const S = await import(pathToFileURL(path.resolve(HERE, "../scripts/credential-header-scan.mjs")).href);
  let escapes = S.scanPortalEscapes();

  if (MUTATE === "handlerescape") {
    // Put verifyStaffForImport back ABOVE the try, exactly as it shipped.
    const src = readSource("asana/tasks.js");
    const planted = src.replace(`  let me;
  try {
    me = await verifyStaffForImport(req);
  } catch (e) {`, `  const me = await verifyStaffForImport(req);
  if (!me) return res.status(401).json({ error: "unauthorized" });
  try {
    if (false) {`);
    if (planted === src) { console.log("❌ NEGATIVE CONTROL FAILED: the handlerescape pin moved."); process.exit(1); }
    escapes = escapes.concat(S.handlerEscapes("api/asana/tasks.js", planted));
  }

  ok(escapes.length === 0,
    `no credential guard can throw from outside a handler's try (${escapes.length} escape(s)${escapes.length ? ": " + escapes.slice(0, 3).map((e) => `${e.rel}:${e.line} in ${e.entry}()`).join(", ") : ""})`);
}

// ─── report ──────────────────────────────────────────────────────────────────
console.log("");
if (MUTATE) {
  if (controlBroken) { console.log(`❌ NEGATIVE CONTROL FAILED: ${controlBroken}`); process.exit(1); }
  const caught = fail > 0;
  console.log(caught
    ? `✅ NEGATIVE CONTROL PASSED: MUTATE=${MUTATE} was caught by ${fail} assertion(s):\n   - ${failures.slice(0, 5).join("\n   - ")}`
    : `❌ NEGATIVE CONTROL FAILED: MUTATE=${MUTATE} reverted a real fix and every assertion still passed. That check is decorative.`);
  process.exit(caught ? 0 : 1);
}
console.log(fail ? `❌ ${pass} passed, ${fail} failed.` : `✅ ${pass} passed, 0 failed.`);
process.exit(fail ? 1 : 0);
