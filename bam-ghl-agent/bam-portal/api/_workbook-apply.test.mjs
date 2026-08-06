// THE REVIEW-AND-APPLY HALF of api/workbook.js: staff review, per-card
// approval, the ordered dry-run apply, and rollback. No network, no database.
//
//   node api/_workbook-apply.test.mjs
//
// (Unlike api/_workbook.test.mjs this suite needs node_modules present: the
// apply action imports api/offers/match-prices.js for buildOfferTargets, and
// that module's import chain reaches @sentry/node.)
//
// WHAT THIS PROVES
//   1. THE FIVE STAFF ACTIONS ARE STAFF-ONLY. The owner's no-login token opens
//      exactly nothing here: review, approve-card, apply, publish and rollback
//      all answer 401 to a caller with no staff bearer, whatever the body says.
//   2. REVIEW GROUPS BY BLAST RADIUS. Academy settings (the tax answer that
//      re-prices every athlete) come FIRST, then the cards, then owner
//      additions, then free text - and a card the owner CONFIRMED WITHOUT
//      EDITING whose proposal differs from what we store reads as a CHANGE,
//      because that is San Jose's three renames.
//   3. APPLY IS GATED ON THE STAFF ACT. Every counted card must carry
//      approved_at or nothing moves - and approving is per card, the same unit
//      the owner confirmed in, refused where the owner never confirmed.
//   4. THE ORDER OF THE WRITE IS LOAD-BEARING. Snapshot first (and the FIRST
//      apply wins - the photograph is never overwritten with a post-write
//      state); tax to clients before any amount is computed; offer jsonb writes
//      translated through the field map; the phase-3 preview built only after
//      tax landed, so every all-in amount carries it.
//   5. THE TRANSLATION SPEAKS THE OFFER'S LANGUAGE. A page-cased "Waive" lands
//      as "waive", "every 4 weeks" as "Every 4 weeks", the number 549 as the
//      string "549" - verified against the live San Jose offer jsonb, because
//      casing on this exact field shipped a live defect this week.
//   6. RERUNS ARE SAFE. Answers stamp applied_at as they land; a second apply
//      skips them, so a staff edit made in the wizard after an apply is not
//      clobbered by the rerun.
//   7. dry_run=false IS REFUSED OUTRIGHT and touches nothing. The live Stripe
//      write does not exist this pass, on purpose.
//   8. ROLLBACK RESTORES THE PHOTOGRAPH - offer data and tax_config - clears
//      the applied stamps, reports what cannot come back (nothing yet), and
//      lands the workbook on 'submitted', which stays read-only to the owner.
//   9. A PLAN CARD RESOLVES TO A LIVE OFFERING OR IT REFUSES. An archived tier
//      of the same name is never written (it is out of everything that prices
//      or sells), and two LIVE options sharing a title stop the apply naming
//      both rather than picking by position - guessing writes money onto the
//      wrong plan.
//  10. THE WHITELIST IS FAIL-CLOSED. Own-property lookup only, so `__proto__`
//      and `constructor` are refusals rather than a 500 and an arbitrary write;
//      indexes are bounded both structurally and against the plan's real
//      length; and EVERY refusal carries a sentence that reaches review AND the
//      row's apply_error.
//  11. THE REHEARSAL SHOWS WHAT CANNOT BE SOLD. A commitment length outside the
//      term vocabulary produces no price key, so the rung is priced on the
//      parent-facing page and mintable nowhere - it is named, by length.
//  12. A READ THAT FAILED IS NOT A READ THAT FOUND NOTHING. An unreadable price
//      catalog makes the preview say it could not compare (never "mint them
//      all"), and an unreadable offer_prices makes the SNAPSHOT refuse rather
//      than photograph an empty list it never verified.
//  13. THE PREVIEW DOES NOT PROMISE A RHYTHM IT CANNOT VERIFY. It reads the
//      typed offer_prices row that outranks the label at mint time, and says
//      plainly that the cadence vocabulary lives somewhere it cannot read.
//  14. THE PRICE MACHINERY LOADS BEFORE THE FIRST WRITE, so its 503 strands
//      nothing - and a missing apply_error column degrades instead of 500ing
//      the whole review surface.
//
// WHAT IT DOES NOT PROVE
//   - Anything against real Postgres; Supabase is an in-memory PostgREST stub.
//   - Anything about Stripe. Phase 3 is a PREVIEW built from the catalog
//     table; no Stripe call exists to test.
//   - That the staff page renders any of this; the contract is asserted from
//     this side only.
//
// ─────────────────────────────────────────────────────────────────────────────
// NEGATIVE CONTROLS. Each breaks ONE guarantee; the suite must PRINT
// "NEGATIVE CONTROL PASSED". A silent non-zero exit is not a report.
//
//   MUTATE=applybeforereview  node api/_workbook-apply.test.mjs
//       the every-card-approved gate is deleted, so an apply with an unapproved
//       card walks straight through and writes configuration nobody signed off.
//   MUTATE=taxaftermint       node api/_workbook-apply.test.mjs
//       the phase-3 preview is built BEFORE the tax write lands, so every
//       previewed amount is pre-tax - the exact defect the workbook's tax card
//       exists to close, reintroduced one call earlier.
//   MUTATE=snapshotoverwrite  node api/_workbook-apply.test.mjs
//       the first-apply-wins guard is deleted, so a second apply re-photographs
//       the POST-write state and the only way back now pictures the thing it
//       was supposed to undo.
//   MUTATE=snapfilteronly     node api/_workbook-apply.test.mjs
//       ONLY the PATCH filter goes, not the branch guard. Every sequential
//       rerun still behaves, and a concurrent apply overwrites a photograph
//       that was already taken - which is what made this half decorative until
//       section 14 could express the race.
//   MUTATE=reapply            node api/_workbook-apply.test.mjs
//       the applied_at skip is deleted, so a rerun double-writes answers that
//       already landed - and a staff edit made in the wizard between the two
//       runs is silently clobbered by the workbook's stale value.
//   MUTATE=vocabdrift         node api/_workbook-apply.test.mjs
//       translation is deleted, so the page's own vocabulary lands in the offer
//       uncased and untyped: "Waive" where checkout compares "waive", a NUMBER
//       where the offer stores a string.
//   MUTATE=ownertoken         node api/_workbook-apply.test.mjs
//       resolveStaff becomes optional, so the owner's no-login token reaches
//       every staff action - review reads staff annotations, apply writes his
//       own prices into the live system.
//   MUTATE=liveapply          node api/_workbook-apply.test.mjs
//       the dry_run=false refusal is deleted, so a "live" apply does things
//       this pass never earned the right to do.
//   MUTATE=archivedsteal      node api/_workbook-apply.test.mjs
//       plan resolution stops skipping archived offerings, so a rename and a
//       new price land on the ARCHIVED tier while the live plan is untouched -
//       with ok:true, a write report that reads correctly, and every answer
//       stamped so the rerun does nothing.
//   MUTATE=ambiguoustitle     node api/_workbook-apply.test.mjs
//       two LIVE offerings sharing a title resolve by position again, so both
//       cards write onto the first one and one plan's money lands on another.
//   MUTATE=protofield         node api/_workbook-apply.test.mjs
//       the whitelist goes back to truthiness, so Object.prototype members pass
//       for whitelisted fields: `__proto__` 500s review and apply, and
//       `constructor` writes an arbitrary key into the pricing jsonb.
//   MUTATE=unboundedrung      node api/_workbook-apply.test.mjs
//       both index bounds are deleted, so commitments.200000.price pads a
//       200,001-element array into a money jsonb with ok:true.
//   MUTATE=silentrefusal      node api/_workbook-apply.test.mjs
//       the reason the machinery gave is dropped on the way out, so a refusal
//       reaches review and apply_error saying nothing a human can act on.
//   MUTATE=unsellablerung     node api/_workbook-apply.test.mjs
//       the unsellable-rung scan is switched off, so a commitment length that
//       can never be minted goes back to being invisible to staff while it is
//       priced on the parent-facing page.
//   MUTATE=catalogblind       node api/_workbook-apply.test.mjs
//       the catalog read swallows its failure again, so the rehearsal reports
//       matched=0 and tells staff to mint prices that already exist.
//   MUTATE=snapshotblind      node api/_workbook-apply.test.mjs
//       the snapshot's offer_prices read swallows its failure, so the only way
//       back is a photograph of an empty list nobody verified.
//   MUTATE=previewlies        node api/_workbook-apply.test.mjs
//       the typed offer_prices row goes unread and the rhythm note goes back to
//       promising the mint will honour the label.
//   MUTATE=lateload           node api/_workbook-apply.test.mjs
//       the price machinery is loaded after every write again, so its 503
//       arrives with tax and prices already changed and names none of them.
//   MUTATE=answercolumn       node api/_workbook-apply.test.mjs
//       the staff answers read loses its 42703 fallback, so a missing
//       apply_error column 500s the entire review surface.
//
// A pin that no longer matches api/workbook.js reports NEGATIVE CONTROL FAILED
// rather than passing quietly. A control run exits ZERO when the mutation IS
// caught; CI greps for the banner and the MUTATE= names above.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const MUTATE = process.env.MUTATE || "";
const HERE = path.dirname(fileURLToPath(import.meta.url));

// ── env, BEFORE the module import ────────────────────────────────────────────
const SB_BASE = "https://stub.supabase.test";
process.env.SUPABASE_URL = SB_BASE;
process.env.VITE_SUPABASE_URL = SB_BASE;
process.env.SUPABASE_SERVICE_ROLE_KEY = "stub-service-key";
delete process.env.SUPABASE_SERVICE_KEY;

let pass = 0, fail = 0;
const failures = [];
let controlBroken = null;
const ok = (cond, label) => {
  if (cond) { pass++; console.log("  ✅ " + label); }
  else { fail++; failures.push(label); console.log("  ❌ " + label); }
};

// Everything printed by the suite AND the route is teed here for the
// token-never-logged assertions.
let consoleBuffer = "";
for (const m of ["log", "info", "warn", "error", "debug"]) {
  const real = console[m].bind(console);
  console[m] = (...args) => { consoleBuffer += args.map(String).join(" ") + "\n"; real(...args); };
}

// ── importing the route (real file, or a pinned mutant copy) ─────────────────
const tmpFiles = [];
const cleanup = () => { for (const f of tmpFiles) { try { fs.unlinkSync(f); } catch (_) { /* best effort */ } } };
process.on("exit", cleanup);

let sentryOk = true;
try { await import("@sentry/node"); } catch (_) { sentryOk = false; }
const SENTRY_IMPORT = 'import { withSentryApiRoute } from "./_sentry.js";';
const SENTRY_STUB = 'const withSentryApiRoute = (h) => h; // (suite) @sentry/node is not installed here';

function copyWith(edits, name = ".mutant-workbook-apply.js") {
  let src = fs.readFileSync(path.join(HERE, "workbook.js"), "utf8");
  for (const [find, repl] of edits) {
    if (!src.includes(find)) {
      controlBroken = `MUTATE=${MUTATE} is pinned to text that is no longer in api/workbook.js:\n\n${find}\n\nRe-point it or delete it - a pin that fails to apply looks exactly like a check that passed.`;
      throw new Error(controlBroken);
    }
    src = src.split(find).join(repl);
  }
  const copy = path.join(HERE, name);
  fs.writeFileSync(copy, src);
  tmpFiles.push(copy);
  return copy;
}

