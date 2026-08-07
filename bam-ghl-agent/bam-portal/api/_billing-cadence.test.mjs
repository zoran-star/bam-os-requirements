// BILLING CADENCE: the clock a price re-bills on, told apart from the term key.
//
//   node api/_billing-cadence.test.mjs
//
// WHAT THIS IS ABOUT.
// api/website/checkout.js used to decide the Stripe recurring shape from the term
// key alone: 3_months -> month x3, 6_months -> month x6, everything else ->
// week x4. Three shapes, hardcoded, with no way to say anything else. Zoran ruled
// on 2026-07-30 that San Jose's 3 and 6 month prepaid terms must re-bill every 12
// and 24 WEEKS, and true calendar-monthly did not exist at all.
//
// The term key could not be repurposed. It is the COMMITMENT'S IDENTITY - what
// source_offer_price_key joins on, what the agreement PDF's term noun reads, what
// the commitment-revert logic gates on - and LIVE rows including BAM GTA's use
// 3_months / 6_months meaning calendar months. Changing what those keys mean
// would have changed live billing for academies nobody asked about.
//
// The commitment free text could not carry it either, and that is worth stating
// because it looks like the obvious fix. Production holds BOTH notations for the
// same shape: GTA's archived tiers say "12 Weeks (3 Months)", San Jose says
// "3 Months (12 Weeks)". Both match /(\d+)\s*month/ AND /12\s*week/. No pattern
// over that text can separate a 12-week clock from a calendar quarter, so
// termFromLength and lengthMatchesTerm are deliberately untouched.
//
// So cadence is DATA: offer_prices.billing_cadence, explicit and nullable, with
// NULL meaning "exactly what this build always did".
//
// WHAT IT PROVES
//   1. THE GTA GUARANTEE. A row with no cadence - null, absent, or the column not
//      selected at all - resolves to byte-identically today's three shapes, for
//      every term including an unknown one. This is the assertion that says the
//      change is safe to deploy before anybody sets a single cadence.
//   2. Each cadence in the vocabulary resolves to its declared Stripe shape, and
//      the shapes are declared HERE rather than read from the code, so the code
//      agreeing with itself cannot pass this.
//   3. A cadence the build does not know FALLS BACK to the legacy shape, flags
//      itself for an admin, and never throws. Money is never billed on a guess.
//   4. The anchor math, which is where a cadence stops being a label: a 12-week
//      commitment anchors +84 days, a 3-calendar-month one lands on the calendar
//      date, and 3_calendar_months is provably the same date as legacy 3_months.
//   5. The vocabulary does not FORK. The map lives in api/_billing-cadence.js,
//      which api/website/checkout.js (which charges) and api/_off-card.js (which
//      reminds an owner to collect cash) both IMPORT, so those two cannot differ
//      at all; api/offers/create-price.js (which mints the Stripe price) still
//      writes its own copy and is compared entry by entry; api/website/offer.js
//      labels the same keys; the migration's CHECK constraint allows the same
//      keys and no others. All are compared. A price minted on one clock and
//      billed on another is the worst outcome available here, and this is what
//      stops it.
//   6. Both idempotency keys carry the cadence when there is one. Without that,
//      re-minting after a cadence change hands back Stripe's CACHED price on the
//      OLD clock with no error anywhere.
//   6b. THE WIRING. Section 1-5 prove the functions BEHAVE, which an independent
//      tester showed is a different claim: three mutations that left every
//      function perfect and broke only the CALLS passed 196 of 196. The anchor
//      and the test-price binding, the handler's single resolveInterval call, and
//      every billed-row select going through the pending-column retry are now
//      pinned, structurally as well as by text.
//   6c. The minter's cadence lookup is scoped like the row that gets BILLED -
//      same offer, active, routable, ordered. Reading a DEACTIVATED or a
//      different offer's row would mint week x12 against a row billed on months.
//   6d. THE ONE-TIME PATH, in bytes. A sign-up fee handed a model-supplied
//      {interval:"month"} produces a Stripe body with no recurring block at all.
//      This was asserted only as source text before, which is how a $75 one-time
//      fee mintable as a $75 monthly subscription stayed uncovered.
//   6e. Propose and apply resolve the SAME cadence, which needs the browser to
//      send offer_id on both calls. Without it the review screen an owner approves
//      describes a clock the mint does not use.
//   7. The cadence survives offers-sync's deactivate-and-recreate. That sequence
//      is how a re-minted price silently loses its clock, and it raises no error
//      at any step, so nothing but a test was ever going to catch it.
//
// WHAT IT DOES NOT PROVE
//   - That the pending-column retries actually work against PostgREST. They are
//     asserted as source text here, not exercised. The MECHANISM they copy is
//     proven in api/_pending-client-column.test.mjs, against the real modules.
//   - That the SORTER UI RENDERS the right cadence. Its own interval label is
//     still computed from the recommendation's recurring shape, so "every 12
//     weeks" reads as "every 12 weeks" but the styling around it is untested here.
//     What IS proven (6e) is that the browser now sends offer_id on propose, which
//     is what lets the server resolve the cadence at all - before that the SENTENCE
//     the owner approved said "every 3 months" while apply minted week x12.
//   - That any academy's rows carry a correct cadence. This suite never touches a
//     database. Setting San Jose's rows is a separate, human, reviewable step.
//   - That the webhook's commitment schedule honors cadence. It reads the term
//     metadata and is out of scope for this build.
//
// HOW IT RUNS. No imports of the real modules and no node_modules: checkout.js
// pulls pdf-lib through the agreement renderer, and a suite that cannot run
// without an install is a suite CI's plain-node step cannot run at all. Instead
// the exact source text of each function is CUT OUT of the shipped file by its
// own declaration line and imported as a temporary module. What executes below is
// the shipped code byte for byte, not a paraphrase of it - and a declaration that
// has been renamed or reformatted makes the extraction FAIL LOUDLY rather than
// quietly test nothing.
//
// ─────────────────────────────────────────────────────────────────────────────
// NEGATIVE CONTROL. Breaks one thing; the suite must print NEGATIVE CONTROL PASSED:
//
//   MUTATE=cadence  node api/_billing-cadence.test.mjs   # resolveInterval stops
//                                                        # consulting the cadence and
//                                                        # goes back to term-only, i.e.
//                                                        # the exact behavior this
//                                                        # build replaced. Every legacy
//                                                        # assertion still passes (that
//                                                        # is the point of it), so only
//                                                        # the cadence assertions can
//                                                        # catch it.
//
// EXIT CODES, because they read backwards on purpose. A control run exits ZERO
// when the mutation IS caught - the suite is reporting "the control worked",
// which is a success. It exits 1 when the mutation changed nothing anybody
// noticed, or when its pin no longer matches. So CI must not read a non-zero exit
// as proof of catching; it must look for the NEGATIVE CONTROL PASSED banner,
// which is exactly what .github/workflows/portal-ci.yml does.

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
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// ─── cutting the shipped code out of the shipped files ───────────────────────
// Find a declaration by its exact opening line, then brace-match to its end. A
// pin that no longer matches sets controlBroken and throws, because a mutation
// (or an extraction) that fails to apply looks exactly like a check that passed.
function readSource(rel) {
  return fs.readFileSync(path.join(HERE, rel), "utf8");
}
function cut(src, pin, where) {
  const at = src.indexOf(pin);
  if (at === -1) {
    controlBroken = `This suite is pinned to text that is no longer in api/${where}:\n\n${pin}\n\nThe code it was written against has moved or been renamed, so it proves nothing. Re-point it, or delete it.`;
    throw new Error(controlBroken);
  }
  let i = src.indexOf("{", at);
  let depth = 0;
  for (; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}") { depth--; if (depth === 0) return src.slice(at, i + 1) + ";\n"; }
  }
  controlBroken = `unbalanced braces after ${pin} in api/${where}`;
  throw new Error(controlBroken);
}

