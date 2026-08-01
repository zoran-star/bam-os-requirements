// TENANT ROUTING IN THE STRIPE WEBHOOK: one dispatcher, two arrival paths.
//
//     node api/_stripe-tenant-routing.test.mjs        # exits non-zero on any failure
//
// Plain node, no network, no database - the same harness shape as
// api/_stripe-deauthorization.test.mjs: global fetch is stubbed, the REAL
// dispatcher (real token resolution, real signature verification, real switch,
// real handlers) runs end to end against an in-memory database, and events are
// signed the way Stripe signs them.
//
// ─────────────────────────────────────────────────────────────────────────────
// WHAT THIS IS ABOUT
//
// Every academy used to reach this webhook through ONE Connect endpoint signed
// with ONE platform secret, and the object-keyed handlers resolved members
// GLOBALLY - members?stripe_customer_id=eq.X across every academy at once. That
// was only safe while a Stripe id could not repeat across academies. Direct-key
// academies (their own Stripe accounts, their own webhook endpoints, their own
// whsec_ secrets, routed by ?t=<token>) end that assumption, so this suite pins
// the two properties that keep tenants apart:
//
//   1. NO CROSS-PATH FALLBACK. A token request verifies ONLY against that
//      academy's endpoint secret; a tokenless request verifies ONLY against the
//      platform secret. An unknown token is 401, never "try the platform key".
//   2. NO CROSS-TENANT RESOLUTION. Every member/cancellation lookup is scoped
//      to the event's tenant. A scoped miss probes the OLD unscoped query once,
//      and a probe hit on another tenant is recorded
//      ('stripe-cross-tenant-member-mismatch') and SKIPPED - never written to.
//
// WHAT IT DOES NOT PROVE
//   - That Stripe delivers events to the academy endpoints (registration is
//     api/stripe/ensure-academy-webhook.js, tested in its own suite).
//   - That api/_stripe-transport.js routes correctly in every corner (its own
//     suite does); here it is exercised live only on the direct dispatch path.
//   - Vercel resolver behavior for the three ../_runtime/*.ts imports - shimmed
//     exactly as in the deauthorization suite, and pinned so drift fails loudly.
//
// ─────────────────────────────────────────────────────────────────────────────
// NEGATIVE CONTROLS. Each breaks ONE thing in a throwaway copy of the REAL
// source and must print NEGATIVE CONTROL PASSED, meaning this suite CAUGHT it.
//
//   MUTATE=tokenfallback   an unknown ?t= token falls through to the platform
//                          secret instead of 401ing - the exact "be lenient"
//                          shortcut that would let anyone who can reach the URL
//                          replay platform-signed events into a tenant context,
//                          and would hide dead academy registrations forever.
//   MUTATE=unscopedlookup  the client_id filter is stripped from the invoice
//                          member lookup (the customer-id branch, which is
//                          textually shared by invoice_failed and
//                          invoice_succeeded - both revert to the old global
//                          query). Academy A's event then flips academy B's
//                          member, which is the write this build exists to
//                          prevent.

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { Readable } from "node:stream";
import { fileURLToPath, pathToFileURL } from "node:url";

const MUTATE = process.env.MUTATE || "";
const HERE = path.dirname(fileURLToPath(import.meta.url));

const PLATFORM_SECRET = "whsec_platform_for_the_suite";
const ACADEMY_SECRET = "whsec_academy_a_for_the_suite";
const ACADEMY_KEY = "rk_live_academy_a_key";
process.env.SUPABASE_URL = "https://stub.supabase.test";
process.env.VITE_SUPABASE_URL = process.env.SUPABASE_URL;
process.env.SUPABASE_SERVICE_ROLE_KEY = "stub-service-key";
process.env.STRIPE_WEBHOOK_SECRET = PLATFORM_SECRET;
process.env.STRIPE_SECRET_KEY = "sk_test_platform_stub";
process.env.STRIPE_DIRECT_ENC_KEY = "tenant-routing-suite-enc-key";

const { encryptSecret } = await import(pathToFileURL(path.join(HERE, "_stripe-direct-crypto.js")).href);

let pass = 0, fail = 0;
const failures = [];
const ok = (cond, label) => {
  if (cond) { pass++; console.log("  ✅ " + label); }
  else { fail++; failures.push(label); console.log("  ❌ " + label); }
};
let controlBroken = null;

