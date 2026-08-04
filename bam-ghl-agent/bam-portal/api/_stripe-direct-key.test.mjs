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
//   8. ONE SAVE, TWO CALLERS. The save logic is EXPORTED as saveDirectKey and
//      the HTTP route is a thin caller of it, so a CLI can save a
//      platform-locked academy's key without a browser and cannot drift from
//      what staff get. Proven three ways: the exported function is callable
//      with no req/res and produces the SAME database writes and audit row as
//      the route path (both drives compared byte-for-byte, volatile fields
//      aside); a source-text wiring pin fails if the handler ever re-inlines
//      the save; and an ACTOR is mandatory at the function boundary - an empty
//      performedByName is refused before Stripe is asked or anything is
//      written, so a CLI cannot land a save with a null actor in the audit row.
//      The goal is IDENTIFIABILITY, not a name check: a staff row whose
//      cosmetic `name` column is null, blank OR whitespace-only still saves
//      through the route, because actorName() trims each link of
//      name -> email -> staff id before it counts. Blocking a real staff
//      member's payment-credential save over a display name would be failing
//      closed on the wrong thing. Disable resolves its actor from the SAME
//      helper, so the two branches cannot drift.
//   9. THE TWO IDS, PINNED BY VALUE. member_audit_log.performed_by gets the
//      STAFF row's id and client_stripe_direct.created_by gets the AUTH user's
//      id - different id spaces, asserted absolutely rather than by comparing
//      the two drives, because a swap inside the save hits both drives
//      identically and any relative comparison cancels it out.
//  10. A TYPO'D ACADEMY ID is a 404 that writes nothing - the guard between an
//      argv typo and a live Stripe key stored under an academy that does not
//      exist.
//  11. ONE STRIPE ACCOUNT, ONE ACADEMY. client_stripe_direct keys its upsert on
//      client_id but holds a UNIQUE index on stripe_account_id, so an account
//      already saved under another academy used to walk into that index and
//      come back as a raw PostgREST 409 with no .status: a 500 full of Postgres
//      for staff, a crash for a CLI, both AFTER the probe hit live Stripe. The
//      save now asks first and refuses with a sentence naming the other academy
//      - and because that name lookup is best effort, the case that matters is
//      the one where it FAILS: the refusal must survive it. An academy
//      re-saving its OWN account (every key rotation) stays idempotent.
//  12. A KEY WITH A LINE BREAK IN IT NEVER COMES BACK. The realistic paste -
//      copied out of a wrapped email, a Slack code block, a PDF - carries a
//      break in the MIDDLE, which .trim() cannot see and the rk_live_ check
//      does not mind. The runtime then refuses the header with a TypeError
//      quoting the whole live key and no .status, which this route used to
//      echo as a 500. Asserted on a TWO-PART canary (the break splits the key,
//      so scrubbing for rk_live_[A-Za-z0-9]* leaves the tail on screen) across
//      \n, \r and \x00, through both probe and save.
//  13. A .status MEANS "REFUSED, NOTHING HAPPENED". Every .status-carrying
//      throw in saveDirectKey is driven and shown to fire before the first
//      sb() write, because a CLI reports that promise to an operator verbatim.
//      It is also why the transport's sanitised runtime errors carry no status
//      at all: a fetch can throw after a write.
//
// WHAT IT DOES NOT PROVE
//   - Real Stripe's status codes for the capability probes (stubbed; the
//     400-means-yes billing-portal trick is asserted as our handling of a 400,
//     not as Stripe's behavior).
//   - Real PostgREST upsert semantics (the stub honors on_conflict merging).
//
// ─────────────────────────────────────────────────────────────────────────────
// NEGATIVE CONTROLS. Each breaks one thing; the suite must print
// "NEGATIVE CONTROL PASSED (<name>)":
//
//   MUTATE=capfalse  node api/_stripe-direct-key.test.mjs
//       restores the could-not-ask collapse: every capability probe error is
//       recorded as `false` again, network failures included. The abort
//       assertions must catch it.
//
//   MUTATE=inlinesave  node api/_stripe-direct-key.test.mjs
//       re-inlines the whole save inside the handler, leaving the exported
//       saveDirectKey orphaned. The mutant still BEHAVES correctly through the
//       route - every other assertion passes - which is exactly the point: the
//       fork is invisible to behavior and only the wiring pin can see it. If
//       the pin ever goes decorative, this control stops printing.
//
//   MUTATE=nocollision  node api/_stripe-direct-key.test.mjs
//       deletes the one-account-one-academy guard, restoring the shape where a
//       Stripe account already claimed by another academy walks into the UNIQUE
//       index and comes back as a Postgres string nobody can act on. Section
//       13 must catch it.
//
//   MUTATE=rawmessage  node api/_stripe-direct-key.test.mjs
//       restores `error: e.message` for statusless errors in handler()'s catch,
//       AND removes the transport's two guards, because the belt only matters
//       for an error we did not construct and with the transport refusing the
//       key there is no such error to echo. Together the two edits ARE the
//       shipped bug: a live restricted key with a line break in it comes back
//       to the browser as a 500 with the credential in the body. Section 14
//       must catch it.
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

