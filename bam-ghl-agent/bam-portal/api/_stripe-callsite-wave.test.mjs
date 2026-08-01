// THE CALL-SITE WAVE: every academy-scoped Stripe helper is a hollow shell over
// api/_stripe-transport.js, and the money gates are three-outcome.
//
//   node api/_stripe-callsite-wave.test.mjs
//
// WHAT THIS IS ABOUT. The direct-key transport gives platform-locked academies
// (CoachIQ-style, no Connect OAuth) their own Stripe key. For that to work,
// every academy-scoped call in the repo has to route through the ONE resolver -
// with ZERO call-site diffs. Each file's local stripeFetch/stripeGet/stripeReq
// keeps its exact name and signature and delegates; the resolver keys off the
// stripeAccount value the call sites already pass. Until a direct row exists in
// prod this whole wave is a pure no-op: Connect academies must behave
// byte-identically.
//
// WHAT IT PROVES
//   1. DELEGATION, in source bytes (the billing-cadence technique: read the
//      SHIPPED file, assert on it - a paraphrase can drift, bytes cannot).
//      The representative helpers delegate to transportStripeFetch and no
//      longer read a Stripe key from env themselves. A restored local env read
//      is the exact regression that would silently un-route direct academies
//      back onto the platform key (MUTATE=localenv).
//   2. PRECEDENCE. onboarding/checkout.js, website/checkout.js, camp-checkout
//      and parent/_stripe.ts pass ONBOARDING_STRIPE_SECRET_KEY as keyOverride
//      when set - the test-sandbox override those files always honored first.
//   3. THE ERROR CONTRACTS SURVIVE. parent/_stripe.ts still throws its own
//      StripeFetchError (message / stripeStatus / responseBody) and its
//      isTestMode / intervalFor / piSecretFromSub are untouched.
//   4. MONEY GATES are three-outcome (house rule 10, option B - ruled by the
//      orchestrator 2026-07-31): ready = the stored-field check, unchanged;
//      not-ready = the row answered, existing 409/400 wording unchanged;
//      could-not-ask = the clients read THREW -> 503 "could not verify billing
//      setup, try again" - NEVER the 409. A gate that answers "not connected"
//      when the database was unreachable states an outage as a fact about an
//      academy (MUTATE=gate409).
//   5. PUBLISHABLE KEYS come from the resolver's publishableFor at every return
//      site that used to read process.env.STRIPE_PUBLISHABLE_KEY directly.
//   6. kpis-v15 payouts DEGRADE: when getCapabilities says a direct key lacks
//      the payouts permission, the revenue payload carries payouts: null - "we
//      cannot see them" - instead of $0.00-as-if-none-happened or a throw.
//   7. EXECUTABLE: the transport itself (imported for real, fetch stubbed)
//      passes pre-encoded STRING bodies through byte-for-byte (api/members.js
//      relies on that), drops null/undefined from object bodies, and throws the
//      superset error shape every hollowed caller reads.
//
// WHAT IT DOES NOT PROVE. That the resolver picks the right transport per
// account - that is api/_stripe-transport.test.mjs's job. Nothing here touches
// a database or the network.
//
// ─────────────────────────────────────────────────────────────────────────────
// NEGATIVE CONTROLS. Each breaks one thing IN MEMORY and requires this suite's
// own assertions to notice; a control run must PRINT the banner:
//
//   MUTATE=localenv node api/_stripe-callsite-wave.test.mjs
//     restores api/members.js's helper to reading its own env key - caught by
//     the delegation assertions (1).
//   MUTATE=gate409  node api/_stripe-callsite-wave.test.mjs
//     makes website/checkout.js's gate answer 409 "not connected" when the
//     clients read THREW - caught by the three-outcome assertions (4).
//   MUTATE=pubcatch node api/_stripe-callsite-wave.test.mjs
//     strips the Connect-fallback .catch off one publishableFor return site,
//     restoring the resolver as a hard-failure point AFTER the subscription
//     exists - caught by the publishable-key assertions (5).
//
// EXIT CODES read like the other control suites: a control run exits 0 when the
// mutation IS caught (the banner prints), 1 when it slipped through or the pin
// it mutates no longer matches. CI must look for the banner, not the exit code.
// ─────────────────────────────────────────────────────────────────────────────

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const MUTATE = process.env.MUTATE || "";
const HERE = path.dirname(fileURLToPath(import.meta.url));
const read = (rel) => fs.readFileSync(path.join(HERE, rel), "utf8");

