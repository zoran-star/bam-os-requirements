// THE TERM VOCABULARY: adjustable prepay commitment lengths on the money path.
//
//   node api/_term-vocab.test.mjs
//
// WHAT THIS IS ABOUT.
// The offer_price_key term suffix was a closed set: monthly | 3_months |
// 6_months | signup_fee. Zoran ruled on 2026-08-06 that prepay lengths are
// adjustable, so the vocabulary opened ADDITIVELY to any whole 1-24 month
// count (`<n>_months`), with weeks folding to whole months and years x12.
// Two defects rode along:
//
//   1. THE COLLAPSE. checkout.js / offer.js / fact-render.js / the second
//      _bbTermFromLength all read "12 months" as n>=6 -> "6_months": a
//      12-month commitment was sold, billed, quoted and receipted as SIX
//      months, silently. "9 months" collapsed the same way, while the
//      match-prices family (exact 3/6 regexes) returned NO key for it and the
//      rung simply vanished from checkout. Both failure modes are gone: every
//      parser now yields `<n>_months` for 1-24 and REFUSES LOUDLY outside.
//
//   2. THE WEEK-SHAPED MINT. San Jose's real prepay members bill every 12 and
//      24 WEEKS, their labels say so ("3 Months (12 Weeks)"), and the minter
//      minted calendar months anyway - new signups on a different clock than
//      existing members, forever, invisibly. The label is the academy's own
//      declaration of billing rhythm (same ruling): a label with an explicit
//      week count that the cadence vocabulary can express now mints weeks.
//
// WHAT IT PROVES
//   1. THE GTA GUARANTEE. The old three terms produce byte-identical keys and
//      Stripe shapes to today, in every parser copy and both intervalFor twins.
//      Expectations are DECLARED here, never read from the code.
//   2. THE PROD REPLAY. Every real commitment label stored in prod on
//      2026-08-06 (pulled live: offers.data pricing_offerings[].commitments[]
//      .length, all academies) maps to the same key it mapped to before, so
//      nothing stored re-keys. Stored key suffixes stay valid and unchanged
//      through intervalFromKey and billingIntervalOf.
//   3. THE ROUND TRIP. "9 months" -> 9_months -> month x9 -> "9 months" labels
//      -> matches its own length text -> parses back to 9_months. The revert
//      gate (isCommitmentTerm) admits it.
//   4. THE WEEK MINT. "3 Months (12 Weeks)" derives cadence 12_weeks; the full
//      cadenceForCreation path (request > typed row > label) resolves it; the
//      REAL form-encoded Stripe body carries recurring week x12. Months-only
//      labels stay calendar months. An archived offering's label lends nothing.
//   5. THE BOUNDS. Out-of-range lengths refuse with a message a human can act
//      on (captured from console.warn); out-of-range TERM KEYS throw in both
//      intervalFor twins and in termToInterval, never default to week x4.
//   6. NO FORK. Every parser copy (match-prices, checkout, offer, fact-render,
//      receipts, sorter cleanup / fix-payment / take-over, both client-portal
//      mirrors) agrees on a shared battery of labels.
//
// WHAT IT DOES NOT PROVE
//   - That public/workbook.html can offer new keys back: its priceKeys() is
//     still closed to 3/6 (flagged to the workbook stream, which owns it).
//   - The webhook's interval derivation and members.js's reconcile parse run
//     for real: they are inline in HTTP handlers, asserted as source text only.
//   - That checkout's offer_prices row for a week-minted price carries
//     billing_cadence: setting the row is offers-sync + data, not this build.
//
// HOW IT RUNS. Same technique as api/_billing-cadence.test.mjs: the exact
// source of each function is CUT out of the shipped file by its declaration
// line and imported as a temporary module. Plain node, no node_modules.
//
// ─────────────────────────────────────────────────────────────────────────────
// NEGATIVE CONTROLS. Each breaks one thing; the run must print NEGATIVE
// CONTROL PASSED (exit 0 when caught, 1 when not - same convention as
// _billing-cadence.test.mjs, CI greps for the banner):
//
//   MUTATE=collapse  node api/_term-vocab.test.mjs   # reinstates the old
//                                                    # n>=6 collapse in
//                                                    # checkout's parser - the
//                                                    # exact shipped defect
//   MUTATE=weekmint  node api/_term-vocab.test.mjs   # cadenceFromLength stops
//                                                    # honouring the label -
//                                                    # week-labelled lengths
//                                                    # mint calendar months
//                                                    # again

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