// ── the mutations ────────────────────────────────────────────────────────────
const APPLYBEFOREREVIEW = [[
  `  const { unapproved } = approvalGate(cards, grouped);
  if (unapproved.length) {`,
  `  const { unapproved } = approvalGate(cards, grouped);
  if (false && unapproved.length) {   // (control applybeforereview) the gate is gone`]];

// The preview moves one call earlier - before the tax write - so every
// previewed amount is computed against the OLD tax_config. Two pins, one
// mutation: the early call, and the late call replaced by its stale result.
const TAXAFTERMINT = [
  [`  // ── b. TAX to clients, before any amount is computed ──────────────────────
  let taxResult = null;`,
   `  // ── b. TAX to clients, before any amount is computed ──────────────────────
  const phase3Early = await phase3Preview(wb.client_id, priceMachinery);   // (control taxaftermint)
  let taxResult = null;`],
  [`  const phase3 = await phase3Preview(wb.client_id, priceMachinery);`,
   `  const phase3 = phase3Early;   // (control taxaftermint) built before the tax landed`],
];

// The PATCH filter ON ITS OWN. Split out because the two-pin mutation below
// passes with only its first half doing any work: the branch guard catches every
// SEQUENTIAL rerun, so `snapshot=is.null` was a guard no assertion could tell was
// gone. Section 14 is the race that makes it load-bearing.
const SNAPFILTERONLY = [[
  "    const landedSnap = await sb(`workbooks?id=eq.${enc(wb.id)}&snapshot=is.null&select=id`, {",
  "    const landedSnap = await sb(`workbooks?id=eq.${enc(wb.id)}&select=id`, {   // (control snapfilteronly)"]];

const SNAPSHOTOVERWRITE = [
  [`  let snapshotState = "already";
  if (wb.snapshot == null) {`,
   `  let snapshotState = "already";
  if (true) {   // (control snapshotoverwrite) every apply re-photographs`],
  ...SNAPFILTERONLY,
];

const REAPPLY = [[
  `    if (a.applied_at) { skipped.already_applied.push(a.id); continue; }`,
  `    // (control reapply) already-applied answers are written again`]];

const VOCABDRIFT = [[
  `    const out = cls.t(eff);
    if (!out.ok) { refuse(a, out.error); continue; }
    offerPending.push({ a, cls, value: out.value });`,
  `    offerPending.push({ a, cls, value: eff });   // (control vocabdrift) the page's own casing lands`]];

const OWNERTOKEN = [[
  `async function resolveStaffForWorkbook(req, body) {
  const { user, staff } = await resolveStaff(req);`,
  `async function resolveStaffForWorkbook(req, body) {
  let user = { id: "token-caller" }, staff = { id: "token-caller" };
  try { ({ user, staff } = await resolveStaff(req)); } catch (_) { /* (control ownertoken) the no-login token is enough */ }`]];

const LIVEAPPLY = [[
  `  if ((body || {}).dry_run === false) {
    throw bad(`,
  `  if (false && (body || {}).dry_run === false) {   // (control liveapply)
    throw bad(`]];

// ── the second wave: what the adversarial pass found ────────────────────────
// The old resolver, restored verbatim: first title match by position, archived
// included. Both halves of it were one line, so this control reverts to the
// behaviour that was really shipped rather than to a synthetic half of it -
// ambiguoustitle below isolates the second half on its own.
const ARCHIVEDSTEAL = [[
  `    const hits = [];
    for (let i = 0; i < list.length; i++) {
      if (!list[i] || list[i].title !== n) continue;
      if (list[i].archived) continue;   // out of the live offer, so out of this
      hits.push(i);
    }
    if (hits.length === 1) return { index: hits[0] };`,
  `    const hits = [];
    for (let i = 0; i < list.length; i++) {
      if (!list[i] || list[i].title !== n) continue;   // (control archivedsteal) archived counts again
      hits.push(i);
    }
    if (hits.length >= 1) return { index: hits[0] };   // (control archivedsteal) first hit wins`]];

const AMBIGUOUSTITLE = [[
  `    if (hits.length === 1) return { index: hits[0] };
    if (hits.length > 1) {`,
  `    if (hits.length >= 1) return { index: hits[0] };   // (control ambiguoustitle) position decides
    if (false) {`]];

const PROTOFIELD = [
  [`  if (!own(table, leaf)) {`,
   `  if (!table[leaf]) {   // (control protofield) inherited members pass for whitelisted ones`],
  [`  return own(PLAN_T, f)
    ? { kind: "plan", leaf: f, t: PLAN_T[f] }`,
   `  return PLAN_T[f]   // (control protofield) inherited members pass for whitelisted ones
    ? { kind: "plan", leaf: f, t: PLAN_T[f] }`],
];

const UNBOUNDEDRUNG = [
  [`  if (!(index <= MAX_LIST_INDEX)) {`,
   `  if (false) {   // (control unboundedrung) no structural ceiling`],
  [`    if (cls.index >= have + MAX_ADD_PER_CARD) {`,
   `    if (false && cls.index >= have + MAX_ADD_PER_CARD) {   // (control unboundedrung)`],
];

// The reason the machinery gave never reaches the human: every refusal collapses
// to the generic fallback, which is what "refused with error: undefined" looked
// like from the outside.
const SILENTREFUSAL = [[
  `  const s = typeof why === "string" ? why.trim() : "";`,
  `  const s = "";   // (control silentrefusal) the reason is dropped on the way out`]];

const UNSELLABLERUNG = [[
  `  let unsellable = null;
  if (offersRead.state === "read") {`,
  `  let unsellable = null;
  if (false) {   // (control unsellablerung) unsellable rungs go back to being invisible`]];

const CATALOGBLIND = [[
  `    readForPreview(
      \`pricing_catalog?client_id=eq.\${enc(clientId)}&select=stripe_price_id,offer_price_key,tier,amount_cents,interval,currency,display_name\`,
      "pricing_catalog"
    ),`,
  `    sb(\`pricing_catalog?client_id=eq.\${enc(clientId)}&select=stripe_price_id,offer_price_key,tier,amount_cents,interval,currency,display_name\`)
      .catch(() => []).then((rows) => ({ state: "read", rows })),   // (control catalogblind)`]];

const SNAPSHOTBLIND = [[
  `      sb(\`offer_prices?tenant_id=eq.\${enc(wb.client_id)}\`).then(
        (rows) => ({ ok: true, rows: Array.isArray(rows) ? rows : [] }),
        (e) => ({ ok: false, why: String((e && e.message) || e) })
      ),`,
  `      sb(\`offer_prices?tenant_id=eq.\${enc(wb.client_id)}\`)
        .catch(() => []).then((rows) => ({ ok: true, rows })),   // (control snapshotblind)`]];

const PREVIEWLIES = [
  [`    readForPreview(
      \`offer_prices?tenant_id=eq.\${enc(clientId)}&is_active=eq.true&is_routable=eq.true&billing_cadence=not.is.null\`
      + "&select=source_offer_id,source_offer_price_key,billing_cadence,sort_order&order=sort_order.asc",
      "offer_prices billing_cadence"
    ),`,
   `    Promise.resolve({ state: "read", rows: [] }),   // (control previewlies) the typed row is never read`],
  ["        rhythm_note: `the commitment length declares a ${weeks}-week billing rhythm. ${CADENCE_UNKNOWABLE}`,",
   "        rhythm_note: `the commitment length declares a ${weeks}-week billing rhythm; the mint resolves it through create-price.js cadence rules`,   // (control previewlies)"],
];

const LATELOAD = [
  [`  const priceMachinery = await loadPriceMachinery();`,
   `  const priceMachinery = null;   // (control lateload) loaded later, after the writes`],
  [`async function phase3Preview(clientId, mod) {`,
   `async function phase3Preview(clientId, mod) {
  mod = await loadPriceMachinery();   // (control lateload) loaded once every write has landed`],
];

const ANSWERCOLUMN = [[
  `    if (!is42703(e)) throw e;
    // Review still works and shows apply_error as null, which is the truth in
    // an environment where no apply has ever been able to record one. The
    // WRITING actions refuse on this flag rather than patching a column that is
    // not there and reading the 400 as a mystery.
    return { answers: (await sb(q(ANSWER_SELECT))) || [], degraded: true };`,
  `    throw e;   // (control answercolumn) a missing apply_error column 500s the review surface`]];

// The withhold goes back to being stdout: the report key is dropped from the
// phase3 return, so a plan's joining fee silently vanishes from the rehearsal
// with only a server-side console.warn to show for it - the exact shape Step 1
// (D1 groundwork) closed.
const FEEWITHHELDSILENTLY = [[
  `    withheld_signup_fees: withheld,`,
  `    // (control feewithheldsilently) the withhold is dropped from the response`]];

// The deliberate No collapses back into never-asked: canonicalTax stores null
// for { charges_tax: false }, so the owner's answer and an unasked academy are
// the same nothing again, and a future workbook asks him a question he already
// answered.
const NOISNULL = [[
  `  if (v.charges_tax === false) return tOk({ charges_tax: false });`,
  `  if (v.charges_tax === false) return tOk(null);   // (control noisnull) the deliberate no collapses into never-asked`]];

const EDITS = {
  applybeforereview: APPLYBEFOREREVIEW,
  feewithheldsilently: FEEWITHHELDSILENTLY,
  noisnull: NOISNULL,
  taxaftermint: TAXAFTERMINT,
  snapshotoverwrite: SNAPSHOTOVERWRITE,
  snapfilteronly: SNAPFILTERONLY,
  reapply: REAPPLY,
  vocabdrift: VOCABDRIFT,
  ownertoken: OWNERTOKEN,
  liveapply: LIVEAPPLY,
  archivedsteal: ARCHIVEDSTEAL,
  ambiguoustitle: AMBIGUOUSTITLE,
  protofield: PROTOFIELD,
  unboundedrung: UNBOUNDEDRUNG,
  silentrefusal: SILENTREFUSAL,
  unsellablerung: UNSELLABLERUNG,
  catalogblind: CATALOGBLIND,
  snapshotblind: SNAPSHOTBLIND,
  previewlies: PREVIEWLIES,
  lateload: LATELOAD,
  answercolumn: ANSWERCOLUMN,
};

const edits = MUTATE
  ? (EDITS[MUTATE] || (() => { controlBroken = `unknown control MUTATE=${MUTATE}`; throw new Error(controlBroken); })())
  : [];
if (!sentryOk) console.log("  (note) @sentry/node is not installed here, so the copy under test has its _sentry import replaced by an identity wrapper. Nothing else is changed. NOTE: apply's phase-3 preview imports match-prices.js, whose chain also needs node_modules - expect it to refuse here.");
const modulePath = (!MUTATE && sentryOk)
  ? path.join(HERE, "workbook.js")
  : copyWith(sentryOk ? edits : [...edits, [SENTRY_IMPORT, SENTRY_STUB]]);

