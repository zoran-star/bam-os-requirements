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
//   5. THE KEY NEVER LEAKS. The decrypted academy key appears in no thrown error
//      property and no console output. This is the property that makes storing
//      other people's payment credentials tolerable at all.
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
const EDITS = { nullroute: NULLROUTE, keyleak: KEYLEAK };

const modulePath = MUTATE
  ? mutatedCopy(EDITS[MUTATE] || (() => { controlBroken = `unknown control MUTATE=${MUTATE}`; throw new Error(controlBroken); })())
  : path.join(HERE, "_stripe-transport.js");

// ── the in-memory world ──────────────────────────────────────────────────────
const DIRECT_KEY = "rk_live_supersecret_academy_key_9Xq7";
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
const SB_PATCHES = [];    // { table, qs, body }
const STRIPE_CALLS = [];  // { method, url, headers, body }
// (status, jsonOrThrow) per-call override for stripe responses
let stripeResponder = null;

globalThis.fetch = async (url, init = {}) => {
  const u = String(url);
  const method = String(init.method || "GET").toUpperCase();
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

  // network failure: unreachable, NO credential_problem, row untouched
  DB.client_stripe_direct[0].status = "active";
  const patchCount = patches().length;
  stripeResponder = (m, u) => u === "https://api.stripe.com/v1/account" ? "network" : null;
  h = await T.readAccountHealth("client-direct");
  ok(h.outcome === "unreachable" && !("credential_problem" in h),
    "a network failure is plain unreachable - credential_problem is ABSENT");
  ok(DB.client_stripe_direct[0].status === "active" && patches().length === patchCount,
    "and writes nothing - a blip must never invalidate a working key");

  // connect academy: read via /v1/accounts/{id} with the platform key
  stripeResponder = (m, u) => u.startsWith("https://api.stripe.com/v1/accounts/acct_connect")
    ? { status: 200, body: { id: "acct_connect", charges_enabled: true, requirements: {} } } : null;
  h = await T.readAccountHealth("client-connect");
  const acctRead = STRIPE_CALLS[STRIPE_CALLS.length - 1];
  ok(h.outcome === "ready" && acctRead.url.includes("/v1/accounts/acct_connect") && authOf(acctRead) === "Bearer sk_live_platform_stub_key",
    "a connect academy is read via /v1/accounts/{id} with the platform key, exactly as today");
  stripeResponder = null;
}

console.log("\n── 7. THE KEY NEVER LEAKS ──");
{
  const propDump = JSON.stringify(caughtDirectError, Object.getOwnPropertyNames(caughtDirectError || {}));
  ok(!!caughtDirectError && !propDump.includes(DIRECT_KEY),
    "the decrypted key appears in NO property of a thrown transport error");
  ok(!consoleBuffer.includes(DIRECT_KEY),
    "and in NO console output produced by the whole suite");
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
