// THE ONE SEAM: api/_stripe-transport.js routes every Stripe call to the right
// credential, and NOTHING downstream may ever ask which one it got.
//
//   node api/_stripe-transport.test.mjs
//
// WHAT THIS PROVES
//   1. ENVELOPE SELECTION, the whole point of the resolver:
//        - stripeAccount null      -> platform key, NO Stripe-Account header,
//                                     byte-identical to today. This is the
//                                     test-mode path and must NEVER route to an
//                                     academy key, even while direct rows exist.
//        - acct with a direct row  -> the academy's decrypted key, NO header.
//        - acct without one        -> platform key + Stripe-Account header
//                                     (today's Connect behavior, untouched).
//        - keyOverride             -> short-circuits everything; header behavior
//                                     stays exactly as the caller intended.
//   2. The reverse-lookup cache: one Supabase read per account per TTL,
//      bustTransportCache() forces a re-read, and the TTL actually expires.
//   3. Body encoding matches the helpers this module replaces byte for byte:
//      object -> urlencoded with flat "items[0][price]" keys and null/undefined
//      dropped; a pre-encoded STRING passes through as-is (the api/members.js
//      quirk); no body -> no body and no Content-Type.
//   4. The error is the SUPERSET of both existing shapes - message, stripeStatus,
//      stripeResponse, responseBody (alias), transportLabel - so every current
//      consumer reads what it already reads.
//   5. THE KEY NEVER LEAKS, in EITHER kind of error. Not in one this module
//      constructs, and not in one the RUNTIME throws - the second half is where
//      the leak actually lived. A key pasted with a line break in the middle of
//      it survives .trim(), passes every rk_live_ check, and makes undici throw
//      a TypeError quoting the whole key with no .status, which a route echoes
//      to the browser. The probe drives \n, \r and \x00 through the real code
//      path and asserts on a TWO-PART canary, so a "fix" that scrubs the
//      message for rk_live_[A-Za-z0-9]* - which stops at the break and leaves
//      the tail on screen - fails here instead of shipping. It also covers the
//      RETURN path: readAccountHealth must not hand an unusable key to
//      _requirements.js, whose reason string ends up in a JSON response body.
//      This is the property that makes storing other people's payment
//      credentials tolerable at all.
//   5b. TRIM FIRST, THEN REFUSE. Leading/trailing whitespace is a cosmetic
//      artifact of how a value was stored or pasted (`echo` instead of `printf`
//      into a secret store leaves a \n on the end - production's
//      SUPABASE_SERVICE_KEY carries exactly that today). It is trimmed and USED,
//      and the trimmed value is the one that reaches the header. Only a
//      non-printable character REMAINING INSIDE the value after the trim is the
//      leak vector, and that is still refused. The first version of this guard
//      refused both, which turned an env-storage artifact into a live academy
//      reading "unreachable".
//   6. publishableFor / getCapabilities answer per-transport facts so no caller
//      ever needs to know the transport.
//   7. readAccountHealth: three outcomes over the right transport, with the two
//      side effects - a credential problem flips the row to 'invalid', a key
//      that answers stamps key_last_verified_at and self-heals 'invalid' back
//      to 'active'. A NETWORK failure does neither.
//
// WHAT IT DOES NOT PROVE
//   - That any real academy row decrypts (no database here - fetch and Supabase
//     are both in-memory stubs).
//   - That call sites actually route through this module. That is the one-doorway
//     parity scan's job, which is a separate suite.
//
// ─────────────────────────────────────────────────────────────────────────────
// NEGATIVE CONTROLS. Each breaks one thing; the suite must print
// NEGATIVE CONTROL PASSED:
//
//   MUTATE=nullroute  node api/_stripe-transport.test.mjs
//       a null stripeAccount starts consulting the direct-key table - the exact
//       "test-mode call billed an academy" failure the null-semantics rule bans.
//   MUTATE=keyleak    node api/_stripe-transport.test.mjs
//       the decrypted key is appended to the thrown error message - the leak
//       assertions must notice.
//   MUTATE=noshapecheck  node api/_stripe-transport.test.mjs
//       the printable-ASCII refusal is deleted, so a key with a line break in
//       it reaches the runtime again. The belt (the sanitiser around fetch)
//       still holds the canary out of the error, so what catches this is the
//       REFUSAL half of section 7 - the 400 and the re-copy sentence - not the
//       canary half. Said plainly because a control whose report is vague is
//       how a decorative check survives.
//   MUTATE=notrim     node api/_stripe-transport.test.mjs
//       the trim is removed, so the shape check judges the RAW value again and
//       a key whose only sin is a trailing newline is refused - the regression
//       this fix repairs. Section 8's trailing/leading-whitespace assertions
//       must catch it, or the trim is decorative.
//   MUTATE=rawruntime    node api/_stripe-transport.test.mjs
//       BOTH layers deleted - the refusal and the fetch sanitiser - so the
//       runtime's own TypeError, quoting the entire Authorization header,
//       propagates exactly as it does in production today. This is the control
//       that proves the two-part canary assertions are alive.
//
// A control run exits ZERO when the mutation IS caught (the suite is reporting
// "the control worked"). CI greps for the banner, not the exit code.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const MUTATE = process.env.MUTATE || "";
const HERE = path.dirname(fileURLToPath(import.meta.url));