// ═════════════════════════════════════════════════════════════════════════════
// ── the in-memory world ──────────────────────────────────────────────────────
//
// The same PostgREST-shaped stub as api/_workbook.test.mjs, extended with the
// filters this half of the route (and buildOfferTargets) actually uses:
// neq.  and  not.is.null  join eq/in/is.null/like.
const TOKEN = "wbk_" + "tok_" + "applySanJose";
const STAFF_BEARER = "staff-session-" + "bearer-Kp3";

const COLUMNS = {
  clients: ["id", "public_name", "business_name", "tax_config"],
  staff: ["id", "user_id", "name", "email"],
  offers: ["id", "client_id", "status", "title", "type", "data"],
  workbooks: ["id", "client_id", "kind", "token", "status", "expires_at", "sent_at", "submitted_at", "reviewed_at", "applied_at", "snapshot", "created_by", "created_by_name", "created_at", "updated_at"],
  workbook_cards: ["id", "workbook_id", "card_key", "title", "sort_order", "state", "confirmed_at", "approved_at", "approved_by", "meta", "created_at", "updated_at"],
  workbook_answers: ["id", "workbook_id", "card_id", "client_id", "target_kind", "target_table", "target_id", "target_field", "current_value", "proposed", "answered", "applied_at", "apply_error", "created_at", "updated_at"],
  pricing_catalog: ["id", "client_id", "stripe_price_id", "stripe_product_id", "offer_price_key", "tier", "amount_cents", "interval", "currency", "display_name"],
  // is_active / is_routable / sort_order are here because the preview's typed
  // cadence read is scoped EXACTLY the way create-price.js scopes the row it
  // mints from - a stub that could not answer that query would let the two
  // disagree without the suite noticing.
  offer_prices: ["id", "tenant_id", "source_offer_id", "source_offer_price_key", "billing_cadence", "is_active", "is_routable", "sort_order"],
};

// FAULT INJECTION, because the whole point of items like catalogblind is what
// happens when a READ FAILS - and a stub that can only ever succeed or return
// nothing cannot tell those apart either. A table named here answers 503 to a
// GET, which is what sb() turns into a throw.
const FAIL_READS = new Set();

// A CONCURRENT WRITER, landing inside the window a REST round trip really has.
// Without this the suite cannot express the race the `snapshot=is.null` filter
// exists for - the branch guard alone passes every sequential test, so that
// filter was a guard no assertion could tell was gone. The hook fires at most
// once and decides for itself which write it is racing.
const RACE = { fn: null };

// ── THE FIXTURE: San Jose, in the shapes the offer REALLY uses ───────────────
// Every value below was read from the live offer jsonb (2026-08-06), not
// invented: "charge"/"waive" lowercase, "Every 4 weeks" exact, prices as
// STRINGS, "Renews same length" exact. The workbook answers hold what the PAGE
// produces - which is not always that.
const OFFER_DATA = () => ({
  pricing: {
    pricing_offerings: [
      {
        title: "2 Trainings/Week", type: "Membership", price: "250",
        billing_cycle: "Every 4 weeks", whats_included: "Two team trainings a week.",
        signup_fee: "40", signup_fee_on_base: "charge",
        commitments: [
          { length: "3 Months (12 Weeks)", price: "599", after: "Renews same length", signup_fee_charge: "waive" },
        ],
      },
      {
        title: "Elementary Academy", type: "Membership", price: "200",
        billing_cycle: "Every 4 weeks", whats_included: "One elementary training a week.",
        signup_fee: "40", signup_fee_on_base: "charge",
      },
    ],
  },
});

let DB;
let seq = 0;
function reset() {
  seq = 0;
  DB = {
    clients: [{ id: "sj", public_name: "By Any Means San Jose", business_name: "BAM San Jose", tax_config: null }],
    staff: [{ id: "staff-1", user_id: "user-1", name: "Zoran", email: "zoran@byanymeansbball.com" }],
    offers: [{ id: "off1", client_id: "sj", status: "active", title: "Training", type: "training", data: OFFER_DATA() }],
    workbooks: [
      { id: "wb1", client_id: "sj", kind: "price", token: TOKEN, status: "submitted", submitted_at: "2026-08-06T01:00:00Z", reviewed_at: null, snapshot: null, created_at: "2026-08-06T00:00:00Z", updated_at: "2026-08-06T00:00:00Z" },
    ],
    workbook_cards: [
      { id: "c-tax", workbook_id: "wb1", card_key: "tax", title: "Sales tax", sort_order: 0, state: "changed", confirmed_at: "2026-08-06T00:30:00Z", approved_at: null, approved_by: null, meta: { kind: "academy" } },
      { id: "c-two", workbook_id: "wb1", card_key: "plan:two", title: "Academy 2x/week", sort_order: 1, state: "changed", confirmed_at: "2026-08-06T00:31:00Z", approved_at: null, approved_by: null, meta: { fam: "two" } },
      { id: "c-ele", workbook_id: "wb1", card_key: "plan:ele", title: "Elementary Academy", sort_order: 2, state: "changed", confirmed_at: "2026-08-06T00:32:00Z", approved_at: null, approved_by: null, meta: { fam: "ele" } },
      { id: "c-plans", workbook_id: "wb1", card_key: "plans", title: "Something missing?", sort_order: 3, state: "changed", confirmed_at: "2026-08-06T00:33:00Z", approved_at: null, approved_by: null, meta: { kind: "add" } },
      { id: "c-codes", workbook_id: "wb1", card_key: "codes", title: "Discount codes", sort_order: 4, state: "changed", confirmed_at: "2026-08-06T00:34:00Z", approved_at: null, approved_by: null, meta: { kind: "codes" } },
      { id: "c-notes", workbook_id: "wb1", card_key: "notes", title: "Anything else", sort_order: 5, state: "changed", confirmed_at: "2026-08-06T00:35:00Z", approved_at: null, approved_by: null, meta: { kind: "notes" } },
    ],
    workbook_answers: [
      // The tax answer carries a passenger key (the example sentence the page
      // rendered). Canonicalization must strip it: GTA stores { pct, label }
      // and nothing else.
      { id: "a-tax", workbook_id: "wb1", card_id: "c-tax", client_id: "sj", target_kind: "academy_setting", target_table: "clients", target_id: "sj", target_field: "tax_config", current_value: null, proposed: null, answered: { charges_tax: true, pct: 9.375, label: "CA sales tax", example: "a $250 plan shows as $273" }, applied_at: null, apply_error: null, created_at: "2026-08-06T00:00:01Z" },
      // THE SAN JOSE RENAME: confirmed without editing, answered materialized
      // from proposed, and it differs from what the portal stores.
      { id: "a-two-title", workbook_id: "wb1", card_id: "c-two", client_id: "sj", target_kind: "price_row", target_table: "offers", target_id: "off1", target_field: "title", current_value: "2 Trainings/Week", proposed: "Academy 2x/week", answered: "Academy 2x/week", applied_at: null, apply_error: null, created_at: "2026-08-06T00:00:02Z" },
      { id: "a-two-price", workbook_id: "wb1", card_id: "c-two", client_id: "sj", target_kind: "price_row", target_table: "offers", target_id: "off1", target_field: "price", current_value: "250", proposed: "250", answered: "250", applied_at: null, apply_error: null, created_at: "2026-08-06T00:00:03Z" },
      // THE PAGE'S OWN CASING: the chip says "Waive"; the offer speaks "waive".
      { id: "a-two-fee", workbook_id: "wb1", card_id: "c-two", client_id: "sj", target_kind: "price_row", target_table: "offers", target_id: "off1", target_field: "signup_fee_on_base", current_value: "charge", proposed: "charge", answered: "Waive", applied_at: null, apply_error: null, created_at: "2026-08-06T00:00:04Z" },
      // Lowercased by the page; the offer stores "Every 4 weeks" exactly. The
      // translated value EQUALS what the offer already holds, so this answer
      // must land without a write.
      { id: "a-two-cycle", workbook_id: "wb1", card_id: "c-two", client_id: "sj", target_kind: "price_row", target_table: "offers", target_id: "off1", target_field: "billing_cycle", current_value: "Every 4 weeks", proposed: "Every 4 weeks", answered: "every 4 weeks", applied_at: null, apply_error: null, created_at: "2026-08-06T00:00:05Z" },
      // A NUMBER from a number input; the offer stores the STRING "549".
      { id: "a-two-c0-price", workbook_id: "wb1", card_id: "c-two", client_id: "sj", target_kind: "price_row", target_table: "offers", target_id: "off1", target_field: "commitments.0.price", current_value: "599", proposed: "599", answered: 549, applied_at: null, apply_error: null, created_at: "2026-08-06T00:00:06Z" },
      // Elementary: a whole NEW rung (current_value null everywhere - the offer
      // has no commitments key at all). Apply must create it.
      { id: "a-ele-title", workbook_id: "wb1", card_id: "c-ele", client_id: "sj", target_kind: "price_row", target_table: "offers", target_id: "off1", target_field: "title", current_value: "Elementary Academy", proposed: "Elementary Academy", answered: "Elementary Academy", applied_at: null, apply_error: null, created_at: "2026-08-06T00:00:07Z" },
      { id: "a-ele-c0-len", workbook_id: "wb1", card_id: "c-ele", client_id: "sj", target_kind: "price_row", target_table: "offers", target_id: "off1", target_field: "commitments.0.length", current_value: null, proposed: "3 Months (12 Weeks)", answered: "3 Months (12 Weeks)", applied_at: null, apply_error: null, created_at: "2026-08-06T00:00:08Z" },
      { id: "a-ele-c0-price", workbook_id: "wb1", card_id: "c-ele", client_id: "sj", target_kind: "price_row", target_table: "offers", target_id: "off1", target_field: "commitments.0.price", current_value: null, proposed: "499", answered: "499", applied_at: null, apply_error: null, created_at: "2026-08-06T00:00:09Z" },
      // The MOCKUP's long phrase; the offer stores "Renews same length".
      { id: "a-ele-c0-after", workbook_id: "wb1", card_id: "c-ele", client_id: "sj", target_kind: "price_row", target_table: "offers", target_id: "off1", target_field: "commitments.0.after", current_value: null, proposed: "Renews same length", answered: "Renews for the same length", applied_at: null, apply_error: null, created_at: "2026-08-06T00:00:10Z" },
      { id: "a-ele-c0-fee", workbook_id: "wb1", card_id: "c-ele", client_id: "sj", target_kind: "price_row", target_table: "offers", target_id: "off1", target_field: "commitments.0.signup_fee_charge", current_value: null, proposed: "waive", answered: "waive", applied_at: null, apply_error: null, created_at: "2026-08-06T00:00:11Z" },
      // A TWELVE month rung - the term vocabulary is open now (any 1-24 whole
      // months yields a <n>_months key), and the old closed map would have
      // misfiled this as the 4-week default. No week count in the label, so no
      // declared rhythm either.
      { id: "a-ele-c1-len", workbook_id: "wb1", card_id: "c-ele", client_id: "sj", target_kind: "price_row", target_table: "offers", target_id: "off1", target_field: "commitments.1.length", current_value: null, proposed: "12 Months", answered: "12 Months", applied_at: null, apply_error: null, created_at: "2026-08-06T00:00:11.2Z" },
      { id: "a-ele-c1-price", workbook_id: "wb1", card_id: "c-ele", client_id: "sj", target_kind: "price_row", target_table: "offers", target_id: "off1", target_field: "commitments.1.price", current_value: null, proposed: "1999", answered: "1999", applied_at: null, apply_error: null, created_at: "2026-08-06T00:00:11.4Z" },
      { id: "a-ele-c1-after", workbook_id: "wb1", card_id: "c-ele", client_id: "sj", target_kind: "price_row", target_table: "offers", target_id: "off1", target_field: "commitments.1.after", current_value: null, proposed: "Renews same length", answered: "Renews same length", applied_at: null, apply_error: null, created_at: "2026-08-06T00:00:11.6Z" },
      // An owner ADDITION: a request a human creates by hand. Apply must not
      // touch it.
      { id: "a-add", workbook_id: "wb1", card_id: "c-plans", client_id: "sj", target_kind: "price_row", target_table: "offers", target_id: null, target_field: "add:plan", current_value: null, proposed: null, answered: { title: "Summer 1x/week", price: 150 }, applied_at: null, apply_error: null, created_at: "2026-08-06T00:00:12Z" },
      // His one real coupon, entering the offer for the first time.
      { id: "a-code-code", workbook_id: "wb1", card_id: "c-codes", client_id: "sj", target_kind: "price_row", target_table: "offers", target_id: "off1", target_field: "codes.0.code", current_value: null, proposed: "club", answered: "club", applied_at: null, apply_error: null, created_at: "2026-08-06T00:00:13Z" },
      { id: "a-code-kind", workbook_id: "wb1", card_id: "c-codes", client_id: "sj", target_kind: "price_row", target_table: "offers", target_id: "off1", target_field: "codes.0.kind", current_value: null, proposed: "Dollar off", answered: "Dollar off", applied_at: null, apply_error: null, created_at: "2026-08-06T00:00:14Z" },
      { id: "a-code-value", workbook_id: "wb1", card_id: "c-codes", client_id: "sj", target_kind: "price_row", target_table: "offers", target_id: "off1", target_field: "codes.0.value", current_value: null, proposed: "100", answered: "100", applied_at: null, apply_error: null, created_at: "2026-08-06T00:00:15Z" },
      { id: "a-code-dur", workbook_id: "wb1", card_id: "c-codes", client_id: "sj", target_kind: "price_row", target_table: "offers", target_id: "off1", target_field: "codes.0.duration", current_value: null, proposed: "Every payment", answered: "Every payment", applied_at: null, apply_error: null, created_at: "2026-08-06T00:00:16Z" },
      // Page vocabulary "No"; the seed writes the BOOLEAN false.
      { id: "a-code-once", workbook_id: "wb1", card_id: "c-codes", client_id: "sj", target_kind: "price_row", target_table: "offers", target_id: "off1", target_field: "codes.0.once_per_customer", current_value: null, proposed: false, answered: "No", applied_at: null, apply_error: null, created_at: "2026-08-06T00:00:17Z" },
      // A restricted applies_to list - which is also what keeps the sign-up fee
      // targets mintable (an UNRESTRICTED code suppresses them).
      { id: "a-code-applies", workbook_id: "wb1", card_id: "c-codes", client_id: "sj", target_kind: "price_row", target_table: "offers", target_id: "off1", target_field: "codes.0.applies_to", current_value: null, proposed: null, answered: ["2 Trainings/Week|monthly"], applied_at: null, apply_error: null, created_at: "2026-08-06T00:00:18Z" },
      // Free text for staff to read, never for apply to write.
      { id: "a-notes", workbook_id: "wb1", card_id: "c-notes", client_id: "sj", target_kind: "price_row", target_table: "offers", target_id: "off1", target_field: "notes", current_value: null, proposed: null, answered: "Please double check the 6 month price.", applied_at: null, apply_error: null, created_at: "2026-08-06T00:00:19Z" },
    ],
    // One live Stripe price already at the post-tax Elementary monthly amount,
    // so the preview has something to MATCH as well as things to mint.
    // 20000 * 1.09375 = 21875 exactly.
    pricing_catalog: [
      { id: "pc1", client_id: "sj", stripe_price_id: "price_ele_m", stripe_product_id: "prod_ele", offer_price_key: null, tier: "canonical", amount_cents: 21875, interval: "4_weeks", currency: "usd", display_name: "Elementary Academy" },
    ],
    offer_prices: [],
  };
}
reset();