function readSource(rel) {
  return fs.readFileSync(path.join(HERE, rel), "utf8");
}
function cut(src, pin, where) {
  const at = src.indexOf(pin);
  if (at === -1) {
    controlBroken = `This suite is pinned to text that is no longer in ${where}:\n\n${pin}\n\nRe-point it, or delete it.`;
    throw new Error(controlBroken);
  }
  let i = src.indexOf("{", at);
  let depth = 0;
  for (; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}") { depth--; if (depth === 0) return src.slice(at, i + 1) + ";\n"; }
  }
  controlBroken = `unbalanced braces after ${pin} in ${where}`;
  throw new Error(controlBroken);
}
async function loadModule(name, srcText) {
  const tmp = path.join(HERE, `.term-vocab-${name}.mjs`);
  fs.writeFileSync(tmp, srcText);
  try { return await import(pathToFileURL(tmp).href); }
  finally { try { fs.unlinkSync(tmp); } catch (_) { /* best effort */ } }
}

// console.warn capture: the LOUD half of "refuse loudly" is an assertable
// output, not decoration.
const WARNINGS = [];
const realWarn = console.warn;
console.warn = (...a) => { WARNINGS.push(a.join(" ")); };
const warnsMatching = (re) => WARNINGS.filter((w) => re.test(w));
const clearWarns = () => { WARNINGS.length = 0; };

const MATCH = readSource("offers/match-prices.js");
const CHECKOUT = readSource("website/checkout.js");
const CREATE = readSource("offers/create-price.js");
const OFFER = readSource("website/offer.js");
const FACT = readSource("agent/fact-render.js");
const RECEIPTS = readSource("_member-receipts.js");
const CLEANUP = readSource("sorter/cleanup.js");
const FIXPAY = readSource("sorter/fix-payment.js");
const TAKEOVER = readSource("sorter/take-over.js");
const SETUPMONTHLY = readSource("sorter/setup-monthly.js");
const PARENT = readSource("parent/_stripe.ts");
const SYNC = readSource("runtime/offers-sync.ts");
const WEBHOOK = readSource("stripe/webhook.js");
const MEMBERS = readSource("members.js");
const PORTAL = readSource("../public/client-portal.html");

// The bound is one number, declared in each file. Verified as source so a cut
// module can declare its own copy without hiding a drifted shipped value.
ok(MATCH.includes("const TERM_MAX_MONTHS = 24;"), "match-prices.js declares TERM_MAX_MONTHS = 24");
ok(CREATE.includes("const TERM_MAX_MONTHS = 24;"), "create-price.js declares TERM_MAX_MONTHS = 24");

// ─── the parser copies, as themselves ───────────────────────────────────────
const matchM = await loadModule("match", [
  "const TERM_MAX_MONTHS = 24;\n",
  cut(MATCH, "function _termFromLength(s) {", "api/offers/match-prices.js"),
  cut(MATCH, "const intervalFromKey = (key) => {", "api/offers/match-prices.js"),
  "export { _termFromLength, intervalFromKey };\n",
].join("\n"));

let checkoutParserSrc = [
  cut(CHECKOUT, "function norm(s) {", "api/website/checkout.js"),
  cut(CHECKOUT, "function intervalFor(term) {", "api/website/checkout.js"),
  cut(CHECKOUT, "function isCommitmentTerm(term) {", "api/website/checkout.js"),
  cut(CHECKOUT, "function lengthMatchesTerm(length, term) {", "api/website/checkout.js"),
  cut(CHECKOUT, "function _termKeyFromLength(length) {", "api/website/checkout.js"),
  "export { intervalFor, isCommitmentTerm, lengthMatchesTerm, _termKeyFromLength };\n",
].join("\n");

// MUTATE=collapse: the shipped defect, byte for byte - months collapse to the
// nearest of 3/6 and everything under 3 vanishes.
if (MUTATE === "collapse") {
  const pin = "    if (n >= 1 && n <= 24) return `${n}_months`;";
  const at = checkoutParserSrc.indexOf("function _termKeyFromLength(length) {");
  if (at === -1 || !checkoutParserSrc.slice(at).includes(pin)) {
    controlBroken = `the collapse control is pinned to text no longer in checkout's _termKeyFromLength:\n\n${pin}`;
    console.log(`\n❌ NEGATIVE CONTROL FAILED: ${controlBroken}`);
    process.exit(1);
  }
  checkoutParserSrc = checkoutParserSrc.slice(0, at)
    + checkoutParserSrc.slice(at).replace(pin,
      '    if (n >= 6) return "6_months"; if (n >= 3) return "3_months";   // MUTATED: the old collapse');
}
const checkoutM = await loadModule("checkout", checkoutParserSrc);