// ── env, BEFORE the module import ────────────────────────────────────────────
process.env.STRIPE_DIRECT_ENC_KEY = "suite-enc-key-not-a-real-one";
process.env.SUPABASE_URL = "https://stub.supabase.test";
process.env.VITE_SUPABASE_URL = "https://stub.supabase.test";
process.env.SUPABASE_SERVICE_ROLE_KEY = "stub-service-key";
process.env.STRIPE_CONNECT_SECRET_KEY = "sk_live_platform_stub_key";
delete process.env.STRIPE_SECRET_KEY;
process.env.STRIPE_PUBLISHABLE_KEY = "pk_live_platform_stub";

let pass = 0, fail = 0;
const failures = [];
let controlBroken = null;
const ok = (cond, label) => {
  if (cond) { pass++; console.log("  ✅ " + label); }
  else { fail++; failures.push(label); console.log("  ❌ " + label); }
};

// ── console capture, for the leak assertions ─────────────────────────────────
// Everything the suite (and the module under test) prints is teed into this
// buffer; the last section asserts the decrypted key is not in it.
let consoleBuffer = "";
for (const m of ["log", "info", "warn", "error", "debug"]) {
  const real = console[m].bind(console);
  console[m] = (...args) => { consoleBuffer += args.map(String).join(" ") + "\n"; real(...args); };
}

// ── importing the module (real file, or a pinned mutant copy) ────────────────
const tmpFiles = [];
const cleanup = () => { for (const f of tmpFiles) { try { fs.unlinkSync(f); } catch (_) { /* best effort */ } } };
process.on("exit", cleanup);

function mutatedCopy(edits) {
  let src = fs.readFileSync(path.join(HERE, "_stripe-transport.js"), "utf8");
  for (const [find, repl] of edits) {
    if (!src.includes(find)) {
      controlBroken = `MUTATE=${MUTATE} is pinned to text that is no longer in api/_stripe-transport.js:\n\n${find}\n\nRe-point it or delete it - a pin that fails to apply looks exactly like a check that passed.`;
      throw new Error(controlBroken);
    }
    src = src.split(find).join(repl);
  }
  const copy = path.join(HERE, ".mutant-stripe-transport.js");
  fs.writeFileSync(copy, src);
  tmpFiles.push(copy);
  return copy;
}

const NULLROUTE = [[
  `  if (!stripeAccount) return { bearer: platformKey(), accountHeader: null, label: "platform" };`,
  `  if (!stripeAccount) {
    const rows = await sb(\`client_stripe_direct?status=eq.active&select=\${DIRECT_SELECT}&limit=1\`);
    const row = Array.isArray(rows) && rows[0] ? rows[0] : null;
    if (row) return { bearer: decryptSecret(row.secret_key_enc), accountHeader: null, label: "platform" };
    return { bearer: platformKey(), accountHeader: null, label: "platform" };
  }`]];
const KEYLEAK = [[
  "    const err = new Error((json && json.error && json.error.message) || `Stripe ${res.status}`);",
  "    const err = new Error(((json && json.error && json.error.message) || `Stripe ${res.status}`) + ` via key ${t.bearer}`);"]];

// Removes the printable-ASCII refusal, so a pasted key with a line break in it
// reaches the runtime again.
//
// BE PRECISE ABOUT WHAT THIS PROVES. The fetch sanitiser (the belt) is still in
// place in this mutant, so it still keeps the canary out of the error - the
// leak assertions stay green and it is the REFUSAL assertions (status 400, the
// re-copy sentence, nothing hitting the wire) that catch it. That is the honest
// result: this control shows the refusal is load-bearing, not decorative.
// MUTATE=rawruntime is the control that proves the canary assertions themselves
// are alive.
const NOSHAPECHECK = [[
  "  const bearer = assertHeaderSafeKey(t.bearer);",
  "  const bearer = t.bearer; // (control noshapecheck) the printable-ASCII refusal was removed"]];

// Puts back the pre-fix behaviour: check the RAW value instead of the trimmed
// one, so a key whose only sin is a trailing newline is refused all over again.
// That is the regression this fix exists for - production's SUPABASE_SERVICE_KEY
// carries exactly that newline, and refusing it turned a cosmetic env artifact
// into "unreachable" for a live academy. The trailing/leading-whitespace
// assertions must catch this; if they do not, the trim is decorative.
const NOTRIM = [
  ["  const normalized = normalizeKey(key);", "  const normalized = String(key); // (control notrim) trim removed"],
  ["  const serviceKey = rawServiceKey ? normalizeKey(rawServiceKey) : rawServiceKey;",
   "  const serviceKey = rawServiceKey; // (control notrim) trim removed"],
  ["  const storedKey = normalizeKey(decryptSecret(direct.secret_key_enc));",
   "  const storedKey = String(decryptSecret(direct.secret_key_enc) || \"\"); // (control notrim) trim removed"],
  ["    const pk = rawPk ? normalizeKey(rawPk) : rawPk;", "    const pk = rawPk; // (control notrim) trim removed"],
];

