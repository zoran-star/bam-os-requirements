// AN ACADEMY REVOKING BAM'S STRIPE ACCESS.
//
//     node api/_stripe-deauthorization.test.mjs      # exits non-zero on any failure
//
// Plain node. No network, no database. Everything api/stripe/webhook.js touches goes
// through global fetch, which is stubbed below, so the REAL dispatcher - real
// signature verification, real switch, real handler - runs end to end against an
// in-memory database.
//
// ─────────────────────────────────────────────────────────────────────────────
// WHAT THIS IS ABOUT
//
// public/client-portal.html has always rendered a complete UI branch for
// clients.stripe_connect_status = 'disabled': "Stripe access was revoked. Reconnect
// to resume billing actions." Nothing in the system could produce that state. No
// code wrote it, and the webhook handled no account.* events - so an academy that
// disconnected BAM in its own Stripe dashboard stayed 'connected' forever, and the
// first person to find out was a staff member watching a refund fail while a parent
// waited on the phone.
//
// ⛔ AND THE FIX HAS A FAIL DIRECTION, which is most of what this suite is for.
//
// Marking a WORKING academy disconnected is worse than the bug being fixed: it hides
// every billing action behind a reconnect wall and sends staff to re-do an OAuth
// flow that was never broken. So "only the explicit event may flip the status" is
// not a comment, it is the thing under test - sections 4 and 5 drive REAL failures
// through the REAL dispatcher and require the status to be untouched afterwards.
//
// ─────────────────────────────────────────────────────────────────────────────
// WHAT IT PROVES
//   1. The event flips exactly one academy to 'disabled', writes one audit row, and
//      changes nothing else in the database.
//   2. The academy is resolved from event.account, NOT event.data.object - which for
//      this event is the platform's APPLICATION object and is the same value for
//      every academy. Proved by pointing data.object at a DIFFERENT academy's id and
//      requiring the right one to flip.
//   3. An unknown connected account is a silent no-op, and a replay of an
//      already-disabled academy writes nothing twice.
//   4. FAIL DIRECTION: a transient database failure on this event leaves the status
//      alone. The top-level catch logs and returns 200; it does not write.
//   5. FAIL DIRECTION: a transient failure on ANY OTHER event leaves it alone too.
//   6. A bad signature never reaches any handler.
//   7. BY CONSTRUCTION: 'disabled' is written in exactly one place in webhook.js,
//      reachable from exactly one switch case, and no catch block in the file writes
//      stripe_connect_status.
//   8. account.updated is deliberately absent, and says so at the handler.
//   9. THE SUBSCRIPTION. api/stripe/ensure-webhook-events.js lists every event the
//      switch handles. Stripe delivers only what an endpoint is subscribed to, so a
//      handler missing from that list is code that can never run - which has already
//      happened three times here (price.created, customer.created, and
//      checkout.session.completed, which this suite found). The set is DERIVED from
//      the switch, resolving constant-routed cases (`case DEAUTHORIZED_EVENT:`)
//      against their declarations as well as literal ones, and pinned exactly so a
//      deleted handler fails too.
//
//      The resolver is not a nicety. The first cut swept only `case "literal":` -
//      blind to this build's OWN case, and patched with a hand-written assertion that
//      made the sweep look complete. A new handler in the house style shipped green.
//      MUTATE=constcase is that exact scenario.
//
// WHAT IT DOES NOT PROVE
//   - That the live Stripe endpoint is actually subscribed. That is a deploy-day
//     step (POST /api/stripe/ensure-webhook-events from the staff portal). Section 9
//     proves the portal will ASK for the right set; it cannot see Stripe.
//   - That the endpoint is a Connect endpoint. It demonstrably is - connected-account
//     events arrive with event.account set today - but nothing here can check it.
//   - Anything about Stripe's real payload beyond the fields used here.
//   - That api/stripe/webhook.js loads on Vercel exactly as it loads here: three
//     `../_runtime/*.js` specifiers resolve to .ts files that only Vercel's resolver
//     rewrites, so this suite substitutes them (see RUNTIME_SHIM). Every other line
//     of the file, including the whole dispatcher, is the real thing.
//
// ─────────────────────────────────────────────────────────────────────────────
// NEGATIVE CONTROLS. Each breaks ONE thing in a throwaway copy of the REAL source
// and must print NEGATIVE CONTROL PASSED, meaning this suite CAUGHT it. A control
// whose pin no longer applies is reported as NEGATIVE CONTROL FAILED, never as a
// pass - a pin that fails to apply looks exactly like a check that passed.
//
//   MUTATE=deauthonerror  the top-level catch marks the academy disabled when a
//                         webhook errors. This is THE bug the fail direction exists
//                         to prevent, written the plausible way somebody would
//                         actually write it ("the webhook failed, assume revoked"),
//                         and it would disconnect working academies over a Supabase
//                         blip.
//   MUTATE=dataobject     the academy is resolved from event.data.object.id instead
//                         of event.account. data.object is the platform APPLICATION
//                         for this event, identical for every academy, so every
//                         revocation would hit the same wrong row or none.
//   MUTATE=accountupdated an account.updated case is added that also writes the
//                         status. The second writer is exactly what "only the
//                         explicit event" forbids, and it fails in the opposite
//                         direction from the one this build reasoned about.
//   MUTATE=noevent        account.application.deauthorized leaves REQUIRED_EVENTS in
//                         api/stripe/ensure-webhook-events.js. The handler is
//                         correct, tested, and Stripe never delivers the event to it.
//   MUTATE=constcase      a NEW handler in this file's own house style - a declared
//                         constant, a case routed through it - with no
//                         REQUIRED_EVENTS line. Dead code that looks alive. This
//                         shipped 43/43 green until section 9 learned to resolve
//                         constant-routed cases, and the constant is the shape the
//                         next developer will copy from here.
//   MUTATE=noacctguard    the "no connected account" guard is deleted, so the handler
//                         builds a database lookup out of a value it has already
//                         established it does not have.
//   MUTATE=directevents   the CONNECT_ONLY_EVENTS filter is dropped from the academy
//                         endpoint's derived event set, so every direct-key academy
//                         subscribes to account.application.deauthorized - a Connect
//                         event delivered under the academy's own signature to the
//                         handler that disables Connect academies.
//   MUTATE=guardblip200   the deauthorized handler's direct-key guard lookup goes back
//                         to riding its error into the dispatcher catch, which acks
//                         200 - and Stripe then drops a REAL revocation forever the
//                         moment the guard lookup blips. The fixed shape answers 500
//                         so Stripe retries (the ONE deliberate exception to the
//                         swallow-to-200 pattern; the handler is idempotent).

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { Readable } from "node:stream";
import { fileURLToPath, pathToFileURL } from "node:url";