// ─── copying the real source, with at most the pinned edits ──────────────────
const tmpFiles = [];
function mutatedSource(rel, edits) {
  const abs = path.join(HERE, rel);
  let src = fs.readFileSync(abs, "utf8");
  for (const [find, repl] of edits) {
    if (!src.includes(find)) {
      controlBroken = `${MUTATE ? `MUTATE=${MUTATE}` : "This suite"} is pinned to text that is no longer in api/${rel}:\n\n${find}\n\n`
        + "Re-point it at the current code or delete it - a pin that fails to apply looks exactly like a check that passed.";
      throw new Error(controlBroken);
    }
    src = src.split(find).join(repl);
  }
  return src;
}
const cleanup = () => { for (const f of tmpFiles) { try { fs.unlinkSync(f); } catch (_) { /* best effort */ } } };
process.on("exit", cleanup);

// ─── the runtime shim, identical in shape to the deauthorization suite's ─────
const RUNTIME_SHIM_SRC = `
export const getAccessSyncMode = async () => "off";
export const syncAccessForMember = async () => ({ ok: true });
export const applyInvoiceCreditGrants = async () => ({ ok: true, skipped: "shimmed" });
export const createRuntimeSupabaseClient = () => ({});
`;
const RUNTIME_IMPORTS = [
  `import { getAccessSyncMode, syncAccessForMember } from "../_runtime/access-sync.js";`,
  `import { applyInvoiceCreditGrants } from "../_runtime/credit-engine.js";`,
  `import { createRuntimeSupabaseClient } from "../_runtime/supabase.js";`,
];
const SHIM_NAME = ".mutant-routing-runtime.js";
fs.writeFileSync(path.join(HERE, "stripe", SHIM_NAME), RUNTIME_SHIM_SRC);
tmpFiles.push(path.join(HERE, "stripe", SHIM_NAME));

// ── the mutations, expressed against the real source text ────────────────────
const TOKEN_FALLBACK = [[
  `  if (!row || !row.secret_enc) return null; // caller answers 401 - no cross-path fallback, ever`,
  `  if (!row || !row.secret_enc) return { kind: "connect", secret: process.env.STRIPE_WEBHOOK_SECRET, clientId: null };`]];
// This text is shared verbatim by handleInvoiceFailed and handleInvoiceSucceeded,
// so the split/join replacement reverts BOTH to the old global query - the exact
// state of the world before this build.
const UNSCOPED_LOOKUP = [[
  `    if (!member && !mismatch && custId) {
      const f = await findTenantRow(tenant, event, "members", \`stripe_customer_id=eq.\${encodeURIComponent(custId)}\`);
      if (f && f.crossTenant) mismatch = true; else member = f;
    }`,
  `    if (!member && !mismatch && custId) {
      const r = await sb(\`members?stripe_customer_id=eq.\${encodeURIComponent(custId)}&select=*&limit=1\`);
      if (Array.isArray(r) && r[0]) member = r[0];
    }`]];
const WEBHOOK_EDITS = { tokenfallback: TOKEN_FALLBACK, unscopedlookup: UNSCOPED_LOOKUP };

const shimEdits = RUNTIME_IMPORTS.map((line) => [line, line.replace(/"\.\.\/_runtime\/[a-z-]+\.js"/, `"./${SHIM_NAME}"`)]);
const WEBHOOK_SRC = mutatedSource("stripe/webhook.js", shimEdits.concat(WEBHOOK_EDITS[MUTATE] || []));
const webhookCopy = path.join(HERE, "stripe", ".mutant-routing-webhook.js");
fs.writeFileSync(webhookCopy, WEBHOOK_SRC);
tmpFiles.push(webhookCopy);
const webhookHandler = (await import(pathToFileURL(webhookCopy).href)).default;

// ─── the in-memory database ──────────────────────────────────────────────────
const DB = {
  clients: [], members: [], member_audit_log: [], cancellations: [],
  client_stripe_direct: [], stripe_academy_webhooks: [],
};
let BLIP = null;                    // { table, method } - one table's reads 500
const STRIPE_CALLS = [];            // { method, url, headers }
const DB_READS = [];