const CHECKOUT = readSource("website/checkout.js");
const CREATE_PRICE = readSource("offers/create-price.js");
const OFFER = readSource("website/offer.js");
// RE-POINTED 2026-08-07 (off-Stripe payments build). These five definitions used
// to live INSIDE api/website/checkout.js and were cut out of it here. They moved,
// byte for byte, to api/_billing-cadence.js when a second shipping consumer
// arrived (api/_off-card.js, the off-card collections engine) - copying them
// would have made a third copy of the arithmetic that decides when a parent is
// charged. checkout.js now IMPORTS them, so the pins below aim at the module.
//
// This is a strictly stronger claim than before: checkout.js can no longer drift
// from what this suite tests, because it does not carry the code at all. The
// create-price.js mirror in section 5 is untouched and still compared.
const SHARED = readSource("_billing-cadence.js");
const MIGRATION = fs.readFileSync(
  path.join(HERE, "..", "supabase", "migrations", "20260730T230000_offer_prices_billing_cadence.sql"), "utf8"
);

// The five pieces of api/_billing-cadence.js that decide an interval, as themselves.
let module_ = [
  cut(SHARED, "const CADENCES = {", "_billing-cadence.js"),
  cut(SHARED, "function intervalFor(term) {", "_billing-cadence.js"),
  cut(SHARED, "function resolveInterval(row, term) {", "_billing-cadence.js"),
  cut(SHARED, "function addInterval(date, iv) {", "_billing-cadence.js"),
  cut(SHARED, "function cadenceWarning(iv) {", "_billing-cadence.js"),
  "export { CADENCES, intervalFor, resolveInterval, addInterval, cadenceWarning };\n",
].join("\n");

// The mutation, expressed against the real source text: resolveInterval stops
// consulting the cadence, which is precisely the code that shipped before this
// build. Legacy behavior is untouched by it, on purpose.
if (MUTATE === "cadence") {
  const pin = "  if (raw && Object.prototype.hasOwnProperty.call(CADENCES, raw)) {";
  if (!module_.includes(pin)) {
    controlBroken = `the cadence control is pinned to text that is no longer in api/website/checkout.js:\n\n${pin}`;
    console.log(`\n❌ NEGATIVE CONTROL FAILED: ${controlBroken}`);
    process.exit(1);
  }
  module_ = module_.split(pin).join("  if (false) {   // MUTATED: cadence ignored");
}

const TMP = path.join(HERE, ".billing-cadence-under-test.mjs");
fs.writeFileSync(TMP, module_);
let M;
try { M = await import(pathToFileURL(TMP).href); }
finally { try { fs.unlinkSync(TMP); } catch (_) { /* best effort */ } }
const { CADENCES, intervalFor, resolveInterval, addInterval, cadenceWarning } = M;

// ─── the shapes, declared HERE ───────────────────────────────────────────────
// Written out in this file on purpose. If the expectations were read from the
// code, the code would only ever be checked against itself and every one of
// these assertions would pass by construction.
const LEGACY = {
  "4_weeks": { interval: "week", interval_count: 4 },
  "3_months": { interval: "month", interval_count: 3 },
  "6_months": { interval: "month", interval_count: 6 },
};
const EXPECTED_CADENCES = {
  "4_weeks": { interval: "week", interval_count: 4 },
  monthly: { interval: "month", interval_count: 1 },
  "12_weeks": { interval: "week", interval_count: 12 },
  "24_weeks": { interval: "week", interval_count: 24 },
  "3_calendar_months": { interval: "month", interval_count: 3 },
  "6_calendar_months": { interval: "month", interval_count: 6 },
};
const shapeOf = (iv) => ({ interval: iv.interval, interval_count: iv.interval_count });

// ─── 1. the GTA guarantee: no cadence means today, exactly ───────────────────
console.log("\n── 1. a row with NO cadence bills exactly what it bills today ──");
for (const [term, want] of Object.entries(LEGACY)) {
  for (const [label, row] of [
    ["billing_cadence: null", { billing_cadence: null }],
    ["the key absent from the row", {}],
    ["the column never selected (row is a plain price row)", { id: "op-1", billing_interval: term, stripe_price_id: "price_1" }],
    ["no row at all", null],
  ]) {
    const iv = resolveInterval(row, term);
    ok(same(shapeOf(iv), want), `${term} with ${label} -> ${JSON.stringify(want)}`);
    ok(iv.cadence === null, `${term} with ${label}: reports no cadence`);
    ok(iv.unknown_cadence === null, `${term} with ${label}: nothing flagged`);
  }
  ok(same(shapeOf(intervalFor(term)), want), `and intervalFor("${term}") itself is untouched`);
}
{
  // The default branch: anything that is not a 3/6 month term bills every 4
  // weeks. GTA's live monthly rows arrive here as "4_weeks", and a row whose
  // billing_interval never got healed arrives as something else entirely.
  for (const term of ["monthly", "week", "one_time", "", null, undefined, "nonsense"]) {
    ok(same(shapeOf(resolveInterval({}, term)), LEGACY["4_weeks"]),
      `an unhandled term (${JSON.stringify(term)}) still falls to week x4`);
  }
}

// ─── 2. each cadence resolves its declared shape ─────────────────────────────
console.log("\n── 2. every cadence in the vocabulary resolves to its declared shape ──");
for (const [cad, want] of Object.entries(EXPECTED_CADENCES)) {
  // The term is varied deliberately: a cadence that is set OVERRIDES the term,
  // so the same cadence on a 3_months row and a 6_months row must bill the same.
  for (const term of ["4_weeks", "3_months", "6_months"]) {
    const iv = resolveInterval({ billing_cadence: cad }, term);
    ok(same(shapeOf(iv), want), `${cad} on a ${term} row -> ${JSON.stringify(want)}`);
    ok(iv.cadence === cad, `${cad} on a ${term} row: reports itself`);
    ok(iv.unknown_cadence === null, `${cad} on a ${term} row: nothing flagged`);
  }
}
ok(same(shapeOf(resolveInterval({ billing_cadence: "12_weeks" }, "3_months")), { interval: "week", interval_count: 12 }),
  "the ruling itself: 12_weeks bills week x12, not month x3");
ok(same(shapeOf(resolveInterval({ billing_cadence: "monthly" }, "4_weeks")), { interval: "month", interval_count: 1 }),
  "true calendar monthly exists: monthly bills month x1, not week x4");