const MUTATE = process.env.MUTATE || "";
const HERE = path.dirname(fileURLToPath(import.meta.url));

const WEBHOOK_SECRET = "whsec_stub_for_the_suite";
process.env.SUPABASE_URL = process.env.SUPABASE_URL || "https://stub.supabase.test";
process.env.VITE_SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "stub-service-key";
process.env.STRIPE_WEBHOOK_SECRET = WEBHOOK_SECRET;
process.env.STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || "sk_test_stub";

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

// ─── the one substitution this suite makes, declared loudly ──────────────────
// api/stripe/webhook.js imports three modules through `../_runtime/<name>.js`
// specifiers that resolve to .ts FILES. Only Vercel's resolver rewrites those, so
// plain node cannot load the file at all - which is why the receipt build could only
// pin this dispatcher by reading its source. Substituting the three specifiers buys
// EXECUTION of everything else, including the switch, the signature check and the
// handler under test.
//
// It is pinned line by line: if webhook.js stops importing any of them, or imports a
// fourth .ts module, this fails loudly rather than quietly testing a file that no
// longer resembles production. None of the shimmed functions are called on any path
// this suite drives - they belong to the access-sync and credit-engine layers, which
// only run on invoice and subscription events.
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
const SHIM_NAME = ".mutant-deauth-runtime.js";
fs.writeFileSync(path.join(HERE, "stripe", SHIM_NAME), RUNTIME_SHIM_SRC);
tmpFiles.push(path.join(HERE, "stripe", SHIM_NAME));

// ── the mutations, expressed against the real source text ────────────────────
const DEAUTH_ON_ERROR = [[
  `    console.error("stripe webhook error:", event.type, e.message);`,
  `    console.error("stripe webhook error:", event.type, e.message);
    if (connectedAccount) {
      await sb(\`clients?stripe_connect_account_id=eq.\${encodeURIComponent(connectedAccount)}\`, {
        method: "PATCH", headers: { Prefer: "return=minimal" },
        body: JSON.stringify({ stripe_connect_status: "disabled" }),
      }).catch(() => {});
    }`]];
const DATA_OBJECT = [[
  `  const acct = connectedAccount || null;`,
  `  const acct = (event.data && event.data.object && event.data.object.id) || null;`]];
const ACCOUNT_UPDATED = [[
  `      case DEAUTHORIZED_EVENT:              return await handleAccountDeauthorized(event, connectedAccount, res);`,
  `      case DEAUTHORIZED_EVENT:              return await handleAccountDeauthorized(event, connectedAccount, res);
      case "account.updated":               return await handleAccountDeauthorized({ ...event, type: DEAUTHORIZED_EVENT }, connectedAccount, res);`]];