let mintSrc = [
  "const TERM_MAX_MONTHS = 24;\n",
  cut(CREATE, "const CADENCES = {", "api/offers/create-price.js"),
  cut(CREATE, "function normCadence(v) {", "api/offers/create-price.js"),
  cut(CREATE, "function termToInterval(term) {", "api/offers/create-price.js"),
  cut(CREATE, "function _termFromLength(s) {", "api/offers/create-price.js"),
  cut(CREATE, "function cadenceFromLength(len) {", "api/offers/create-price.js"),
  cut(CREATE, "function recurringFor(term, cadence, proposed) {", "api/offers/create-price.js"),
  cut(CREATE, "function priceBody(key, amount, currency, recurring, priceName) {", "api/offers/create-price.js"),
  cut(CREATE, "function stripeForm(body) {", "api/offers/create-price.js"),
  // A controllable sb so the FULL cadence decision (request > row > label) runs
  // for real: each queued item answers one read, in order.
  "export let CALLS = [];\nlet QUEUE = [];\n",
  "export function __setQueue(q) { QUEUE = q.slice(); CALLS = []; }\n",
  "async function sb(url) { CALLS.push(url); return QUEUE.length ? QUEUE.shift() : []; }\n",
  cut(CREATE, "async function cadenceForCreation(clientId, c) {", "api/offers/create-price.js"),
  cut(CREATE, "async function cadenceFromOfferLabel(clientId, offerId, key) {", "api/offers/create-price.js"),
  "export { termToInterval, cadenceFromLength, recurringFor, priceBody, stripeForm, cadenceForCreation };\n",
].join("\n");

// MUTATE=weekmint: the label stops mattering - exactly the pre-ruling minter.
if (MUTATE === "weekmint") {
  const pin = "  if (Object.prototype.hasOwnProperty.call(CADENCES, cad)) return cad;";
  if (!mintSrc.includes(pin)) {
    controlBroken = `the weekmint control is pinned to text no longer in create-price's cadenceFromLength:\n\n${pin}`;
    console.log(`\n❌ NEGATIVE CONTROL FAILED: ${controlBroken}`);
    process.exit(1);
  }
  mintSrc = mintSrc.replace(pin, "  if (false) return cad;   // MUTATED: labels ignored, calendar months for everyone");
}
const mintM = await loadModule("mint", mintSrc);

const offerM = await loadModule("offer", [
  cut(OFFER, "function termFromLength(length) {", "api/website/offer.js"),
  cut(OFFER, "const TERM_LABELS = {", "api/website/offer.js"),
  cut(OFFER, "function termLabelOf(term) {", "api/website/offer.js"),
  cut(OFFER, "const LEGACY_TERM_CADENCE_LABELS = {", "api/website/offer.js"),
  cut(OFFER, "function legacyTermCadenceLabel(term) {", "api/website/offer.js"),
  "export { termFromLength, termLabelOf, legacyTermCadenceLabel };\n",
].join("\n"));

const factM = await loadModule("fact", [
  cut(FACT, "const termFromLength = (length) => {", "api/agent/fact-render.js"),
  cut(FACT, "const INTERVAL_LABEL = {", "api/agent/fact-render.js"),
  cut(FACT, "const TERM_WORDS = {", "api/agent/fact-render.js"),
  cut(FACT, "const intervalLabelOf = (iv) => {", "api/agent/fact-render.js"),
  cut(FACT, "const termWordOf = (term) => {", "api/agent/fact-render.js"),
  "export { termFromLength, intervalLabelOf, termWordOf };\n",
].join("\n"));

const receiptsM = await loadModule("receipts", [
  cut(RECEIPTS, "function termFromLength(len) {", "api/_member-receipts.js"),
  "export { termFromLength };\n",
].join("\n"));

const cleanupM = await loadModule("cleanup", [
  cut(CLEANUP, "function _termFromLength(len) {", "api/sorter/cleanup.js"),
  "export { _termFromLength };\n",
].join("\n"));

const fixpayM = await loadModule("fixpay", [
  cut(FIXPAY, "function _termFromLen(len) {", "api/sorter/fix-payment.js"),
  "export { _termFromLen };\n",
].join("\n"));