// Removes BOTH layers - the refusal AND the sanitiser wrapped around fetch - so
// the runtime's own TypeError propagates to the caller exactly as it does in
// production today: a message quoting the entire Authorization header, no
// .status, and a route that echoes it. This is the control that makes the
// two-part canary assertions earn their keep. If they were decorative, or if
// someone "fixed" the leak by regex-scrubbing rk_live_[A-Za-z0-9]* (which stops
// at the line break and leaves the tail on screen), this control would pass.
const RAWRUNTIME = [
  ["  const bearer = assertHeaderSafeKey(t.bearer);", "  const bearer = t.bearer; // (control rawruntime) the refusal was removed"],
  [`async function safeFetch(url, init, what) {
  try {
    return await fetch(url, init);
  } catch (e) {
    throw sanitizeFetchError(e, what);
  }
}`,
   `async function safeFetch(url, init, what) {
  return await fetch(url, init); // (control rawruntime) sanitiser removed
}`],
];
const EDITS = { nullroute: NULLROUTE, keyleak: KEYLEAK, noshapecheck: NOSHAPECHECK, rawruntime: RAWRUNTIME, notrim: NOTRIM };

const modulePath = MUTATE
  ? mutatedCopy(EDITS[MUTATE] || (() => { controlBroken = `unknown control MUTATE=${MUTATE}`; throw new Error(controlBroken); })())
  : path.join(HERE, "_stripe-transport.js");

// ── the in-memory world ──────────────────────────────────────────────────────
const DIRECT_KEY = "rk_live_supersecret_academy_key_9Xq7";

// TWO-PART CANARY, split the way a real paste is. The break lands in the MIDDLE
// of the key, so a "fix" that scrubs an error message for rk_live_[A-Za-z0-9]*
// stops dead at the break and leaves CANARY_TAIL - a recoverable piece of a
// LIVE credential - on screen. Every leak assertion below checks BOTH halves,
// which is what makes truncation fail here rather than pass here and leak in
// production. Neither half may appear in any label printed by this suite.
const CANARY_HEAD = "rk_live_FAKE_CANARY";
const CANARY_TAIL = "SECOND_LINE_TAIL";
const { encryptSecret, decryptSecret } = await import(pathToFileURL(path.join(HERE, "_stripe-direct-crypto.js")).href);

const DB = {
  client_stripe_direct: [{
    client_id: "client-direct", status: "active",
    secret_key_enc: encryptSecret(DIRECT_KEY), secret_key_last4: "9Xq7",
    publishable_key: "pk_live_academy_own", stripe_account_id: "acct_direct",
    capabilities: { customers: true, payouts: false }, key_last_verified_at: null,
  }],
  clients: [
    { id: "client-direct", stripe_connect_account_id: "acct_direct", stripe_connect_status: "connected" },
    { id: "client-connect", stripe_connect_account_id: "acct_connect", stripe_connect_status: "connected" },
  ],
};

function runQuery(table, qs) {
  const p = new URLSearchParams(qs);
  let rows = DB[table] || [];
  for (const [k, v] of p.entries()) {
    if (["select", "order", "limit", "offset", "on_conflict"].includes(k)) continue;
    const s = String(v);
    if (s.startsWith("eq.")) { const val = s.slice(3); rows = rows.filter(r => String(r[k] == null ? "" : r[k]) === val); }
    else if (s.startsWith("in.(")) { const vals = s.slice(4, -1).split(","); rows = rows.filter(r => vals.includes(String(r[k]))); }
  }
  const lim = parseInt(p.get("limit") || "0", 10);
  return lim > 0 ? rows.slice(0, lim) : rows;
}

const SB_GETS = [];       // supabase GET paths
const SB_CALLS = [];      // { method, url, headers } - section 8 reads the service-key header off these
const SB_PATCHES = [];    // { table, qs, body }
const STRIPE_CALLS = [];  // { method, url, headers, body }
// (status, jsonOrThrow) per-call override for stripe responses
let stripeResponder = null;

globalThis.fetch = async (url, init = {}) => {
  const u = String(url);
  const method = String(init.method || "GET").toUpperCase();
  // THE STUB VALIDATES HEADERS LIKE THE RUNTIME DOES, or the leak this suite
  // exists to catch cannot happen inside it. Real fetch builds a Headers object
  // out of init.headers, and undici's validator throws a TypeError QUOTING the
  // whole offending header value - live key and all. This is that same
  // validator, called at the same point in the sequence, so section 7 drives
  // the actual production failure instead of a story about it. Without this
  // line a stub simply accepts a key with a line break in it and every leak
  // assertion below passes for the wrong reason.
  new Headers(init.headers || {});
  const json = (v, status = 200) => new Response(JSON.stringify(v), { status, headers: { "content-type": "application/json" } });

  if (u.startsWith("https://api.stripe.com/")) {
    STRIPE_CALLS.push({ method, url: u, headers: init.headers || {}, body: init.body });
    if (stripeResponder) {
      const r = stripeResponder(method, u, init);
      if (r === "network") throw new Error("socket hang up (stub)");
      if (r) return json(r.body, r.status);
    }
    return json({ ok_stub: true });
  }
  if (u.startsWith("https://stub.supabase.test/rest/v1/")) {
    SB_CALLS.push({ method, url: u, headers: init.headers || {} });
    const [table, qs = ""] = u.slice("https://stub.supabase.test/rest/v1/".length).split("?");
    if (method === "GET") { SB_GETS.push(`${table}?${qs}`); return json(runQuery(table, qs)); }
    if (method === "PATCH") {
      const body = init.body ? JSON.parse(init.body) : {};
      SB_PATCHES.push({ table, qs, body });
      const keys = new Set(runQuery(table, qs).map(r => r.client_id ?? r.id));
      for (const r of DB[table] || []) if (keys.has(r.client_id ?? r.id)) Object.assign(r, body);
      return json([]);
    }
    return json([]);
  }
  throw new Error(`UNSTUBBED CALL: ${method} ${u}`);
};