const CALLS = [];
const httpErr = (code, message) => ({ status: 400, body: { code, message, details: null, hint: null } });

function applyFilters(table, params) {
  let rows = (DB[table] || []).slice();
  for (const [k, v] of params.entries()) {
    if (["select", "order", "limit", "offset", "on_conflict"].includes(k)) continue;
    const s = String(v);
    if (s.startsWith("eq.")) { const val = s.slice(3); rows = rows.filter((r) => String(r[k] == null ? "" : r[k]) === val); }
    else if (s.startsWith("neq.")) { const val = s.slice(4); rows = rows.filter((r) => String(r[k] == null ? "" : r[k]) !== val); }
    else if (s.startsWith("in.(")) { const vals = s.slice(4, -1).split(","); rows = rows.filter((r) => vals.includes(String(r[k]))); }
    else if (s === "not.is.null") rows = rows.filter((r) => r[k] != null);
    else if (s.startsWith("is.null")) rows = rows.filter((r) => r[k] == null);
    else if (s.startsWith("like.")) {
      const pat = s.slice(5).split("*").join("%");
      const rx = new RegExp("^" + pat.split("%").map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join(".*") + "$");
      rows = rows.filter((r) => rx.test(String(r[k] == null ? "" : r[k])));
    }
  }
  const lim = parseInt(params.get("limit") || "0", 10);
  return lim > 0 ? rows.slice(0, lim) : rows;
}

function project(table, rows, params) {
  const sel = params.get("select");
  if (!sel || sel === "*") return rows.map((r) => ({ ...r }));
  const cols = sel.split(",").map((c) => c.trim()).filter(Boolean);
  for (const c of cols) {
    if (!COLUMNS[table].includes(c)) {
      const e = new Error("undefined column");
      e.pgrst = httpErr("42703", `column ${table}.${c} does not exist`);
      throw e;
    }
  }
  return rows.map((r) => Object.fromEntries(cols.map((c) => [c, r[c] === undefined ? null : r[c]])));
}

globalThis.fetch = async (url, init = {}) => {
  const u = String(url);
  const method = String(init.method || "GET").toUpperCase();
  CALLS.push({ method, url: u, headers: init.headers || {}, body: init.body });
  new Headers(init.headers || {});
  const json = (v, status = 200) => new Response(JSON.stringify(v), { status, headers: { "content-type": "application/json" } });

  if (u.startsWith("https://api.stripe.com/")) throw new Error(`STRIPE WAS CALLED: ${method} ${u} - nothing in this pass may talk to Stripe`);
  if (u.startsWith(`${SB_BASE}/auth/v1/`)) {
    const bearer = String((init.headers || {}).Authorization || "");
    if (bearer !== `Bearer ${STAFF_BEARER}`) return json({ msg: "invalid" }, 401);
    return json({ id: "user-1", email: "zoran@byanymeansbball.com" });
  }
  if (!u.startsWith(`${SB_BASE}/rest/v1/`)) throw new Error(`UNSTUBBED CALL: ${method} ${u}`);

  const [table, qs = ""] = u.slice(`${SB_BASE}/rest/v1/`.length).split("?");
  const params = new URLSearchParams(qs);
  const prefer = String((init.headers || {}).Prefer || "");
  try {
    if (method === "GET" && FAIL_READS.has(table)) {
      return json({ code: "57P01", message: "the database went away mid-read", details: null, hint: null }, 503);
    }
    if (method === "GET") return json(project(table, applyFilters(table, params), params));
    if (method === "PATCH") {
      // The competing write lands BEFORE this one is filtered, which is exactly
      // where a real concurrent apply lands: after our read, before our PATCH.
      if (RACE.fn && RACE.fn(table, params)) RACE.fn = null;
      const patch = init.body ? JSON.parse(init.body) : {};
      const hit = applyFilters(table, params);
      for (const r of hit) Object.assign(r, patch);
      return json(prefer.includes("return=representation") ? project(table, hit, params) : []);
    }
    if (method === "POST") {
      const rows = JSON.parse(init.body || "[]");
      const made = (Array.isArray(rows) ? rows : [rows]).map((r) => {
        const row = { id: `new-${++seq}`, created_at: "2026-08-06T12:00:00Z", ...r };
        (DB[table] = DB[table] || []).push(row);
        return row;
      });
      return json(prefer.includes("return=representation") ? project(table, made, params) : []);
    }
    if (method === "DELETE") {
      const hit = applyFilters(table, params);
      const ids = new Set(hit.map((r) => r.id));
      DB[table] = (DB[table] || []).filter((r) => !ids.has(r.id));
      return json(prefer.includes("return=representation") ? hit : []);
    }
  } catch (e) {
    if (e.pgrst) return json(e.pgrst.body, e.pgrst.status);
    throw e;
  }
  return json([]);
};

const WB = await import(pathToFileURL(modulePath).href);

// A SECOND COPY OF THE ROUTE whose price-machinery import cannot resolve. It is
// not a mutation of a guarantee, it is the only way to EXERCISE the 503 path:
// the question item 6 asks is "what has already been written when that import
// fails", and you cannot answer it against an import that works. MUTATE=lateload
// moves the load back to where it used to be, and this copy is where that shows
// up as tax and offer writes that landed before the refusal.
const noloadEdits = [
  ...(sentryOk ? [] : [[SENTRY_IMPORT, SENTRY_STUB]]),
  ...edits,
  [`await import("./offers/match-prices.js")`, `await import("./offers/no-such-price-machinery.js")`],
];
const WB_NOLOAD = await import(pathToFileURL(copyWith(noloadEdits, ".mutant-workbook-noload.js")).href);