const MEMBERS = read("members.js");
const WEB = read("website/checkout.js");
const ONB = read("onboarding/checkout.js");
const CAMP = read("website/camp-checkout.js");
const PARENT = read("parent/_stripe.ts");
const KPIS = read("kpis-v15.js");
const ACTION = read("action-items.js");

let pass = 0, fail = 0;
function report(results) {
  for (const r of results) {
    if (r.ok) { pass++; console.log(`  ✅ ${r.msg}`); }
    else { fail++; console.log(`  ❌ ${r.msg}`); }
  }
}

// Cut a top-level function's body out of a file by its declaration line. Loud on
// a moved pin: a cut that fails to apply must never look like a passing check.
function cut(src, decl, label) {
  const i = src.indexOf(decl);
  if (i < 0) throw new Error(`PIN MOVED: ${label} no longer contains the declaration line:\n  ${decl}`);
  const end = src.indexOf("\n}", i);
  if (end < 0) throw new Error(`PIN MOVED: could not find the closing brace of ${label}'s helper`);
  return src.slice(i, end + 2);
}

// ─── 1. delegation: api/members.js (the representative, string-body caller) ──
function checkMembersDelegation(src) {
  const out = [];
  const helper = cut(src, 'async function stripeFetch(path, { method = "GET", body, stripeAccount, idempotencyKey } = {}) {', "members.js");
  out.push({ ok: /return transportStripeFetch\(path, \{ method, body, stripeAccount, idempotencyKey \}\);/.test(helper),
    msg: "members.js: stripeFetch is a hollow delegation to the transport, same name, same signature" });
  out.push({ ok: !/process\.env/.test(helper),
    msg: "members.js: the helper reads NO env key of its own - the resolver owns key selection" });
  out.push({ ok: !/api\.stripe\.com/.test(helper) && !/Authorization/.test(helper),
    msg: "members.js: the helper builds no Stripe request of its own (no URL, no auth header)" });
  out.push({ ok: src.includes('import { stripeFetch as transportStripeFetch } from "./_stripe-transport.js";'),
    msg: "members.js: imports the transport under an alias, keeping the local name free" });
  const calls = (src.match(/\bstripeFetch\(/g) || []).length - 1; // minus the declaration
  out.push({ ok: calls >= 30,
    msg: `members.js: the call sites are untouched (${calls} calls still go through the local name)` });
  out.push({ ok: src.includes("await stripeFetch(`/subscriptions/${member.stripe_subscription_id}`, {"),
    msg: "members.js: a known billing call site is byte-identical" });
  return out;
}

// ─── 4. the three-outcome money gate (generic over the six gate files) ───────
function checkGateThreeOutcome(src, label, notReadyLine) {
  const out = [];
  const catch503 = /\} catch \{\s*return res\.status\(503\)\.json\(\{ error: "could not verify billing setup, try again" \}\);\s*\}/;
  out.push({ ok: catch503.test(src),
    msg: `${label}: a clients read that THREW returns 503 could-not-ask, in a catch of its own` });
  out.push({ ok: !/catch \{\s*return res\.status\(409\)/.test(src) && !/catch \{\s*return res\.status\(400\)/.test(src),
    msg: `${label}: no catch turns a failed read into the not-connected answer (503, NEVER the 409)` });
  out.push({ ok: src.includes(notReadyLine),
    msg: `${label}: the not-ready wording for a row that ANSWERED is unchanged` });
  return out;
}

// ─── 2 + 5. precedence and publishable keys ─────────────────────────────────
// Every publishableFor site carries the SAME .catch fallback: these returns fire
// AFTER the subscription/PaymentIntent exists, and before this wave they could
// not fail. A resolver hiccup (the Supabase read behind publishableFor) must
// degrade to the Connect answer the site always returned - never 500 a
// checkout the parent already paid for (tester defect D1; MUTATE=pubcatch).
const pubCatch = (acct) => `publishableFor(${acct}).catch(() => ({ publishable_key: process.env.STRIPE_PUBLISHABLE_KEY || null, stripe_account: ${acct} || null }))`;
const PUB_WITH_CATCH = pubCatch("stripeAccount"); // the exact string the pubcatch control strips
function checkOverridesAndPublishable(web = WEB, onb = ONB, camp = CAMP) {
  const out = [];
  for (const [label, src] of [["website/checkout.js", web], ["onboarding/checkout.js", onb], ["website/camp-checkout.js", camp]]) {
    out.push({ ok: src.includes("keyOverride: process.env.ONBOARDING_STRIPE_SECRET_KEY || undefined,"),
      msg: `${label}: ONBOARDING_STRIPE_SECRET_KEY keeps first precedence, as keyOverride` });
  }
  // The parent-app sites ride the same rule: a direct academy's parents must
  // mount Stripe.js with the key that matches their client secret, so those
  // return sites ask the resolver too, with the same Connect fallback.
  const SITES = [
    ["website/checkout.js", web, 2, "stripeAccount"],
    ["onboarding/checkout.js", onb, 2, "stripeAccount"],
    ["website/camp-checkout.js", camp, 1, "stripeAccount"],
    ["parent/checkout.ts", read("parent/checkout.ts"), 2, "stripeAccount"],
    ["parent/billing.ts", read("parent/billing.ts"), 1, "academy.stripeAccount"],
  ];
  for (const [label, src, n, acct] of SITES) {
    const found = src.split(`publishableFor(${acct})`).length - 1;
    out.push({ ok: found === n,
      msg: `${label}: ${n} return site(s) ask the resolver's publishableFor (saw ${found})` });
    const guarded = src.split(pubCatch(acct)).length - 1;
    out.push({ ok: guarded === n,
      msg: `${label}: all ${n} publishableFor site(s) carry the Connect-fallback .catch - they cannot 500 after the money moved (saw ${guarded})` });
    const envReads = (src.match(/publishable_key: process\.env\.STRIPE_PUBLISHABLE_KEY/g) || []).length;
    out.push({ ok: envReads === n,
      msg: `${label}: the direct env read survives ONLY inside the ${n} catch fallback(s), nowhere else (saw ${envReads})` });
  }
  return out;
}

// ─── 3. parent/_stripe.ts error contract + untouched trio ──────────────────
function checkParent(src) {
  const out = [];
  out.push({ ok: src.includes("export class StripeFetchError extends Error")
      && src.includes("readonly responseBody: unknown;")
      && src.includes("readonly stripeStatus: number | null;"),
    msg: "parent/_stripe.ts: StripeFetchError keeps its exported shape (message/stripeStatus/responseBody)" });
  out.push({ ok: src.includes('if (!key) throw new StripeFetchError("Stripe secret key not configured");'),
    msg: "parent/_stripe.ts: the no-key-configured guard still throws the same StripeFetchError first" });
  out.push({ ok: src.includes("transportStripeFetch(path, {")
      && src.includes("keyOverride: process.env.ONBOARDING_STRIPE_SECRET_KEY || undefined,"),
    msg: "parent/_stripe.ts: stripeFetch delegates to the transport with the ONBOARDING override" });
  out.push({ ok: src.includes("throw new StripeFetchError(err.message"),
    msg: "parent/_stripe.ts: transport errors are rethrown AS StripeFetchError for the importers" });
  out.push({ ok: src.includes('return String(process.env.ONBOARDING_STRIPE_SECRET_KEY || "").startsWith("sk_test");'),
    msg: "parent/_stripe.ts: isTestMode is untouched" });
  out.push({ ok: src.includes('if (term === "3_months") return { interval: "month", interval_count: 3 };'),
    msg: "parent/_stripe.ts: intervalFor is untouched" });
  out.push({ ok: src.includes("const confirmationSecret = (latestInvoice as { confirmation_secret?: unknown }).confirmation_secret;"),
    msg: "parent/_stripe.ts: piSecretFromSub is untouched" });
  return out;
}

// ─── 6. kpis-v15 payouts degrade to null when the key cannot see them ────────
function checkKpisPayouts(src) {
  const out = [];
  out.push({ ok: src.includes('import { stripeFetch as transportStripeFetch, getCapabilities } from "./_stripe-transport.js";'),
    msg: "kpis-v15.js: asks the resolver (getCapabilities) for the per-transport payouts fact" });
  out.push({ ok: src.includes("const caps = await getCapabilities(acct).catch(() => null);")
      && src.includes("caps.payouts !== false"),
    msg: "kpis-v15.js: a capability row saying payouts:false switches the payouts read off" });
  out.push({ ok: src.includes("payouts: payoutsArr ? money(payouts) : null,")
      && src.includes("payouts_count: payoutsArr ? payoutsArr.length : null,"),
    msg: "kpis-v15.js: an unreadable payouts feed reports null, never $0.00-as-a-fact" });
  out.push({ ok: src.includes("? await stripeGetAll(`/payouts?created[gte]=${start}&created[lt]=${end}`, acct).catch(() => [])"),
    msg: "kpis-v15.js: a permitted-but-failed payouts read still degrades to [] as before" });
  return out;
}

// ─── the sweep: every hollowed file routes through the transport ─────────────
const SWEEP = [
  "members.js", "members/enroll.js", "members/import-cancelled.js", "members-agent.js",
  "offers/create-price.js", "offers/create-discount.js", "offers/kpi-setup.js", "offers/match-prices.js",
  "sorter/cleanup.js", "sorter/fix-payment.js", "sorter/setup-monthly.js", "sorter/take-over.js", "sorter/take-over-ai.js",
  "ghl.js", "marketing.js", "kpis-v15.js", "contacts/stripe-link.js", "stripe/contact.js",
  "admin/backfill-stripe-joined-at.js", "commissions.js",
  "website/checkout.js", "website/camp-checkout.js", "website/validate-coupon.js",
];
// The stripe-bearer constructions the old helpers used. commissions.js's
// platform-invoicing stripeForm keeps `Bearer ${key}` ON PURPOSE (BAM's own
// account, not academy-scoped) and is not in this list.
const OLD_BEARERS = ["Bearer ${stripeKey()}", "Bearer ${STRIPE_KEY}", "Bearer ${stripeSecret}", "Bearer ${stripeKey}"];
function checkSweep() {
  const out = [];
  for (const rel of SWEEP) {
    const src = read(rel);
    const leftovers = OLD_BEARERS.filter((b) => src.includes(b));
    out.push({ ok: src.includes("transportStripeFetch(") && leftovers.length === 0,
      msg: `${rel}: routes through the transport${leftovers.length ? ` - STILL BUILDS ITS OWN BEARER: ${leftovers.join(", ")}` : ""}` });
  }
  out.push({ ok: ACTION.includes('import { readAccountHealth } from "./_stripe-transport.js";')
      && ACTION.includes("readAccountHealth({ id: clientId, stripe_connect_account_id: acct })")
      && !/readStripeAccount\(/.test(ACTION),
    msg: "action-items.js: backfillStripeWhenChargeable reads health through the resolver, same outcome gating" });
  out.push({ ok: ACTION.includes('if (status.outcome !== "ready") return signals;'),
    msg: "action-items.js: only outcome 'ready' can tick the onboarding step, exactly as before" });
  return out;
}

// ─── 7. executable: the transport seam the hollow helpers now stand on ───────
async function checkTransportExecutable() {
  const out = [];
  const { stripeFetch } = await import(pathToFileURL(path.join(HERE, "_stripe-transport.js")).href);
  const realFetch = globalThis.fetch;
  const calls = [];
  try {
    globalThis.fetch = async (url, init) => {
      calls.push({ url, init });
      return { ok: true, status: 200, text: async () => '{"id":"sub_1"}' };
    };
    // (a) a pre-encoded STRING body passes through byte-for-byte (members.js's contract)
    const raw = "items[0][price]=price_1&metadata[athlete_name]=A%20B";
    await stripeFetch("/subscriptions", { method: "POST", body: raw, stripeAccount: "acct_1", keyOverride: "rk_live_ctrl" });
    const a = calls[0];
    out.push({ ok: a.url === "https://api.stripe.com/v1/subscriptions" && a.init.body === raw,
      msg: "transport: a pre-encoded string body reaches Stripe byte-for-byte" });
    out.push({ ok: a.init.headers.Authorization === "Bearer rk_live_ctrl" && a.init.headers["Stripe-Account"] === "acct_1"
        && a.init.headers["Content-Type"] === "application/x-www-form-urlencoded",
      msg: "transport: keyOverride is the bearer and the caller's Stripe-Account header survives" });
    // (b) object bodies drop null/undefined - the shape every old helper encoded
    await stripeFetch("/prices", { method: "POST", body: { currency: "cad", unit_amount: 7500, nope: null, gone: undefined }, keyOverride: "rk_live_ctrl" });
    out.push({ ok: calls[1].init.body === "currency=cad&unit_amount=7500",
      msg: "transport: object bodies drop null/undefined keys exactly like the old helpers" });
    // (c) the error superset every hollowed caller reads
    globalThis.fetch = async () => ({ ok: false, status: 402, text: async () => JSON.stringify({ error: { message: "Your card was declined." } }) });
    let err = null;
    try { await stripeFetch("/charges", { method: "POST", body: { amount: 1 }, keyOverride: "rk_live_ctrl" }); } catch (e) { err = e; }
    out.push({ ok: !!err && err.message === "Your card was declined." && err.stripeStatus === 402
        && !!err.stripeResponse && err.responseBody === err.stripeResponse,
      msg: "transport: errors carry message + stripeStatus + stripeResponse + responseBody (both legacy shapes)" });
  } finally {
    globalThis.fetch = realFetch;
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// NEGATIVE CONTROLS
// ─────────────────────────────────────────────────────────────────────────────
if (MUTATE === "localenv") {
  // Restore the helper's own env-key read - the regression that would silently
  // put a direct academy's traffic back on the platform key.
  const pin = "return transportStripeFetch(path, { method, body, stripeAccount, idempotencyKey });";
  if (!MEMBERS.includes(pin)) { console.error("PIN MOVED: members.js delegation line not found; the control cannot run."); process.exit(1); }
  const mutated = MEMBERS.replace(pin,
    'const stripeSecret = process.env.STRIPE_CONNECT_SECRET_KEY || process.env.STRIPE_SECRET_KEY;\n  return transportStripeFetch(path, { method, body, stripeAccount, idempotencyKey, keyOverride: stripeSecret });');
  const results = checkMembersDelegation(mutated);
  const caught = results.some((r) => !r.ok);
  console.log(caught
    ? "NEGATIVE CONTROL PASSED (localenv) - a restored local env-key read was flagged by the delegation assertions."
    : "❌ NEGATIVE CONTROL FAILED (localenv) - the helper went back to choosing its own key and every assertion still passed.");
  process.exit(caught ? 0 : 1);
}

if (MUTATE === "gate409") {
  // Make the gate state "not connected" when the clients read THREW - the exact
  // collapse house rule 10 exists to stop.
  const pin = 'return res.status(503).json({ error: "could not verify billing setup, try again" });';
  if (!WEB.includes(pin)) { console.error("PIN MOVED: website/checkout.js 503 gate line not found; the control cannot run."); process.exit(1); }
  const mutated = WEB.replace(pin, 'return res.status(409).json({ error: "academy is not connected to Stripe" });');
  const results = checkGateThreeOutcome(mutated, "website/checkout.js", 'return res.status(409).json({ error: "academy is not connected to Stripe" });');
  const caught = results.some((r) => !r.ok);
  console.log(caught
    ? "NEGATIVE CONTROL PASSED (gate409) - a gate answering 409 not-connected on a THROWN read was flagged by the three-outcome assertions."
    : "❌ NEGATIVE CONTROL FAILED (gate409) - an outage now reads as 'not connected' and nothing here noticed.");
  process.exit(caught ? 0 : 1);
}

if (MUTATE === "pubcatch") {
  // Strip the fallback off ONE return site - publishableFor becomes a hard
  // failure point again, on a response that fires after the sub was created.
  if (!WEB.includes(PUB_WITH_CATCH)) { console.error("PIN MOVED: website/checkout.js publishableFor+catch not found; the control cannot run."); process.exit(1); }
  const mutated = WEB.replace(PUB_WITH_CATCH, "publishableFor(stripeAccount)");
  const results = checkOverridesAndPublishable(mutated, ONB, CAMP);
  const caught = results.some((r) => !r.ok);
  console.log(caught
    ? "NEGATIVE CONTROL PASSED (pubcatch) - an unguarded publishableFor return site was flagged by the fallback assertions."
    : "❌ NEGATIVE CONTROL FAILED (pubcatch) - a post-payment return site can 500 on a resolver hiccup and nothing here noticed.");
  process.exit(caught ? 0 : 1);
}

if (MUTATE) {
  console.error(`Unknown MUTATE="${MUTATE}". Known controls: localenv, gate409, pubcatch`);
  process.exit(1);
}

// ─────────────────────────────────────────────────────────────────────────────
// The real run
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n── 1. delegation (members.js, the string-body representative) ──");
report(checkMembersDelegation(MEMBERS));

console.log("\n── 2+5. ONBOARDING precedence + publishableFor at the return sites ──");
report(checkOverridesAndPublishable());

console.log("\n── 3. parent/_stripe.ts error contract + untouched trio ──");
report(checkParent(PARENT));

console.log("\n── 4. money gates: three outcomes, could-not-ask is 503 ──");
report(checkGateThreeOutcome(WEB, "website/checkout.js", 'return res.status(409).json({ error: "academy is not connected to Stripe" });'));
report(checkGateThreeOutcome(ONB, "onboarding/checkout.js", 'return res.status(409).json({ error: "academy is not connected to Stripe" });'));
report(checkGateThreeOutcome(MEMBERS, "members.js", "Stripe not connected for this academy. Click 'Connect Stripe' on the Members tab first."));
report(checkGateThreeOutcome(read("members/enroll.js"), "members/enroll.js", `return res.status(409).json({ error: "Stripe isn't connected for this academy - connect it on the Members tab first" });`));
report(checkGateThreeOutcome(read("offers/create-price.js"), "offers/create-price.js", 'return res.status(409).json({ error: "academy not connected to Stripe" });'));
report(checkGateThreeOutcome(read("offers/match-prices.js"), "offers/match-prices.js", 'return res.status(409).json({ error: "academy not connected to Stripe" });'));

console.log("\n── 6. kpis-v15 payouts degrade when the key cannot see them ──");
report(checkKpisPayouts(KPIS));

console.log("\n── sweep: every hollowed file routes through the transport ──");
report(checkSweep());

console.log("\n── 7. executable: the transport seam itself (fetch stubbed) ──");
report(await checkTransportExecutable());

console.log(fail ? `\n❌ ${pass} passed, ${fail} failed.` : `\n✅ ${pass} passed, 0 failed.`);
process.exit(fail ? 1 : 0);