const T = await import(pathToFileURL(modulePath).href);
const authOf = (call) => String((call.headers || {}).Authorization || "");
const acctHeaderOf = (call) => (call.headers || {})["Stripe-Account"];
const lastStripe = () => STRIPE_CALLS[STRIPE_CALLS.length - 1];

// ═════════════════════════════════════════════════════════════════════════════
console.log("\n── 1. envelope selection: the resolver, and only the resolver, knows ──");
{
  // null -> platform. Asserted WHILE an active direct row exists in the table,
  // because that is the exact situation the null-semantics rule exists for.
  await T.stripeFetch("/customers?limit=1");
  ok(authOf(lastStripe()) === "Bearer sk_live_platform_stub_key",
    "stripeAccount null uses the PLATFORM key even while an active direct row exists");
  ok(acctHeaderOf(lastStripe()) === undefined, "and sends no Stripe-Account header");

  await T.stripeFetch("/customers?limit=1", { stripeAccount: "acct_direct" });
  ok(authOf(lastStripe()) === `Bearer ${DIRECT_KEY}`,
    "a direct account's call carries the academy's own decrypted key");
  ok(acctHeaderOf(lastStripe()) === undefined,
    "with NO Stripe-Account header - the key IS the account");

  await T.stripeFetch("/customers?limit=1", { stripeAccount: "acct_connect" });
  ok(authOf(lastStripe()) === "Bearer sk_live_platform_stub_key",
    "an account with no direct row keeps today's platform key");
  ok(acctHeaderOf(lastStripe()) === "acct_connect", "plus the Stripe-Account header, unchanged");

  await T.stripeFetch("/account", { keyOverride: "rk_live_probe_override" });
  ok(authOf(lastStripe()) === "Bearer rk_live_probe_override" && acctHeaderOf(lastStripe()) === undefined,
    "keyOverride short-circuits the resolver; no stripeAccount means no header");
  await T.stripeFetch("/account", { keyOverride: "sk_test_onboarding", stripeAccount: "acct_x" });
  ok(authOf(lastStripe()) === "Bearer sk_test_onboarding" && acctHeaderOf(lastStripe()) === "acct_x",
    "keyOverride + stripeAccount keeps the header exactly as the caller intended");
}

console.log("\n── 2. the cache: one lookup per account per minute, bustable, expiring ──");
{
  const lookups = () => SB_GETS.filter(g => g.startsWith("client_stripe_direct?stripe_account_id=eq.acct_direct")).length;
  const before = lookups();
  await T.stripeFetch("/x", { stripeAccount: "acct_direct" });
  await T.stripeFetch("/x", { stripeAccount: "acct_direct" });
  ok(lookups() === before, "repeat calls inside the TTL re-read nothing (section 1 already cached it)");

  T.bustTransportCache();
  await T.stripeFetch("/x", { stripeAccount: "acct_direct" });
  ok(lookups() === before + 1, "bustTransportCache() forces the next call to re-read the row");

  const realNow = Date.now;
  Date.now = () => realNow() + 61_000;
  try {
    await T.stripeFetch("/x", { stripeAccount: "acct_direct" });
    ok(lookups() === before + 2, "and the TTL itself expires after 60s");
  } finally { Date.now = realNow; }
}

console.log("\n── 3. body encoding, byte for byte the helpers this replaces ──");
{
  await T.stripeFetch("/subscription_items", {
    method: "POST",
    body: { "items[0][price]": "price_abc", quantity: 2, drop_me: null, and_me: undefined },
  });
  const sent = new URLSearchParams(String(lastStripe().body));
  ok(sent.get("items[0][price]") === "price_abc" && sent.get("quantity") === "2",
    "object bodies urlencode with flat nested-string keys, values stringified");
  ok(!sent.has("drop_me") && !sent.has("and_me"), "null and undefined values are dropped");
  ok((lastStripe().headers["Content-Type"] || "") === "application/x-www-form-urlencoded",
    "with the urlencoded Content-Type");

  const pre = "enabled_events[0]=invoice.paid&url=https%3A%2F%2Fx.test";
  await T.stripeFetch("/webhook_endpoints", { method: "POST", body: pre });
  ok(lastStripe().body === pre, "a pre-encoded STRING body passes through untouched (members.js quirk)");

  await T.stripeFetch("/customers?limit=1");
  ok(lastStripe().body === undefined && lastStripe().headers["Content-Type"] === undefined,
    "no body means no body and no Content-Type");

  await T.stripeFetch("/refunds", { method: "POST", body: { charge: "ch_1" }, idempotencyKey: "idem-123" });
  ok(lastStripe().headers["Idempotency-Key"] === "idem-123", "Idempotency-Key is sent when given");
}

