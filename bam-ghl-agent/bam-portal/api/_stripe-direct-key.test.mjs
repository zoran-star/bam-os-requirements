// STAFF KEY ENTRY for direct-key academies: api/stripe/direct-key.js, driven
// through its real handler with fetch and Supabase stubbed.
//
//   node api/_stripe-direct-key.test.mjs
//
// WHAT THIS PROVES
//   1. KEY-SHAPE REFUSALS. A full secret key (sk_) is refused with the sentence
//      that tells staff what to paste instead; a test-mode restricted key and a
//      non-key string are refused too. None of them reach Stripe.
//   2. PROBE WRITES NOTHING. A fully successful probe leaves the database
//      byte-identical - no row, no clients patch, no audit.
//   3. THREE-OUTCOME CAPABILITIES. `false` in the stored capability map may
//      ONLY mean Stripe answered 401/403. Could-not-ask - a network failure or
//      a Stripe 5xx - ABORTS the probe with 502 rather than persisting a guess,
//      because this map is saved and served forever via getCapabilities, and
//      "could not ask" collapsed into "no" is the house failure shape.
//   4. SAVE REFUSALS: publishable key mandatory and pk_live_; a key belonging
//      to a DIFFERENT account than the one already on the client row is a 409
//      with no force flag (idempotency keys are account-scoped) - while
//      whitespace drift on the stored id (the trailing-\n env classic) still
//      counts as the SAME account and does not false-409.
//   5. SAVE PERSISTS RIGHT: PostgREST upsert on client_stripe_direct keyed
//      on_conflict=client_id with merge-duplicates; the key stored encrypted
//      and round-tripping; the clients mirror of connect.js (connected +
//      connected_at only when chargeable); the audit row carries last4 and
//      capabilities, never the key; a webhook registration failure is REPORTED
//      in the response and does not undo the save.
//   6. NO RESPONSE EVER CONTAINS the pasted key or the stored ciphertext.
//   7. DISABLE flips the row, writes an audit row, and busts the transport
//      cache so routing falls back to Connect on the very next call in this
//      instance.
//
// WHAT IT DOES NOT PROVE
//   - Real Stripe's status codes for the capability probes (stubbed; the
//     400-means-yes billing-portal trick is asserted as our handling of a 400,
//     not as Stripe's behavior).
//   - Real PostgREST upsert semantics (the stub honors on_conflict merging).
//
// ─────────────────────────────────────────────────────────────────────────────
// NEGATIVE CONTROL. Breaks one thing; the suite must print
// NEGATIVE CONTROL PASSED:
//
//   MUTATE=capfalse  node api/_stripe-direct-key.test.mjs
//       restores the could-not-ask collapse: every capability probe error is
//       recorded as `false` again, network failures included. The abort
//       assertions must catch it.
//
// A control run exits ZERO when the mutation IS caught. CI greps for the
// banner, not the exit code.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const MUTATE = process.env.MUTATE || "";
const HERE = path.dirname(fileURLToPath(import.meta.url));

// ── env, BEFORE any module import ────────────────────────────────────────────
process.env.STRIPE_DIRECT_ENC_KEY = "suite-enc-key-not-a-real-one";
process.env.SUPABASE_URL = "https://stub.supabase.test";
process.env.VITE_SUPABASE_URL = "https://stub.supabase.test";
process.env.SUPABASE_SERVICE_ROLE_KEY = "stub-service-key";
process.env.STRIPE_CONNECT_SECRET_KEY = "sk_live_platform_stub_key";
process.env.STRIPE_PUBLISHABLE_KEY = "pk_live_platform_stub";
// Deliberately UNSET: the save's webhook registration must fail, be REPORTED,
// and not undo the save.
delete process.env.PORTAL_BASE_URL;

let pass = 0, fail = 0;
const failures = [];
let controlBroken = null;
const ok = (cond, label) => {
  if (cond) { pass++; console.log("  ✅ " + label); }
  else { fail++; failures.push(label); console.log("  ❌ " + label); }
};

// ── importing the module (real file, or a pinned mutant copy) ────────────────
const tmpFiles = [];
const cleanup = () => { for (const f of tmpFiles) { try { fs.unlinkSync(f); } catch (_) { /* best effort */ } } };
process.on("exit", cleanup);

const CAPFALSE = [[
  `    } catch (e) {
      capabilities[name] = classify(e, name);
    }`,
  `    } catch (e) {
      capabilities[name] = false;
    }`]];