function runQuery(table, qs) {
  const p = new URLSearchParams(qs);
  let rows = DB[table] || [];
  for (const [k, v] of p.entries()) {
    if (["select", "order", "limit", "offset"].includes(k)) continue;
    const [op, ...rest] = String(v).split(".");
    const val = rest.join(".");
    if (op === "eq") rows = rows.filter((r) => String(r[k] == null ? "" : r[k]) === val);
    else if (op === "is") rows = rows.filter((r) => (val === "null" ? r[k] == null : true));
    else if (op === "in") {
      const list = val.replace(/^\(|\)$/g, "").split(",");
      rows = rows.filter((r) => list.includes(String(r[k])));
    }
  }
  const sel = p.get("select");
  if (sel && sel !== "*") {
    const cols = sel.split(",").map((c) => c.trim());
    rows = rows.map((r) => Object.fromEntries(cols.filter((c) => c in r).map((c) => [c, r[c]])));
  }
  const lim = parseInt(p.get("limit") || "0", 10);
  return lim > 0 ? rows.slice(0, lim) : rows;
}

let uid = 0;
globalThis.fetch = async (url, init = {}) => {
  const u = String(url);
  const method = String(init.method || "GET").toUpperCase();
  const json = (v, status = 200) => new Response(JSON.stringify(v), { status, headers: { "content-type": "application/json" } });

  if (u.startsWith("https://api.stripe.com/")) {
    STRIPE_CALLS.push({ method, url: u, headers: init.headers || {} });
    if (u.includes("/v1/customers/cus_new")) return json({ id: "cus_new", email: "parenta@example.com" });
    return json({});
  }
  if (u.startsWith("https://stub.supabase.test/rest/v1/")) {
    const [table, qs = ""] = u.slice("https://stub.supabase.test/rest/v1/".length).split("?");
    const body = init.body ? JSON.parse(init.body) : null;
    if (method === "GET") DB_READS.push(`${table}?${qs}`);
    if (BLIP && BLIP.table === table && BLIP.method === method) return json({ message: "stub: supabase unavailable" }, 500);
    if (!(table in DB)) return json(method === "POST" ? [{ id: `x${++uid}` }] : []);
    if (method === "POST") {
      const rows = (Array.isArray(body) ? body : [body]).map((r) => ({ id: `r${++uid}`, created_at: new Date().toISOString(), ...r }));
      DB[table].push(...rows);
      return json(rows);
    }
    if (method === "PATCH") {
      const ids = new Set(runQuery(table, qs).map((h) => h.id));
      const hit = [];
      for (const r of DB[table]) if (ids.has(r.id)) { Object.assign(r, body); hit.push(r); }
      const prefer = String((init.headers || {}).Prefer || "");
      return json(prefer.includes("representation") ? hit : []);
    }
    return json(runQuery(table, qs));
  }
  throw new Error(`UNSTUBBED CALL: ${method} ${u}`);
};

// ─── driving the REAL endpoint, signed the way Stripe signs ──────────────────
function sign(rawBody, secret) {
  const t = Math.floor(Date.now() / 1000);
  const v1 = crypto.createHmac("sha256", secret).update(`${t}.${rawBody}`).digest("hex");
  return `t=${t},v1=${v1}`;
}
async function post(event, { secret = PLATFORM_SECRET, url = "/api/stripe/webhook" } = {}) {
  const raw = JSON.stringify(event);
  const req = Object.assign(Readable.from([Buffer.from(raw, "utf8")]), {
    method: "POST", url,
    headers: { "stripe-signature": sign(raw, secret) },
  });
  let code = null, payload = null;
  const res = { status(c) { code = c; return this; }, json(v) { payload = v; return this; }, end() { return this; } };
  await webhookHandler(req, res);
  return { code, payload };
}