console.log("\n── 4. the error shape: a superset of BOTH existing shapes ──");
let caughtDirectError = null;
{
  stripeResponder = () => ({ status: 402, body: { error: { message: "Your card was declined.", code: "card_declined" } } });
  try {
    await T.stripeFetch("/charges", { method: "POST", body: { amount: 100 }, stripeAccount: "acct_direct" });
    ok(false, "a Stripe error throws");
  } catch (e) {
    caughtDirectError = e;
    ok(e.message === "Your card was declined.", "message comes from Stripe's own sentence");
    ok(e.stripeStatus === 402, "stripeStatus carries the HTTP status (members.js shape)");
    ok(!!e.stripeResponse && e.stripeResponse.error.code === "card_declined",
      "stripeResponse carries the parsed body (members.js shape)");
    ok(e.responseBody === e.stripeResponse, "responseBody is an alias of it (parent/_stripe.ts shape)");
    ok(e.transportLabel === "direct:acct_direct", "transportLabel names the envelope, for diagnostics");
  }
  try {
    await T.stripeFetch("/charges", { stripeAccount: "acct_connect" });
  } catch (e) {
    ok(e.transportLabel === "connect:acct_connect", "a connect call is labelled connect");
  }
  try {
    await T.stripeFetch("/charges");
  } catch (e) {
    ok(e.transportLabel === "platform", "a platform call is labelled platform");
  }
  stripeResponder = null;
}

console.log("\n── 5. per-transport facts, so no caller ever needs to ask ──");
{
  ok(JSON.stringify(await T.publishableFor("acct_direct")) === JSON.stringify({ publishable_key: "pk_live_academy_own", stripe_account: null }),
    "publishableFor(direct): the academy's own pk, and stripe_account null");
  ok(JSON.stringify(await T.publishableFor("acct_connect")) === JSON.stringify({ publishable_key: "pk_live_platform_stub", stripe_account: "acct_connect" }),
    "publishableFor(connect): the platform pk plus the connected account");
  ok(JSON.stringify(await T.publishableFor(null)) === JSON.stringify({ publishable_key: "pk_live_platform_stub", stripe_account: null }),
    "publishableFor(null): platform pk, no account");
  ok(JSON.stringify(await T.getCapabilities("acct_direct")) === JSON.stringify({ customers: true, payouts: false }),
    "getCapabilities(direct) returns the stored probe results");
  ok((await T.getCapabilities("acct_connect")) === null, "and null for a connect account");
}