// The thin save branch as shipped, and the inlined save that must NOT come
// back. The replacement is deliberately CORRECT code: it does exactly what
// saveDirectKey does, so the mutant passes every behavioral assertion and only
// the wiring pin in section 9 can catch it.
const INLINESAVE = [[
  `    if (action === "save") {
      // Thin caller. The save lives in saveDirectKey above so a CLI can run the
      // exact same code path - re-inlining it here forks the money path.
      //
      // The actor is resolved by actorName() - the same one the disable branch
      // uses, so the two can never drift into different rules about who counts
      // as identifiable.
      const payload = await saveDirectKey({
        clientId: client_id,
        secretKey: req.body.secret_key,
        publishableKey: req.body.publishable_key,
        performedBy: staff.id,
        performedByName: actorName(staff, user),
        createdBy: user.id,
      });
      return res.status(200).json(payload);
    }`,
  [
    '    if (action === "save") {',
    '      const pk = String(req.body.publishable_key || "").trim();',
    '      if (!pk || !pk.startsWith("pk_live_")) {',
    '        throw bad("publishable_key (pk_live_...) is required to save - the checkout cannot mount Stripe.js without it");',
    '      }',
    '      const actor = actorName(staff, user);',
    '      const report = await probeKey(req.body.secret_key, pk);',
    '      const clientRows = await sb(`clients?id=eq.${encodeURIComponent(client_id)}&select=id,stripe_connect_account_id&limit=1`);',
    '      const client = Array.isArray(clientRows) && clientRows[0] ? clientRows[0] : null;',
    '      if (!client) throw bad("academy not found", 404);',
    '      const storedAcct = String(client.stripe_connect_account_id || "").trim();',
    '      if (storedAcct && storedAcct !== String(report.account_id || "").trim()) {',
    '        throw bad(',
    '          `this key belongs to ${report.account_id}, but the academy is already tied to ${storedAcct}. ` +',
    '          "Refusing to switch Stripe accounts through a key save.",',
    '          409',
    '        );',
    '      }',
    // the collision guard, inlined too - this mutant must stay behaviorally
    // CORRECT so that only the wiring pin can catch it
    '      const acctId = String(report.account_id || "").trim();',
    '      const claimRows = await sb(`client_stripe_direct?stripe_account_id=eq.${encodeURIComponent(acctId)}&select=client_id&limit=1`);',
    '      const claimedBy = Array.isArray(claimRows) && claimRows[0] ? String(claimRows[0].client_id || "").trim() : "";',
    '      if (claimedBy && claimedBy !== String(client_id).trim()) {',
    '        let claimedName = "";',
    '        try {',
    '          const owner = await sb(`clients?id=eq.${encodeURIComponent(claimedBy)}&select=business_name&limit=1`);',
    '          claimedName = Array.isArray(owner) && owner[0] ? String(owner[0].business_name || "").trim() : "";',
    '        } catch (e) {',
    '          claimedName = "";',
    '        }',
    '        throw bad(',
    '          claimedName',
    '            ? `that Stripe account (${acctId}) is already saved under "${claimedName}" - remove it there first`',
    '            : `that Stripe account (${acctId}) is already saved under another academy (client_id ${claimedBy}) - remove it there first`,',
    '          409',
    '        );',
    '      }',
    '      await sb(`client_stripe_direct?on_conflict=client_id`, {',
    '        method: "POST",',
    '        headers: { Prefer: "resolution=merge-duplicates,return=minimal" },',
    '        body: JSON.stringify([{',
    '          client_id,',
    '          status: "active",',
    '          secret_key_enc: encryptSecret(String(req.body.secret_key).trim()),',
    '          secret_key_last4: report.key_last4,',
    '          publishable_key: pk,',
    '          livemode: true,',
    '          stripe_account_id: report.account_id,',
    '          capabilities: report.capabilities,',
    '          key_last_verified_at: nowIso(),',
    '          created_by: user.id,',
    '          created_by_name: actor,',
    '          updated_at: nowIso(),',
    '        }]),',
    '      });',
    '      const chargeable = report.charges_enabled === true;',
    '      await sb(`clients?id=eq.${encodeURIComponent(client_id)}`, {',
    '        method: "PATCH",',
    '        headers: { Prefer: "return=minimal" },',
    '        body: JSON.stringify({',
    '          ...(storedAcct ? {} : { stripe_connect_account_id: report.account_id }),',
    '          stripe_connect_status: chargeable ? "connected" : "onboarding",',
    '          stripe_connect_connected_at: chargeable ? nowIso() : null,',
    '          updated_at: nowIso(),',
    '        }),',
    '      });',
    '      await writeAudit({',
    '        client_id,',
    '        action_type: "stripe-direct-key-save",',
    '        args: { account: report.account_id, key_last4: report.key_last4, capabilities: report.capabilities },',
    '        performed_by: staff.id,',
    '        performed_by_name: actor,',
    '      });',
    '      bustTransportCache();',
    '      let webhook;',
    '      try {',
    '        webhook = await ensureAcademyWebhook({ clientId: client_id });',
    '      } catch (e) {',
    '        webhook = { ok: false, error: e.message || String(e) };',
    '      }',
    '      return res.status(200).json({ ok: true, ...report, webhook });',
    '    }',
  ].join("\n")]];