const takeoverM = await loadModule("takeover", [
  cut(TAKEOVER, "const termOf = (len) => {", "api/sorter/take-over.js"),
  "export { termOf };\n",
].join("\n"));

const setupMonthlyM = await loadModule("setupmonthly", [
  cut(SETUPMONTHLY, "function termMonths(key) {", "api/sorter/setup-monthly.js"),
  "export { termMonths };\n",
].join("\n"));

// TypeScript twins: rewrite only the annotated signature line, body verbatim -
// same approach as _billing-cadence.test.mjs section 7.
const PARENT_SIG = "export function intervalFor(term: string | null | undefined): StripeInterval {";
if (!PARENT.includes(PARENT_SIG)) { controlBroken = `pin gone: ${PARENT_SIG}`; throw new Error(controlBroken); }
const parentM = await loadModule("parent", [
  "class StripeFetchError extends Error {}\n",
  cut(PARENT, PARENT_SIG, "api/parent/_stripe.ts").replace(PARENT_SIG, "export function intervalFor(term) {"),
].join("\n"));

const SYNC_SIG = 'export function billingIntervalOf(row: Pick<CatalogRow, "offer_price_key" | "interval">): string | null {';
if (!SYNC.includes(SYNC_SIG)) { controlBroken = `pin gone: ${SYNC_SIG}`; throw new Error(controlBroken); }
const syncM = await loadModule("sync", [
  cut(SYNC, SYNC_SIG, "api/runtime/offers-sync.ts").replace(SYNC_SIG, "export function billingIntervalOf(row) {"),
].join("\n"));

// The two client-portal mirrors, told apart by their (different) signatures.
const portalPillM = await loadModule("portal-pill", [
  cut(PORTAL, "function _bbTermFromLength(s) {", "public/client-portal.html"),
  "export { _bbTermFromLength };\n",
].join("\n"));
const portalBbM = await loadModule("portal-bb", [
  cut(PORTAL, "function _bbTermFromLength(length) {", "public/client-portal.html"),
  "export { _bbTermFromLength };\n",
].join("\n"));

// ─── the expectations, declared HERE ────────────────────────────────────────
const LEGACY_SHAPES = {
  monthly: { interval: "week", interval_count: 4 },
  "4_weeks": { interval: "week", interval_count: 4 },
  "3_months": { interval: "month", interval_count: 3 },
  "6_months": { interval: "month", interval_count: 6 },
};
const shapeOf = (iv) => ({ interval: iv.interval, interval_count: iv.interval_count });

// ─── 1. the GTA guarantee: the old three terms are byte-identical ────────────
console.log("\n── 1. the old three terms: byte-identical keys and shapes ──");
const LEGACY_LABELS = [
  ["3 months", "3_months"], ["3 Months", "3_months"], ["3 month", "3_months"],
  ["6 months", "6_months"], ["6 months ", "6_months"],
  ["12 weeks", "3_months"], ["24 weeks", "6_months"],
  ["3 Months (12 Weeks)", "3_months"], ["12 Weeks (3 Months)", "3_months"],
  ["6 Months (24 Weeks)", "6_months"], ["24 Weeks (6 Months)", "6_months"],
];
const parsers = [
  ["match-prices._termFromLength", (s) => matchM._termFromLength(s)],
  ["checkout._termKeyFromLength", (s) => checkoutM._termKeyFromLength(s)],
  ["offer.termFromLength", (s) => offerM.termFromLength(s)],
  ["fact-render.termFromLength", (s) => factM.termFromLength(s)],
  ["receipts.termFromLength", (s) => receiptsM.termFromLength(s) || null],
  ["sorter/cleanup._termFromLength", (s) => cleanupM._termFromLength(s)],
  ["sorter/fix-payment._termFromLen", (s) => fixpayM._termFromLen(s)],
  ["sorter/take-over.termOf", (s) => takeoverM.termOf(s)],
  ["client-portal pill _bbTermFromLength", (s) => portalPillM._bbTermFromLength(s)],
  ["client-portal blueprint _bbTermFromLength", (s) => portalBbM._bbTermFromLength(s)],
];
for (const [label, want] of LEGACY_LABELS) {
  for (const [name, fn] of parsers) {
    ok(fn(label) === want, `${name}("${label}") -> ${want}`);
  }
}
for (const term of ["monthly", "4_weeks", "3_months", "6_months"]) {
  ok(same(shapeOf(checkoutM.intervalFor(term)), LEGACY_SHAPES[term]), `checkout intervalFor("${term}") unchanged: ${JSON.stringify(LEGACY_SHAPES[term])}`);
  ok(same(shapeOf(parentM.intervalFor(term)), LEGACY_SHAPES[term]), `parent intervalFor("${term}") unchanged`);
}
for (const junk of ["", null, undefined, "nonsense", "week", "one_time"]) {
  ok(same(shapeOf(checkoutM.intervalFor(junk)), LEGACY_SHAPES["4_weeks"]), `checkout intervalFor(${JSON.stringify(junk)}) still defaults week x4`);
  ok(same(shapeOf(parentM.intervalFor(junk)), LEGACY_SHAPES["4_weeks"]), `parent intervalFor(${JSON.stringify(junk)}) still defaults week x4`);
}
ok(same(mintM.termToInterval("3_months"), { interval: "3_months", recurring: { interval: "month", interval_count: 3 } }), "termToInterval(3_months) unchanged");
ok(same(mintM.termToInterval("6_months"), { interval: "6_months", recurring: { interval: "month", interval_count: 6 } }), "termToInterval(6_months) unchanged");
ok(same(mintM.termToInterval("monthly"), { interval: "4_weeks", recurring: { interval: "week", interval_count: 4 } }), "termToInterval(monthly) unchanged");
ok(same(mintM.termToInterval("signup_fee"), { interval: "one_time", recurring: null }), "termToInterval(signup_fee) is still one-time, no recurring block");
ok(mintM.recurringFor("signup_fee", "12_weeks", { interval: "month", interval_count: 1 }) === null, "a sign-up fee still cannot be promoted to a subscription by cadence or payload");
ok(offerM.termLabelOf("3_months") === "3 months" && offerM.termLabelOf("monthly") === "Monthly (billed every 4 weeks)", "offer.js legacy term labels unchanged");
ok(factM.intervalLabelOf("3_months") === "3 months prepaid" && factM.intervalLabelOf("4_weeks") === "every 4 weeks", "fact-render legacy interval labels unchanged");