console.log("\n── 6. readAccountHealth: three outcomes, right transport, right side effects ──");
{
  const patches = () => SB_PATCHES.filter(p => p.table === "client_stripe_direct");

  // ready, via the KEY (GET /v1/account, not /v1/accounts/{id})
  stripeResponder = (m, u) => u === "https://api.stripe.com/v1/account"
    ? { status: 200, body: { id: "acct_direct", charges_enabled: true, details_submitted: true, requirements: {} } } : null;
  let h = await T.readAccountHealth("client-direct");
  ok(h.outcome === "ready", "a chargeable direct account reads as ready");
  const keyRead = STRIPE_CALLS[STRIPE_CALLS.length - 1];
  ok(keyRead.url === "https://api.stripe.com/v1/account" && authOf(keyRead) === `Bearer ${DIRECT_KEY}` && acctHeaderOf(keyRead) === undefined,
    "read via GET /v1/account with the academy key and no Stripe-Account header");
  ok(patches().some(p => p.body.key_last_verified_at), "and key_last_verified_at is stamped");

  // self-heal: an 'invalid' row whose key answers goes back to 'active'
  DB.client_stripe_direct[0].status = "invalid";
  h = await T.readAccountHealth("client-direct");
  ok(h.outcome === "ready" && DB.client_stripe_direct[0].status === "active",
    "an 'invalid' row whose key answers self-heals to 'active'");

  // not_ready with reasons
  stripeResponder = (m, u) => u === "https://api.stripe.com/v1/account"
    ? { status: 200, body: { id: "acct_direct", charges_enabled: false, details_submitted: true, requirements: { currently_due: ["external_account"], disabled_reason: "requirements.past_due" } } } : null;
  h = await T.readAccountHealth("client-direct");
  ok(h.outcome === "not_ready" && h.needs.length === 1 && /bank account/i.test(h.needs[0].label),
    "not_ready carries WHY, through the same describers as Connect");

  // credential problem: 401 flips the row to 'invalid'
  stripeResponder = (m, u) => u === "https://api.stripe.com/v1/account"
    ? { status: 401, body: { error: { message: "Invalid API Key provided" } } } : null;
  h = await T.readAccountHealth("client-direct");
  ok(h.outcome === "unreachable" && h.credential_problem === true,
    "a 401 is unreachable PLUS credential_problem - the key is dead, not the network");
  ok(/cannot answer/.test(String(h.error)), "and the reason says the KEY cannot answer");
  ok(DB.client_stripe_direct[0].status === "invalid", "side effect: the row is flipped to 'invalid'");
  // Captured for the drift pin further down: this is the REAL shape
  // api/stripe/_requirements.js hands back for a credential problem.
  const CRED_PROBLEM_SHAPE = Object.keys(h).sort().join(",");

  // network failure: unreachable, NO credential_problem, row untouched
  DB.client_stripe_direct[0].status = "active";
  const patchCount = patches().length;
  stripeResponder = (m, u) => u === "https://api.stripe.com/v1/account" ? "network" : null;
  h = await T.readAccountHealth("client-direct");
  ok(h.outcome === "unreachable" && !("credential_problem" in h),
    "a network failure is plain unreachable - credential_problem is ABSENT");
  ok(DB.client_stripe_direct[0].status === "active" && patches().length === patchCount,
    "and writes nothing - a blip must never invalidate a working key");

  // THE DISABLE RACE. Staff turn the key off between the health read's SELECT
  // and its PATCH. Both patches re-filter on status=in.(active,invalid), so the
  // late write must match NOTHING - a health read must never re-arm a key.
  DB.client_stripe_direct[0].status = "invalid";  // selected as probe-able...
  stripeResponder = (m, u) => {
    if (u !== "https://api.stripe.com/v1/account") return null;
    DB.client_stripe_direct[0].status = "disabled";  // ...staff disable lands mid-read
    return { status: 200, body: { id: "acct_direct", charges_enabled: true, details_submitted: true, requirements: {} } };
  };
  h = await T.readAccountHealth("client-direct");
  ok(h.outcome === "ready" && DB.client_stripe_direct[0].status === "disabled",
    "a staff disable landing mid-health-read is never overwritten by the self-heal");
  // Same race, the other write: the credential-problem 'invalid' stamp.
  DB.client_stripe_direct[0].status = "active";
  stripeResponder = (m, u) => {
    if (u !== "https://api.stripe.com/v1/account") return null;
    DB.client_stripe_direct[0].status = "disabled";
    return { status: 401, body: { error: { message: "Invalid API Key provided" } } };
  };
  h = await T.readAccountHealth("client-direct");
  ok(h.outcome === "unreachable" && DB.client_stripe_direct[0].status === "disabled",
    "nor by the credential-problem 'invalid' stamp");
  ok(patches().every(p => p.qs.includes("status=in.(active,invalid)")),
    "every health-read patch carries the status filter, so 'disabled' is out of reach by construction");
  DB.client_stripe_direct[0].status = "active";
  stripeResponder = null;

  // ── THE OTHER MOUTH OF THE LEAK: the RETURN path, not the throw path ───────
  // readAccountHealth hands its key to api/stripe/_requirements.js, whose catch
  // folds a fetch failure into `could not reach Stripe: ${e.message}` and
  // RETURNS it - and api/stripe/direct-key.js's status action puts that string
  // straight into the JSON it sends the browser. So a key that cannot be a
  // header value would arrive in a response body without ever being thrown, and
  // no amount of care in a catch block would catch it. Both keys are checked
  // before they are handed over.
  {
    const realEnc = DB.client_stripe_direct[0].secret_key_enc;
    DB.client_stripe_direct[0].secret_key_enc = encryptSecret(`${CANARY_HEAD}\n${CANARY_TAIL}`);
    DB.client_stripe_direct[0].status = "active";
    T.bustTransportCache();
    const wireBefore = STRIPE_CALLS.length;
    const broken = await T.readAccountHealth("client-direct");
    const dump = JSON.stringify(broken);
    ok(broken.outcome === "unreachable" && broken.credential_problem === true,
      "a STORED key with an embedded break reads unreachable + credential_problem");
    ok(!dump.includes(CANARY_HEAD) && !dump.includes(CANARY_TAIL),
      "and NEITHER canary half is anywhere in the health object the status action returns");
    ok(STRIPE_CALLS.length === wireBefore, "it never reached the wire");
    ok(DB.client_stripe_direct[0].status === "invalid",
      "and the row flips to 'invalid' - a key that cannot be sent must stop routing");
    // DRIFT PIN. That unreachable object is BUILT in _stripe-transport.js
    // rather than imported, because _requirements.js keeps its builder private.
    // If the two shapes ever diverge, callers reading .needs / .problems break
    // on a path nobody exercises by hand - so the shapes are compared, here,
    // against a real credential-problem result from the real function.
    ok(Object.keys(broken).sort().join(",") === CRED_PROBLEM_SHAPE,
      `the built unreachable object matches the shape _requirements.js returns (saw ${Object.keys(broken).sort().join(",")})`);

    // Our OWN key, same failure: a platform secret with a trailing newline (the
    // `echo` instead of `printf` classic when setting a secret) would be quoted
    // by the runtime and returned in the health object of every CONNECT academy.
    DB.client_stripe_direct[0].secret_key_enc = realEnc;
    DB.client_stripe_direct[0].status = "active";
    T.bustTransportCache();
    const realPlatform = process.env.STRIPE_CONNECT_SECRET_KEY;
    process.env.STRIPE_CONNECT_SECRET_KEY = `sk_live_${CANARY_HEAD}\n${CANARY_TAIL}`;
    const bp = await T.readAccountHealth("client-connect");
    process.env.STRIPE_CONNECT_SECRET_KEY = realPlatform;
    const bpDump = JSON.stringify(bp);
    ok(bp.outcome === "unreachable" && !bpDump.includes(CANARY_HEAD) && !bpDump.includes(CANARY_TAIL),
      "a PLATFORM key with an embedded break is unreachable with neither canary half in the result");
    ok(!("credential_problem" in bp),
      "and carries NO credential_problem - our misconfiguration must never flip an academy's key to invalid");
  }

  // connect academy: read via /v1/accounts/{id} with the platform key
  stripeResponder = (m, u) => u.startsWith("https://api.stripe.com/v1/accounts/acct_connect")
    ? { status: 200, body: { id: "acct_connect", charges_enabled: true, requirements: {} } } : null;
  h = await T.readAccountHealth("client-connect");
  const acctRead = STRIPE_CALLS[STRIPE_CALLS.length - 1];
  ok(h.outcome === "ready" && acctRead.url.includes("/v1/accounts/acct_connect") && authOf(acctRead) === "Bearer sk_live_platform_stub_key",
    "a connect academy is read via /v1/accounts/{id} with the platform key, exactly as today");
  stripeResponder = null;
}