// A NEW HANDLER IN THE HOUSE STYLE: a declared constant, a case routed through it,
// and nobody remembering the REQUIRED_EVENTS line. This is the shape the next
// developer will copy from this very file, and until the resolver in section 9
// existed it shipped fully green - the sweep only saw `case "literal":`.
const CONST_CASE = [
  [`const DEAUTHORIZED_EVENT = "account.application.deauthorized";`,
   `const DEAUTHORIZED_EVENT = "account.application.deauthorized";\nconst PAYOUT_FAILED_EVENT = "payout.failed";`],
  [`      case DEAUTHORIZED_EVENT:              return await handleAccountDeauthorized(event, connectedAccount, res);`,
   `      case DEAUTHORIZED_EVENT:              return await handleAccountDeauthorized(event, connectedAccount, res);
      case PAYOUT_FAILED_EVENT:             return res.status(200).json({ ok: true, action: "payout-failed-noted" });`],
];
// The "no connected account" guard removed. With it gone the handler still asks the
// database a question it has no business asking - and the answer only stays harmless
// because of the `|| null` normalisation one line above, which is one edit away from
// `|| ""` and a query that reads `stripe_connect_account_id=eq.` (matching every
// academy with no account on file).
const NO_ACCT_GUARD = [[
  `  if (!acct) return res.status(200).json({ skipped: "no connected account on the event" });`,
  `  // guard removed by the control`]];

// The direct-key guard failure ceases to be the one deliberate 500 and goes back
// to riding into the dispatcher catch - which acks 200, so Stripe never retries
// and a real revocation that hit a database blip is gone for good.
const GUARD_BLIP_200 = [[
  `  const guard = await directKeyGuardRows(client.id);
  if (guard.failed) {
    return res.status(500).json({ error: "direct-key guard lookup failed - retry" });
  }
  const directRows = guard.rows;`,
  `  const directRows = await sb(
    \`client_stripe_direct?client_id=eq.\${client.id}&status=eq.active&select=client_id,status&limit=1\`
  );`]];

const WEBHOOK_EDITS = {
  deauthonerror: DEAUTH_ON_ERROR, dataobject: DATA_OBJECT, accountupdated: ACCOUNT_UPDATED,
  constcase: CONST_CASE, noacctguard: NO_ACCT_GUARD, guardblip200: GUARD_BLIP_200,
};

// Build the runnable copy: the shim rewrite always, plus the mutation if any.
const shimEdits = RUNTIME_IMPORTS.map((line) => [line, line.replace(/"\.\.\/_runtime\/[a-z-]+\.js"/, `"./${SHIM_NAME}"`)]);
const WEBHOOK_SRC = mutatedSource("stripe/webhook.js", shimEdits.concat(WEBHOOK_EDITS[MUTATE] || []));
const webhookCopy = path.join(HERE, "stripe", ".mutant-deauth-webhook.js");
fs.writeFileSync(webhookCopy, WEBHOOK_SRC);
tmpFiles.push(webhookCopy);
const webhookHandler = (await import(pathToFileURL(webhookCopy).href)).default;

// Comments blanked while preserving length and newlines, so a case named in prose
// does not read as a case. (This file names account.updated in a comment on purpose.)
const strip = (s) => s
  .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
  .replace(/(^|[^:])\/\/[^\n]*/g, (m, p) => p + " ".repeat(m.length - p.length));

// ─── the in-memory database ──────────────────────────────────────────────────
const DB = { clients: [], members: [], member_audit_log: [], client_stripe_direct: [] };
// The transient blip, aimed per section at ONE table's READS.
//
// Reads only, deliberately. A stub that failed writes too would hide the very damage
// the fail-direction controls have to be able to demonstrate: MUTATE=deauthonerror
// writes the status FROM the catch block, so a stub that also blocks that write makes
// a broken build look identical to a correct one. (That is not hypothetical - the
// first cut of this suite failed writes as well, and reported deauthonerror as an
// uncaught control.) It is also the more realistic shape: a read timing out while the
// connection is otherwise fine is the ordinary blip.
let BLIP = null;                    // { table, method }
const STRIPE_CALLS = [];
// Every Supabase READ the dispatcher makes. "It answered without asking the database
// anything" is a checkable claim, and it is what makes the no-account guard
// load-bearing rather than decorative - see section 3b.
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
  const body = init.body ? JSON.parse(init.body) : null;
  const json = (v, status = 200) => new Response(JSON.stringify(v), { status, headers: { "content-type": "application/json" } });

  if (u.startsWith("https://api.stripe.com/")) { STRIPE_CALLS.push(`${method} ${u}`); return json({}, 500); }
  if (u.startsWith("https://stub.supabase.test/rest/v1/")) {
    const [table, qs = ""] = u.slice("https://stub.supabase.test/rest/v1/".length).split("?");
    // THE TRANSIENT BLIP. A 500 from PostgREST, which is what sb() turns into a
    // throw and what the dispatcher's catch then sees.
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
      for (const r of DB[table]) if (ids.has(r.id)) Object.assign(r, body);
      return json([]);
    }
    return json(runQuery(table, qs));
  }
  throw new Error(`UNSTUBBED CALL: ${method} ${u}`);
};

// ─── driving the REAL endpoint ───────────────────────────────────────────────
// Signed the way Stripe signs, so verifyStripeSignature runs for real rather than
// being bypassed. A suite that skipped the signature would not notice the day the
// handler was reachable without one.
function sign(rawBody, secret = WEBHOOK_SECRET) {
  const t = Math.floor(Date.now() / 1000);
  const v1 = crypto.createHmac("sha256", secret).update(`${t}.${rawBody}`).digest("hex");
  return `t=${t},v1=${v1}`;
}
async function post(event, { secret } = {}) {
  const raw = JSON.stringify(event);
  const req = Object.assign(Readable.from([Buffer.from(raw, "utf8")]), {
    method: "POST", url: "/api/stripe/webhook",
    headers: { "stripe-signature": sign(raw, secret || WEBHOOK_SECRET) },
  });
  let code = null, payload = null;
  const res = { status(c) { code = c; return this; }, json(v) { payload = v; return this; }, end() { return this; } };
  await webhookHandler(req, res);
  return { code, payload };
}