let modulePath = path.join(HERE, "stripe/direct-key.js");
if (MUTATE) {
  const edits = { capfalse: CAPFALSE }[MUTATE];
  if (!edits) { console.log(`❌ NEGATIVE CONTROL FAILED: unknown control MUTATE=${MUTATE}`); process.exit(1); }
  let src = fs.readFileSync(modulePath, "utf8");
  for (const [find, repl] of edits) {
    if (!src.includes(find)) {
      console.log(`❌ NEGATIVE CONTROL FAILED: MUTATE=${MUTATE} is pinned to text that is no longer in api/stripe/direct-key.js:\n\n${find}\n\nRe-point it or delete it.`);
      process.exit(1);
    }
    src = src.split(find).join(repl);
  }
  modulePath = path.join(HERE, "stripe", ".mutant-direct-key.js");
  fs.writeFileSync(modulePath, src);
  tmpFiles.push(modulePath);
}

// ── the in-memory world ──────────────────────────────────────────────────────
const RK = "rk_live_the_pasted_academy_key_7Zp4";
const { decryptSecret } = await import(pathToFileURL(path.join(HERE, "_stripe-direct-crypto.js")).href);

const DB = {
  staff: [{ id: "staff-1", user_id: "user-1", name: "Zoran", email: "zo@test" }],
  clients: [
    // c1 carries the whitespace-drift form of the SAME account the key belongs to.
    { id: "c1", business_name: "BAM Locked", stripe_connect_account_id: "acct_A\n", stripe_connect_status: "not_connected", stripe_connect_connected_at: null },
    // c2 is tied to a DIFFERENT account - the 409 case.
    { id: "c2", business_name: "BAM Other", stripe_connect_account_id: "acct_B", stripe_connect_status: "connected", stripe_connect_connected_at: "2026-01-01T00:00:00.000Z" },
  ],
  client_stripe_direct: [],
  member_audit_log: [],
  stripe_academy_webhooks: [],
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

const SB_POSTS = [];    // { table, qs, prefer, body }
const SB_PATCHES = [];  // { table, qs, body }
const SB_GETS = [];
const STRIPE_CALLS = [];
// (method, url) => {status, body} | "network" | null(use defaults)
let stripeOverride = null;

globalThis.fetch = async (url, init = {}) => {
  const u = String(url);
  const method = String(init.method || "GET").toUpperCase();
  const json = (v, status = 200) => new Response(JSON.stringify(v), { status, headers: { "content-type": "application/json" } });

  if (u === "https://stub.supabase.test/auth/v1/user") return json({ id: "user-1", email: "zo@test" });

  if (u.startsWith("https://api.stripe.com/")) {
    STRIPE_CALLS.push({ method, url: u, headers: init.headers || {} });
    if (stripeOverride) {
      const r = stripeOverride(method, u);
      if (r === "network") throw new Error("socket hang up (stub)");
      if (r) return json(r.body, r.status);
    }
    if (u === "https://api.stripe.com/v1/account") {
      return json({ id: "acct_A", charges_enabled: true, details_submitted: true, requirements: {} });
    }
    if (method === "POST" && u.includes("/v1/billing_portal/sessions")) {
      // Stripe validates the PERMISSION before the body: a key that gets a 400
      // got past the gate. That is what the handler's 400-means-yes relies on.
      return json({ error: { message: "No such customer: 'cus_probe_nonexistent'" } }, 400);
    }
    return json({ data: [] });
  }
  if (u.startsWith("https://stub.supabase.test/rest/v1/")) {
    const [table, qs = ""] = u.slice("https://stub.supabase.test/rest/v1/".length).split("?");
    const body = init.body ? JSON.parse(init.body) : null;
    if (method === "GET") {
      SB_GETS.push(`${table}?${qs}`);
      // Honor PostgREST column projection: the status action's "row minus
      // secret" guarantee IS its select list, so the stub must enforce it or
      // this suite cannot see a ciphertext leak.
      let rows = runQuery(table, qs);
      const sel = new URLSearchParams(qs).get("select");
      if (sel && sel !== "*") {
        const cols = sel.split(",").map(c => c.trim());
        rows = rows.map(r => Object.fromEntries(cols.filter(c => c in r).map(c => [c, r[c]])));
      }
      return json(rows);
    }
    if (method === "POST") {
      SB_POSTS.push({ table, qs, prefer: String((init.headers || {}).Prefer || ""), body });
      const conflict = new URLSearchParams(qs).get("on_conflict");
      const rows = Array.isArray(body) ? body : [body];
      for (const r of rows) {
        const existing = conflict ? (DB[table] || []).find(x => x[conflict] === r[conflict]) : null;
        if (existing) Object.assign(existing, r);
        else (DB[table] = DB[table] || []).push({ ...r });
      }
      return json(rows);
    }
    if (method === "PATCH") {
      SB_PATCHES.push({ table, qs, body });
      for (const r of runQuery(table, qs)) Object.assign(r, body);
      return json([]);
    }
    return json([]);
  }
  throw new Error(`UNSTUBBED CALL: ${method} ${u}`);
};

const handler = (await import(pathToFileURL(modulePath).href)).default;
const T = await import(pathToFileURL(path.join(HERE, "_stripe-transport.js")).href);

const RESPONSES = [];   // every payload the handler ever returned, for the leak scan
async function post(body) {
  const req = { method: "POST", url: "/api/stripe/direct-key", headers: { authorization: "Bearer stub-user-token" }, body };
  let code = null, payload = null;
  const res = {
    status(c) { code = c; return this; },
    json(v) { payload = v; RESPONSES.push(JSON.stringify(v)); return this; },
    end() { return this; },
    setHeader() { return this; },
  };
  await handler(req, res);
  return { code, payload };
}
const snapshot = () => JSON.stringify({ d: DB.client_stripe_direct, c: DB.clients, a: DB.member_audit_log });
const auditRows = (type) => DB.member_audit_log.filter(r => r.action_type === type);

// ═════════════════════════════════════════════════════════════════════════════
console.log("\n── 1. key-shape refusals, before Stripe is ever asked ──");
{
  const before = STRIPE_CALLS.length;
  let r = await post({ action: "probe", client_id: "c1", secret_key: "sk_live_full_secret_key" });
  ok(r.code === 400 && /RESTRICTED key, never the full secret key/.test(r.payload.error),
    "a full sk_ key is refused with the sentence that says what to paste instead");
  r = await post({ action: "probe", client_id: "c1", secret_key: "rk_test_something" });
  ok(r.code === 400 && /TEST-mode/.test(r.payload.error), "a test-mode restricted key is refused");
  r = await post({ action: "probe", client_id: "c1", secret_key: "not-a-key" });
  ok(r.code === 400 && /rk_live_/.test(r.payload.error), "a non-key string is refused, naming the expected prefix");
  ok(STRIPE_CALLS.length === before, "and none of them reached Stripe");
}

console.log("\n── 2. a successful probe writes NOTHING ──");
{
  const before = snapshot();
  const r = await post({ action: "probe", client_id: "c1", secret_key: RK, publishable_key: "pk_live_academy" });
  ok(r.code === 200 && r.payload.account_id === "acct_A" && r.payload.charges_enabled === true,
    `the probe reports the account it read (saw ${r.code} ${JSON.stringify(r.payload && r.payload.account_id)})`);
  ok(r.payload.key_last4 === RK.slice(-4), "with the key's last 4 and nothing more of it");
  const caps = r.payload.capabilities || {};
  ok(caps.customers === true && caps.payouts === true && caps.billing_portal === true,
    "all capabilities read true, billing_portal via the 400-means-yes trick");
  ok(snapshot() === before, "and the database is byte-identical - a probe is a dry run");
}

console.log("\n── 3. could-not-ask ABORTS - it is never stored as `false` ──");
{
  // Network failure on one probe endpoint: the whole probe must abort.
  stripeOverride = (m, u) => u.includes("/v1/payouts") ? "network" : null;
  let r = await post({ action: "probe", client_id: "c1", secret_key: RK });
  ok(r.code === 502, `a network failure mid-probe aborts with 502, not a guess (saw ${r.code})`);
  ok(/could not reach Stripe to test permissions/.test(String(r.payload.error || "")),
    "telling staff to try again");
  ok(!("capabilities" in (r.payload || {})),
    "and NO capability map is returned - a partial map is worse than a retry");

  // A Stripe 5xx is the same fact: we did not get an answer.
  stripeOverride = (m, u) => u.includes("/v1/payouts") ? { status: 500, body: { error: { message: "oops" } } } : null;
  r = await post({ action: "probe", client_id: "c1", secret_key: RK });
  ok(r.code === 502, `a Stripe 500 aborts the same way (saw ${r.code})`);

  // 401/403 is Stripe SAYING no - the only thing that may become `false`.
  stripeOverride = (m, u) => u.includes("/v1/payouts") ? { status: 403, body: { error: { message: "not permitted" } } } : null;
  r = await post({ action: "probe", client_id: "c1", secret_key: RK });
  ok(r.code === 200 && r.payload.capabilities.payouts === false && r.payload.capabilities.customers === true,
    "a 403 reads as capability absent while everything else stays true");
  stripeOverride = null;
}

console.log("\n── 4. save refusals ──");
{
  let r = await post({ action: "save", client_id: "c1", secret_key: RK });
  ok(r.code === 400 && /publishable_key/.test(String(r.payload.error)), "save without a publishable key is refused");
  r = await post({ action: "save", client_id: "c1", secret_key: RK, publishable_key: "pk_test_nope" });
  ok(r.code === 400, "and a non-live publishable key too");

  const before = snapshot();
  r = await post({ action: "save", client_id: "c2", secret_key: RK, publishable_key: "pk_live_academy" });
  ok(r.code === 409, `a key for a DIFFERENT account than the client row's is a 409 (saw ${r.code})`);
  ok(/acct_A/.test(String(r.payload.error)) && /acct_B/.test(String(r.payload.error)),
    "naming both accounts so staff can see the collision");
  ok(snapshot() === before, "and nothing was written - there is no force flag on purpose");
}

console.log("\n── 5. save persists right (and whitespace drift is the SAME account) ──");
{
  const r = await post({ action: "save", client_id: "c1", secret_key: RK, publishable_key: "pk_live_academy" });
  ok(r.code === 200 && r.payload.ok === true,
    `the stored 'acct_A\\n' drift does not false-409 against the probed acct_A (saw ${r.code})`);

  const up = SB_POSTS.find(p => p.table === "client_stripe_direct");
  ok(!!up && up.qs.includes("on_conflict=client_id") && /resolution=merge-duplicates/.test(up.prefer),
    "the row is a PostgREST upsert keyed on client_id with merge-duplicates");

  const row = DB.client_stripe_direct[0];
  ok(!!row && row.client_id === "c1" && row.status === "active" && row.stripe_account_id === "acct_A",
    "the row lands active on the probed account");
  ok(row.secret_key_enc !== RK && decryptSecret(row.secret_key_enc) === RK,
    "the key is stored encrypted and round-trips through the dedicated module");
  ok(row.secret_key_last4 === RK.slice(-4) && row.publishable_key === "pk_live_academy" && row.capabilities.billing_portal === true,
    "with last4, the pk, and the probed capability map");

  const c1 = DB.clients.find(c => c.id === "c1");
  ok(c1.stripe_connect_status === "connected" && !!c1.stripe_connect_connected_at,
    "the clients mirror of connect.js: chargeable means connected + connected_at stamped");
  ok(c1.stripe_connect_account_id === "acct_A\n",
    "and a non-empty stored account id is never overwritten, drift and all");

  const audit = auditRows("stripe-direct-key-save");
  ok(audit.length === 1 && audit[0].member_id === null && audit[0].args.account === "acct_A"
    && audit[0].args.key_last4 === RK.slice(-4) && !JSON.stringify(audit[0]).includes(RK),
    "one academy-level audit row, carrying last4 and capabilities but NEVER the key");

  ok(!!r.payload.webhook && r.payload.webhook.ok === false && /PORTAL_BASE_URL/.test(String(r.payload.webhook.error)),
    "the webhook registration failure is REPORTED in the response, not thrown away");
  ok(DB.client_stripe_direct.length === 1, "and it did not undo the save");
}

console.log("\n── 6. status answers without secrets ──");
{
  const r = await post({ action: "status", client_id: "c1" });
  ok(r.code === 200 && !!r.payload.direct && !("secret_key_enc" in r.payload.direct),
    "the direct row comes back WITHOUT the ciphertext column");
  ok(r.payload.transport === "direct:acct_A", "naming the transport the resolver would use");
  ok(!!r.payload.health && r.payload.health.outcome === "ready", "with the three-outcome health read");
}

console.log("\n── 7. disable flips the row and busts the transport cache ──");
{
  T.bustTransportCache();
  const lookups = () => SB_GETS.filter(g => g.startsWith("client_stripe_direct?stripe_account_id=eq.acct_A")).length;
  await T.stripeFetch("/x", { stripeAccount: "acct_A" });
  const primed = lookups();
  await T.stripeFetch("/x", { stripeAccount: "acct_A" });
  ok(lookups() === primed, "the transport cache is primed (no re-read inside the TTL)");
  ok(String(STRIPE_CALLS[STRIPE_CALLS.length - 1].headers.Authorization) === `Bearer ${RK}`,
    "and the saved key is what routes those calls");

  const r = await post({ action: "disable", client_id: "c1" });
  ok(r.code === 200 && DB.client_stripe_direct[0].status === "disabled", "disable flips the row to 'disabled'");
  ok(auditRows("stripe-direct-key-disable").length === 1, "with its own audit row");

  await T.stripeFetch("/x", { stripeAccount: "acct_A" });
  const last = STRIPE_CALLS[STRIPE_CALLS.length - 1];
  ok(lookups() === primed + 1, "the very next transport call re-reads (cache busted in this instance)");
  ok(String(last.headers.Authorization) === "Bearer sk_live_platform_stub_key" && last.headers["Stripe-Account"] === "acct_A",
    "and routing falls back to Connect - platform key plus the account header");
}

console.log("\n── 8. no response ever carried a secret ──");
{
  const all = RESPONSES.join("\n");
  ok(!all.includes(RK), "the pasted key appears in NO response the handler ever sent");
  const enc = DB.client_stripe_direct[0] && DB.client_stripe_direct[0].secret_key_enc;
  ok(!!enc && !all.includes(enc), "and neither does the stored ciphertext");
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