// ─── fixtures ────────────────────────────────────────────────────────────────
// Academy A: DIRECT-KEY. Its own Stripe account, its own endpoint + secret, its
// own restricted key (encrypted the way production stores it - the transport
// decrypts it live during this suite).
DB.clients.push({ id: "client-a", business_name: "BAM DirectA", stripe_connect_account_id: "acct_a", stripe_connect_status: "connected" });
DB.client_stripe_direct.push({
  id: "csd-a", client_id: "client-a", status: "active",
  stripe_account_id: "acct_a", secret_key_enc: encryptSecret(ACADEMY_KEY),
});
DB.stripe_academy_webhooks.push({
  id: "saw-a", client_id: "client-a", token: "tok_a",
  endpoint_id: "we_a", secret_enc: encryptSecret(ACADEMY_SECRET),
});
// Academy B: ordinary CONNECT academy on the platform endpoint.
DB.clients.push({ id: "client-b", business_name: "BAM ConnectB", stripe_connect_account_id: "acct_b", stripe_connect_status: "connected" });

const memberById = (id) => DB.members.find((m) => m.id === id) || {};
const auditRows = (type) => DB.member_audit_log.filter((r) => r.action_type === type);

// ═════════════════════════════════════════════════════════════════════════════
console.log("\n── 1. tokenless requests are the exact current Connect path ──");
{
  DB.members.push({ id: "m-b1", client_id: "client-b", status: "live", athlete_name: "Bea", stripe_customer_id: "cus_b1" });
  const attached = {
    id: `evt_${++uid}`, type: "payment_method.attached", account: "acct_b",
    data: { object: { id: "pm_1", customer: "cus_b1", type: "card", card: { brand: "visa", last4: "4242" } } },
  };
  const readsBefore = DB_READS.length;
  const r = await post(attached);
  const reads = DB_READS.slice(readsBefore);
  ok(r.code === 200 && r.payload && r.payload.action === "audit-logged" && r.payload.member_id === "m-b1",
    `a platform-signed connect event runs its handler as always (saw ${r.code} ${JSON.stringify(r.payload)})`);
  ok(auditRows("stripe-auto-card-updated").length === 1 && auditRows("stripe-auto-card-updated")[0].member_id === "m-b1",
    "and the audit lands on the right member");
  ok(!reads.some((q) => q.startsWith("stripe_academy_webhooks")),
    "with NO token-table read - the tokenless path never touches the token table");
  ok(reads.some((q) => q.startsWith("members?") && q.includes("client_id=eq.client-b")),
    `and even the connect path resolves the member scoped to its own academy (saw: ${reads.filter((q) => q.startsWith("members")).join(" | ")})`);

  const readsBefore2 = DB_READS.length;
  const r2 = await post(attached, { secret: ACADEMY_SECRET });
  ok(r2.code === 400, `the same event signed with an ACADEMY secret is rejected - no cross-path fallback (saw ${r2.code})`);
  ok(DB_READS.length === readsBefore2, "before a single database read");
}

console.log("\n── 2. direct dispatch, end to end ──");
// The whole direct chain at once: ?t= resolves the academy, the body verifies
// against the ACADEMY endpoint secret, the handler runs, its Stripe read goes
// out on the ACADEMY'S OWN KEY with no Stripe-Account header (the transport's
// reverse lookup), and its member queries are scoped to the academy.
{
  DB.members.push({
    id: "m-a1", client_id: "client-a", status: "payment_method_required",
    athlete_name: "Ari", parent_email: "parenta@example.com",
  });
  const subCreated = {
    id: `evt_${++uid}`, type: "customer.subscription.created",
    data: { object: {
      id: "sub_a1", customer: "cus_new", status: "active", created: 1753900000,
      metadata: {},
      items: { data: [{ price: { id: "plan_ToNwa96lQ5I1Bs", unit_amount: 22600 } }] },
    } },
  };
  const readsBefore = DB_READS.length;
  const stripeBefore = STRIPE_CALLS.length;
  const r = await post(subCreated, { secret: ACADEMY_SECRET, url: "/api/stripe/webhook?t=tok_a" });
  const reads = DB_READS.slice(readsBefore);
  const stripe = STRIPE_CALLS.slice(stripeBefore);

  ok(r.code === 200 && r.payload && r.payload.linked_member_id === "m-a1",
    `the academy-signed, token-routed event ran the real handler (saw ${r.code} ${JSON.stringify(r.payload)})`);
  ok(memberById("m-a1").status === "live" && memberById("m-a1").stripe_subscription_id === "sub_a1",
    "and linked the pending member to the sub, flipping it live");
  const custCall = stripe.find((c) => c.url.includes("/v1/customers/cus_new"));
  ok(!!custCall && custCall.headers.Authorization === `Bearer ${ACADEMY_KEY}`,
    `the customer read went out on the ACADEMY'S OWN key (saw ${custCall ? custCall.headers.Authorization : "no call"})`);
  ok(!!custCall && !("Stripe-Account" in custCall.headers),
    "with no Stripe-Account header - the key IS the account");
  ok(reads.some((q) => q.startsWith("members?") && q.includes("client_id=eq.client-a")),
    `and the member resolution carried client_id=eq.client-a (saw: ${reads.filter((q) => q.startsWith("members")).join(" | ")})`);
}