// The real event shape. data.object is the platform's APPLICATION (ca_...), which is
// why the academy has to come from the top-level `account`.
const deauthEvent = (acct, over = {}) => ({
  id: `evt_${++uid}`, type: "account.application.deauthorized", account: acct,
  data: { object: { id: "ca_bam_platform_app", object: "application", name: "BAM" } },
  ...over,
});

// ─── fixtures ────────────────────────────────────────────────────────────────
function academy(tag, acct, status = "connected") {
  const row = { id: `client-${tag}`, business_name: `BAM ${tag}`, stripe_connect_account_id: acct, stripe_connect_status: status, updated_at: "2026-01-01T00:00:00.000Z" };
  DB.clients.push(row);
  return row;
}
const GTA = academy("GTA", "acct_gta");
const SJ = academy("SanJose", "acct_sj");
const OTHER = academy("Detail", "acct_detail");
// A fourth academy that ONLY section 5 touches. Without it, section 5 would run
// against a row section 4 may already have flipped, and would then pass by
// inheritance rather than by detecting anything - two sections, one real check.
const FIFTH = academy("Northside", "acct_northside");
// An academy that has NEVER connected Stripe - 36 of the 47 rows in production look
// like this. It is here because it is the population a missing account-id guard would
// endanger: a lookup that degrades to an empty or null match hits these rows, not the
// connected ones.
const NEVER_CONNECTED = academy("Unconnected", null, "not_connected");
DB.members.push({ id: "m1", client_id: GTA.id, status: "live", athlete_name: "Jordan" });

const statusOf = (id) => (DB.clients.find((c) => c.id === id) || {}).stripe_connect_status;
const auditRows = (type) => DB.member_audit_log.filter((r) => r.action_type === type);
const snapshot = () => JSON.stringify({ clients: DB.clients, members: DB.members });

// ═════════════════════════════════════════════════════════════════════════════
console.log("\n── 1. the revocation flips exactly one academy ──");
{
  const before = { sj: statusOf(SJ.id), other: statusOf(OTHER.id), members: JSON.stringify(DB.members) };
  const r = await post(deauthEvent("acct_gta"));

  ok(r.code === 200 && r.payload && r.payload.action === "stripe-access-revoked",
    `the endpoint accepted it and named what it did (saw ${r.code} ${JSON.stringify(r.payload)})`);
  ok(statusOf(GTA.id) === "disabled", `the revoking academy is now 'disabled' (saw ${statusOf(GTA.id)})`);
  ok(r.payload.from === "connected" && r.payload.to === "disabled", "and the response records what it moved from");
  ok(statusOf(SJ.id) === before.sj && statusOf(OTHER.id) === before.other,
    "no other academy was touched - a revocation is one academy's decision");
  ok(JSON.stringify(DB.members) === before.members, "and no member row changed - this is an academy-level fact");

  // Traceability: a status flip that hides every billing action has to be
  // explicable afterwards.
  const audit = auditRows("stripe-access-revoked");
  ok(audit.length === 1, `exactly one audit row was written (saw ${audit.length})`);
  ok(!!audit[0] && audit[0].client_id === GTA.id && audit[0].member_id === null,
    "on the academy, with no member attached");
  ok(!!audit[0] && audit[0].args.connected_account === "acct_gta" && !!audit[0].args.event_id,
    "naming the connected account and the Stripe event id");
  ok(!!audit[0] && audit[0].db_changes.clients.stripe_connect_status.from === "connected",
    "and what the status was before, so the flip can be undone knowingly");
  ok(STRIPE_CALLS.length === 0, "and nothing called Stripe - the access it would use is exactly what was just revoked");
}

console.log("\n── 2. the academy comes from event.account, never data.object ──");
// For this event data.object is the platform's APPLICATION object - the SAME value
// for every academy on the platform. Resolving from it would send every revocation
// to one wrong row. Proved by pointing data.object at a real, different academy's
// connected account id and requiring the one named by event.account to flip.
{
  const r = await post(deauthEvent("acct_sj", {
    data: { object: { id: "acct_detail", object: "application", name: "BAM" } },
  }));
  ok(r.code === 200 && statusOf(SJ.id) === "disabled",
    `the academy named by event.account flipped (saw ${statusOf(SJ.id)})`);
  ok(statusOf(OTHER.id) === "connected",
    `and the academy named by data.object did NOT (saw ${statusOf(OTHER.id)})`);
}