// ── calling the route ────────────────────────────────────────────────────────
async function callOn(mod, req) {
  let status = 200, body = null;
  const res = {
    status(c) { status = c; return this; },
    json(b) { body = b; return this; },
  };
  await mod.default({ headers: {}, ...req }, res);
  return { status, body, text: JSON.stringify(body) };
}
const call = (req) => callOn(WB, req);
const post = (body, headers) => call({ method: "POST", url: "/api/workbook", headers: headers || {}, body });
const AUTH = { authorization: `Bearer ${STAFF_BEARER}` };
const staffPost = (body) => post(body, AUTH);
const row = (table, id) => (DB[table] || []).find((r) => r.id === id);
const offering = (i) => row("offers", "off1").data.pricing.pricing_offerings[i];
const wbRow = () => row("workbooks", "wb1");
const answers = () => DB.workbook_answers.filter((a) => a.workbook_id === "wb1");
const noEmDash = (s) => !String(s).includes("—");
const offerings = () => row("offers", "off1").data.pricing.pricing_offerings;
// Every card stamped, so a section can get straight to the thing it is about.
const approveAll = () => {
  for (const c of DB.workbook_cards) { c.approved_at = "2026-08-06T02:00:00Z"; c.approved_by = "user-1"; }
};
// The written state apply must not have touched when it refuses.
const worldState = () => JSON.stringify(DB.offers) + JSON.stringify(DB.clients) + String(wbRow().snapshot);
// An answer row in the same shape the seed writes, so a section can add the one
// row it is testing without restating eleven fields.
let extraSeq = 0;
const addAnswer = (cardId, field, answered, extra) => {
  const rowNew = {
    id: `x-${++extraSeq}`, workbook_id: "wb1", card_id: cardId, client_id: "sj",
    target_kind: "price_row", target_table: "offers", target_id: "off1",
    target_field: field, current_value: null, proposed: null, answered,
    applied_at: null, apply_error: null, created_at: `2026-08-06T00:01:${String(extraSeq).padStart(2, "0")}Z`,
    ...(extra || {}),
  };
  DB.workbook_answers.push(rowNew);
  return rowNew.id;
};

// ═════════════════════════════════════════════════════════════════════════════
console.log("\n── 1. the staff-only door: the owner's token opens none of this ──");
{
  const before = JSON.stringify(DB);
  for (const action of ["review", "approve-card", "apply", "publish", "rollback"]) {
    // Everything an owner could plausibly send: his token, the workbook id his
    // own GET handed him, a card key. No staff bearer.
    const r = await post({ action, token: TOKEN, workbook_id: "wb1", card_key: "plan:two", dry_run: true });
    ok(r.status === 401 && r.body.ok === false, `${action} with the owner token and no staff bearer is 401`);
    ok(!r.text.includes(TOKEN), `and the ${action} refusal does not echo the token`);
  }
  const wrong = await post({ action: "review", workbook_id: "wb1" }, { authorization: "Bearer not-a-staff-session" });
  ok(wrong.status === 401, "an unknown bearer is 401 too");
  ok(JSON.stringify(DB) === before, "and none of the six attempts wrote a single thing");
  ok(!consoleBuffer.includes(TOKEN), "the token reached no log line either");
}

console.log("\n── 2. review: the decision set, grouped by blast radius ──");
{
  const r = await staffPost({ action: "review", workbook_id: "wb1" });
  ok(r.status === 200 && r.body.ok === true, "staff review answers");
  ok(r.body.workbook.status === "submitted" && r.body.workbook.snapshot_taken === false,
    "with the workbook's status and the fact no snapshot exists yet");

  const rv = r.body.review;
  ok(Object.keys(rv).join(",") === "academy_settings,cards,additions,notes",
    "grouped academy_settings FIRST, then cards, then additions, then notes");
  ok(rv.academy_settings.length === 1 && rv.academy_settings[0].target_field === "tax_config",
    "the tax answer is in academy settings, not buried among price rows");
  ok(JSON.stringify(rv.academy_settings[0].will_write) === JSON.stringify({ pct: 9.375, label: "CA sales tax" }),
    "and its will_write is the canonical { pct, label } - the passenger keys are already stripped in the preview");

  // THE RENAME. Confirmed without editing: answered === proposed !== current.
  const two = rv.cards.find((c) => c.card_key === "plan:two");
  const title = two.items.find((i) => i.target_field === "title");
  ok(!!title && title.is_change === true && title.answered === "Academy 2x/week" && title.current_value === "2 Trainings/Week",
    "a card confirmed WITHOUT EDITING whose proposal differs from current reads as a CHANGE - the San Jose rename is visible");
  const fee = two.items.find((i) => i.target_field === "signup_fee_on_base");
  ok(!!fee && fee.will_write === "waive",
    `the page's "Waive" previews as the offer's "waive" (saw ${JSON.stringify(fee && fee.will_write)})`);
  const cyc = two.items.find((i) => i.target_field === "billing_cycle");
  ok(!!cyc && cyc.will_write === "Every 4 weeks",
    "and the lowercased cycle previews as the offer's exact string");
  const c0p = two.items.find((i) => i.target_field === "commitments.0.price");
  ok(!!c0p && c0p.will_write === "549" && c0p.answered === 549,
    "a NUMBER answer previews as the STRING the offer stores");

  ok(rv.additions.length === 1 && rv.additions[0].target_field === "add:plan" && rv.additions[0].card_key === "plans",
    "the owner's addition is its own group - a request a human must create");
  ok(rv.notes.length === 1 && /double check/.test(String(rv.notes[0].effective)),
    "and the free text is its own group at the end");

  ok(r.body.gate.counted === 6 && r.body.gate.approved === 0 && r.body.gate.ready_to_apply === false,
    `the gate counts 6 cards, 0 approved (saw ${r.body.gate.counted}/${r.body.gate.approved})`);
  ok(!r.text.includes(TOKEN), "no token anywhere in the review body");

  const writes = CALLS.filter((c) => c.method !== "GET" && c.url.includes("/rest/v1/"));
  ok(writes.length === 0, "review wrote NOTHING - it is a read");
}

console.log("\n── 3. approve-card: the staff act, refused where the owner never confirmed ──");
{
  // A card the owner never confirmed cannot be approved.
  const was = row("workbook_cards", "c-two").confirmed_at;
  row("workbook_cards", "c-two").confirmed_at = null;
  const refused = await staffPost({ action: "approve-card", workbook_id: "wb1", card_key: "plan:two" });
  ok(refused.status === 409 && /has not confirmed/.test(refused.body.error) && noEmDash(refused.body.error),
    `approving an unconfirmed card is refused ("${refused.body.error}")`);
  ok(row("workbook_cards", "c-two").approved_at == null, "and nothing was stamped");
  row("workbook_cards", "c-two").confirmed_at = was;

  const gone = await staffPost({ action: "approve-card", workbook_id: "wb1", card_key: "plan:nope" });
  ok(gone.status === 404, "an unknown card_key is 404");

  const first = await staffPost({ action: "approve-card", workbook_id: "wb1", card_key: "tax" });
  ok(first.body.ok === true && !!row("workbook_cards", "c-tax").approved_at
    && row("workbook_cards", "c-tax").approved_by === "user-1",
    "approving stamps approved_at and approved_by with the STAFF user");
  ok(first.body.gate.approved === 1 && first.body.workbook_status === "submitted",
    "one of six approved; the workbook stays submitted");

  const stampedAt = row("workbook_cards", "c-tax").approved_at;
  const again = await staffPost({ action: "approve-card", workbook_id: "wb1", card_key: "tax" });
  ok(again.body.ok === true && row("workbook_cards", "c-tax").approved_at === stampedAt,
    "re-approving is idempotent - the FIRST stamp is the record");

  for (const key of ["plan:two", "plan:ele", "plans", "codes"]) {
    await staffPost({ action: "approve-card", workbook_id: "wb1", card_key: key });
  }
  ok(wbRow().status === "submitted", "five of six approved: still submitted");
  const last = await staffPost({ action: "approve-card", workbook_id: "wb1", card_key: "notes" });
  ok(last.body.workbook_status === "reviewed" && wbRow().status === "reviewed" && !!wbRow().reviewed_at,
    "the LAST approval moves the workbook to 'reviewed' with reviewed_at stamped");

  // The workbook never reopened to the owner through any of this.
  const ownerSave = await post({ token: TOKEN, action: "save", card_key: "plan:two", answers: [{ id: "a-two-title", answered: "sneaky" }] });
  ok(ownerSave.status === 409 && row("workbook_answers", "a-two-title").answered === "Academy 2x/week",
    "and the owner still cannot edit - review and approval never reopen the workbook");
}