// ─── 2. the prod replay: nothing stored re-keys ─────────────────────────────
console.log("\n── 2. every real stored label and key, replayed ──");
// Pulled live from prod offers.data on 2026-08-06 (all academies, published +
// draft). Each pair is (label as stored, the key it produced BEFORE this build
// in the family that sells: match-prices/buildOfferTargets). "Annual" and
// "3 Months Upfront" are the only non-trivial rows: "3 Months Upfront" keyed
// 3_months before and must stay; "Annual" keyed NOTHING before (the silent
// vanish this build replaces) and now keys 12_months - additive, no re-key,
// and its only prod occurrence is an ARCHIVED plan that never builds targets.
const PROD_LABELS = [
  ["12 Weeks (3 Months)", "3_months"], ["24 Weeks (6 Months)", "6_months"],
  ["3 month", "3_months"], ["3 Months", "3_months"], ["3 months", "3_months"],
  ["6 months", "6_months"], ["3 Months (12 Weeks)", "3_months"],
  ["6 Months (24 Weeks)", "6_months"], ["3 months ", "3_months"],
  ["6 months ", "6_months"], ["3 Months Upfront", "3_months"],
];
for (const [label, want] of PROD_LABELS) {
  ok(matchM._termFromLength(label) === want, `stored label "${label}" still keys ${want}`);
}
ok(matchM._termFromLength("Annual") === "12_months", 'stored label "Annual" now keys 12_months (was: no key, an invisible rung on an archived plan)');
// The stored key suffixes (offer_prices + pricing_catalog, pulled the same
// day): monthly / 3_months / 6_months, nothing else. Their derived intervals
// are byte-identical.
ok(matchM.intervalFromKey("Steady|monthly") === "4_weeks", 'intervalFromKey("...|monthly") -> 4_weeks, unchanged');
ok(matchM.intervalFromKey("Steady|3_months") === "3_months", 'intervalFromKey("...|3_months") -> 3_months, unchanged');
ok(matchM.intervalFromKey("Steady|6_months") === "6_months", 'intervalFromKey("...|6_months") -> 6_months, unchanged');
ok(matchM.intervalFromKey("Steady|signup_fee") === "one_time", 'intervalFromKey("...|signup_fee") -> one_time, unchanged');
ok(syncM.billingIntervalOf({ offer_price_key: "Steady|monthly", interval: "week" }) === "4_weeks", "billingIntervalOf monthly unchanged");
ok(syncM.billingIntervalOf({ offer_price_key: "Steady|3_months", interval: "week" }) === "3_months", "billingIntervalOf 3_months unchanged");
ok(syncM.billingIntervalOf({ offer_price_key: "Steady|6_months", interval: "week" }) === "6_months", "billingIntervalOf 6_months unchanged");
ok(syncM.billingIntervalOf({ offer_price_key: "Steady|signup_fee", interval: "one_time" }) === "one_time", "billingIntervalOf signup_fee unchanged");