// Deletes the collision guard outright, restoring the shape where the upsert
// walks into the UNIQUE index on stripe_account_id: PostgREST 409, sb() rethrow
// with no .status, a Postgres string in front of staff, and a CLI crash - all
// AFTER the probe already hit live Stripe.
const NOCOLLISION = [[
  [
    '  const acctId = String(report.account_id || "").trim();',
    '  const claimRows = await sb(`client_stripe_direct?stripe_account_id=eq.${encodeURIComponent(acctId)}&select=client_id&limit=1`);',
    '  const claimedBy = Array.isArray(claimRows) && claimRows[0] ? String(claimRows[0].client_id || "").trim() : "";',
    '  if (claimedBy && claimedBy !== String(clientId).trim()) {',
  ].join("\n"),
  [
    '  const acctId = String(report.account_id || "").trim();',
    '  if (false) {',
    '    const claimedBy = "";',
  ].join("\n")]];

// A TWO-FILE CONTROL, and it has to be, which is the interesting part.
//
// The boundary belt in handler()'s catch only matters for an error we did NOT
// construct. With api/_stripe-transport.js refusing a malformed key up front,
// no such error ever arrives - so a control that mutated only direct-key.js
// would break nothing, catch nothing, and print nothing. Removing the
// transport's two guards alongside it reproduces the shipped bug EXACTLY as it
// exists in production right now: a live key inside a statusless TypeError,
// echoed straight into the response body.
const RAWMESSAGE = {
  directKey: [[
    `    if (e && e.status) return res.status(e.status).json({ error: e.message || String(e) });
    console.error("stripe/direct-key unexpected error:", (e && e.stack) || e);
    return res.status(500).json({ error: "unexpected error saving the key" });`,
    `    return res.status(e.status || 500).json({ error: e.message || String(e) });`]],
  transport: [
    ["  assertHeaderSafeKey(t.bearer);", "  // (control rawmessage) refusal removed"],
    [`async function safeFetch(url, init, what) {
  try {
    return await fetch(url, init);
  } catch (e) {
    throw sanitizeFetchError(e, what);
  }
}`,
     `async function safeFetch(url, init, what) {
  return await fetch(url, init); // (control rawmessage) sanitiser removed
}`],
  ],
};

let modulePath = path.join(HERE, "stripe/direct-key.js");
let transportPath = path.join(HERE, "_stripe-transport.js");

const controlDied = (msg) => { console.log(`❌ NEGATIVE CONTROL FAILED: ${msg}`); process.exit(1); };
const applyEdits = (srcPath, edits, outPath, human) => {
  let src = fs.readFileSync(srcPath, "utf8");
  for (const [find, repl] of edits) {
    if (!src.includes(find)) {
      controlDied(`MUTATE=${MUTATE} is pinned to text that is no longer in ${human}:\n\n${find}\n\nRe-point it or delete it - a pin that fails to apply looks exactly like a check that passed.`);
    }
    src = src.split(find).join(repl);
  }
  fs.writeFileSync(outPath, src);
  tmpFiles.push(outPath);
  return outPath;
};

if (MUTATE) {
  const PLANS = {
    capfalse: { directKey: CAPFALSE },
    inlinesave: { directKey: INLINESAVE },
    nocollision: { directKey: NOCOLLISION },
    rawmessage: RAWMESSAGE,
  };
  const plan = PLANS[MUTATE];
  if (!plan) controlDied(`unknown control MUTATE=${MUTATE}`);

  const dkEdits = [...(plan.directKey || [])];
  if (plan.transport) {
    transportPath = applyEdits(transportPath, plan.transport,
      path.join(HERE, ".mutant-stripe-transport-dk.js"), "api/_stripe-transport.js");
    // The mutant direct-key must import the MUTANT transport, and section 7's
    // cache assertions must talk to that same instance - one specifier, one
    // module, one cache. Two instances would fail section 7 for a reason that
    // has nothing to do with the control.
    dkEdits.push(['from "../_stripe-transport.js";', 'from "../.mutant-stripe-transport-dk.js";']);
  }
  if (dkEdits.length) {
    modulePath = applyEdits(modulePath, dkEdits,
      path.join(HERE, "stripe", ".mutant-direct-key.js"), "api/stripe/direct-key.js");
  }
}