console.log("\n── 3. an unknown token is 401, never the platform secret ──");
{
  const attached = {
    id: `evt_${++uid}`, type: "payment_method.attached",
    data: { object: { id: "pm_2", customer: "cus_b1", type: "card" } },
  };
  const auditsBefore = DB.member_audit_log.length;
  const r1 = await post(attached, { secret: ACADEMY_SECRET, url: "/api/stripe/webhook?t=tok_ghost" });
  ok(r1.code === 401, `an unknown token answers 401 (saw ${r1.code})`);
  const r2 = await post(attached, { secret: PLATFORM_SECRET, url: "/api/stripe/webhook?t=tok_ghost" });
  ok(r2.code === 401,
    `even PLATFORM-signed - an unknown token must never fall through to the platform secret (saw ${r2.code})`);
  ok(DB.member_audit_log.length === auditsBefore, "no handler ran and no audit was written for either");
}

console.log("\n── 4. a token request never verifies against the platform secret ──");
{
  const attached = {
    id: `evt_${++uid}`, type: "payment_method.attached",
    data: { object: { id: "pm_3", customer: "cus_b1", type: "card" } },
  };
  const auditsBefore = DB.member_audit_log.length;
  const r = await post(attached, { secret: PLATFORM_SECRET, url: "/api/stripe/webhook?t=tok_a" });
  ok(r.code === 400,
    `a KNOWN token with a platform-signed body is an invalid signature, not a handled event (saw ${r.code})`);
  ok(DB.member_audit_log.length === auditsBefore, "and nothing was written");
}

console.log("\n── 5. two academies sharing a stripe_customer_id stay two academies ──");
{
  // Both A and B have a member on cus_shared - the id collision Connect made
  // impossible and academy-owned accounts make ordinary.
  DB.members.push({ id: "m-a2", client_id: "client-a", status: "payment_failed", athlete_name: "Ava", stripe_customer_id: "cus_shared" });
  DB.members.push({ id: "m-b2", client_id: "client-b", status: "payment_failed", athlete_name: "Ben", stripe_customer_id: "cus_shared" });
  const paidEvent = (cust) => ({
    id: `evt_${++uid}`, type: "invoice.payment_succeeded",
    data: { object: { id: `in_${uid}`, customer: cust, amount_paid: 10000, currency: "cad", lines: { data: [] } } },
  });

  const r = await post(paidEvent("cus_shared"), { secret: ACADEMY_SECRET, url: "/api/stripe/webhook?t=tok_a" });
  ok(r.code === 200 && r.payload && r.payload.action === "recovered-to-live" && r.payload.member_id === "m-a2",
    `academy A's token recovered academy A's member (saw ${r.code} ${JSON.stringify(r.payload)})`);
  ok(memberById("m-a2").status === "live", "A's member is live again");
  ok(memberById("m-b2").status === "payment_failed",
    `and B's member on the SAME customer id is untouched (saw ${memberById("m-b2").status})`);

  // Only B matches: the scoped lookup misses, the probe finds B, and the old
  // global code would have flipped B's member from A's event. Recorded + skipped.
  DB.members.push({ id: "m-b3", client_id: "client-b", status: "payment_failed", athlete_name: "Bo", stripe_customer_id: "cus_only_b" });
  const r2 = await post(paidEvent("cus_only_b"), { secret: ACADEMY_SECRET, url: "/api/stripe/webhook?t=tok_a" });
  ok(r2.code === 200 && /no member match/.test(String(r2.payload && r2.payload.skipped)),
    `a customer id that only exists on ANOTHER academy is a skip, not a write (saw ${JSON.stringify(r2.payload)})`);
  ok(memberById("m-b3").status === "payment_failed",
    `B's member was not touched by A's event (saw ${memberById("m-b3").status})`);
  const mm = auditRows("stripe-cross-tenant-member-mismatch");
  ok(mm.length === 1 && mm[0].args.member_id === "m-b3" && mm[0].args.member_client_id === "client-b" && mm[0].args.tenant_client_id === "client-a",
    `and the near-miss is on the record: member_id/member_client_id/tenant_client_id all named (saw ${mm.length})`);

  // A connect event whose account matches NO academy: skip on the record, and
  // never "helpfully" resolve the member globally (cus_b1 WOULD match B).
  const r3 = await post({
    id: `evt_${++uid}`, type: "payment_method.attached", account: "acct_ghost",
    data: { object: { id: "pm_9", customer: "cus_b1", type: "card" } },
  });
  ok(r3.code === 200 && /no client for event account/.test(String(r3.payload && r3.payload.skipped)),
    `an account matching no academy skips (saw ${JSON.stringify(r3.payload)})`);
  const unknownSkips = auditRows("stripe-unknown-tenant-skip");
  ok(unknownSkips.length === 1 && unknownSkips[0].args.account === "acct_ghost",
    "with an audit row naming the unplaceable account");
  ok(auditRows("stripe-auto-card-updated").length === 1,
    "and no card-updated audit was minted from a tenant we could not place");
}