console.log("\n── 3. unknown accounts and replays are silent no-ops ──");
{
  const before = snapshot();
  const unknown = await post(deauthEvent("acct_never_seen"));
  ok(unknown.code === 200 && /no academy/.test(String(unknown.payload.skipped)),
    `an account we do not know is skipped, not an error (saw ${JSON.stringify(unknown.payload)})`);
  ok(snapshot() === before, "and wrote nothing at all");

  const replay = await post(deauthEvent("acct_gta"));
  ok(replay.code === 200 && replay.payload.skipped === "already disabled",
    `a replay for an already-disabled academy is a no-op (saw ${JSON.stringify(replay.payload)})`);
  ok(auditRows("stripe-access-revoked").length === 2,
    `and writes no second audit row for it (saw ${auditRows("stripe-access-revoked").length} total for two real revocations)`);
}

console.log("\n── 3b. an event carrying no connected account asks nothing and writes nothing ──");
// Stripe always sets event.account on a Connect event, so a payload without one is
// malformed, hand-replayed, or from an endpoint that is not a Connect endpoint. The
// right answer is to stop immediately.
//
// "Writes nothing" is the weak half of that and would pass without the guard. The
// half that makes the guard LOAD-BEARING is that it asks the database nothing at
// all: without it the handler issues a lookup whose filter is built from a value it
// has already established it does not have, and that filter only stays harmless
// because of the `|| null` normalisation one line above it. Change that to `|| ""`
// - a one-token edit - and the query becomes `stripe_connect_account_id=eq.`, which
// matches every academy that has never connected Stripe. The guard is what makes
// that edit unable to reach the database.
{
  for (const missing of [undefined, ""]) {
    const before = snapshot();
    DB_READS.length = 0;
    const r = await post(deauthEvent(missing));
    ok(r.code === 200 && r.payload.skipped === "no connected account on the event",
      `account: ${JSON.stringify(missing)} stops at the guard (saw ${JSON.stringify(r.payload)})`);
    ok(DB_READS.length === 0,
      `and asks the database NOTHING - no lookup is built from a value we do not have (saw ${DB_READS.length}: ${DB_READS.join(", ")})`);
    ok(snapshot() === before, "so nothing is written");
    ok(statusOf(NEVER_CONNECTED.id) === "not_connected",
      "and the academies with no connected account on file - most of them - are untouched");
  }
}

console.log("\n── 4. FAIL DIRECTION: a transient failure must not disconnect anybody ──");
// The scenario: the deauthorized event arrives, and Supabase is having a moment.
// Marking OTHER disabled here would hide every billing action from an academy whose
// Stripe is working perfectly, and send staff to redo an OAuth flow that was never
// broken. The status must be untouched.
{
  const before = statusOf(OTHER.id);
  BLIP = { table: "clients", method: "GET" };   // the academy lookup times out
  const r = await post(deauthEvent("acct_detail"));
  BLIP = null;

  ok(r.code === 200, `the endpoint still answers 200 so Stripe stops retrying (saw ${r.code})`);
  ok(!!r.payload && !!r.payload.error, `and reports the error rather than claiming success (saw ${JSON.stringify(r.payload)})`);
  ok(statusOf(OTHER.id) === before && before === "connected",
    `THE STATUS IS UNTOUCHED - a database blip is not a revocation (saw ${statusOf(OTHER.id)})`);
  ok(auditRows("stripe-access-revoked").length === 2, "and no revocation was recorded");
}

console.log("\n── 5. FAIL DIRECTION: the same, on every other event ──");
// A failure while handling an unrelated event must not touch the status either. This
// is the broader version of section 4: the top-level catch is shared by every
// handler, so if it ever learned to write the status, EVERY event would become a
// possible disconnection.
{
  const before = statusOf(FIFTH.id);
  BLIP = { table: "members", method: "GET" };   // the member lookup times out
  const r = await post({
    id: "evt_inv", type: "invoice.paid", account: "acct_northside",
    data: { object: { id: "in_x", customer: "cus_x", amount_paid: 100, currency: "cad", lines: { data: [] } } },
  });
  BLIP = null;
  ok(r.code === 200, "a failing invoice event still answers 200");
  ok(!!r.payload && !!r.payload.error, `and reports the error (saw ${JSON.stringify(r.payload)})`);
  ok(statusOf(FIFTH.id) === before && before === "connected",
    `and leaves stripe_connect_status alone (saw ${statusOf(FIFTH.id)})`);
  ok(auditRows("stripe-access-revoked").length === 2,
    "with no revocation recorded - an unrelated event cannot disconnect an academy");
}

console.log("\n── 6. an unsigned or wrongly-signed event reaches no handler ──");
{
  const before = snapshot();
  const r = await post(deauthEvent("acct_detail"), { secret: "whsec_not_the_real_one" });
  ok(r.code === 400, `a bad signature is rejected at the door (saw ${r.code})`);
  ok(snapshot() === before, "and nothing was written");
  ok(statusOf(OTHER.id) === "connected", "so an unsigned 'revocation' cannot disconnect anybody");
}