ok(!same(shapeOf(resolveInterval({ billing_cadence: "monthly" }, "4_weeks")), LEGACY["4_weeks"]),
  "and monthly is NOT the same thing as the 4_weeks default it used to collapse into");
{
  // Whitespace and case are normalized, because a human types these into a
  // portal field and " 12_Weeks " must not silently become legacy billing.
  const iv = resolveInterval({ billing_cadence: "  12_Weeks  " }, "3_months");
  ok(same(shapeOf(iv), { interval: "week", interval_count: 12 }) && iv.cadence === "12_weeks",
    "a value with stray case and whitespace still resolves");
}

// ─── 3. an unknown cadence degrades, flags, and never throws ─────────────────
console.log("\n── 3. a cadence this build does not know bills LEGACY and says so ──");
for (const bad of ["13_weeks", "quarterly", "3 months", "every_other_week", "12weeks", "🙂"]) {
  let iv = null, threw = null;
  try { iv = resolveInterval({ billing_cadence: bad }, "3_months"); } catch (e) { threw = e; }
  ok(!threw, `"${bad}" does not throw${threw ? ` (threw ${threw.message})` : ""}`);
  ok(!!iv && same(shapeOf(iv), LEGACY["3_months"]), `"${bad}" bills the legacy 3_months shape`);
  ok(!!iv && iv.cadence === null, `"${bad}" is not reported as a cadence that worked`);
  ok(!!iv && iv.unknown_cadence === bad.toLowerCase(), `"${bad}" IS flagged for an admin`);
  const warn = cadenceWarning(iv);
  ok(typeof warn === "string" && warn.includes(bad.toLowerCase()), `"${bad}" produces a readable admin note`);
}
ok(cadenceWarning(resolveInterval({ billing_cadence: null }, "3_months")) === null, "a clean row produces NO note");
ok(cadenceWarning(resolveInterval({ billing_cadence: "12_weeks" }, "3_months")) === null, "a known cadence produces NO note");
{
  // Shapes that are not strings at all. A row is data from a database, and the
  // one thing this function may never do on the enrollment path is throw.
  for (const [label, junk] of [["0", 0], ["false", false], ["12", 12], ["[]", []], ["{}", {}], ["a function", () => {}]]) {
    let threw = null, iv = null;
    try { iv = resolveInterval({ billing_cadence: junk }, "6_months"); } catch (e) { threw = e; }
    ok(!threw, `a non-string billing_cadence (${label}) does not throw`);
    ok(!threw && same(shapeOf(iv), LEGACY["6_months"]), `a non-string billing_cadence (${label}) still bills legacy`);
  }
}

// ─── 4. the anchor math, where a cadence stops being a label ─────────────────
console.log("\n── 4. addInterval: a future start date anchors on the CADENCE ──");
const START = new Date("2026-03-15T12:00:00Z");   // mid-month, so a rollover would show
const days = (a, b) => Math.round((b.getTime() - a.getTime()) / 86400000);
{
  const iv = resolveInterval({ billing_cadence: "12_weeks" }, "3_months");
  const at = addInterval(START, iv);
  ok(days(START, at) === 84, `12_weeks anchors +84 days (${at.toISOString().slice(0, 10)}), not a calendar quarter`);
  ok(at.toISOString().slice(0, 10) === "2026-06-07", "12_weeks from 2026-03-15 lands 2026-06-07");
}
{
  const iv = resolveInterval({ billing_cadence: "24_weeks" }, "6_months");
  const at = addInterval(START, iv);
  ok(days(START, at) === 168, `24_weeks anchors +168 days (${at.toISOString().slice(0, 10)})`);
}
{
  const iv = resolveInterval({ billing_cadence: "3_calendar_months" }, "3_months");
  const at = addInterval(START, iv);
  ok(at.toISOString().slice(0, 10) === "2026-06-15", `3_calendar_months lands on the calendar date (${at.toISOString().slice(0, 10)})`);
  // And it is provably the SAME date as the legacy term, which is the whole
  // claim of the name: 3_calendar_months is today's 3_months said out loud.
  const legacyAt = addInterval(START, resolveInterval(null, "3_months"));
  ok(at.getTime() === legacyAt.getTime(), "3_calendar_months == legacy 3_months, to the millisecond");
  ok(days(START, at) !== 84, "and it is NOT the same as 12_weeks, which is the distinction that did not exist before");
}
{
  const iv = resolveInterval({ billing_cadence: "6_calendar_months" }, "6_months");
  const legacyAt = addInterval(START, resolveInterval(null, "6_months"));
  ok(addInterval(START, iv).getTime() === legacyAt.getTime(), "6_calendar_months == legacy 6_months");
}
{
  const at = addInterval(START, resolveInterval({ billing_cadence: "monthly" }, "4_weeks"));
  ok(at.toISOString().slice(0, 10) === "2026-04-15", `monthly anchors on the calendar month (${at.toISOString().slice(0, 10)})`);
  const fourWeeks = addInterval(START, resolveInterval(null, "4_weeks"));
  ok(fourWeeks.toISOString().slice(0, 10) === "2026-04-12", "while the 4-week default lands 2026-04-12");
  ok(at.getTime() !== fourWeeks.getTime(), "so monthly and 4_weeks are genuinely different dates");
}
{
  // Every legacy anchor, unchanged. If this section ever moves, a parent's first
  // recurring charge moved with it.
  const cases = [["4_weeks", "2026-04-12"], ["3_months", "2026-06-15"], ["6_months", "2026-09-15"]];
  for (const [term, want] of cases) {
    ok(addInterval(START, resolveInterval(null, term)).toISOString().slice(0, 10) === want,
      `legacy ${term} still anchors ${want}`);
  }
}