console.log("\n── 4. apply: gated, ordered, dry by default ──");
{
  // ── the gate, shown by a fresh workbook state ─────────────────────────────
  // Un-approve one card and try: the whole apply refuses and writes nothing.
  const keep = row("workbook_cards", "c-codes").approved_at;
  row("workbook_cards", "c-codes").approved_at = null;
  const before = JSON.stringify(DB.offers) + JSON.stringify(DB.clients) + String(wbRow().snapshot);
  const held = await staffPost({ action: "apply", workbook_id: "wb1" });
  ok(held.status === 409 && held.body.code === "unapproved_cards" && /codes/.test(held.body.error) && noEmDash(held.body.error),
    `apply with an unapproved card is refused and NAMES it ("${held.body.error}")`);
  ok(JSON.stringify(DB.offers) + JSON.stringify(DB.clients) + String(wbRow().snapshot) === before,
    "and the refusal wrote nothing - no snapshot, no tax, no offer edit");
  row("workbook_cards", "c-codes").approved_at = keep;

  // ── dry_run=false is refused BEFORE it can do anything ────────────────────
  const live = await staffPost({ action: "apply", workbook_id: "wb1", dry_run: false });
  ok(live.status === 409 && live.body.code === "live_apply_not_built" && /rehearsal/.test(live.body.error) && noEmDash(live.body.error),
    `dry_run:false is refused outright ("${live.body.error}")`);
  ok(wbRow().snapshot == null && row("clients", "sj").tax_config === null
    && offering(0).title === "2 Trainings/Week",
    "and it did NOTHING AT ALL - no snapshot, no tax, no offer write");

  // ── the real dry run (the DEFAULT - no dry_run key sent) ──────────────────
  const originalOfferData = JSON.parse(JSON.stringify(row("offers", "off1").data));
  const r = await staffPost({ action: "apply", workbook_id: "wb1" });
  ok(r.status === 200 && r.body.ok === true && r.body.dry_run === true, "apply with no dry_run flag runs DRY");
  ok(r.body.snapshot === "taken", "and reports the snapshot as freshly taken");

  // a. THE PHOTOGRAPH is the PRE-write state.
  const snap = wbRow().snapshot;
  ok(!!snap && JSON.stringify(snap.offers[0].data) === JSON.stringify(originalOfferData),
    "the snapshot photographs the offer BEFORE the writes");
  ok(snap.tax_config === null, "and the tax_config before it was set");

  // b. TAX, canonical shape, extra keys stripped.
  const tax = row("clients", "sj").tax_config;
  ok(!!tax && tax.pct === 9.375 && tax.label === "CA sales tax" && Object.keys(tax).sort().join(",") === "label,pct",
    `clients.tax_config is EXACTLY { pct, label } - the workbook's passenger keys are stripped (saw ${JSON.stringify(tax)})`);

  // c. THE OFFER, in its own vocabulary.
  ok(offering(0).title === "Academy 2x/week", "the plan is renamed - the confirm-without-editing rename really lands");
  ok(offering(0).signup_fee_on_base === "waive",
    `the page's "Waive" landed as the offer's lowercase "waive" (saw ${JSON.stringify(offering(0).signup_fee_on_base)})`);
  ok(offering(0).billing_cycle === "Every 4 weeks",
    "the billing cycle still reads the offer's exact string");
  ok(offering(0).commitments[0].price === "549",
    `the number 549 landed as the STRING "549" (saw ${JSON.stringify(offering(0).commitments[0].price)})`);
  ok(offering(1).commitments && offering(1).commitments[0]
    && offering(1).commitments[0].length === "3 Months (12 Weeks)"
    && offering(1).commitments[0].price === "499"
    && offering(1).commitments[0].after === "Renews same length"
    && offering(1).commitments[0].signup_fee_charge === "waive",
    "the Elementary rung the offer never had is CREATED, with the mockup's long phrase translated to the offer's exact string");
  const code = row("offers", "off1").data.pricing.discount_codes[0];
  ok(!!code && code.code === "club" && code.kind === "Dollar off" && code.value === "100"
    && code.duration === "Every payment" && code.once_per_customer === false
    && JSON.stringify(code.applies_to) === JSON.stringify(["2 Trainings/Week|monthly"]),
    `the club coupon enters the offer with "No" translated to the boolean false (saw ${JSON.stringify(code)})`);

  // The stamps: everything applied is marked; the addition and the note are not.
  const stamped = answers().filter((a) => a.applied_at).map((a) => a.id).sort();
  ok(!stamped.includes("a-add") && !stamped.includes("a-notes"),
    "the addition and the free-text note are NOT stamped - apply never touched them");
  ok(stamped.includes("a-tax") && stamped.includes("a-two-title") && stamped.includes("a-two-cycle") && stamped.includes("a-code-once"),
    "every landed answer carries applied_at - including the cycle answer that needed no write to agree");
  ok(r.body.skipped.additions.length === 1 && r.body.skipped.notes.length === 1,
    "and the response says out loud what was left for humans");

  // d. THE PHASE-3 PREVIEW: tax baked in, matched vs to-mint, recurring shapes.
  const p3 = r.body.phase3;
  const byKey = Object.fromEntries(p3.targets.map((t) => [t.key, t]));
  const eleM = byKey["Elementary Academy|monthly"];
  ok(!!eleM && eleM.allin_cents === 21875 && eleM.base_cents === 20000,
    `the preview's amounts CARRY THE TAX written moments before (Elementary monthly all-in ${eleM && eleM.allin_cents}, base 20000)`);
  ok(!!eleM && eleM.needs_mint === false && eleM.matched && eleM.matched.stripe_price_id === "price_ele_m",
    "the one price already live at the taxed amount+interval MATCHES instead of minting a duplicate");
  const twoM = byKey["Academy 2x/week|monthly"];
  ok(!!twoM && twoM.needs_mint === true && twoM.allin_cents === 27344
    && JSON.stringify(twoM.recurring) === JSON.stringify({ interval: "week", interval_count: 4 }),
    "the renamed plan's monthly needs minting, every 4 weeks, at the taxed amount");
  const two3 = byKey["Academy 2x/week|3_months"];
  ok(!!two3 && two3.allin_cents === 60047 && JSON.stringify(two3.recurring) === JSON.stringify({ interval: "month", interval_count: 3 }),
    "the 3-month rung previews on the 3-month clock with the NEW 549 price, taxed");
  // THE RHYTHM San Jose actually bills on. "3 Months (12 Weeks)" declares a
  // 12-week clock; his real members ride it, and the rehearsal must show it.
  ok(!!two3 && two3.declared_weeks === 12 && /12-week billing rhythm/.test(String(two3.rhythm_note)),
    `the declared 12-week rhythm is visible on the 3-month rung ("${two3 && two3.rhythm_note}")`);
  ok(!!twoM && twoM.declared_weeks === undefined,
    "while the monthly target carries no declared rhythm - its label has no week count");
  // The OPEN term vocabulary: a 12-month rung previews on a 12-month calendar
  // clock, not collapsed to the 4-week default and not to 6_months.
  const ele12 = byKey["Elementary Academy|12_months"];
  ok(!!ele12 && ele12.interval === "12_months"
    && JSON.stringify(ele12.recurring) === JSON.stringify({ interval: "month", interval_count: 12 })
    && ele12.allin_cents === Math.round(199900 * 1.09375),
    `a 12-month term previews as month x12 at the taxed amount (saw ${ele12 && ele12.interval}, ${ele12 && ele12.allin_cents})`);
  const eleFee = byKey["Elementary Academy|signup_fee"];
  ok(!!eleFee && eleFee.recurring === null && eleFee.interval === "one_time" && eleFee.allin_cents === 4375,
    "the sign-up fee previews as ONE-TIME - recurring null, never a subscription");
  ok(byKey["Academy 2x/week|signup_fee"] === undefined,
    "and no fee target exists for the plan whose fee the owner just waived everywhere");
  ok(p3.matched === 1 && p3.would_mint === p3.targets.length - 1,
    `the counts add up (${p3.matched} matched, ${p3.would_mint} to mint)`);

  // Status: NOTHING moves to applied in this pass.
  ok(wbRow().status === "reviewed", "apply(dry) leaves the workbook exactly where review left it - never 'applied'");
  const ownerSave = await post({ token: TOKEN, action: "save", card_key: "plan:two", answers: [{ id: "a-two-price", answered: "1" }] });
  ok(ownerSave.status === 409, "and the owner is still locked out after apply");

  // ── THE RERUN: a run that died halfway must be repeatable, and a staff edit
  //    made after the first apply must SURVIVE the second ─────────────────────
  offering(0).price = "999";                       // a wizard edit, after apply
  const snapBefore = JSON.stringify(wbRow().snapshot);
  const rerun = await staffPost({ action: "apply", workbook_id: "wb1" });
  ok(rerun.body.ok === true && rerun.body.snapshot === "already",
    "a second apply reports the snapshot as already taken");
  ok(JSON.stringify(wbRow().snapshot) === snapBefore,
    "and the PHOTOGRAPH IS UNTOUCHED - the first apply's picture survives, never re-taken from post-write state");
  ok(offering(0).price === "999",
    `the wizard edit SURVIVES the rerun - the already-applied answer was skipped, not re-written (saw ${JSON.stringify(offering(0).price)})`);
  ok(rerun.body.skipped.already_applied.length > 0,
    `and the rerun says how many answers it skipped (${rerun.body.skipped.already_applied.length})`);
  offering(0).price = "250";                       // put the probe back
}

console.log("\n── 5. publish is a refusal with a sentence; rollback restores the photograph ──");
{
  const pub = await staffPost({ action: "publish", workbook_id: "wb1" });
  ok(pub.status === 409 && pub.body.code === "publish_not_built" && /deliberate step/.test(pub.body.error) && noEmDash(pub.body.error),
    `publish refuses, naming itself a separate deliberate step ("${pub.body.error}")`);

  // rollback: everything the apply wrote comes back.
  const r = await staffPost({ action: "rollback", workbook_id: "wb1" });
  ok(r.status === 200 && r.body.ok === true, "rollback answers");
  ok(JSON.stringify(row("offers", "off1").data) === JSON.stringify(wbRow().snapshot.offers[0].data)
    && offering(0).title === "2 Trainings/Week"
    && offering(0).commitments[0].price === "599"
    && !offering(1).commitments,
    "the offer jsonb is BYTE-IDENTICAL to the photograph - rename undone, rung gone, codes gone");
  ok(row("clients", "sj").tax_config === null, "tax_config is back to what the photograph holds");
  ok(answers().every((a) => a.applied_at == null && a.apply_error == null),
    "every applied stamp is cleared, so a future apply can land again");
  ok(wbRow().status === "submitted", "and the workbook goes back to 'submitted'");
  ok(wbRow().snapshot != null, "while the snapshot itself STAYS - it is still the only way back");
  ok(Array.isArray(r.body.could_not_restore) && r.body.could_not_restore.length === 0,
    "could_not_restore is honestly empty - no live apply exists, so nothing is unrecoverable yet");

  const ownerSave = await post({ token: TOKEN, action: "save", card_key: "plan:two", answers: [{ id: "a-two-price", answered: "1" }] });
  ok(ownerSave.status === 409, "'submitted' after rollback is still read-only to the owner");

  // The approvals survived the rollback, so apply can run again immediately -
  // and from 'submitted' it leaves the status EXACTLY as it found it.
  const again = await staffPost({ action: "apply", workbook_id: "wb1" });
  ok(again.body.ok === true && offering(0).title === "Academy 2x/week",
    "apply after rollback lands the same writes again from the cleared stamps");
  ok(wbRow().status === "submitted",
    "and apply(dry) from 'submitted' leaves the status 'submitted' - apply never advances a workbook");

  const empty = await staffPost({ action: "rollback", workbook_id: "nope" });
  ok(empty.status === 404, "rollback on an unknown workbook is 404");
  reset();
  const noSnap = await staffPost({ action: "rollback", workbook_id: "wb1" });
  ok(noSnap.status === 409 && /snapshot/.test(noSnap.body.error),
    "rollback before any apply refuses - there is no photograph to restore");
  reset();
}

console.log("\n── 6. translation refuses what it cannot say, before anything is written ──");
{
  // A billing cycle the offer's vocabulary does not contain. Apply must refuse
  // the WHOLE run with nothing written, and record the refusal on the row.
  for (const c of DB.workbook_cards) { c.approved_at = "2026-08-06T02:00:00Z"; c.approved_by = "user-1"; }
  row("workbook_answers", "a-two-cycle").answered = "every fortnight or so";
  const before = JSON.stringify(DB.offers) + JSON.stringify(DB.clients);
  const r = await staffPost({ action: "apply", workbook_id: "wb1" });
  ok(r.status === 200 && r.body.ok === false && Array.isArray(r.body.failures) && r.body.failures.length === 1,
    "one untranslatable answer refuses the apply with ok:false and names the failure");
  // Read defensively: under MUTATE=vocabdrift there IS no failures array, and a
  // control that crashes the harness exits without its banner.
  const f0 = (Array.isArray(r.body.failures) && r.body.failures[0]) || {};
  ok(/billing cycle/.test(String(f0.error)) && noEmDash(String(f0.error)),
    `in a sentence about the vocabulary ("${f0.error}")`);
  ok(JSON.stringify(DB.offers) + JSON.stringify(DB.clients) === before && wbRow().snapshot == null,
    "and NOTHING was written - not the snapshot, not the tax, not the other 17 answers");
  ok(row("workbook_answers", "a-two-cycle").apply_error != null,
    "while the refusal is recorded on the row for review to show");
  reset();
}

