// PER-ACADEMY WEBHOOK ENDPOINTS for direct-key academies, registered by
// api/stripe/ensure-academy-webhook.js on the academy's own Stripe account.
//
//   node api/_stripe-academy-webhook.test.mjs
//
// WHAT THIS PROVES
//   1. IDEMPOTENCE. Running ensure twice creates exactly ONE endpoint - the
//      second run verifies instead of duplicating. A duplicate endpoint means
//      every event delivered twice, which means every activation and receipt
//      processed twice.
//   2. THE SECRET IS NEVER STORED IN THE CLEAR. Stripe returns the whsec_
//      signing secret exactly once, at creation; what lands in the row is
//      AES-256-GCM ciphertext that round-trips through the dedicated
//      STRIPE_DIRECT_ENC_KEY module and never equals the plaintext.
//   3. CRASH RECOVERY, both halves:
//        - endpoint deleted on Stripe's side (resource_missing) -> a NEW token
//          is minted (anything signed for the old endpoint is dead, correctly)
//          and a fresh endpoint created;
//        - a row with a token but no endpoint_id (crashed between INSERT and
//          create) -> orphan endpoints carrying our token are DELETED (their
//          secret is unrecoverable) and a fresh one is created.
//   4. PORTAL_BASE_URL unset refuses loudly - a preview deploy must never
//      register itself as a live academy's event sink.
//   5. CONNECT_ONLY_EVENTS is subtracted: an academy endpoint never subscribes
//      to account.application.deauthorized (there is no Connect application on
//      that account to deauthorize), and the rest of REQUIRED_EVENTS is all
//      there - derived, so a new portal handler reaches direct academies too.
//   6. Every Stripe call rides api/_stripe-transport.js and lands with the
//      ACADEMY's key and no Stripe-Account header - this file never sees a key.
//
// WHAT IT DOES NOT PROVE
//   - That api/stripe/webhook.js can route or verify events arriving at these
//     endpoints (?t=<token> handling is the receiving side's build).
//   - That any real Stripe account accepts the registration (fetch is a stub).
//
// ─────────────────────────────────────────────────────────────────────────────
// NEGATIVE CONTROL. Breaks one thing; the suite must print
// NEGATIVE CONTROL PASSED:
//
//   MUTATE=plainsecret  node api/_stripe-academy-webhook.test.mjs
//       the whsec_ secret is stored UNENCRYPTED - the storage assertions must
//       notice, because this is the one mistake that turns a database read into
//       the power to forge any academy's Stripe events.
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
process.env.PORTAL_BASE_URL = "https://portal.byanymeansbusiness.com";

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

const PLAINSECRET = [[
  "      secret_enc: encryptSecret(endpoint.secret),",
  "      secret_enc: endpoint.secret,"]];

let modulePath = path.join(HERE, "stripe/ensure-academy-webhook.js");
if (MUTATE) {
  const edits = { plainsecret: PLAINSECRET }[MUTATE];
  if (!edits) { controlBroken = `unknown control MUTATE=${MUTATE}`; console.log(`❌ NEGATIVE CONTROL FAILED: ${controlBroken}`); process.exit(1); }
  let src = fs.readFileSync(modulePath, "utf8");
  for (const [find, repl] of edits) {
    if (!src.includes(find)) {
      console.log(`❌ NEGATIVE CONTROL FAILED: MUTATE=${MUTATE} is pinned to text that is no longer in api/stripe/ensure-academy-webhook.js:\n\n${find}\n\nRe-point it or delete it.`);
      process.exit(1);
    }
    src = src.split(find).join(repl);
  }
  modulePath = path.join(HERE, "stripe", ".mutant-academy-webhook.js");
  fs.writeFileSync(modulePath, src);
  tmpFiles.push(modulePath);
}

// ── the in-memory world ──────────────────────────────────────────────────────
const ACADEMY_KEY = "rk_live_academy_own_key_for_this_suite";
const { encryptSecret, decryptSecret } = await import(pathToFileURL(path.join(HERE, "_stripe-direct-crypto.js")).href);