console.log("\n── 7. THE KEY NEVER LEAKS - constructed errors AND runtime throws ──");
{
  const propDump = JSON.stringify(caughtDirectError, Object.getOwnPropertyNames(caughtDirectError || {}));
  ok(!!caughtDirectError && !propDump.includes(DIRECT_KEY),
    "the decrypted key appears in NO property of a thrown transport error");
  ok(!consoleBuffer.includes(DIRECT_KEY),
    "and in NO console output produced by the whole suite");

  // ── the half this probe used to miss ──────────────────────────────────────
  // Everything above inspects errors this module CONSTRUCTS, and the module
  // header used to claim that was the whole guarantee. It was not. The errors
  // that actually leaked are the ones the RUNTIME throws: a restricted key
  // copied out of a wrapped email, a Slack code block or a PDF arrives with a
  // line break IN THE MIDDLE, .trim() cannot see it (trim only touches the
  // ends), every rk_live_ shape check passes, and undici refuses the header
  // with a TypeError quoting the entire key - no .status, so a route's
  // `e.status || 500` + `e.message` hands a live credential to the browser.
  //
  // A leak probe that only reads errors we wrote is assurance with nothing
  // behind it: it cannot fail on the case it was written for.
  for (const [label, sep] of [["a line break", "\\n"], ["a carriage return", "\\r"], ["a NUL", "\\x00"]]) {
    const raw = { "\\n": "\n", "\\r": "\r", "\\x00": "\x00" }[sep];
    const pasted = `${CANARY_HEAD}${raw}${CANARY_TAIL}`;
    const wireBefore = STRIPE_CALLS.length;
    let e = null;
    try { await T.stripeFetch("/account", { keyOverride: pasted }); } catch (err) { e = err; }

    ok(!!e, `a key containing ${label} is refused rather than sent`);
    // message + EVERY enumerable property + the STACK. The stack matters on its
    // own: Node builds err.stack out of the message, so an error whose message
    // was cleaned after construction still carries the original in its stack.
    const dump = e
      ? [String(e.message), String(e.stack || ""), JSON.stringify(e, Object.getOwnPropertyNames(e)), JSON.stringify(e)].join("\n")
      : "";
    ok(!!e && !dump.includes(CANARY_HEAD) && !dump.includes(CANARY_TAIL),
      `and NEITHER half of the canary is in its message, its properties or its stack (${label})`);
    ok(!!e && e.status === 400,
      `refused as bad INPUT rather than a server fault (${label}) - saw status ${JSON.stringify(e && e.status)}`);
    ok(!!e && /re-copy it without the break/.test(String(e.message)),
      `with the sentence that tells the operator what to actually do (${label})`);
    ok(STRIPE_CALLS.length === wireBefore,
      `and the malformed key never reached the wire (${label})`);
  }

  ok(!consoleBuffer.includes(CANARY_HEAD) && !consoleBuffer.includes(CANARY_TAIL),
    "and neither canary half was printed to the console by anything in this suite");
}