console.log("\n── 7. a plan card resolves to a LIVE offering, or it refuses ──");
{
  // ── the archived tier standing in front of the live one ───────────────────
  // GTA carries archived tiers today (Accelerate/Elevate/Dominate) and reusing a
  // title after archiving one is ordinary. buildOfferTargets skips archived; the
  // resolver used to take the first title match by POSITION.
  reset();
  offerings().unshift({
    title: "2 Trainings/Week", type: "Membership", price: "199", archived: true,
    billing_cycle: "Every 4 weeks", whats_included: "The retired version.",
    signup_fee: "40", signup_fee_on_base: "charge",
    commitments: [{ length: "3 Months (12 Weeks)", price: "499", after: "Renews same length" }],
  });
  approveAll();
  const r = await staffPost({ action: "apply", workbook_id: "wb1" });
  ok(r.status === 200 && r.body.ok === true, "apply runs with an archived tier of the same name sitting in front of the live one");
  ok(offerings()[0].archived === true && offerings()[0].title === "2 Trainings/Week"
    && offerings()[0].price === "199" && offerings()[0].commitments[0].price === "499",
    `the ARCHIVED tier is untouched - not renamed, not re-priced (saw ${JSON.stringify({ t: offerings()[0].title, p: offerings()[0].price, c: offerings()[0].commitments[0].price })})`);
  ok(offerings()[1].title === "Academy 2x/week" && offerings()[1].commitments[0].price === "549",
    `and the LIVE plan is the one that got the rename and the new price (saw ${JSON.stringify({ t: offerings()[1].title, c: offerings()[1].commitments && offerings()[1].commitments[0].price })})`);

  // ── two LIVE options sharing a title: a refusal, never a pick ─────────────
  reset();
  offerings().unshift({
    title: "2 Trainings/Week", type: "Membership", price: "199",
    billing_cycle: "Every 4 weeks", whats_included: "A duplicate nobody archived.",
  });
  approveAll();
  const before = worldState();
  const dup = await staffPost({ action: "apply", workbook_id: "wb1" });
  ok(dup.status === 200 && dup.body.ok === false && Array.isArray(dup.body.failures) && dup.body.failures.length > 0,
    "two LIVE options sharing a title refuse the apply rather than resolving by position");
  const df = (Array.isArray(dup.body.failures) && dup.body.failures[0]) || {};
  ok(/2 live pricing options/.test(String(df.error)) && /positions 1 and 2/.test(String(df.error)) && noEmDash(String(df.error)),
    `and the refusal NAMES BOTH of them ("${df.error}")`);
  ok(worldState() === before, "and nothing at all was written - no snapshot, no tax, no offer edit");
  reset();
}

console.log("\n── 8. the whitelist is fail-closed: own properties, bounded indexes, reasons ──");
{
  reset();
  // Every shape the adversarial pass got through with. `constructor` carries a
  // payload SHAPED LIKE A TRANSLATOR RESULT, which is what let arbitrary JSON
  // into the pricing jsonb with ok:true.
  addAnswer("c-two", "__proto__", "polluted");
  addAnswer("c-two", "constructor", { ok: true, value: { evil: "arbitrary json in a money field" } });
  addAnswer("c-two", "toString", "polluted");
  addAnswer("c-two", "commitments.0.__proto__", "polluted");
  addAnswer("c-two", "commitments.200000.price", "10");
  addAnswer("c-two", "commitments.50.price", "10");

  const rev = await staffPost({ action: "review", workbook_id: "wb1" });
  ok(rev.status === 200 && rev.body.ok === true,
    `ONE bad field name no longer makes the whole review surface unusable (status ${rev.status})`);
  const items = (rev.body.review && rev.body.review.cards ? rev.body.review.cards : [])
    .flatMap((c) => c.items || []);
  const shown = (f) => items.find((i) => i.target_field === f) || {};
  ok(/is not a plan field/.test(String(shown("__proto__").translation_error)),
    `and review says WHY, in a sentence about the whitelist ("${shown("__proto__").translation_error}")`);
  ok(/is not a plan field/.test(String(shown("toString").translation_error))
    && /is not a commitment rung field/.test(String(shown("commitments.0.__proto__").translation_error)),
    "an inherited plan name and an inherited rung leaf each get their own reason");
  ok(/past the 200/.test(String(shown("commitments.200000.price").translation_error)),
    `and an index nobody could mean is refused by the structural ceiling ("${shown("commitments.200000.price").translation_error}")`);

  approveAll();
  const before = worldState();
  const ap = await staffPost({ action: "apply", workbook_id: "wb1" });
  ok(ap.status === 200 && ap.body.ok === false && Array.isArray(ap.body.failures),
    `apply refuses the whole run rather than writing any of it (status ${ap.status})`);
  ok(!JSON.stringify(row("offers", "off1").data).includes("evil"),
    "the `constructor` payload did NOT become a key in the pricing jsonb");
  ok(offerings()[0].commitments.length === 1,
    `and the commitments array is still 1 long - no 200,001-element pad (saw ${offerings()[0].commitments.length})`);
  ok(worldState() === before, "nothing was written at all");

  const fails = Array.isArray(ap.body.failures) ? ap.body.failures : [];
  const failFor = (f) => (fails.find((x) => x.target_field === f) || {});
  ok(fails.length > 0 && fails.every((f) => typeof f.error === "string" && f.error.trim().length > 0),
    `every refusal carries a sentence - none travels as undefined (${fails.length} failures)`);
  ok(/is not a plan field/.test(String(failFor("toString").error)) && noEmDash(String(failFor("toString").error)),
    `including the one that used to refuse with error: undefined ("${failFor("toString").error}")`);
  ok(/commitment rung number 51 where there are 1/.test(String(failFor("commitments.50.price").error)),
    `and an index past the plan's real length plus the add cap is refused by name ("${failFor("commitments.50.price").error}")`);
  const stampedErr = answers().filter((a) => a.apply_error != null);
  ok(stampedErr.length > 0 && stampedErr.every((a) => typeof a.apply_error === "string" && a.apply_error.trim().length > 0),
    "and each reason reached the ROW, so review shows it - apply_error is never left null on a refused answer");
  reset();
}

console.log("\n── 9. the rehearsal names the rungs that can never be minted ──");
{
  reset();
  approveAll();
  // Live on the parent-facing page with prices on them, and outside the term
  // vocabulary, so buildOfferTargets drops them with only a server-side warning.
  offerings().push({
    title: "Summer Unlimited", type: "Membership", price: "300",
    billing_cycle: "Every 4 weeks", whats_included: "Summer, everything.",
    commitments: [
      { length: "6 Months", price: "1500", after: "Ends" },
      { length: "25 Months", price: "2500", after: "Ends" },
      { length: "3 Years", price: "3000", after: "Ends" },
      { length: "30 Weeks", price: "1750", after: "Ends" },
    ],
  });
  const r = await staffPost({ action: "apply", workbook_id: "wb1" });
  ok(r.status === 200 && r.body.ok === true, "apply still runs - an unsellable rung is REPORTED, not a refusal");
  const p3 = r.body.phase3;
  const bad3 = Array.isArray(p3.unsellable_rungs) ? p3.unsellable_rungs : null;
  ok(!!bad3 && bad3.length === 3,
    `the three lengths outside the vocabulary are named as unsellable rungs (saw ${bad3 ? bad3.length : JSON.stringify(p3.unsellable_rungs)})`);
  ok(!!bad3 && ["25 Months", "3 Years", "30 Weeks"].every((L) => bad3.some((u) => u.length === L)),
    `and each one is named by its length (${bad3 ? bad3.map((u) => u.length).join(", ") : "-"})`);
  ok(!!bad3 && bad3.every((u) => u.offering === "Summer Unlimited" && typeof u.why === "string" && u.why.length > 20 && noEmDash(u.why)),
    `each carries the plan it is on and a sentence a human can act on ("${bad3 && bad3[0] && bad3[0].why}")`);
  ok(!!bad3 && !bad3.some((u) => u.length === "6 Months"),
    "while the 6-month rung on the same plan is NOT flagged - the detector does not cry wolf");
  const keys = p3.targets.map((t) => t.key);
  ok(keys.includes("Summer Unlimited|6_months")
    && !keys.some((k) => k.startsWith("Summer Unlimited|") && !["Summer Unlimited|6_months", "Summer Unlimited|monthly"].includes(k)),
    "and the proof they are invisible without this: the three appear in NO target at all");
  reset();
}

console.log("\n── 10. a read that FAILED is never reported as a read that found nothing ──");
{
  // ── the catalog: the comparison did not happen, so no count is claimed ────
  reset();
  approveAll();
  FAIL_READS.add("pricing_catalog");
  const r = await staffPost({ action: "apply", workbook_id: "wb1" });
  FAIL_READS.delete("pricing_catalog");
  ok(r.status === 200 && r.body.ok === true, "apply still answers - the writes that landed are real and are reported");
  const p3 = r.body.phase3;
  ok(p3.matched === null && p3.would_mint === null,
    `but the counts are NULL, not 0 and "mint everything" (saw matched ${JSON.stringify(p3.matched)}, would_mint ${JSON.stringify(p3.would_mint)})`);
  ok(p3.catalog === "could_not_read" && typeof p3.could_not_compare === "string" && /do not mint/i.test(p3.could_not_compare) && noEmDash(p3.could_not_compare),
    `and it says so out loud ("${p3.could_not_compare}")`);
  ok(p3.targets.length > 0 && p3.targets.every((t) => t.needs_mint === null),
    "no target claims it needs minting off a catalog nobody could open - that claim is duplicate Stripe prices");

  // ── the snapshot: a photograph with a hole in it is not taken ─────────────
  reset();
  approveAll();
  DB.offer_prices.push({ id: "op1", tenant_id: "sj", source_offer_id: "off1", source_offer_price_key: "Academy 2x/week|3_months", billing_cadence: "12_weeks", is_active: true, is_routable: true, sort_order: 0 });
  const before = worldState();
  FAIL_READS.add("offer_prices");
  const blind = await staffPost({ action: "apply", workbook_id: "wb1" });
  FAIL_READS.delete("offer_prices");
  ok(blind.status === 503 && blind.body.code === "snapshot_unreadable" && noEmDash(String(blind.body.error)),
    `apply REFUSES when the snapshot cannot read offer_prices ("${blind.body.error}")`);
  ok(wbRow().snapshot == null && worldState() === before,
    "and it refuses BEFORE the first write - no photograph, no tax, no offer edit");

  const good = await staffPost({ action: "apply", workbook_id: "wb1" });
  ok(good.body.ok === true && Array.isArray(wbRow().snapshot.offer_prices) && wbRow().snapshot.offer_prices.length === 1,
    `and with the read working the photograph holds the row that is really there (saw ${wbRow().snapshot && JSON.stringify((wbRow().snapshot.offer_prices || []).length)})`);
  reset();
}