// ─── 3. the round trip: 9 months exists end to end ──────────────────────────
console.log("\n── 3. 9_months round-trips label -> key -> shape -> label -> key ──");
ok(matchM._termFromLength("9 months") === "9_months", '"9 months" -> 9_months (was: NO key, rung vanished)');
ok(checkoutM._termKeyFromLength("9 months") === "9_months", "checkout parses the same key");
ok(same(shapeOf(checkoutM.intervalFor("9_months")), { interval: "month", interval_count: 9 }), "checkout bills 9_months as month x9");
ok(same(shapeOf(parentM.intervalFor("9_months")), { interval: "month", interval_count: 9 }), "the parent app bills the same shape");
ok(same(mintM.termToInterval("9_months"), { interval: "9_months", recurring: { interval: "month", interval_count: 9 } }), "the minter mints month x9 and labels the row 9_months");
ok(matchM.intervalFromKey("Steady|9_months") === "9_months", "the catalog interval for the new key is 9_months");
ok(syncM.billingIntervalOf({ offer_price_key: "Steady|9_months", interval: "week" }) === "9_months", "offers-sync writes billing_interval 9_months onto the typed row (the value checkout reads back)");
ok(offerM.termLabelOf("9_months") === "9 months", 'the sales page labels it "9 months"');
ok(offerM.legacyTermCadenceLabel("9_months") === "every 9 months", 'and its no-cadence billing reads "every 9 months"');
ok(factM.intervalLabelOf("9_months") === "9 months prepaid", 'the sales agent reads "9 months prepaid", never "every 4 weeks"');
ok(factM.termWordOf("9_months") === "9 month", "and the fee-waiver sentence can name it");
ok(checkoutM.isCommitmentTerm("9_months") === true, "the commitment-revert gate admits 9_months");
ok(checkoutM.lengthMatchesTerm("9 months", "9_months") === true, "9_months matches its own months label");
ok(checkoutM.lengthMatchesTerm("36 weeks", "9_months") === true, "and the 36-week notation of the same span");
ok(checkoutM.lengthMatchesTerm("9 months", "3_months") === false, "but a 9-month label does not match 3_months");
ok(checkoutM._termKeyFromLength("36 weeks") === "9_months", "36 weeks parses to 9_months (weeks fold to whole months)");
ok(matchM._termFromLength("1 year") === "12_months", '"1 year" -> 12_months (was: NO key)');
ok(matchM._termFromLength("2 years") === "24_months", '"2 years" -> 24_months, the top of the bound');
ok(setupMonthlyM.termMonths("Steady|9_months") === 9, "prepaid-to-monthly anchors 9 months out for a 9_months key");
ok(setupMonthlyM.termMonths("Steady|3_months") === 3 && setupMonthlyM.termMonths("Steady|6_months") === 6, "and 3/6 anchor exactly as before");
ok(setupMonthlyM.termMonths("Steady|13_months") === 13, "13_months anchors 13 months out, not 3 (the substring bug is gone)");