// ═════════════════════════════════════════════════════════════════════════════
console.log("\n── 8. TRIM FIRST, THEN REFUSE - a paste artifact is not a broken key ──");
{
  // THE REGRESSION THIS SECTION EXISTS FOR. The refusal above shipped as a flat
  // printable-ASCII test on the RAW value, which also refused the whitespace
  // every secret store leaves behind (`echo` instead of `printf` into
  // `vercel env add` puts a \n on the end - production's SUPABASE_SERVICE_KEY
  // has one right now). The result in production was a live academy's key-health
  // read coming back "unreachable / the Supabase service key contains a line
  // break", with the key stored fine and the webhook registered fine. A cosmetic
  // storage artifact had been promoted to a hard failure.
  //
  // The line is WHERE the character is. At the ends it is how the value was
  // stored; in the middle it is a key that cannot be a header. Trim, then judge.
  const CLEAN = "rk_live_trim_me_9Xq7";

  for (const [label, dirty] of [
    ["a trailing newline", `${CLEAN}\n`],
    ["trailing whitespace and a CRLF", `${CLEAN}  \r\n`],
    ["a leading space", ` ${CLEAN}`],
    ["whitespace at BOTH ends", `\n\t ${CLEAN} \r\n`],
  ]) {
    const wireBefore = STRIPE_CALLS.length;
    let threw = null;
    try { await T.stripeFetch("/account", { keyOverride: dirty }); } catch (e) { threw = e; }
    ok(!threw, `a key with ${label} is ACCEPTED, not refused (saw ${threw ? String(threw.message) : "no error"})`);
    ok(STRIPE_CALLS.length === wireBefore + 1, `and it actually reached the wire (${label})`);
    // EXACT equality, not a startsWith / includes. A header built from the
    // untrimmed value would still "contain" the key, and that is precisely the
    // bug where the trimmed value is checked and the raw one is sent.
    ok(threw ? false : authOf(lastStripe()) === `Bearer ${CLEAN}`,
      `the Authorization header is exactly "Bearer <trimmed>" - no whitespace rides along (${label})`);
  }

  // An EMBEDDED break still refused, side by side with the accepted case, so the
  // distinction is asserted rather than assumed. (Section 7 proves the leak
  // property; this proves the two cases are told apart.)
  {
    let threw = null;
    try { await T.stripeFetch("/account", { keyOverride: `${CANARY_HEAD}\n${CANARY_TAIL}` }); } catch (e) { threw = e; }
    ok(!!threw && threw.status === 400,
      "while a break in the MIDDLE is still refused with 400 - trimming did not soften the guard");
  }

  // ── the Supabase service key: the one that actually broke in production ─────
  {
    const realSk = process.env.SUPABASE_SERVICE_ROLE_KEY;
    process.env.SUPABASE_SERVICE_ROLE_KEY = "stub-service-key\n";
    T.bustTransportCache();
    const sbBefore = SB_CALLS.length;
    let threw = null;
    try { await T.stripeFetch("/x", { stripeAccount: "acct_direct" }); } catch (e) { threw = e; }
    ok(!threw, `a service key with a trailing newline no longer throws (saw ${threw ? String(threw.message) : "no error"})`);
    ok(SB_CALLS.length > sbBefore, "and the Supabase read actually went out");
    const sbCall = SB_CALLS[SB_CALLS.length - 1] || { headers: {} };
    ok(String(sbCall.headers.Authorization || "") === "Bearer stub-service-key",
      "with the TRIMMED service key in Authorization, exactly, no trailing newline");
    ok(String(sbCall.headers.apikey || "") === "stub-service-key",
      "and in the apikey header too");
    process.env.SUPABASE_SERVICE_ROLE_KEY = realSk;
    T.bustTransportCache();
  }

  // A service key broken IN THE MIDDLE is still refused, and still statelessly:
  // sb() runs both before and after writes, so a .status here would one day tell
  // a caller "nothing happened" after a write had landed.
  {
    const realSk = process.env.SUPABASE_SERVICE_ROLE_KEY;
    process.env.SUPABASE_SERVICE_ROLE_KEY = `stub-service\nkey`;
    T.bustTransportCache();
    let threw = null;
    try { await T.stripeFetch("/x", { stripeAccount: "acct_direct" }); } catch (e) { threw = e; }
    ok(!!threw && /re-set it without the break/.test(String(threw.message)),
      "a service key with an EMBEDDED break is still refused");
    ok(!!threw && threw.status === undefined,
      "and that refusal is still STATUSLESS - sb() runs after writes too");
    process.env.SUPABASE_SERVICE_ROLE_KEY = realSk;
    T.bustTransportCache();
  }

  // ── a stored row that only needs trimming reads HEALTHY ────────────────────
  // The failure mode being blocked: a health read judges the raw stored value,
  // calls it credential_problem, and flips a WORKING academy's row to 'invalid'
  // over a stray byte - which stops routing and falls the academy back to
  // Connect. The key is fine. It just has a newline on the end.
  {
    const realEnc = DB.client_stripe_direct[0].secret_key_enc;
    DB.client_stripe_direct[0].secret_key_enc = encryptSecret(`${DIRECT_KEY}\n`);
    DB.client_stripe_direct[0].status = "active";
    T.bustTransportCache();
    stripeResponder = (m, u) => u === "https://api.stripe.com/v1/account"
      ? { status: 200, body: { id: "acct_direct", charges_enabled: true, details_submitted: true, requirements: {} } } : null;
    const h = await T.readAccountHealth("client-direct");
    ok(h.outcome === "ready", `a stored key that only needs trimming reads as a normal outcome (saw ${h.outcome})`);
    ok(!("credential_problem" in h),
      "with NO credential_problem - a paste artifact must never invalidate a working key");
    ok(DB.client_stripe_direct[0].status === "active",
      "and the row stays 'active' rather than being flipped to 'invalid'");
    ok(authOf(STRIPE_CALLS[STRIPE_CALLS.length - 1]) === `Bearer ${DIRECT_KEY}`,
      "and the key that answered Stripe was the trimmed one, exactly");
    stripeResponder = null;
    DB.client_stripe_direct[0].secret_key_enc = realEnc;
    DB.client_stripe_direct[0].status = "active";
    T.bustTransportCache();
  }
}

// ─── report ──────────────────────────────────────────────────────────────────
cleanup();
console.log("");
if (MUTATE) {
  if (controlBroken) { console.log(`❌ NEGATIVE CONTROL FAILED: ${controlBroken}`); process.exit(1); }
  const caught = fail > 0;
  console.log(caught
    ? `✅ NEGATIVE CONTROL PASSED: MUTATE=${MUTATE} was caught by ${fail} assertion(s):\n   - ${failures.slice(0, 4).join("\n   - ")}`
    : `❌ NEGATIVE CONTROL FAILED: MUTATE=${MUTATE} broke a real guarantee and every assertion still passed. That check is decorative.`);
  process.exit(caught ? 0 : 1);
}
console.log(fail ? `❌ ${pass} passed, ${fail} failed.` : `✅ ${pass} passed, 0 failed.`);
process.exit(fail ? 1 : 0);