// The source of the module ACTUALLY under test (the shipped file, or the mutant
// copy). Section 9's wiring pin reads this, so a control that re-inlines the
// save is judged on the code that just ran, not on the pristine file.
const MODULE_SRC = fs.readFileSync(modulePath, "utf8");

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
    // c3 is the never-saved academy section 9 runs BOTH ways (route, then the
    // exported function) to compare their database writes.
    { id: "c3", business_name: "BAM Fresh", stripe_connect_account_id: null, stripe_connect_status: "not_connected", stripe_connect_connected_at: null },
    // c4 is the second never-saved academy: section 13 points it at the Stripe
    // account c3 already owns.
    { id: "c4", business_name: "BAM Second", stripe_connect_account_id: null, stripe_connect_status: "not_connected", stripe_connect_connected_at: null },
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
// (table, qs) => true makes that ONE Supabase read fail, the way a real one can.
// Section 13 uses it to prove the collision guard's best-effort name lookup
// cannot swallow the refusal it decorates.
let sbFail = null;

globalThis.fetch = async (url, init = {}) => {
  const u = String(url);
  const method = String(init.method || "GET").toUpperCase();
  // THE STUB VALIDATES HEADERS LIKE THE RUNTIME DOES. Real fetch builds a
  // Headers object out of init.headers and undici's validator throws a
  // TypeError QUOTING the entire offending header value - the live key
  // included. Section 14 exists to prove that string never reaches a response
  // body; without this line the stub happily accepts a key with a line break in
  // it, the failure never happens, and section 14 passes for the wrong reason.
  new Headers(init.headers || {});
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
      if (sbFail && sbFail(table, qs)) return new Response("stub: this read failed", { status: 500 });
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

const MOD = await import(pathToFileURL(modulePath).href);
const handler = MOD.default;
const T = await import(pathToFileURL(transportPath).href);

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

  // And so does a 429: rate limiting says nothing about permissions, so it
  // must never persist a guess into the forever-served capability map.
  stripeOverride = (m, u) => u.includes("/v1/payouts") ? { status: 429, body: { error: { message: "Too many requests" } } } : null;
  r = await post({ action: "probe", client_id: "c1", secret_key: RK });
  ok(r.code === 502 && !("capabilities" in (r.payload || {})),
    `a 429 aborts too - rate limited is not a permission answer (saw ${r.code})`);

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

console.log("\n── 9. ONE save, TWO callers: the route and a CLI run the same code ──");
{
  // c3 is a DIFFERENT academy, so it must probe a DIFFERENT Stripe account:
  // acct_A belongs to c1 from section 5, and one Stripe account belongs to
  // exactly one academy (section 13). Every save from here on is acct_C.
  stripeOverride = (m, u) => (u === "https://api.stripe.com/v1/account"
    ? { status: 200, body: { id: "acct_C", charges_enabled: true, details_submitted: true, requirements: {} } }
    : null);

  const resetC3 = () => {
    DB.client_stripe_direct = DB.client_stripe_direct.filter(r => r.client_id !== "c3");
    DB.member_audit_log = DB.member_audit_log.filter(r => r.client_id !== "c3");
    Object.assign(DB.clients.find(c => c.id === "c3"),
      { stripe_connect_account_id: null, stripe_connect_status: "not_connected", stripe_connect_connected_at: null });
  };
  // Timestamps and the ciphertext (a fresh random IV per encrypt) differ between
  // ANY two runs by design. Everything else must not, so everything else is
  // compared literally.
  const VOLATILE = new Set(["updated_at", "created_at", "key_last_verified_at", "stripe_connect_connected_at", "secret_key_enc"]);
  const writesSince = (p, q) => JSON.stringify([SB_POSTS.slice(p), SB_PATCHES.slice(q)],
    (k, v) => (VOLATILE.has(k) ? (v == null ? null : "<volatile>") : v), 1);

  resetC3();
  const p0 = SB_POSTS.length, q0 = SB_PATCHES.length;
  const viaRoute = await post({ action: "save", client_id: "c3", secret_key: RK, publishable_key: "pk_live_academy" });
  const routeWrites = writesSince(p0, q0);
  const routeAudit = auditRows("stripe-direct-key-save").find(r => r.client_id === "c3");
  const routeRow = DB.client_stripe_direct.find(r => r.client_id === "c3");

  // The CLI drive: no req, no res, no HTTP - the same actor the route resolved,
  // stamped by hand the way a CLI must stamp it.
  resetC3();
  const p1 = SB_POSTS.length, q1 = SB_PATCHES.length;
  let viaFn = null, fnErr = null;
  try {
    viaFn = await MOD.saveDirectKey({
      clientId: "c3", secretKey: RK, publishableKey: "pk_live_academy",
      performedBy: "staff-1", performedByName: "Zoran", createdBy: "user-1",
    });
  } catch (e) { fnErr = e; }
  const fnWrites = writesSince(p1, q1);
  const fnRow = DB.client_stripe_direct.find(r => r.client_id === "c3");
  const fnAudit = auditRows("stripe-direct-key-save").find(r => r.client_id === "c3");

  ok(typeof MOD.saveDirectKey === "function" && typeof MOD.probeKey === "function",
    "saveDirectKey and probeKey are EXPORTED - a CLI has something to call");
  ok(!fnErr && !!viaFn && viaFn.ok === true,
    `saveDirectKey runs with no req and no res${fnErr ? ` (threw: ${fnErr.message})` : ""}`);
  ok(fnWrites === routeWrites, "and writes the SAME rows the browser route writes, byte for byte");
  if (fnWrites !== routeWrites) {
    console.log("\n     THE DIFFERING WRITES:\n     route: " + routeWrites.replace(/\n/g, "\n     route: "));
    console.log("     fn:    " + fnWrites.replace(/\n/g, "\n     fn:    ") + "\n");
  }
  ok(JSON.stringify(viaFn) === JSON.stringify(viaRoute.payload),
    "and returns the identical payload, webhook report and all");
  ok(!!fnAudit && !!routeAudit && fnAudit.performed_by === routeAudit.performed_by
    && fnAudit.performed_by_name === "Zoran" && JSON.stringify(fnAudit.args) === JSON.stringify(routeAudit.args),
    "one audit row either way, same actor, same args - and still no key in it");

  // ABSOLUTE, by value, not fn-vs-route. The two ids live in different id
  // spaces (staff row vs auth user) and a swap inside saveDirectKey hits BOTH
  // drives identically, so every relative comparison above cancels it out and
  // reports green. Only naming the expected value per column can see it. This
  // is the highest-consequence invariant in the file: a staff id sitting in a
  // column everything else joins as an auth id is a silent data-integrity bug
  // on live payment rows, invisible until someone tries to join on it.
  ok(!!routeAudit && routeAudit.performed_by === "staff-1",
    `the STAFF row's id is what lands in member_audit_log.performed_by (saw ${JSON.stringify(routeAudit && routeAudit.performed_by)}, want "staff-1")`);
  ok(!!routeRow && routeRow.created_by === "user-1",
    `the AUTH user's id is what lands in client_stripe_direct.created_by (saw ${JSON.stringify(routeRow && routeRow.created_by)}, want "user-1")`);
  ok(!!fnAudit && fnAudit.performed_by === "staff-1" && !!fnRow && fnRow.created_by === "user-1",
    "and the CLI's performedBy / createdBy arguments route to those same two columns, not to each other");
  ok(!!fnRow && fnRow.secret_key_enc !== RK && decryptSecret(fnRow.secret_key_enc) === RK,
    "the CLI drive encrypts through the same module (no plaintext shortcut off the HTTP path)");
  ok(!JSON.stringify(viaFn).includes(RK) && !JSON.stringify(fnAudit).includes(RK),
    "and neither the returned payload nor the audit row carries the pasted key");
}

console.log("\n── 10. the wiring pin: the route CALLS the save, it does not re-inline it ──");
{
  // Source-text, deliberately: a re-inlined save behaves perfectly through the
  // route (see MUTATE=inlinesave) and no behavioral assertion can see it. Only
  // the shape of the code can.
  const branchOf = (src) => {
    const pin = 'if (action === "save") {';
    const at = src.indexOf(pin, src.indexOf("async function handler("));
    if (at === -1) return null;
    let depth = 0;
    for (let i = at + pin.length - 1; i < src.length; i++) {
      if (src[i] === "{") depth++;
      else if (src[i] === "}") { depth--; if (depth === 0) return src.slice(at, i + 1); }
    }
    return null;
  };
  const branch = branchOf(MODULE_SRC);
  if (branch == null) {
    controlBroken = 'This suite is pinned to `if (action === "save") {` inside handler() in api/stripe/direct-key.js and can no longer find it. Re-point section 10 - a pin that cannot run looks exactly like a check that passed.';
  }
  ok(/export async function saveDirectKey\(\{/.test(MODULE_SRC),
    "saveDirectKey is declared as an exported function, not a closure inside the handler");
  ok(!!branch && /saveDirectKey\(\{/.test(branch),
    "the handler's save branch CALLS saveDirectKey");
  // The save's own machinery, listed by name: if any of it reappears inside the
  // branch, the money path has been forked back into two implementations.
  const INLINED = ["encryptSecret(", "client_stripe_direct?on_conflict=client_id", "ensureAcademyWebhook(",
    "stripe-direct-key-save", "bustTransportCache()", "stripe_connect_status:"];
  const found = branch == null ? ["(branch not found)"] : INLINED.filter(t => branch.includes(t));
  ok(found.length === 0,
    `and re-implements none of it inline${found.length ? ` - found: ${found.join(", ")}` : ""}`);
}

console.log("\n── 11. an actor is mandatory - no save lands nameless ──");
{
  const before = snapshot();
  const stripeBefore = STRIPE_CALLS.length;
  const refused = [];
  for (const [label, name] of [["missing", undefined], ["null", null], ["empty", ""], ["whitespace", "   "]]) {
    let e = null;
    try {
      await MOD.saveDirectKey({ clientId: "c3", secretKey: RK, publishableKey: "pk_live_academy", performedByName: name });
    } catch (err) { e = err; }
    refused.push(!!e && /performedByName required/.test(e.message) && (e.status || 400) === 400 ? null : `${label} was not refused`);
  }
  const bad4 = refused.filter(Boolean);
  ok(bad4.length === 0, `on the CLI path, a missing, null, empty or whitespace performedByName is refused${bad4.length ? ` (${bad4.join("; ")})` : ""}`);
  ok(snapshot() === before, "with NOTHING written - the refusal comes before the upsert, the patch and the audit");
  ok(STRIPE_CALLS.length === stripeBefore, "and before Stripe is asked anything at all");

  // But the ROUTE must never fail closed on a cosmetic column. `name` is blank
  // on plenty of real staff rows - null in some, "   " in others. A whitespace
  // name is TRUTHY, which is exactly how an untrimmed fallback chain hands back
  // an empty actor and then 400s a live key save; the shipped chain trims each
  // link BEFORE it counts, which is what makes the invariant true instead of
  // merely asserted in a comment. Blocking a payment-credential save over a
  // display name would be failing closed on the wrong thing: every shape goes
  // through, and every one still names a human in the audit.
  const staffRow = DB.staff[0];
  const realName = staffRow.name;
  for (const [label, cosmetic] of [["null", null], ["whitespace-only", "   "], ["an empty string", ""]]) {
    DB.client_stripe_direct = DB.client_stripe_direct.filter(r => r.client_id !== "c3");
    DB.member_audit_log = DB.member_audit_log.filter(r => r.client_id !== "c3");
    staffRow.name = cosmetic;
    const r = await post({ action: "save", client_id: "c3", secret_key: RK, publishable_key: "pk_live_academy" });
    const row = auditRows("stripe-direct-key-save").find(a => a.client_id === "c3");
    staffRow.name = realName;
    ok(r.code === 200 && r.payload.ok === true,
      `a staff row whose name is ${label} still saves through the route (saw ${r.code}${r.code === 200 ? "" : ` ${JSON.stringify(r.payload && r.payload.error)}`})`);
    ok(!!row && row.performed_by_name === "zo@test" && String(row.performed_by_name).trim() !== ""
      && row.performed_by_name !== "null",
      `and its audit row carries the email fallback - never null, never the STRING "null", never blank (saw ${JSON.stringify(row && row.performed_by_name)})`);
  }

  // The disable branch answers to the same rule, from the same helper: turning
  // a live academy's payment transport OFF is exactly as answerable as turning
  // it on, so it may not land nameless either.
  staffRow.name = "   ";
  const d = await post({ action: "disable", client_id: "c3" });
  staffRow.name = realName;
  const dis = auditRows("stripe-direct-key-disable").find(a => a.client_id === "c3");
  ok(d.code === 200 && !!dis && dis.performed_by_name === "zo@test",
    `disable resolves the SAME actor as save - one helper, both branches (saw ${JSON.stringify(dis && dis.performed_by_name)})`);
}

console.log("\n── 12. a typo'd academy id is a 404, not a credential written into nowhere ──");
{
  // A CLI takes clientId as an argv string, so a typo is now the likeliest
  // operator error there is - and this guard is the only thing standing between
  // it and a live Stripe key stored under an academy that does not exist.
  const before = snapshot();
  const p = SB_POSTS.length, q = SB_PATCHES.length;
  let e = null;
  try {
    await MOD.saveDirectKey({
      clientId: "c3-typo", secretKey: RK, publishableKey: "pk_live_academy",
      performedBy: "staff-1", performedByName: "CLI: zoran",
    });
  } catch (err) { e = err; }
  ok(!!e && /academy not found/.test(String(e.message)) && e.status === 404,
    `an unknown client_id is refused 404 "academy not found" (saw ${e ? `${e.status} ${e.message}` : "NO THROW - it went through"})`);
  ok(snapshot() === before && SB_POSTS.length === p && SB_PATCHES.length === q,
    "and NOTHING is written - no key row, no clients patch, no audit row under an academy that does not exist");
}

console.log("\n── 13. one Stripe account, one academy ──");
{
  // THE PREMISE, pinned to the schema instead of to my belief about it: this
  // guard exists because stripe_account_id carries a UNIQUE index. If that
  // index is ever dropped, the guard is enforcing a rule the database no longer
  // has, and this assertion says so out loud rather than passing quietly.
  const MIG = fs.readFileSync(path.join(HERE, "../supabase/migrations/20260801T120000_client_stripe_direct.sql"), "utf8");
  ok(/CREATE UNIQUE INDEX[\s\S]{0,200}?client_stripe_direct\s*\(\s*stripe_account_id\s*\)/i.test(MIG),
    "the schema really does hold stripe_account_id UNIQUE - the guard enforces a real constraint, not a hunch");

  // c3 owns acct_C (section 9). c4 pastes a key for the SAME Stripe account.
  // Without the guard this walks into that index: PostgREST 409, sb() rethrows
  // with no .status, staff get a 500 full of Postgres and a CLI just crashes -
  // all after the probe already hit live Stripe.
  const before = snapshot();
  const posts = SB_POSTS.length, patches = SB_PATCHES.length;
  let r = await post({ action: "save", client_id: "c4", secret_key: RK, publishable_key: "pk_live_academy" });
  ok(r.code === 409, `a Stripe account already saved under another academy is a 409 (saw ${r.code})`);
  ok(/already saved under "BAM Fresh"/.test(String(r.payload.error)) && /acct_C/.test(String(r.payload.error))
    && !/Supabase|duplicate key|constraint|violates/i.test(String(r.payload.error)),
    `naming the OTHER ACADEMY and the account, in a sentence an operator can act on (saw ${JSON.stringify(r.payload.error)})`);
  ok(snapshot() === before && SB_POSTS.length === posts && SB_PATCHES.length === patches,
    "with NOTHING written - no upsert, no clients patch, no audit");

  // THE ONE THAT MATTERS: the name lookup is a decoration on the refusal, and a
  // decoration that fails must never take the refusal down with it. The throw
  // lives OUTSIDE that try for exactly this reason - move it inside and this
  // save goes through against a claimed Stripe account.
  sbFail = (table, qs) => table === "clients" && /select=business_name/.test(qs);
  const before2 = snapshot();
  const posts2 = SB_POSTS.length, patches2 = SB_PATCHES.length;
  r = await post({ action: "save", client_id: "c4", secret_key: RK, publishable_key: "pk_live_academy" });
  sbFail = null;
  ok(r.code === 409, `when the name lookup THROWS, the collision is still refused 409 (saw ${r.code})`);
  ok(/already saved under another academy \(client_id c3\)/.test(String(r.payload.error)) && /acct_C/.test(String(r.payload.error)),
    `falling back to the unnamed shape, still naming the account and the owner's id (saw ${JSON.stringify(r.payload.error)})`);
  ok(snapshot() === before2 && SB_POSTS.length === posts2 && SB_PATCHES.length === patches2,
    "and still nothing written - a failure to look up a name is not a failure to refuse");

  // THE REGRESSION RISK: an academy re-saving its OWN account (a key rotation
  // is a re-save) must stay idempotent. A guard that blocks this would break
  // every future key rotation, quietly, at the worst moment.
  const rowsBefore = DB.client_stripe_direct.filter(x => x.client_id === "c3").length;
  const again = await post({ action: "save", client_id: "c3", secret_key: RK, publishable_key: "pk_live_academy" });
  ok(again.code === 200 && again.payload.ok === true,
    `the SAME academy re-saving its own account id still succeeds (saw ${again.code} ${JSON.stringify(again.payload && again.payload.error || "")})`);
  ok(rowsBefore === 1 && DB.client_stripe_direct.filter(x => x.client_id === "c3").length === 1,
    "and it stays ONE row - a re-save is an upsert, not a second claim on the account");
}

console.log("\n── 14. a key pasted with a line break in it never comes back in the response ──");
{
  // THE BUG THIS SECTION EXISTS FOR, reproduced end to end. A restricted key
  // copied out of a wrapped email, a Slack code block or a PDF arrives with a
  // break IN THE MIDDLE. .trim() only touches the ends, so it survives; the
  // rk_live_ prefix check passes; and the runtime refuses the header with
  //   TypeError: Headers.append: "Bearer rk_live_...\n..." is an invalid header value
  // - a message containing the WHOLE LIVE KEY and carrying no .status, which
  // this route used to echo as a 500. The key is malformed but trivially
  // repaired by deleting the break, and the operator's next move on a
  // confusing error is to paste it into Slack or a ticket.
  //
  // TWO-PART CANARY on purpose: the break SPLITS the key, so a fix that scrubs
  // the body for rk_live_[A-Za-z0-9]* stops at the break and leaves
  // CANARY_TAIL in the response. Both halves are asserted, so that fix fails
  // here rather than shipping.
  const CANARY_HEAD = "rk_live_FAKE_CANARY";
  const CANARY_TAIL = "SECOND_LINE_TAIL";
  for (const [label, raw] of [["a line break", "\n"], ["a carriage return", "\r"], ["a NUL", "\x00"]]) {
    const pasted = `${CANARY_HEAD}${raw}${CANARY_TAIL}`;
    for (const action of ["probe", "save"]) {
      const before = snapshot();
      const r = await post({ action, client_id: "c1", secret_key: pasted, publishable_key: "pk_live_academy" });
      const body = JSON.stringify(r.payload);
      ok(!body.includes(CANARY_HEAD) && !body.includes(CANARY_TAIL),
        `NEITHER half of the canary is in the ${action} response body (${label})`);
      ok(r.code === 400,
        `and it answers 400 - bad input, not a server fault (${action}, ${label}) - saw ${r.code}`);
      ok(/re-copy it without the break/.test(String(r.payload && r.payload.error)),
        `with the sentence that tells the operator what to do (${action}, ${label})`);
      ok(snapshot() === before, `and nothing was written (${action}, ${label})`);
    }
  }
  const all = RESPONSES.join("\n");
  ok(!all.includes(CANARY_HEAD) && !all.includes(CANARY_TAIL),
    "and neither half appears in ANY response this handler sent across the whole suite");
}

console.log("\n── 15. every .status refusal fires BEFORE the first write ──");
{
  // THE INVARIANT A CLI DEPENDS ON. saveDirectKey's callers read .status as
  // "refused deliberately, and nothing happened" - a CLI prints exactly that to
  // an operator. So a .status may only ever ride on an error thrown BEFORE the
  // first sb() write. Get that wrong and an operator is told nothing happened
  // while a live payment credential is already in the database, which is worse
  // than an unmapped 500.
  //
  // It is also why the transport's sanitised runtime errors are deliberately
  // STATUSLESS: a fetch can throw AFTER a write, so a status there would be a
  // reassurance we cannot back. The one new .status - the printable-ASCII key
  // refusal - fires before fetch is called at all, so it is inside the rule,
  // and this table proves it by driving it alongside every older refusal.
  const cases = [
    ["no client id", { clientId: "", secretKey: RK, publishableKey: "pk_live_academy", performedByName: "CLI" }],
    ["no actor", { clientId: "c3", secretKey: RK, publishableKey: "pk_live_academy", performedByName: "" }],
    ["no publishable key", { clientId: "c3", secretKey: RK, publishableKey: "", performedByName: "CLI" }],
    ["a test-mode publishable key", { clientId: "c3", secretKey: RK, publishableKey: "pk_test_x", performedByName: "CLI" }],
    ["a full sk_ key", { clientId: "c3", secretKey: "sk_live_whatever", publishableKey: "pk_live_academy", performedByName: "CLI" }],
    ["a test-mode restricted key", { clientId: "c3", secretKey: "rk_test_whatever", publishableKey: "pk_live_academy", performedByName: "CLI" }],
    ["a key with a line break in it", { clientId: "c3", secretKey: "rk_live_FAKE_CANARY\nSECOND_LINE_TAIL", publishableKey: "pk_live_academy", performedByName: "CLI" }],
    ["an unknown academy", { clientId: "c3-typo", secretKey: RK, publishableKey: "pk_live_academy", performedByName: "CLI" }],
    ["an account already claimed", { clientId: "c4", secretKey: RK, publishableKey: "pk_live_academy", performedByName: "CLI" }],
  ];
  const offenders = [];
  for (const [label, args] of cases) {
    const before = snapshot();
    const p = SB_POSTS.length, q = SB_PATCHES.length;
    let e = null;
    try { await MOD.saveDirectKey(args); } catch (err) { e = err; }
    if (!e) { offenders.push(`${label}: did not throw at all`); continue; }
    if (!e.status) { offenders.push(`${label}: threw without a .status`); continue; }
    if (SB_POSTS.length !== p || SB_PATCHES.length !== q || snapshot() !== before) {
      offenders.push(`${label}: .status ${e.status} was thrown AFTER a write landed`);
    }
  }
  ok(offenders.length === 0,
    offenders.length
      ? `a .status refusal escaped the rule - ${offenders.join("; ")}`
      : `all ${cases.length} .status refusals fire before the first sb() write, so "refused, nothing happened" is true every time`);
}

// ─── report ──────────────────────────────────────────────────────────────────
cleanup();
console.log("");
if (MUTATE) {
  if (controlBroken) { console.log(`❌ NEGATIVE CONTROL FAILED: ${controlBroken}`); process.exit(1); }
  const caught = fail > 0;
  console.log(caught
    ? `✅ NEGATIVE CONTROL PASSED (${MUTATE}) - MUTATE=${MUTATE} was caught by ${fail} assertion(s):\n   - ${failures.slice(0, 4).join("\n   - ")}`
    : `❌ NEGATIVE CONTROL FAILED (${MUTATE}): MUTATE=${MUTATE} broke a real guarantee and every assertion still passed. That check is decorative.`);
  process.exit(caught ? 0 : 1);
}
console.log(fail ? `❌ ${pass} passed, ${fail} failed.` : `✅ ${pass} passed, 0 failed.`);
process.exit(fail ? 1 : 0);