console.log("\n── 6. a handler failure on a token'd event leaves a labelled trace ──");
// The top-level catch still answers 200 (Stripe must not retry-storm handler
// bugs), but now leaves a best-effort 'stripe-webhook-error' audit naming the
// TRANSPORT - a direct academy's failing events are otherwise invisible.
{
  BLIP = { table: "members", method: "GET" };
  const r = await post({
    id: `evt_${++uid}`, type: "payment_method.attached",
    data: { object: { id: "pm_4", customer: "cus_shared", type: "card" } },
  }, { secret: ACADEMY_SECRET, url: "/api/stripe/webhook?t=tok_a" });
  BLIP = null;
  ok(r.code === 200 && !!(r.payload && r.payload.error), `the failure still answers 200 with the error named (saw ${r.code})`);
  const errs = auditRows("stripe-webhook-error");
  ok(errs.length === 1 && errs[0].args.transport === "direct:client-a",
    `and the audit names the transport it happened on (saw ${errs.length}: ${errs[0] && errs[0].args.transport})`);
}

console.log("\n── 7. BY CONSTRUCTION: one verification, one platform doorway ──");
{
  const strip = (s) => s
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
    .replace(/(^|[^:])\/\/[^\n]*/g, (m, p) => p + " ".repeat(m.length - p.length));
  const code = strip(WEBHOOK_SRC);
  const verifies = (code.match(/verifyStripeSignature\(/g) || []).length;
  ok(verifies === 2,
    `verifyStripeSignature is defined once and called once - one gate, one secret per request (saw ${verifies})`);
  const doorways = (code.match(/kind: "connect", secret: process\.env\.STRIPE_WEBHOOK_SECRET/g) || []).length;
  ok(doorways === 1,
    `the platform secret is reachable from exactly ONE doorway, the tokenless branch (saw ${doorways})`);
  ok(/return null; \s*$/m.test(code.slice(code.indexOf("async function resolveTenantContext"), code.indexOf("async function buildTenant")))
    || /if \(!row \|\| !row\.secret_enc\) return null;/.test(code),
    "and an unknown token resolves to null - the 401, not a guess");
}

// ─── report ──────────────────────────────────────────────────────────────────
cleanup();
console.log("");
if (MUTATE) {
  if (controlBroken) { console.log(`❌ NEGATIVE CONTROL FAILED: ${controlBroken}`); process.exit(1); }
  const caught = fail > 0;
  console.log(caught
    ? `✅ NEGATIVE CONTROL PASSED (${MUTATE}): caught by ${fail} assertion(s):\n   - ${failures.slice(0, 4).join("\n   - ")}`
    : `❌ NEGATIVE CONTROL FAILED (${MUTATE}): the break shipped green. That check is decorative.`);
  process.exit(caught ? 0 : 1);
}
console.log(fail ? `❌ ${pass} passed, ${fail} failed.` : `✅ ${pass} passed, 0 failed.`);
process.exit(fail ? 1 : 0);