console.log("\n── 7. BY CONSTRUCTION: one writer, one route, no catch block ──");
// Sections 4 and 5 prove the two failure paths that exist TODAY leave the status
// alone. This section is what keeps that true for paths nobody has written yet.
{
  // WEBHOOK_SRC, not a fresh read of the file: it is the same text that was just
  // EXECUTED above (the real file, plus the three import shims, plus any mutation).
  // Reading the file again would make these structural checks blind to every
  // mutation - they would pass while the code under test was broken, which is the
  // shape of a decorative check.
  const code = strip(WEBHOOK_SRC);

  // 1. The status VALUE exists once, as a named constant.
  const literals = (code.match(/["']disabled["']/g) || []).length;
  ok(literals === 1 && /const REVOKED_STATUS = "disabled";/.test(code),
    `the string 'disabled' appears exactly once in the file, as REVOKED_STATUS (saw ${literals})`);

  // 2. The column is ASSIGNED A VALUE exactly once, through the constant.
  //
  // Matched on the assignment specifically, not on every mention: the audit row
  // carries `stripe_connect_status: { from, to }`, which DESCRIBES the change rather
  // than making one, and counting that as a writer would either force the audit to
  // stop naming the column or make this check impossible to satisfy honestly. What
  // must not exist is a second place that assigns it a value - especially a raw
  // string literal, which is how a hand-written second writer would look.
  const valueWrites = (code.match(/stripe_connect_status:\s*(?:REVOKED_STATUS|["'][^"']*["'])/g) || []);
  ok(valueWrites.length === 1 && valueWrites[0].includes("REVOKED_STATUS"),
    `stripe_connect_status is assigned exactly once in the whole file, and through REVOKED_STATUS (saw ${valueWrites.length}: ${valueWrites.join(" | ") || "none"})`);
  const handlerStart = code.indexOf("async function handleAccountDeauthorized(");
  const handlerEnd = code.indexOf("\nasync function", handlerStart + 10);
  const handlerBody = code.slice(handlerStart, handlerEnd < 0 ? code.length : handlerEnd);
  ok(handlerStart > 0 && /stripe_connect_status: REVOKED_STATUS/.test(handlerBody),
    "and that write is inside handleAccountDeauthorized, through the constant");

  // 3. Exactly one route in, and it is the one event.
  const calls = (code.match(/handleAccountDeauthorized\(/g) || []).length;
  ok(calls === 2, `the handler is defined once and called once (saw ${calls} occurrences)`);
  ok(/case DEAUTHORIZED_EVENT:\s+return await handleAccountDeauthorized\(/.test(code),
    "from the switch case for account.application.deauthorized and nowhere else");
  ok(/const DEAUTHORIZED_EVENT = "account\.application\.deauthorized";/.test(code),
    "which is that event type and not a near neighbour");
  ok(/event\.type !== DEAUTHORIZED_EVENT/.test(handlerBody),
    "and the handler re-checks the event type itself, so a mis-wired case still cannot write");

  // 4. No catch block writes it. This is the one that stops MUTATE=deauthonerror
  //    from ever being written by hand.
  const catchBlocks = [];
  let i = -1;
  while ((i = code.indexOf("catch", i + 1)) >= 0) catchBlocks.push(code.slice(i, i + 700));
  const guilty = catchBlocks.filter((b) => /stripe_connect_status/.test(b));
  ok(guilty.length === 0,
    `no catch block in the file writes stripe_connect_status (saw ${guilty.length})`);
  ok(/console\.error\("stripe webhook error:", event\.type, e\.message\);\s*\n\s*await writeAudit\(\{[\s\S]{0,500}?\}\)\.catch\(\(\) => \{\}\);\s*\n\s*return res\.status\(200\)/.test(code),
    "the top-level catch logs, leaves a best-effort audit trace, and returns 200 - it never writes a clients row");
}

console.log("\n── 8. account.updated is deliberately absent ──");
{
  ok(!/case\s+["']account\.updated["']/.test(strip(WEBHOOK_SRC)),
    "there is no account.updated case - it fails in the OPPOSITE direction and is its own change");
  ok(/account\.updated IS DELIBERATELY ABSENT/.test(WEBHOOK_SRC),
    "and the file says so at the handler, where somebody would reach for it");
  // Live proof of the same thing: the event goes in, nothing comes out.
  const before = snapshot();
  const r = await post({ id: "evt_upd", type: "account.updated", account: "acct_detail", data: { object: { id: "acct_detail", charges_enabled: true } } });
  ok(r.code === 200 && r.payload.skipped === "account.updated", `it falls through to the default skip (saw ${JSON.stringify(r.payload)})`);
  ok(snapshot() === before, "writing nothing - no status, no auto-tick");
}

console.log("\n── 9. THE SUBSCRIPTION: a handler Stripe never calls is dead code ──");
// Stripe delivers only the events an endpoint is SUBSCRIBED to.
// api/stripe/ensure-webhook-events.js is how the portal owns that list, and its own
// header records that price.created and customer.created each shipped ahead of their
// subscription. The required set is derived from the switch here rather than
// eyeballed, so this cannot happen to the next handler either.
{
  let ensure = fs.readFileSync(path.join(HERE, "stripe/ensure-webhook-events.js"), "utf8");
  if (MUTATE === "noevent") {
    const pin = `  "account.application.deauthorized",\n`;
    if (!ensure.includes(pin)) {
      controlBroken = "MUTATE=noevent is pinned to the REQUIRED_EVENTS entry, which is no longer in api/stripe/ensure-webhook-events.js.";
      throw new Error(controlBroken);
    }
    ensure = ensure.replace(pin, "");
  }
  // ── reading the switch, INCLUDING constant-routed cases ────────────────────
  //
  // The first cut of this swept only `case "literal.string":` - and this build's own
  // case is `case DEAUTHORIZED_EVENT:`, which it could not see. The gap was papered
  // over with a hand-written "and also check for our event" assertion, which made the
  // sweep look complete while covering everything EXCEPT the shape this file had just
  // introduced. A new handler routed through a declared constant with no
  // REQUIRED_EVENTS line shipped fully green. Worse, the constant is now the house
  // style the next dev copies, so the sweep was blind to exactly the case it was most
  // likely to meet next.
  //
  // So identifiers are RESOLVED: sweep `case <IDENTIFIER>:`, look each one up against
  // its own `const <IDENTIFIER> = "..."` declaration in the same source, and fold the
  // resolved values in. An identifier that CANNOT be resolved (imported from another
  // module, computed) is a hard failure rather than a silent skip - if this sweep
  // cannot see what the switch handles, it must say so instead of reporting a clean
  // subset.
  const code = strip(WEBHOOK_SRC);
  // Scoped to the dispatch switch so an unrelated switch elsewhere in the file
  // cannot contribute cases.
  const swStart = code.indexOf("switch (event.type) {");
  const swEnd = code.indexOf("\n    }\n", swStart);
  ok(swStart > 0 && swEnd > swStart, "the event dispatch switch is where this section expects it");
  const sw = code.slice(swStart, swEnd);

  const literalCases = [...sw.matchAll(/case\s+"([^"]+)"\s*:/g)].map((m) => m[1]);
  const identCases = [...sw.matchAll(/case\s+([A-Za-z_$][\w$]*)\s*:/g)].map((m) => m[1]);
  const resolvedCases = [];
  const unresolved = [];
  for (const id of identCases) {
    const decl = new RegExp(`const\\s+${id}\\s*=\\s*["']([^"']+)["']`).exec(code);
    if (decl) resolvedCases.push(decl[1]); else unresolved.push(id);
  }
  ok(unresolved.length === 0,
    `every constant-routed case resolves to its declared value${unresolved.length ? ` (UNRESOLVED: ${unresolved.join(", ")} - declare it in this file or this sweep is blind to it)` : ""}`);
  // The resolver is doing work, not passing vacuously: this build's own case is
  // constant-routed, so a resolver that silently found nothing would show up here.
  ok(resolvedCases.includes("account.application.deauthorized"),
    `the resolver read this build's own constant-routed case off its declaration (saw ${resolvedCases.join(", ") || "none"})`);

  const handled = [...literalCases, ...resolvedCases].sort();

  // ── N2: the exact set, not a floor ─────────────────────────────────────────
  // `handled.length >= 11` passed whether the switch had 12 cases or 5. Pinning the
  // SET means deleting a handler fails, adding one fails until it is blessed here AND
  // subscribed below, and the failure message names the difference rather than a
  // number.
  const EXPECTED_HANDLED = [
    "account.application.deauthorized",
    "charge.refunded",
    "checkout.session.completed",
    "customer.created",
    "customer.subscription.created",
    "customer.subscription.deleted",
    "customer.subscription.updated",
    "invoice.paid",
    "invoice.payment_failed",
    "invoice.payment_succeeded",
    "payment_method.attached",
    "price.created",
    "price.updated",
  ];
  const added = handled.filter((h) => !EXPECTED_HANDLED.includes(h));
  const gone = EXPECTED_HANDLED.filter((e) => !handled.includes(e));
  ok(added.length === 0 && gone.length === 0,
    `the switch handles exactly the ${EXPECTED_HANDLED.length} events this suite knows about`
    + `${added.length ? ` (NEW: ${added.join(", ")} - bless it here and subscribe it)` : ""}`
    + `${gone.length ? ` (GONE: ${gone.join(", ")} - a handler was deleted)` : ""}`);

  const declared = (/const REQUIRED_EVENTS = \[([\s\S]*?)\];/.exec(ensure) || [])[1] || "";
  const listed = [...declared.matchAll(/"([^"]+)"/g)].map((m) => m[1]);
  const missing = handled.filter((h) => !listed.includes(h));
  ok(missing.length === 0,
    `every handled event is in REQUIRED_EVENTS, so the portal asks Stripe for it${missing.length ? ` (MISSING: ${missing.join(", ")})` : ""}`);
}

console.log("\n── 10. the academy endpoint's derived event set ──");
// Direct-key academies get their OWN webhook endpoints, subscribed to a set
// DERIVED from REQUIRED_EVENTS minus the Connect-only plumbing
// (api/stripe/ensure-academy-webhook.js). Drop that filter and every academy
// endpoint subscribes to account.application.deauthorized - a Connect event
// that means nothing on an account with no Connect application, delivered
// under the ACADEMY'S signature to the handler that disables Connect
// academies. MUTATE=directevents is that exact regression.
{
  let ensureModPath = path.join(HERE, "stripe/ensure-academy-webhook.js");
  if (MUTATE === "directevents") {
    const mutated = mutatedSource("stripe/ensure-academy-webhook.js", [[
      `export const ACADEMY_EVENTS = REQUIRED_EVENTS.filter((ev) => !CONNECT_ONLY_EVENTS.includes(ev));`,
      `export const ACADEMY_EVENTS = [...REQUIRED_EVENTS];`,
    ]]);
    ensureModPath = path.join(HERE, "stripe", ".mutant-deauth-ensure.js");
    fs.writeFileSync(ensureModPath, mutated);
    tmpFiles.push(ensureModPath);
  }
  const ensureMod = await import(pathToFileURL(ensureModPath).href);
  const eventsMod = await import(pathToFileURL(path.join(HERE, "stripe/ensure-webhook-events.js")).href);

  ok(Array.isArray(ensureMod.CONNECT_ONLY_EVENTS) && ensureMod.CONNECT_ONLY_EVENTS.includes("account.application.deauthorized"),
    "account.application.deauthorized is declared Connect-only");
  const leaked = (ensureMod.ACADEMY_EVENTS || []).filter((ev) => ensureMod.CONNECT_ONLY_EVENTS.includes(ev));
  ok(leaked.length === 0,
    `no Connect-only event reaches an academy endpoint's subscription (leaked: ${leaked.join(", ") || "none"})`);
  const union = [...new Set([...(ensureMod.ACADEMY_EVENTS || []), ...ensureMod.CONNECT_ONLY_EVENTS])].sort();
  ok(JSON.stringify(union) === JSON.stringify([...eventsMod.REQUIRED_EVENTS].sort()),
    "and the derivation is complete: academy events + Connect-only events = REQUIRED_EVENTS exactly");
  // The dispatcher's own backstop: a Connect-only event that somehow arrives
  // WITH a routing token is refused before the switch - an academy's signing
  // secret must never be able to reach the Connect-status writer.
  ok(/tenant\.kind === "direct" && CONNECT_ONLY_EVENTS\.includes\(event\.type\)/.test(strip(WEBHOOK_SRC)),
    "and the dispatcher refuses Connect-only events on a token even if one is forged");
}

console.log("\n── 11. a direct-key academy cannot be disconnected by a stale OAuth revocation ──");
// The direct-key guard, and its ONE deliberate exception to swallow-to-200: if
// the guard lookup itself fails, the handler cannot tell a direct-key academy
// (must NOT be flipped) from a Connect academy (MUST be flipped). Riding that
// error into the dispatcher catch acks 200 and Stripe drops a REAL revocation
// forever - so the handler answers 500 and lets Stripe retry. Idempotent: a
// replay that finds the flip already done skips without a second write.
{
  const DIRECT = academy("DirectKey", "acct_directkey");
  DB.client_stripe_direct.push({ id: "csd1", client_id: DIRECT.id, status: "active", stripe_account_id: "acct_directkey" });

  // (a) active direct row: skip, on the record, and the status never flips.
  const r1 = await post(deauthEvent("acct_directkey"));
  ok(r1.code === 200 && /direct-key academy/.test(String(r1.payload.skipped)),
    `the revocation is skipped and says why (saw ${r1.code} ${JSON.stringify(r1.payload)})`);
  ok(statusOf(DIRECT.id) === "connected",
    `and the academy stays connected - its transport does not use Connect (saw ${statusOf(DIRECT.id)})`);
  const skippedAudit = auditRows("stripe-access-revoked-skipped");
  ok(skippedAudit.length === 1 && skippedAudit[0].client_id === DIRECT.id,
    `with one stale-OAuth audit row on the academy (saw ${skippedAudit.length})`);

  // (b) guard lookup blip: 500 so Stripe RETRIES; nothing written either way.
  const VICTIM = academy("GuardBlip", "acct_guardblip");
  BLIP = { table: "client_stripe_direct", method: "GET" };
  const r2 = await post(deauthEvent("acct_guardblip"));
  BLIP = null;
  ok(r2.code === 500,
    `a guard-lookup failure answers 500 - Stripe must retry, not drop the revocation (saw ${r2.code})`);
  ok(statusOf(VICTIM.id) === "connected",
    `and the status is untouched - the blip deferred the decision, it did not make one (saw ${statusOf(VICTIM.id)})`);
  ok(auditRows("stripe-access-revoked").length === 2, "and no revocation was recorded during the blip");

  // The retry converges once the database answers.
  const r3 = await post(deauthEvent("acct_guardblip"));
  ok(r3.code === 200 && r3.payload.action === "stripe-access-revoked" && statusOf(VICTIM.id) === "disabled",
    `the retry lands and the Connect academy is then disabled for real (saw ${r3.code} ${JSON.stringify(r3.payload)})`);
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