// ─── 4. week-labelled lengths mint week shapes ──────────────────────────────
console.log("\n── 4. the label's week count is honoured at mint time ──");
ok(mintM.cadenceFromLength("3 Months (12 Weeks)") === "12_weeks", 'San Jose\'s "3 Months (12 Weeks)" declares cadence 12_weeks');
ok(mintM.cadenceFromLength("6 Months (24 Weeks)") === "24_weeks", 'and "6 Months (24 Weeks)" declares 24_weeks');
ok(mintM.cadenceFromLength("3 Months") === null, "a months-only label declares nothing: calendar months stay");
ok(mintM.cadenceFromLength("3 months") === null, "case-insensitively");
clearWarns();
ok(mintM.cadenceFromLength("9 Months (36 Weeks)") === null, "a week rhythm the cadence vocabulary cannot express is refused");
ok(warnsMatching(/36-week billing rhythm.*not in the cadence vocabulary/).length === 1, "and the refusal is LOUD, naming the rhythm and what to do");
{
  const shape = mintM.recurringFor("3_months", "12_weeks", null);
  ok(same(shape, { interval: "week", interval_count: 12 }), "recurringFor(3_months, 12_weeks) mints week x12, not month x3");
  const form = mintM.stripeForm(mintM.priceBody("Unlimited|3_months", 55000, "usd", shape, "Unlimited · 3 months"));
  ok(/recurring%5Binterval%5D=week/.test(form) && /recurring%5Binterval_count%5D=12/.test(form),
    `the REAL Stripe body carries recurring week x12 (${form.slice(0, 70)}…)`);
  ok(!/interval%5D=month/.test(form), "and no month shape reaches Stripe for it");
}
{
  // The FULL decision, request > typed row > label, against a stubbed database.
  const SJ_OFFER = [{ data: { pricing: { pricing_offerings: [
    { title: "Unlimited", type: "Membership", archived: false,
      commitments: [{ length: "3 Months (12 Weeks)", price: "500" }, { length: "6 Months (24 Weeks)", price: "900" }] },
    { title: "Old Tier", type: "Membership", archived: true,
      commitments: [{ length: "12 Weeks (3 Months)", price: "700" }] },
  ] } } }];
  mintM.__setQueue([[], SJ_OFFER]);   // no typed-row cadence, then the offer
  ok(await mintM.cadenceForCreation("client-sj", { key: "Unlimited|3_months", offer_id: "offer-1" }) === "12_weeks",
    "cadenceForCreation: no row cadence -> the LABEL answers 12_weeks");
  mintM.__setQueue([[{ billing_cadence: "3_calendar_months" }], SJ_OFFER]);
  ok(await mintM.cadenceForCreation("client-sj", { key: "Unlimited|3_months", offer_id: "offer-1" }) === "3_calendar_months",
    "a typed-row cadence OUTRANKS the label (an owner's explicit setting wins)");
  mintM.__setQueue([[], SJ_OFFER]);
  ok(await mintM.cadenceForCreation("client-sj", { key: "Unlimited|3_months", offer_id: "offer-1", billing_cadence: "monthly" }) === "monthly",
    "and an explicit request cadence outranks both");
  mintM.__setQueue([[], SJ_OFFER]);
  ok(await mintM.cadenceForCreation("client-sj", { key: "Old Tier|3_months", offer_id: "offer-1" }) === null,
    "an ARCHIVED offering's week label lends nothing (GTA's retired tiers stay calendar)");
  mintM.__setQueue([[], SJ_OFFER]);
  ok(await mintM.cadenceForCreation("client-sj", { key: "Unlimited|6_months", offer_id: "offer-1" }) === "24_weeks",
    "the 6-month rung derives its own 24_weeks");
  ok(await mintM.cadenceForCreation("client-sj", { key: "Unlimited|3_months" }) === null,
    "no offer_id still refuses to answer (scoping rule unchanged)");
}

// ─── 5. out of bounds refuses loudly, never collapses, never defaults ───────
console.log("\n── 5. the bound: 1-24 months, refusals a human can read ──");
clearWarns();
ok(matchM._termFromLength("36 months") === null, '"36 months" yields no key');
ok(warnsMatching(/36 months, outside the 1-24 month range/).length === 1, "and says why, with the range, in the warning");
clearWarns();
ok(matchM._termFromLength("10 weeks") === null, '"10 weeks" (not a whole month count) yields no key');
ok(warnsMatching(/10 weeks.*does not map to a whole 1-24 month term/).length === 1, "and the weeks refusal is loud too");
clearWarns();
ok(matchM._termFromLength("3 years") === null, '"3 years" (36 months) yields no key');
ok(warnsMatching(/outside the 1-24 month range/).length === 1, "with the same loud message");
ok(matchM._termFromLength("0 months") === null, '"0 months" yields no key');
for (const [name, fn] of [["checkout", checkoutM.intervalFor], ["parent", parentM.intervalFor]]) {
  let threw = null;
  try { fn("99_months"); } catch (e) { threw = e; }
  ok(!!threw, `${name} intervalFor("99_months") THROWS instead of billing week x4`);
  ok(!!threw && /99 months, outside the 1-24 month range/.test(threw.message), `${name}: and the message names the number and the range`);
}
{
  let threw = null;
  try { mintM.termToInterval("27_months"); } catch (e) { threw = e; }
  ok(!!threw && /27 months, outside the 1-24 month range/.test(threw.message), "termToInterval(27_months) refuses with an actionable message");
}
ok(matchM.intervalFromKey("Steady|99_months") === null, "an out-of-range key derives NO catalog interval");
ok(syncM.billingIntervalOf({ offer_price_key: "Steady|99_months", interval: "month" }) === "month", "offers-sync falls back to the raw catalog interval for it, inventing nothing");
ok(checkoutM.isCommitmentTerm("99_months") === false, "and the revert gate refuses it");