console.log("\n── 11. the preview does not promise a rhythm it cannot verify ──");
{
  reset();
  approveAll();
  // The typed row the MINT would obey, which the preview never used to read.
  DB.offer_prices.push({ id: "op1", tenant_id: "sj", source_offer_id: "off1", source_offer_price_key: "Academy 2x/week|3_months", billing_cadence: "12_weeks", is_active: true, is_routable: true, sort_order: 0 });
  // A superseded row on the same key, deactivated rather than deleted - exactly
  // what offers-sync leaves behind, and exactly what a looser scope would read.
  DB.offer_prices.push({ id: "op0", tenant_id: "sj", source_offer_id: "off1", source_offer_price_key: "Academy 2x/week|3_months", billing_cadence: "3_calendar_months", is_active: false, is_routable: false, sort_order: 1 });
  // A label declaring a rhythm the mint's cadence vocabulary does not contain.
  row("workbook_answers", "a-ele-c0-len").answered = "2 Months (8 Weeks)";
  row("workbook_answers", "a-ele-c0-len").proposed = "2 Months (8 Weeks)";

  const r = await staffPost({ action: "apply", workbook_id: "wb1" });
  const p3 = r.body.phase3;
  const byKey = Object.fromEntries(p3.targets.map((t) => [t.key, t]));
  const two3 = byKey["Academy 2x/week|3_months"] || {};
  ok(two3.typed_cadence === "12_weeks",
    `the preview READS the typed offer_prices row - the thing that actually outranks the label at mint time (saw ${JSON.stringify(two3.typed_cadence)})`);
  ok(/OUTRANKS the length label/.test(String(two3.typed_cadence_note)) && noEmDash(String(two3.typed_cadence_note)),
    `and says which way the priority runs ("${two3.typed_cadence_note}")`);
  ok(p3.typed_cadence_source === "read", `and reports where that came from (${p3.typed_cadence_source})`);

  const ele2 = byKey["Elementary Academy|2_months"] || {};
  ok(ele2.declared_weeks === 8, `an 8-week label still SHOWS its declared rhythm (saw ${JSON.stringify(ele2.declared_weeks)})`);
  ok(/cannot say which billing rhythm/.test(String(ele2.rhythm_note)) && !/the mint resolves it/.test(String(ele2.rhythm_note)),
    `but the note no longer promises the mint will honour it ("${ele2.rhythm_note}")`);
  ok(typeof p3.cadence_caveat === "string" && /not exported/.test(p3.cadence_caveat) && noEmDash(p3.cadence_caveat),
    "and the rehearsal carries the caveat once, at the top, whether or not any row declares a rhythm");
  reset();
}

console.log("\n── 12. the price machinery is loaded BEFORE the first write ──");
{
  reset();
  approveAll();
  const before = worldState();
  const r = await callOn(WB_NOLOAD, { method: "POST", url: "/api/workbook", headers: AUTH, body: { action: "apply", workbook_id: "wb1" } });
  ok(r.status === 503 && r.body.code === "price_machinery_unavailable" && noEmDash(String(r.body.error)),
    `an unloadable price machinery is a 503 ("${r.body.error}")`);
  ok(/stopped before writing anything/.test(String(r.body.error)),
    "and the sentence says what it means: nothing happened");
  ok(worldState() === before,
    "and it is TRUE - no snapshot, no tax on the academy, no offer write left behind by a failure that named none of them");
  reset();
}

console.log("\n── 13. a missing apply_error column degrades instead of 500ing review ──");
{
  reset();
  const cols = COLUMNS.workbook_answers;
  COLUMNS.workbook_answers = cols.filter((c) => c !== "apply_error");
  const rev = await staffPost({ action: "review", workbook_id: "wb1" });
  ok(rev.status === 200 && rev.body.ok === true,
    `review still answers on a deployment that has not run the apply migration (status ${rev.status})`);
  const items = (rev.body.review && rev.body.review.cards ? rev.body.review.cards : []).flatMap((c) => c.items || []);
  ok(items.length > 0 && items.every((i) => i.apply_error === null),
    "with apply_error reading null, which is the truth where no apply could ever have recorded one");
  approveAll();
  const ap = await staffPost({ action: "apply", workbook_id: "wb1" });
  ok(ap.status === 409 && /20260806T063000/.test(String(ap.body.error)),
    `while apply refuses out loud rather than writing against a column that is not there ("${ap.body.error}")`);
  COLUMNS.workbook_answers = cols;
  reset();
}

console.log("\n── 14. the snapshot filter decides the race the branch guard cannot ──");
{
  reset();
  approveAll();
  // TWO APPLIES AT ONCE. Ours read `wb.snapshot == null` and is a round trip
  // from writing; the other one lands in that window. `snapshot=is.null` on the
  // PATCH is the only thing that makes the FIRST photograph win - the branch
  // guard above it saw a null that was already stale. Every sequential test in
  // this file passes with that filter deleted, which is what made it a guard
  // nothing could tell was missing. MUTATE=snapfilteronly.
  const rival = { taken_at: "2026-08-06T03:00:00Z", taken_by: "the-other-apply", offers: [], tax_config: null, offer_prices: [] };
  RACE.fn = (table, params) => {
    if (table !== "workbooks" || String(params.get("snapshot") || "") !== "is.null") return false;
    wbRow().snapshot = rival;      // the other apply photographs first
    return true;
  };
  const r = await staffPost({ action: "apply", workbook_id: "wb1" });
  RACE.fn = null;
  ok(r.status === 200 && r.body.ok === true, "the losing apply still completes - it lost a photograph, not the run");
  ok(JSON.stringify(wbRow().snapshot) === JSON.stringify(rival),
    `the FIRST photograph stands - the loser's PATCH matched nothing (saw taken_by ${JSON.stringify(wbRow().snapshot && wbRow().snapshot.taken_by)})`);
  ok(r.body.snapshot === "already",
    `and the loser SAYS it did not take one, rather than claiming a photograph it never wrote (saw ${JSON.stringify(r.body.snapshot)})`);
  reset();
}

console.log("\n── 15. a withheld joining fee is DATA in the response, not a console.warn ──");
{
  // ── an unrestricted code + a charged fee: the withhold is reported ────────
  reset();
  approveAll();
  // The code loses its applies-to list, so it discounts every line on the
  // first invoice - the fee included. Elementary charges its fee on base in
  // the offer, so its fee target must be WITHHELD, and the response must say
  // which plan and which code, because a console.warn in a server log is not
  // something a reviewer reads.
  row("workbook_answers", "a-code-applies").answered = [];
  // The review side works from the workbook's own answers, so the ele card
  // carries its fee facts the way a real capture would.
  addAnswer("c-ele", "signup_fee", "40", { current_value: "40" });
  addAnswer("c-ele", "signup_fee_on_base", "charge", { current_value: "charge" });

  const rev = await staffPost({ action: "review", workbook_id: "wb1" });
  const w0 = (Array.isArray(rev.body.warnings) && rev.body.warnings[0]) || {};
  ok(Array.isArray(rev.body.warnings) && rev.body.warnings.length === 1
    && w0.plan_card_key === "plan:ele" && w0.card_key === "codes",
    `review WARNS before apply, naming the plan card and the codes card (${JSON.stringify({ plan: w0.plan_card_key, codes: w0.card_key })})`);
  ok(/joining fee/.test(String(w0.sentence)) && /"club"/.test(String(w0.sentence)) && noEmDash(String(w0.sentence)),
    `in a sentence that names the code ("${w0.sentence}")`);

  const r = await staffPost({ action: "apply", workbook_id: "wb1" });
  const wh = r.body.phase3 && r.body.phase3.withheld_signup_fees;
  const wh0 = (Array.isArray(wh) && wh[0]) || {};
  ok(r.body.ok === true && Array.isArray(wh) && wh.length === 1
    && wh0.offering === "Elementary Academy" && Array.isArray(wh0.because_codes) && wh0.because_codes.includes("club"),
    `the withheld fee rides the apply response, naming plan and code (${JSON.stringify(wh)})`);
  ok(/"club"/.test(String(wh0.reason)) && /applies-to/.test(String(wh0.reason)) && noEmDash(String(wh0.reason)),
    `with a reason a human can act on ("${wh0.reason}")`);
  ok(Array.isArray(r.body.phase3.targets) && !r.body.phase3.targets.some((t) => String(t.key).endsWith("|signup_fee")),
    `and NO |signup_fee key is in the targets - the withhold is real, not just reported (${r.body.phase3.targets.length} targets)`);
  ok(r.body.phase3.withheld_fees === 1,
    `the counts area carries it too (withheld_fees ${JSON.stringify(r.body.phase3.withheld_fees)})`);
  reset();

  // ── the positive control: a restricted code withholds nothing ─────────────
  reset();
  approveAll();
  const rev2 = await staffPost({ action: "review", workbook_id: "wb1" });
  ok(Array.isArray(rev2.body.warnings) && rev2.body.warnings.length === 0,
    "a code WITH an applies-to list raises no review warning");
  const r2 = await staffPost({ action: "apply", workbook_id: "wb1" });
  const wh2 = r2.body.phase3 && r2.body.phase3.withheld_signup_fees;
  ok(Array.isArray(wh2) && wh2.length === 0,
    `and withholds nothing - the EMPTY ARRAY, never null, because "nothing withheld" is a claim this run actually checked (saw ${JSON.stringify(wh2)})`);
  ok(r2.body.phase3.targets.some((t) => t.key === "Elementary Academy|signup_fee"),
    "while the fee target is present in the targets");
  reset();
}

console.log("\n── 16. a confirmed No to tax is a VALUE, never null ──");
{
  // ── the No lands as { charges_tax: false } and the rehearsal says so ──────
  reset();
  approveAll();
  // What the page's writeTax really sends for a No: the marker plus passengers.
  row("workbook_answers", "a-tax").answered = { charges_tax: false, pct: null, label: "Sales tax" };
  const r = await staffPost({ action: "apply", workbook_id: "wb1" });
  const cfg = row("clients", "sj").tax_config;
  ok(r.body.ok === true && JSON.stringify(cfg) === JSON.stringify({ charges_tax: false }),
    `a No lands as clients.tax_config = { charges_tax: false } - a value, not null (saw ${JSON.stringify(cfg)})`);
  ok(r.body.phase3.tax_state === "confirmed_no",
    `and the rehearsal states it (tax_state ${JSON.stringify(r.body.phase3.tax_state)})`);
  const byKey16 = Object.fromEntries(r.body.phase3.targets.map((t) => [t.key, t]));
  const eleM16 = byKey16["Elementary Academy|monthly"] || {};
  ok(eleM16.allin_cents === 20000 && eleM16.base_cents === 20000,
    `while every amount is the BASE amount - a confirmed no taxes nothing (Elementary monthly all-in ${eleM16.allin_cents})`);
  reset();

  // ── never-asked stays its own answer ──────────────────────────────────────
  reset();
  approveAll();
  row("workbook_answers", "a-tax").answered = null;
  row("workbook_answers", "a-tax").proposed = null;
  const r2 = await staffPost({ action: "apply", workbook_id: "wb1" });
  ok(row("clients", "sj").tax_config === null && r2.body.phase3.tax_state === "never_asked",
    `an academy nobody asked stays null and reports never_asked (saw ${JSON.stringify(r2.body.phase3.tax_state)})`);
  reset();

  // ── and a configured academy reports configured ───────────────────────────
  reset();
  approveAll();
  const r3 = await staffPost({ action: "apply", workbook_id: "wb1" });
  ok(r3.body.phase3.tax_state === "configured",
    `a real rate reports configured (saw ${JSON.stringify(r3.body.phase3.tax_state)})`);
  reset();

  // ── the _fees guard: a confirmed no beats a stale typed string ────────────
  const fees = await import("./_fees.js");
  const resolved = fees.resolveFee({ taxConfig: { charges_tax: false }, legacyText: "13% HST" });
  ok(resolved === null,
    `resolveFee: a confirmed no beats a stale typed "13% HST" instead of falling through to it (resolved ${JSON.stringify(resolved)})`);
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