// ─── 5. the vocabulary does not fork ─────────────────────────────────────────
console.log("\n── 5. checkout, the minter, the labels and the migration agree ──");
{
  const KEYS = Object.keys(EXPECTED_CADENCES).sort();
  ok(same(Object.keys(CADENCES).sort(), KEYS), "checkout.js CADENCES holds exactly the expected keys");
  for (const k of KEYS) ok(same(CADENCES[k], EXPECTED_CADENCES[k]), `checkout.js CADENCES.${k} is the declared shape`);

  // api/offers/create-price.js mints the Stripe price. Its copy of the map is
  // parsed out of its own source and compared entry by entry: a price minted on
  // one clock and billed on another is the failure this exists to prevent.
  const minterSrc = cut(CREATE_PRICE, "const CADENCES = {", "offers/create-price.js");
  const minterTmp = path.join(HERE, ".billing-cadence-minter.mjs");
  fs.writeFileSync(minterTmp, minterSrc + "\nexport { CADENCES as MINT };\n");
  let MINT;
  try { ({ MINT } = await import(pathToFileURL(minterTmp).href)); }
  finally { try { fs.unlinkSync(minterTmp); } catch (_) { /* best effort */ } }
  ok(same(Object.keys(MINT).sort(), KEYS), "create-price.js CADENCES holds the same keys");
  for (const k of KEYS) ok(same(MINT[k], CADENCES[k]), `create-price.js mints ${k} on the shape checkout bills it on`);

  // api/website/offer.js only labels them, but a label for a cadence that does
  // not exist (or a cadence with no label) is how a parent reads the wrong thing.
  const labelSrc = cut(OFFER, "const CADENCE_LABELS = {", "website/offer.js");
  const labelTmp = path.join(HERE, ".billing-cadence-labels.mjs");
  fs.writeFileSync(labelTmp, labelSrc + "\nexport { CADENCE_LABELS as LABELS };\n");
  let LABELS;
  try { ({ LABELS } = await import(pathToFileURL(labelTmp).href)); }
  finally { try { fs.unlinkSync(labelTmp); } catch (_) { /* best effort */ } }
  ok(same(Object.keys(LABELS).sort(), KEYS), "offer.js CADENCE_LABELS covers every cadence and invents none");
  for (const k of KEYS) ok(typeof LABELS[k] === "string" && LABELS[k].length > 0, `offer.js labels ${k} as "${LABELS[k]}"`);
  ok(LABELS["12_weeks"] === "every 12 weeks" && LABELS["3_calendar_months"] === "every 3 months",
    "and the two that a parent could confuse read differently from each other");

  // The migration's CHECK constraint. A vocabulary the database rejects is a
  // feature that fails on the day somebody first uses it.
  const check = MIGRATION.slice(MIGRATION.indexOf("billing_cadence in ("));
  const allowed = (check.slice(0, check.indexOf(")")).match(/'([a-z0-9_]+)'/g) || []).map((s) => s.replace(/'/g, "")).sort();
  ok(same(allowed, KEYS), `the migration's CHECK allows exactly these keys (${allowed.join(", ")})`);
  ok(/billing_cadence is null or/.test(MIGRATION), "and it allows NULL, which is what every existing row is");
  ok(/add column if not exists billing_cadence/.test(MIGRATION), "the column add is idempotent");
  ok(!/\bupdate\s+offer_prices\b/i.test(MIGRATION), "the migration writes NO data, so applying it re-bills nobody");
}

// ─── 6. the idempotency keys carry the cadence ───────────────────────────────
// Asserted as source text, and labeled as such: these two lines live inside HTTP
// handlers that cannot run without Stripe. Weak evidence is still the difference
// between someone noticing this line being removed and nobody noticing.
console.log("\n── 6. re-minting after a cadence change cannot return Stripe's cached price ──");
ok(/idempotencyKey: `web-price-\$\{resolvedPriceKey\}-\$\{price\.amount_cents\}\$\{cadenceIv\.cadence \?/.test(CHECKOUT),
  "checkout.js: the test-mode price key includes the cadence when there is one");
ok(/idempotencyKey: `sorter-price-\$\{clientId\}-\$\{key \|\| "nokey"\}-\$\{amount\}\$\{cadence \?/.test(CREATE_PRICE),
  "create-price.js: the mint key includes the cadence when there is one");
ok(/const oneTime = termIv\.recurring === null;\n\s*const cadence = oneTime \? null : await cadenceForCreation\(clientId, c\);/.test(CREATE_PRICE),
  "create-price.js: a one-time price (sign-up fee) never even LOOKS UP a cadence");
// The pending-column retries. The mechanism itself is proven against real
// modules in api/_pending-client-column.test.mjs; what is checked here is that
// this build actually uses one on each read, so an unapplied migration is a
// no-op rather than the enroll outage of July.
ok(/async function sbWithCadence/.test(CHECKOUT), "checkout.js reads billing_cadence through a pending-column retry");
ok(/42703\|does not exist/.test(CHECKOUT), "and the retry is narrow: only an undefined-column error earns it");
ok(/typedSelectFor\(withCadence\)/.test(CHECKOUT), "the plan select asks for the column");
ok(/&is_active=eq\.true&is_routable=eq\.true&limit=1&select=\$\{typedSelect\}`/.test(CHECKOUT),
  "the sign-up fee select deliberately does NOT (plain typedSelect), because its catch drops the fee silently");
ok(/is not readable yet \(migration pending\)/.test(OFFER), "offer.js falls back to the pre-cadence select rather than an empty list");
// RE-STATED (2026-08-06, adjustable prepay lengths). The old pin held the catch
// to `return null` - "an unreadable row cadence is no cadence". The invariant it
// protected was never the return statement; it was that an unreadable row can
// neither THROW on the mint path nor INVENT a clock. Both still hold, but the
// degradation target moved: an unreadable row now falls through to the offer's
// own LENGTH LABEL (cadenceFromOfferLabel), which is read-only, scoped to the
// named offer's non-archived offerings, and returns null on any failure of its
// own - so the worst case is still exactly the term's standard shape.
ok(/\} catch \(_\) \{\n(?:\s*\/\/[^\n]*\n)+\s*\}\n  if \(rowCadence\) return rowCadence;\n  return await cadenceFromOfferLabel\(clientId, offerId, key\);/.test(CREATE_PRICE),
  "create-price.js: an unreadable row cadence degrades to the label derivation, never to a throw");
ok(/async function cadenceFromOfferLabel\(clientId, offerId, key\) \{[\s\S]*?catch \(_\) \{\n    return null;/.test(CREATE_PRICE),
  "create-price.js: and the label derivation itself degrades to null, so nothing on this path invents a cadence");

// ─── 6b. THE WIRING, not just the functions ──────────────────────────────────
//
// Everything above proves resolveInterval BEHAVES. An independent tester showed
// that is not the same claim: three mutations that left the functions perfect and
// broke the CALLS - the anchor reverted to intervalFor(term), resolveInterval
// defined but never invoked, and the plan select bypassing the pending-column
// retry - all passed 196 of 196. A suite that green-lights a build where the
// feature is disconnected is worse than no suite, because it is quoted as
// evidence. These are the pins that close it.
//
// Comment lines are excluded before counting, so prose ABOUT a function is never
// mistaken for a CALL to it.
console.log("\n── 6b. the call sites are actually wired to the cadence ──");
const codeLines = (src) => src.split("\n").filter((l) => !l.trim().startsWith("//"));
const countCalls = (src, needle) => codeLines(src).filter((l) => l.includes(needle)).length;
{
  // The handler's interval comes from the ROW, once, and every later decision
  // reuses that one value.
  ok(/\n    const cadenceIv = resolveInterval\(price, term\);\n/.test(CHECKOUT),
    "checkout.js: the handler resolves the interval with resolveInterval(price, term)");

  // The anchor. Pinned THROUGH to addInterval so `iv` cannot be rebound in
  // between: this is the line that decides a parent's first recurring date.
  ok(/const iv = cadenceIv;\n      const anchorSec = Math\.floor\(addInterval\(new Date\(`\$\{startDate\}T12:00:00Z`\), iv\)/.test(CHECKOUT),
    "checkout.js: the START-DATE ANCHOR binds iv to cadenceIv and feeds it straight to addInterval");

  // The test-mode inline price. Pinned through to the /prices POST for the same
  // reason.
  ok(/if \(testMode\) \{\n(?:\s*\/\/[^\n]*\n)*\s*const iv = cadenceIv;\n\s*const testPrice = await stripeFetch\(`\/prices`/.test(CHECKOUT),
    "checkout.js: the TEST-MODE PRICE binds iv to cadenceIv and mints from it");
  ok(/"recurring\[interval\]": iv\.interval, "recurring\[interval_count\]": iv\.interval_count/.test(CHECKOUT),
    "checkout.js: and that iv is what the Stripe recurring shape is built from");

  // The structural half. Counting is what catches a mutation that reintroduces a
  // direct legacy call ANYWHERE, in any wording, rather than only the two spots
  // named above. intervalFor may be called from exactly three places: its own
  // definition, resolveInterval's fallback, and signupFeeAppliesTo (which uses it
  // as a term-key truthiness check and is deliberately left alone).
  // RE-POINTED 2026-08-07: this used to be one count of 3 over checkout.js, when
  // the definition and resolveInterval's fallback still lived there. The three
  // permitted places are unchanged, they are now split across two files - the
  // module holds its own definition plus the fallback, checkout.js holds the one
  // remaining reference, signupFeeAppliesTo's term-key truthiness check, which is
  // deliberately left alone. Counting BOTH is what still catches a mutation that
  // reintroduces a direct legacy call anywhere, in any wording.
  const ivSharedCalls = countCalls(SHARED, "intervalFor(");
  ok(ivSharedCalls === 2,
    `_billing-cadence.js: intervalFor appears in exactly 2 places, its definition and the fallback (saw ${ivSharedCalls})`);
  const ivCalls = countCalls(CHECKOUT, "intervalFor(");
  ok(ivCalls === 1,
    `checkout.js: intervalFor is referenced exactly once, in signupFeeAppliesTo, and nowhere near a billed row (saw ${ivCalls})`);
  ok(/import \{[^}]*\bintervalFor\b[^}]*\} from "\.\.\/_billing-cadence\.js";/.test(CHECKOUT),
    "checkout.js: and it gets that intervalFor by IMPORT, so it cannot be a second copy");
  const ivTermCalls = codeLines(SHARED)
    .filter((l) => l.includes("intervalFor(term)") && !l.includes("function intervalFor")).length;
  ok(ivTermCalls === 1,
    `_billing-cadence.js: and intervalFor(term) is CALLED exactly once, inside resolveInterval's fallback (saw ${ivTermCalls})`);
  ok(/return \{ \.\.\.intervalFor\(term\), cadence: null, unknown_cadence: raw \|\| null \};/.test(SHARED),
    "_billing-cadence.js: that one call IS the legacy fallback, so the old mapping is still reachable");

  // The selects. Every read of a row that gets BILLED goes through the retry;
  // bypassing it is the pre-migration 400 that takes the enroll page down.
  const swc = countCalls(CHECKOUT, "sbWithCadence(");
  ok(swc === 4, `checkout.js: sbWithCadence is the definition plus THREE call sites (saw ${swc})`);
  ok(/typedRows = await sbWithCadence\(\(withCadence\) =>\n\s*`offer_prices\?tenant_id=eq\.\$\{encodeURIComponent\(clientId\)\}&id=eq\./.test(CHECKOUT),
    "checkout.js: the offer_price_id plan select goes through sbWithCadence");
  ok(/typedRows = await sbWithCadence\(\(withCadence\) =>\n\s*`offer_prices\?tenant_id=eq\.\$\{encodeURIComponent\(clientId\)\}&source_offer_id=eq\./.test(CHECKOUT),
    "checkout.js: the offer_price_key plan select goes through sbWithCadence");
  ok(/monthlyRows = await sbWithCadence\(/.test(CHECKOUT),
    "checkout.js: the commitment-revert select goes through sbWithCadence");
  ok(countCalls(CHECKOUT, "typedRows = await sb(") === 0,
    "checkout.js: and NO plan select calls sb() directly, which is the pre-migration 400");

  // offer.js has to actually pass the typed rows in, or cadence_label is computed
  // from a map nothing ever populates.
  ok(/pricing: buildPricing\(offer, catalogRows, purchasable\)/.test(OFFER),
    "offer.js: buildPricing is CALLED with the typed rows, not just able to accept them");
  ok(/const cadence = cadenceByKey\.get\(opt\.key\) \|\| null;/.test(OFFER),
    "offer.js: each pricing entry looks its cadence up by key");
  ok(/cadence_label: CADENCE_LABELS\[cadence\] \|\| LEGACY_TERM_CADENCE_LABELS\[opt\.term\]/.test(OFFER),
    "offer.js: and the label falls back to the legacy term cadence, never to nothing");

  // create-price.js: the mint has to USE the resolved cadence, and BOTH ends have
  // to use the same decision. Propose and apply computing the recurring shape
  // separately is how the review screen and the mint drifted apart in the first
  // place, so what is pinned is that there is exactly ONE function and both call
  // it. The behavior of that function is section 6d.
  ok(/if \(cadence && Object\.prototype\.hasOwnProperty\.call\(CADENCES, cadence\)\) return CADENCES\[cadence\];/.test(CREATE_PRICE),
    "create-price.js: the Stripe recurring shape is built FROM the cadence when there is one");
  ok(/const recurring = recurringFor\(term, cadence, c\.recurring\);/.test(CREATE_PRICE),
    "create-price.js: APPLY resolves the shape through recurringFor, not from c.recurring");
  ok(/const recurring = recurringFor\(t\.term, rowCadence, a\.recurring\);/.test(CREATE_PRICE),
    "create-price.js: PROPOSE resolves it through the same function, so the two cannot disagree");
  ok(/const recurring = recurringFor\(t\.term, rowCadence, null\);/.test(CREATE_PRICE),
    "create-price.js: and so does the deterministic fallback the owner's sentence is written from");
  const rfCalls = countCalls(CREATE_PRICE, "recurringFor(");
  ok(rfCalls === 4, `create-price.js: recurringFor is the definition plus THREE call sites (saw ${rfCalls})`);
  ok(/body: priceBody\(key, amount, currency, recurring, priceName\),/.test(CREATE_PRICE),
    "create-price.js: and that shape is what reaches Stripe");
  ok(/const encoded = body \? stripeForm\(body\) : undefined;/.test(CREATE_PRICE),
    "create-price.js: the POST is encoded by stripeForm, which is the null-dropping section 6d runs");
}

// ─── 6c. the cadence read is scoped like the row that gets BILLED ────────────
// The function that decides what clock a REAL Stripe price is minted on used to
// read `tenant + key`, unordered, with no active filter. That can read a
// DEACTIVATED row (offers-sync never deletes) or another OFFER's row, because
// offer_price_key is only unique within an offer - and then mints week x12 while
// checkout bills the live row on months. Latent rather than live today (no tenant
// currently has one key across two offers), which is exactly when to fix it.
console.log("\n── 6c. the minter's cadence lookup cannot read a dead or foreign row ──");
{
  const q = CREATE_PRICE.slice(CREATE_PRICE.indexOf("async function cadenceForCreation"));
  const lookup = q.slice(0, q.indexOf("} catch"));
  ok(/source_offer_id=eq\.\$\{encodeURIComponent\(offerId\)\}/.test(lookup),
    "scoped to the offer, because offer_price_key is only unique within one");
  ok(/if \(!key \|\| !offerId\) return null;/.test(q),
    "and no offer_id on the request means NO cadence, not a guess across offers");
  ok(/is_active=eq\.true/.test(lookup), "is_active=true, so a deactivated row cannot supply the clock");
  ok(/is_routable=eq\.true/.test(lookup), "is_routable=true, matching what checkout will actually sell");
  ok(/order=sort_order\.asc/.test(lookup), "ordered, so limit=1 is the same row on every request");
  ok(/billing_cadence=not\.is\.null/.test(lookup), "and only rows that actually declare a cadence are considered");
  ok(/tenant_id=eq\.\$\{encodeURIComponent\(clientId\)\}/.test(lookup), "still tenant-scoped");
}

// ─── 6d. THE ONE-TIME PATH, rendered rather than described ───────────────────
//
// THE DEFECT THIS SECTION EXISTS FOR. A sign-up fee is a ONE-TIME charge:
// termToInterval("signup_fee") is { interval: "one_time", recurring: null }. But
// the AI response schema in create-price.js REQUIRES a `recurring` object on every
// item, so the model returns one for a sign-up fee too; propose passed it through;
// the sorter UI stashes the recommendation verbatim and posts it straight back to
// apply as `c.recurring`. That is a $75 sign-up fee minted as a $75 MONTHLY
// SUBSCRIPTION against a real parent's card, and it was fail-closed only by
// accident - cadenceLabel(null) threw and 500'd the propose call, so nobody ever
// reached apply. Adding a null-guard to cadenceLabel UN-GATED it. An earlier round
// of this build did exactly that.
//
// Everything about that path was previously asserted as source text, which is how
// it stayed uncovered: source text cannot tell you what Stripe receives. So the
// REAL body is built and REAL-encoded here, through the same two functions the
// endpoint uses, and the assertion is on the bytes.
console.log("\n── 6d. a sign-up fee reaches Stripe with no recurring block at all ──");
{
  const src = [
    cut(CREATE_PRICE, "function termToInterval(term) {", "offers/create-price.js"),
    cut(CREATE_PRICE, "const CADENCES = {", "offers/create-price.js"),
    cut(CREATE_PRICE, "function recurringFor(term, cadence, proposed) {", "offers/create-price.js"),
    cut(CREATE_PRICE, "function priceBody(key, amount, currency, recurring, priceName) {", "offers/create-price.js"),
    cut(CREATE_PRICE, "function stripeForm(body) {", "offers/create-price.js"),
    "export { termToInterval, recurringFor, priceBody, stripeForm };\n",
  ].join("\n");
  const tmp = path.join(HERE, ".billing-cadence-mint.mjs");
  fs.writeFileSync(tmp, src);
  let recurringFor, priceBody, stripeForm;
  try { ({ recurringFor, priceBody, stripeForm } = await import(pathToFileURL(tmp).href)); }
  finally { try { fs.unlinkSync(tmp); } catch (_) { /* best effort */ } }

  // What the endpoint actually sends: the form-encoded body, for real.
  const sent = (term, cadence, proposed) =>
    stripeForm(priceBody(`Steady|${term}`, 7500, "cad", recurringFor(term, cadence, proposed), "Steady · sign-up"));

  // The model's answer for a sign-up fee, as the schema forces it to be shaped.
  const MODEL_SAYS_MONTHLY = { interval: "month", interval_count: 1 };

  for (const term of ["signup_fee", "one_time"]) {
    const form = sent(term, null, MODEL_SAYS_MONTHLY);
    ok(!/recurring/.test(form),
      `${term} + a model-supplied {interval:"month"}: NO recurring block reaches Stripe (${form.slice(0, 60)}…)`);
    ok(/unit_amount=7500/.test(form), `${term}: the amount is still charged, once`);
    ok(recurringFor(term, null, MODEL_SAYS_MONTHLY) === null, `${term}: the decision itself is null, not a shape`);
    // And a cadence cannot promote it either - that is the same hole from the
    // other direction, a cadence landing on the sign-up fee row.
    ok(recurringFor(term, "monthly", MODEL_SAYS_MONTHLY) === null,
      `${term}: not even a billing_cadence on the row can make it a subscription`);
    ok(!/recurring/.test(sent(term, "12_weeks", MODEL_SAYS_MONTHLY)),
      `${term}: and that stays true in the bytes`);
    // Junk the client could post back. None of it may open the path.
    for (const [label, junk] of [
      ["a bare interval string", "month"], ["true", true], ["an empty object", {}],
      ["interval_count only", { interval_count: 3 }], ["an array", [{ interval: "month" }]],
    ]) {
      ok(recurringFor(term, null, junk) === null, `${term}: ${label} in the payload is still one-time`);
    }
  }

  // The positive control. If a recurring price ALSO came out with no recurring
  // block, every assertion above would pass and mean nothing.
  {
    const form = sent("3_months", "12_weeks", MODEL_SAYS_MONTHLY);
    ok(/recurring%5Binterval%5D=week/.test(form) && /recurring%5Binterval_count%5D=12/.test(form),
      "positive control: a 12_weeks row DOES send recurring week x12, so the check above is not vacuous");
    ok(!/interval%5D=month/.test(form), "and the model's month x1 lost to the row's cadence");
  }
  // The minter's GTA guarantee: no cadence, no proposal, legacy shapes.
  for (const [term, want] of [["4_weeks", "week"], ["monthly", "week"], ["3_months", "month"], ["6_months", "month"]]) {
    const iv = recurringFor(term, null, null);
    ok(iv.interval === want, `no cadence, no proposal: ${term} still mints on ${want}s`);
  }
  ok(same(recurringFor("3_months", null, null), LEGACY["3_months"]), "and 3_months is byte-identically month x3");
  ok(same(recurringFor("6_months", null, null), LEGACY["6_months"]), "and 6_months is byte-identically month x6");
  ok(same(recurringFor("4_weeks", null, null), LEGACY["4_weeks"]), "and 4_weeks is byte-identically week x4");
  // A cadence the build does not know is not a cadence: mint the term's shape
  // rather than crashing or guessing. Same rule checkout follows.
  ok(same(recurringFor("3_months", "13_weeks", null), LEGACY["3_months"]),
    "an unknown cadence mints the legacy shape, never a guess");
  ok(same(recurringFor("3_months", "constructor", null), LEGACY["3_months"]),
    "and a prototype key is not a cadence either");
}

// ─── 6e. the propose payload the BROWSER sends ───────────────────────────────
//
// THE DEFECT. cadenceForCreation is correctly scoped to the offer (6c), which
// means it returns null when the request carries no offer_id. The sorter's propose
// call in public/client-portal.html did not send one, so the resolver refused to
// answer, the review screen said "every 3 months", and apply - whose payload DID
// carry offer_id - minted week x12. The money was right and the screen lied about
// it, which is the wrong way round to be wrong.
console.log("\n── 6e. propose resolves the same cadence apply mints on ──");
{
  const PORTAL = readSource("../public/client-portal.html");
  // Anchored on the SORTER's propose, by function name. `mode: 'propose'` alone
  // appears three times in this file for three different endpoints, and a pin that
  // reads the wrong one is a check that proves nothing about this path.
  const ANCHOR = "async function _sorterProposeMissing(key) {";
  const at = PORTAL.indexOf(ANCHOR);
  if (at === -1) {
    controlBroken = `This suite is pinned to public/client-portal.html:\n\n${ANCHOR}\n\nIt has been renamed or moved. Re-point it, or delete section 6e.`;
    throw new Error(controlBroken);
  }
  const proposeFn = PORTAL.slice(at, at + 4000);
  const proposeBody = proposeFn.slice(0, proposeFn.indexOf("const json = await _safeJson(r);"));
  ok(/mode: 'propose', targets: \[\{ key: t\.key, offer_id: t\.offer_id,/.test(proposeBody),
    "client-portal.html: the propose target carries offer_id");
  ok(/_sorterCreation = \{ key: t\.key, offer_id: t\.offer_id,/.test(PORTAL),
    "client-portal.html: and apply's stashed creation carries the same one, so both ends scope alike");
  ok(/const c = \{ key: t\.key, offer_id: t\.offer_id \|\| body\.offer_id, billing_cadence: t\.billing_cadence \};/.test(CREATE_PRICE),
    "create-price.js: propose builds the lookup from the target's offer_id");

  // And the resolver itself, run for real against a stubbed read: this is the
  // assertion that the propose path RESOLVES a cadence for a row that has one.
  const src = [
    cut(CREATE_PRICE, "const CADENCES = {", "offers/create-price.js"),
    cut(CREATE_PRICE, "function normCadence(v) {", "offers/create-price.js"),
    "export let ROWS = [];\nexport let CALLS = [];\n",
    "export function __setRows(r) { ROWS = r; CALLS = []; }\n",
    "async function sb(url) { CALLS.push(url); return ROWS; }\n",
    cut(CREATE_PRICE, "async function cadenceForCreation(clientId, c) {", "offers/create-price.js"),
    "export { cadenceForCreation };\nexport function calls() { return CALLS; }\n",
  ].join("\n");
  const tmp = path.join(HERE, ".billing-cadence-lookup.mjs");
  fs.writeFileSync(tmp, src);
  let cadenceForCreation, __setRows, calls;
  try { ({ cadenceForCreation, __setRows, calls } = await import(pathToFileURL(tmp).href)); }
  finally { try { fs.unlinkSync(tmp); } catch (_) { /* best effort */ } }

  // A San Jose target as the browser now sends it, against a row that re-bills
  // every 12 weeks.
  __setRows([{ billing_cadence: "12_weeks" }]);
  const fixed = { key: "Steady|3_months", offer_id: "offer-a", billing_cadence: undefined };
  ok(await cadenceForCreation("client-1", fixed) === "12_weeks",
    "propose resolves 12_weeks for a row that has it - which is what the review screen now says");
  ok(/source_offer_id=eq\.offer-a/.test(calls()[0] || ""), "and it read the row scoped to that offer");

  // The payload as it was BEFORE this fix. Same row, same academy, no offer_id.
  __setRows([{ billing_cadence: "12_weeks" }]);
  const broken = { key: "Steady|3_months", billing_cadence: undefined };
  ok(await cadenceForCreation("client-1", broken) === null,
    "the OLD payload (no offer_id) resolves nothing - the defect, still reproducible");
  ok(calls().length === 0, "and it does not even read: an unscoped guess is worse than no answer");

  // An explicit cadence on the request short-circuits the read entirely.
  __setRows([{ billing_cadence: "12_weeks" }]);
  ok(await cadenceForCreation("client-1", { key: "k", offer_id: "o", billing_cadence: "monthly" }) === "monthly",
    "an explicit billing_cadence on the request wins without a read");
  ok(calls().length === 0, "and skips the query");
}

// ─── 7. the cadence survives a deactivate-and-recreate ───────────────────────
//
// THE SEQUENCE THAT LOSES MONEY. offers-sync never deletes a typed price; when a
// price is re-minted the old row is DEACTIVATED and a new one is INSERTED from
// pricing_catalog. pricing_catalog has no cadence column, so the new row cannot
// re-derive one. Before this fix the dead row kept billing_cadence = 12_weeks and
// the live row was NULL, so checkout billed the live row on CALENDAR MONTHS while
// the Stripe price it pointed at charged every 12 weeks. No error is raised
// anywhere in that sequence. The parent is simply charged on the wrong clock.
//
// cadenceForKey is cut out of api/runtime/offers-sync.ts the same way checkout's
// functions are. That module imports Sentry and the Supabase client, so it cannot
// be imported on plain node; its BODY is byte-for-byte the shipped code and only
// the (TypeScript-annotated) signature line is rewritten, by an explicit pin that
// fails loudly if it moves.
console.log("\n── 7. offers-sync: a re-mint cannot orphan the cadence ──");
{
  const SYNC = readSource("runtime/offers-sync.ts");
  const TS_SIG = "export function cadenceForKey(existingPrices: PriceRow[], offerId: string, key: string, existingCadence: string | null | undefined): string | null {";
  if (!SYNC.includes(TS_SIG)) {
    controlBroken = `This suite is pinned to cadenceForKey's signature in api/runtime/offers-sync.ts:\n\n${TS_SIG}\n\nIt has moved or been re-annotated. Re-point it, or delete section 7 - a pin that fails to apply looks exactly like a check that passed.`;
    throw new Error(controlBroken);
  }
  const body = cut(SYNC, TS_SIG, "runtime/offers-sync.ts")
    .replace(TS_SIG, "export function cadenceForKey(existingPrices, offerId, key, existingCadence) {");
  const tmp = path.join(HERE, ".billing-cadence-sync.mjs");
  fs.writeFileSync(tmp, body);
  let cadenceForKey;
  try { ({ cadenceForKey } = await import(pathToFileURL(tmp).href)); }
  finally { try { fs.unlinkSync(tmp); } catch (_) { /* best effort */ } }

  const OFFER_A = "offer-a", OFFER_B = "offer-b", KEY = "Steady|3_months";
  const row = (o) => ({
    source_offer_id: OFFER_A, source_offer_price_key: KEY,
    billing_cadence: null, is_active: true, is_routable: true, ...o,
  });

  // Step 1: San Jose's live row, set to re-bill every 12 weeks.
  const live = row({ billing_cadence: "12_weeks" });
  ok(cadenceForKey([live], OFFER_A, KEY, live.billing_cadence) === "12_weeks",
    "step 1: the live row bills every 12 weeks");

  // Step 2: the price is re-minted. offers-sync deactivates the old row and plans
  // a NEW one whose existing cadence is null - this is the exact orphaning case.
  const dead = row({ billing_cadence: "12_weeks", is_active: false, is_routable: false });
  ok(cadenceForKey([dead], OFFER_A, KEY, null) === "12_weeks",
    "step 2: the RECREATED row inherits 12_weeks from the row it replaces");
  ok(cadenceForKey([dead], OFFER_A, KEY, null) !== null,
    "step 2: which is the whole defect - a null here is billing on calendar months");

  // Step 3: with both rows on file the ACTIVE one is the answer, so a stale dead
  // row can never out-vote the row that is really selling.
  const relive = row({ billing_cadence: "24_weeks" });
  ok(cadenceForKey([dead, relive], OFFER_A, KEY, null) === "24_weeks",
    "step 3: an ACTIVE row beats a deactivated one, in either list order");
  ok(cadenceForKey([relive, dead], OFFER_A, KEY, null) === "24_weeks",
    "step 3: and the answer does not depend on row order");

  // Step 3b: THE CLEARED LIVE ROW. Rule 3 says an active sibling beats a dead one,
  // and the reason given for it is "so a cadence deliberately cleared on the live
  // row is not resurrected by a stale dead one" - which the first version of this
  // function did not actually do. It skipped every row with no cadence BEFORE
  // asking whether the row was active, so a live row someone had just cleared was
  // invisible and the dead sibling answered instead. Clearing a cadence is an
  // instruction: it means "go back to billing this the way the term says". Silently
  // undoing it on the next sync is the same class of failure as dropping one.
  const cleared = row({ billing_cadence: null });
  ok(cadenceForKey([dead, cleared], OFFER_A, KEY, null) === null,
    "a live row with a CLEARED cadence stays cleared - the dead sibling cannot resurrect it");
  ok(cadenceForKey([cleared, dead], OFFER_A, KEY, null) === null,
    "and that does not depend on row order either");
  ok(cadenceForKey([dead, row({ billing_cadence: "   " })], OFFER_A, KEY, null) === null,
    "a live row cleared to whitespace counts as cleared, not as absent");
  ok(cadenceForKey([dead, { source_offer_id: OFFER_A, source_offer_price_key: KEY, is_active: true }], OFFER_A, KEY, null) === null,
    "and a live row read before the migration is the same answer: no cadence anywhere live");

  // Step 3c: TWO DEAD ROWS THAT DISAGREE. offers-sync never deletes, so a key
  // re-minted twice leaves two deactivated rows behind. Whichever Postgres felt
  // like returning first used to decide the clock of the next re-mint, so two
  // identical syncs could produce two different subscriptions. sort_order then id
  // makes it one answer, forever.
  const deadA = row({ id: "p-1", sort_order: 1, billing_cadence: "12_weeks", is_active: false, is_routable: false });
  const deadB = row({ id: "p-2", sort_order: 2, billing_cadence: "24_weeks", is_active: false, is_routable: false });
  ok(cadenceForKey([deadA, deadB], OFFER_A, KEY, null) === cadenceForKey([deadB, deadA], OFFER_A, KEY, null),
    "two disagreeing dead rows give the SAME answer in either order");
  ok(cadenceForKey([deadB, deadA], OFFER_A, KEY, null) === "12_weeks",
    "and that answer is the lowest sort_order, not whatever arrived first");
  {
    // Same sort_order: id is the tiebreaker, so there is no unordered pair left.
    const tieA = row({ id: "p-b", sort_order: 5, billing_cadence: "24_weeks", is_active: false });
    const tieB = row({ id: "p-a", sort_order: 5, billing_cadence: "12_weeks", is_active: false });
    ok(cadenceForKey([tieA, tieB], OFFER_A, KEY, null) === "12_weeks" &&
       cadenceForKey([tieB, tieA], OFFER_A, KEY, null) === "12_weeks",
      "and a sort_order tie is broken by id, in either order");
  }
  {
    // Two ACTIVE rows disagreeing is not supposed to happen, but "not supposed to"
    // is not a guarantee, and the money path may not have a coin-flip in it.
    const liveA = row({ id: "p-1", sort_order: 1, billing_cadence: "12_weeks" });
    const liveB = row({ id: "p-2", sort_order: 2, billing_cadence: "monthly" });
    ok(cadenceForKey([liveA, liveB], OFFER_A, KEY, null) === cadenceForKey([liveB, liveA], OFFER_A, KEY, null),
      "two disagreeing ACTIVE rows are also deterministic");
  }
  // The input array is not reordered underneath the caller: the same list feeds
  // the deactivate plan and every other key's lookup.
  {
    const list = [deadB, deadA];
    cadenceForKey(list, OFFER_A, KEY, null);
    ok(list[0] === deadB && list[1] === deadA, "and the caller's array is left in the order it was passed");
  }

  // A cadence already on the row is never overwritten by a sibling: nothing
  // upstream can authorize changing it, because the catalog has no opinion.
  ok(cadenceForKey([dead], OFFER_A, KEY, "monthly") === "monthly",
    "an existing cadence on the row WINS over any sibling");
  // And it is never cleared. There is no path that returns null for a row that
  // has one, which is what makes this safe to run on every sync.
  ok(cadenceForKey([], OFFER_A, KEY, "12_weeks") === "12_weeks",
    "a row with a cadence and no siblings at all keeps it");

  // Scoping. offer_price_key is unique only WITHIN an offer.
  ok(cadenceForKey([row({ source_offer_id: OFFER_B, billing_cadence: "12_weeks" })], OFFER_A, KEY, null) === null,
    "another OFFER's row with the same key supplies nothing");
  ok(cadenceForKey([row({ source_offer_price_key: "Steady|6_months", billing_cadence: "24_weeks" })], OFFER_A, KEY, null) === null,
    "another KEY in the same offer supplies nothing");

  // Pre-migration and junk shapes. Rows read before the column exists have no
  // billing_cadence key at all, and that must be indistinguishable from null.
  ok(cadenceForKey([{ source_offer_id: OFFER_A, source_offer_price_key: KEY, is_active: true }], OFFER_A, KEY, null) === null,
    "a row read BEFORE the migration (no such key) yields no cadence");
  ok(cadenceForKey([row({ billing_cadence: "   " })], OFFER_A, KEY, null) === null, "a whitespace-only cadence is no cadence");
  ok(cadenceForKey([row({ billing_cadence: 12 })], OFFER_A, KEY, null) === null, "a non-string cadence is no cadence");
  ok(cadenceForKey([], OFFER_A, KEY, null) === null, "no rows at all yields no cadence");
  ok(cadenceForKey([row({ billing_cadence: " 12_weeks " })], OFFER_A, KEY, null) === "12_weeks", "and it is trimmed");

  // The wiring, same lesson as 6b: the function existing is not the function
  // being used. The insert must carry it and the update must converge on it.
  ok(/\.\.\.\(price\.cadence \? \{ billing_cadence: price\.cadence \} : \{\}\),/.test(SYNC),
    "offers-sync: the INSERT carries the inherited cadence onto the new row");
  ok(/const inheritedCadence = cadenceForKey\(existingPrices, offer\.id, row\.offer_price_key, null\);/.test(SYNC),
    "offers-sync: the create path resolves it through cadenceForKey");
  ok(/if \(desiredCadence && !existing\.billing_cadence\) changes\.billing_cadence = desiredCadence;/.test(SYNC),
    "offers-sync: the UPDATE path adopts a sibling's cadence when the row has none");
  ok(!/changes\.billing_cadence = null/.test(SYNC), "offers-sync: and nothing ever CLEARS a cadence");
  ok(/billing_cadence`\);\n\s*if \(priceError && \/42703\|does not exist\/i\.test/.test(SYNC),
    "offers-sync: the price read asks for the column and degrades when it is not migrated yet");
  ok(/\.order\("sort_order", \{ ascending: true \}\)\.order\("id", \{ ascending: true \}\)/.test(SYNC),
    "offers-sync: and the read itself is ordered, so the whole sync plan is reproducible");
  ok(/cadence: string \| null/.test(SYNC) || /cadence: inheritedCadence/.test(SYNC),
    "offers-sync: the planned price carries the cadence through to apply");
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
    ? `✅ NEGATIVE CONTROL PASSED: the cadence control was caught by ${fail} assertion(s):\n   - ${failures.slice(0, 4).join("\n   - ")}`
    : "❌ NEGATIVE CONTROL FAILED: cadence resolution was reverted to term-only and every assertion still passed. That check is decorative.");
  process.exit(caught ? 0 : 1);
}
console.log(fail ? `❌ ${pass} passed, ${fail} failed.` : `✅ ${pass} passed, 0 failed.`);
process.exit(fail ? 1 : 0);