// ─── 6. the collapse is GONE ────────────────────────────────────────────────
console.log("\n── 6. 12 months is twelve months, not six ──");
ok(checkoutM._termKeyFromLength("12 months") === "12_months", 'checkout: "12 months" -> 12_months');
ok(checkoutM._termKeyFromLength("12 months") !== "6_months", "checkout: and NOT 6_months (the shipped defect)");
ok(checkoutM._termKeyFromLength("9 months") === "9_months", 'checkout: "9 months" -> 9_months, not 6_months');
ok(offerM.termFromLength("12 months") === "12_months", "offer.js agrees");
ok(factM.termFromLength("12 months") === "12_months", "fact-render agrees");
ok(portalBbM._bbTermFromLength("12 months") === "12_months", "the blueprint mirror agrees");
ok(portalPillM._bbTermFromLength("12 months") === "12_months", "the pill mirror agrees");
ok(cleanupM._termFromLength("12 weeks") === "3_months", 'sorter/cleanup: "12 weeks" is 3 months, not 12 (its substring bug is gone)');
ok(cleanupM._termFromLength("13 months") === "13_months", 'sorter/cleanup: "13 months" is no longer read as 3_months');

// ─── 7. no fork: every parser copy agrees ───────────────────────────────────
console.log("\n── 7. the parser copies do not fork ──");
const BATTERY = [
  "3 months", "6 Months", "9 months", "12 months", "1 month", "2 months",
  "12 weeks", "24 weeks", "36 weeks", "10 weeks", "1 year", "2 years",
  "Annual", "3 Months (12 Weeks)", "12 Weeks (3 Months)", "36 months",
  "0 months", "forever", "", "3 Months Upfront",
];
for (const label of BATTERY) {
  const answers = parsers.map(([name, fn]) => [name, fn(label)]);
  const first = answers[0][1];
  const agree = answers.every(([, v]) => v === first);
  ok(agree, `"${label}" -> ${JSON.stringify(first)} in all ${answers.length} copies${agree ? "" : " - FORK: " + answers.map(([n, v]) => `${n}=${v}`).join(", ")}`);
}

// ─── 8. the inline copies, as source (weak evidence, labelled as such) ──────
console.log("\n── 8. inline copies in webhook.js and members.js (source text) ──");
ok(/else if \(u === "month" && c > 1 && c <= 24\) interval = `\$\{c\}_months`;/.test(WEBHOOK),
  "webhook.js labels other whole-month shapes <n>_months (not the dead `9_month` spelling)");
ok(/else if \(u === "week" && c % 4 === 0 && c \/ 4 > 1 && c \/ 4 <= 24\) interval = `\$\{c \/ 4\}_months`;/.test(WEBHOOK),
  "webhook.js folds whole-month week shapes the same way");
ok(WEBHOOK.includes('else if (u === "week" && c === 12) interval = "3_months";'),
  "webhook.js: the legacy week x12 -> 3_months line is untouched");
ok(/const months = tm \? \+tm\[1\]/.test(MEMBERS) && /months >= 1 && months <= 24\) \? `\$\{months\}_months` : null;/.test(MEMBERS),
  "members.js reconcile parses any bounded month count with the same rules");

// ─── footer ─────────────────────────────────────────────────────────────────
console.warn = realWarn;
console.log("");
if (MUTATE) {
  if (controlBroken) {
    console.log(`❌ NEGATIVE CONTROL FAILED: ${controlBroken}`);
    process.exit(1);
  }
  const caught = fail > 0;
  console.log(caught
    ? `✅ NEGATIVE CONTROL PASSED: the ${MUTATE} control was caught by ${fail} assertion(s):\n   - ${failures.slice(0, 4).join("\n   - ")}`
    : `❌ NEGATIVE CONTROL FAILED: the ${MUTATE} mutation changed nothing any assertion noticed. That coverage is decorative.`);
  process.exit(caught ? 0 : 1);
}
console.log(fail ? `❌ ${pass} passed, ${fail} failed.` : `✅ ${pass} passed, 0 failed.`);
process.exit(fail ? 1 : 0);