const DB = {
  client_stripe_direct: [{
    client_id: "client-direct", status: "active",
    secret_key_enc: encryptSecret(ACADEMY_KEY), secret_key_last4: "uite",
    publishable_key: "pk_live_academy", stripe_account_id: "acct_direct",
    capabilities: null, key_last_verified_at: null,
  }],
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

// Stripe's side: the academy account's webhook endpoints.
let weSeq = 0;
const STRIPE_ENDPOINTS = [];         // { id, url, enabled_events, secret }
const STRIPE_CALLS = [];             // { method, url, auth, acctHeader }
const createCalls = () => STRIPE_CALLS.filter(c => c.method === "POST" && /\/v1\/webhook_endpoints$/.test(c.url)).length;

let uid = 0;
globalThis.fetch = async (url, init = {}) => {
  const u = String(url);
  const method = String(init.method || "GET").toUpperCase();
  const json = (v, status = 200) => new Response(JSON.stringify(v), { status, headers: { "content-type": "application/json" } });

  if (u.startsWith("https://api.stripe.com/v1/webhook_endpoints")) {
    STRIPE_CALLS.push({ method, url: u.split("?")[0], auth: String((init.headers || {}).Authorization || ""), acctHeader: (init.headers || {})["Stripe-Account"] });
    const tail = u.slice("https://api.stripe.com/v1/webhook_endpoints".length);
    if (method === "POST" && (tail === "" || tail.startsWith("?"))) {
      const p = new URLSearchParams(String(init.body || ""));
      const events = [];
      for (const [k, v] of p.entries()) if (/^enabled_events\[\d+\]$/.test(k)) events.push(v);
      const ep = { id: `we_${++weSeq}`, url: p.get("url"), enabled_events: events, secret: `whsec_stub_${weSeq}_${Math.random().toString(36).slice(2)}` };
      STRIPE_ENDPOINTS.push(ep);
      return json(ep); // secret returned HERE and only here
    }
    const id = decodeURIComponent(tail.replace(/^\//, "").split("?")[0]);
    const found = STRIPE_ENDPOINTS.find(e => e.id === id);
    if (method === "GET" && !id) return json({ data: STRIPE_ENDPOINTS.map(({ secret, ...rest }) => rest) });
    if (!found) return json({ error: { code: "resource_missing", message: `No such webhook endpoint: ${id}` } }, 404);
    if (method === "DELETE") { STRIPE_ENDPOINTS.splice(STRIPE_ENDPOINTS.indexOf(found), 1); return json({ id, deleted: true }); }
    if (method === "POST") {
      const p = new URLSearchParams(String(init.body || ""));
      const events = [];
      for (const [k, v] of p.entries()) if (/^enabled_events\[\d+\]$/.test(k)) events.push(v);
      if (events.length) found.enabled_events = events;
      const { secret, ...rest } = found;
      return json(rest);
    }
    const { secret, ...rest } = found;   // a GET never re-reveals the secret
    return json(rest);
  }
  if (u.startsWith("https://stub.supabase.test/rest/v1/")) {
    const [table, qs = ""] = u.slice("https://stub.supabase.test/rest/v1/".length).split("?");
    const body = init.body ? JSON.parse(init.body) : null;
    if (method === "GET") return json(runQuery(table, qs));
    if (method === "POST") {
      const rows = (Array.isArray(body) ? body : [body]).map(r => ({ id: `r${++uid}`, ...r }));
      (DB[table] = DB[table] || []).push(...rows);
      return json(rows);
    }
    if (method === "PATCH") {
      const keys = new Set(runQuery(table, qs).map(r => r.id));
      for (const r of DB[table] || []) if (keys.has(r.id)) Object.assign(r, body);
      return json([]);
    }
    return json([]);
  }
  throw new Error(`UNSTUBBED CALL: ${method} ${u}`);
};

const M = await import(pathToFileURL(modulePath).href);
const row = () => DB.stripe_academy_webhooks[0];
// A stored value that is not our ciphertext must read as a FAILED assertion,
// not a crash - that is exactly what the plainsecret control stores.
const tryDecrypt = (v) => { try { return decryptSecret(v); } catch (_) { return null; } };

// ═════════════════════════════════════════════════════════════════════════════
console.log("\n── 1. the event list: REQUIRED_EVENTS minus the Connect-only plumbing ──");
{
  ok(Array.isArray(M.CONNECT_ONLY_EVENTS) && M.CONNECT_ONLY_EVENTS.length === 1
    && M.CONNECT_ONLY_EVENTS[0] === "account.application.deauthorized",
    "CONNECT_ONLY_EVENTS is the sole definition and holds exactly the deauthorization event");
  ok(!M.ACADEMY_EVENTS.includes("account.application.deauthorized"),
    "an academy endpoint never subscribes to account.application.deauthorized");
  ok(M.ACADEMY_EVENTS.includes("invoice.paid") && M.ACADEMY_EVENTS.includes("customer.subscription.updated")
    && M.ACADEMY_EVENTS.includes("checkout.session.completed"),
    "and everything else the portal handles is in the derived list");
}

console.log("\n── 2. guards: not-direct academies and missing PORTAL_BASE_URL ──");
{
  const r = await M.ensureAcademyWebhook({ clientId: "client-has-no-key" });
  ok(r.ok === true && /not a direct-key academy/.test(String(r.skipped)),
    "a client with no active direct row is a clean no-op");
  ok(STRIPE_ENDPOINTS.length === 0 && DB.stripe_academy_webhooks.length === 0, "that created nothing anywhere");

  const saved = process.env.PORTAL_BASE_URL;
  delete process.env.PORTAL_BASE_URL;
  let threw = null;
  try { await M.ensureAcademyWebhook({ clientId: "client-direct" }); } catch (e) { threw = e; }
  process.env.PORTAL_BASE_URL = saved;
  ok(!!threw && /PORTAL_BASE_URL/.test(String(threw.message)),
    "PORTAL_BASE_URL unset REFUSES loudly, naming the missing env (preview-deploy guard)");
  ok(STRIPE_ENDPOINTS.length === 0 && DB.stripe_academy_webhooks.length === 0, "and registered nothing");
}

console.log("\n── 3. create once, verify forever ──");
let firstSecretPlain = null;
{
  const r1 = await M.ensureAcademyWebhook({ clientId: "client-direct" });
  ok(r1.ok === true && r1.action === "created" && STRIPE_ENDPOINTS.length === 1,
    `the first run creates exactly one endpoint (saw ${JSON.stringify(r1)})`);
  ok(!!row() && row().token && row().endpoint_id === STRIPE_ENDPOINTS[0].id,
    "the row carries the token and the endpoint id");
  ok(STRIPE_ENDPOINTS[0].url === `https://portal.byanymeansbusiness.com/api/stripe/webhook?t=${row().token}`,
    "the endpoint URL is our webhook route carrying the routing token");
  ok(JSON.stringify(STRIPE_ENDPOINTS[0].enabled_events) === JSON.stringify(M.ACADEMY_EVENTS),
    "subscribed to exactly ACADEMY_EVENTS");

  firstSecretPlain = STRIPE_ENDPOINTS[0].secret;
  ok(!!row().secret_enc && row().secret_enc !== firstSecretPlain && !String(row().secret_enc).startsWith("whsec_"),
    "the signing secret is NOT stored in the clear");
  ok(tryDecrypt(row().secret_enc) === firstSecretPlain, "and round-trips through the dedicated crypto module");

  const r2 = await M.ensureAcademyWebhook({ clientId: "client-direct" });
  ok(r2.ok === true && r2.action === "verified" && STRIPE_ENDPOINTS.length === 1 && createCalls() === 1,
    `the second run verifies - one endpoint, one create call, ever (saw ${JSON.stringify(r2)})`);
  ok(!!row().last_verified_at, "and stamps last_verified_at");

  ok(STRIPE_CALLS.every(c => c.auth === `Bearer ${ACADEMY_KEY}` && c.acctHeader === undefined),
    "every Stripe call so far rode the transport with the ACADEMY key and no Stripe-Account header");
}

console.log("\n── 4. a handler added to the portal reaches existing endpoints ──");
{
  // Simulate an endpoint registered before checkout.session.completed existed.
  STRIPE_ENDPOINTS[0].enabled_events = M.ACADEMY_EVENTS.filter(ev => ev !== "checkout.session.completed");
  const r = await M.ensureAcademyWebhook({ clientId: "client-direct" });
  ok(r.ok === true && JSON.stringify(r.added) === JSON.stringify(["checkout.session.completed"]),
    "a missing event is unioned in, not ignored");
  ok(STRIPE_ENDPOINTS[0].enabled_events.includes("checkout.session.completed") && STRIPE_ENDPOINTS.length === 1,
    "on the SAME endpoint - no recreation for an event gap");
}

console.log("\n── 5. endpoint deleted on Stripe's side: new token, new endpoint ──");
{
  const oldToken = row().token;
  STRIPE_ENDPOINTS.length = 0;   // deleted from the academy's dashboard
  const r = await M.ensureAcademyWebhook({ clientId: "client-direct" });
  ok(r.ok === true && r.action === "recreated" && STRIPE_ENDPOINTS.length === 1,
    `resource_missing recreates the endpoint (saw ${JSON.stringify(r)})`);
  ok(row().token !== oldToken,
    "under a NEW token - anything signed for the dead endpoint can never route again");
  ok(STRIPE_ENDPOINTS[0].url.includes(row().token) && tryDecrypt(row().secret_enc) === STRIPE_ENDPOINTS[0].secret,
    "and the new secret is stored encrypted, round-tripping");
}

console.log("\n── 6. crash between row-INSERT and endpoint-create: orphans die, fresh one lives ──");
{
  // Rewind the row to the half-written state and plant the orphan whose secret
  // was returned once, to a process that died before storing it.
  const token = row().token;
  const orphan = { id: `we_orphan_${++weSeq}`, url: `https://portal.byanymeansbusiness.com/api/stripe/webhook?t=${token}`, enabled_events: ["invoice.paid"], secret: "whsec_lost_forever" };
  STRIPE_ENDPOINTS.length = 0;
  STRIPE_ENDPOINTS.push(orphan);
  Object.assign(row(), { endpoint_id: null, secret_enc: null });

  const r = await M.ensureAcademyWebhook({ clientId: "client-direct" });
  ok(r.ok === true && r.action === "recovered" && r.deleted_orphans === 1,
    `the half-written row recovers, reporting the orphan (saw ${JSON.stringify(r)})`);
  ok(!STRIPE_ENDPOINTS.some(e => e.id === orphan.id),
    "the orphan endpoint (secret unrecoverable) was DELETED by token match");
  ok(STRIPE_ENDPOINTS.length === 1 && row().endpoint_id === STRIPE_ENDPOINTS[0].id,
    "and exactly one fresh endpoint replaced it, stamped on the row");
  ok(!!row().secret_enc && row().secret_enc !== STRIPE_ENDPOINTS[0].secret
    && tryDecrypt(row().secret_enc) === STRIPE_ENDPOINTS[0].secret,
    "with ITS secret stored encrypted, round-tripping");
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
