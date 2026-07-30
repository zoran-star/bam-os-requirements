// THE BLANK DASHBOARD, AND THE WRONG ONE.
//
//     node api/_kpi-autolink.test.mjs        # exits non-zero on any failure
//
// A new academy's V1.5/V2 KPI dashboards group Sales, Revenue and Members by OFFER,
// and they do it through kpi_offer_links rows. Until somebody sits in the KPIs Setup
// tab and hand-ties every Stripe product and every GHL pipeline to an offer, there
// are no rows, so the dashboards read empty. auto-link seeds them in one action.
//
// The failure this suite exists to prevent is NOT the blank dashboard. It is the
// confidently wrong one. A blank Sales section is obviously broken and somebody
// fixes it; a Sales section attributing another offer's pipeline to this offer looks
// exactly like a real number, and nothing downstream ever disagrees with it. So the
// thing under test is not "does auto-link fill rows" - it is "does auto-link refuse".
//
// ─────────────────────────────────────────────────────────────────────────────
// WHAT IT DRIVES
//
// buildAutoLinkPlan(), autoLinkInserts(), planPriceLookups() and settleAutoLinkPlan()
// out of api/offers/kpi-setup.js, the real exported functions, against plain fixture
// rows. They are pure by construction - the handler does every fetch and every sb()
// call, then hands them rows - so this file needs no network, no database and no
// dependencies. It answers @sentry/node with a local stub only because kpi-setup.js
// line 1 imports api/_sentry.js, the same dodge api/_arming-gate.test.mjs and
// api/_ghl-migration.test.mjs use and for the same reason.
//
// The last two are pure BECAUSE of this file. The lookup cap and the apply-time bucket
// rebuild both started out inline in the handler, where the only way to reach them was
// a live Stripe account and a live database, which in practice means they were never
// going to be reached at all. Both had a reporting defect when they were untestable.
//
// The two bases, and the whole point of separating them:
//
//   catalog / stamp   DETERMINISTIC. pricing_catalog.stripe_product_id sits next to
//                     .offer_id, offer_prices.stripe_product_id next to
//                     .source_offer_id, pipeline_stages.ghl_pipeline_id next to the
//                     .offer_id its preset stamped. Nobody is matching names.
//   title             A GUESS with a good hit rate. Exact normalized-title equality,
//                     case and whitespace only.
//
// Precedence is strict, and section 1 is the reason it has to be: the fixture's
// "Steady" product is named identically to the "Steady" offer, and the catalog says
// it belongs to Training. Left to a name, this product would be attributed to an
// offer it was never sold under, forever, and plausibly.
//
// ─────────────────────────────────────────────────────────────────────────────
// NEGATIVE CONTROLS. Each breaks ONE thing in a throwaway copy of the REAL source and
// must report NEGATIVE CONTROL PASSED, meaning this suite CAUGHT it. A control that
// does not print that line is decorative and must not be quoted.
//
//   MUTATE=title-first     node api/_kpi-autolink.test.mjs
//        the name is consulted before the spine. Every deterministic tie that
//        disagrees with a product's name silently flips to the name. This is the
//        control the design exists for; section 1 is aimed at it.
//   MUTATE=first-wins      node api/_kpi-autolink.test.mjs
//        a signal pointing at two offers takes the first one instead of stopping.
//        This is the wrong-pipeline bug in its purest form: a coin toss rendered as
//        a KPI. Caught on the ambiguous pipeline AND the ambiguous product.
//   MUTATE=overwrite       node api/_kpi-autolink.test.mjs
//        the existing-link check goes, so a tie a human already made is re-proposed
//        and, on apply, fought over. Caught by section 2.
//   MUTATE=trust-proposed  node api/_kpi-autolink.test.mjs
//        pricing_catalog rows at match_status 'proposed' count as deterministic.
//        Those rows ARE the AI price-matcher's unapproved guess, so this control is
//        a guess wearing the label of a fact - the worst of the six, because the
//        output still says basis "catalog" and staff read that as certainty.
//   MUTATE=cap-silent      node api/_kpi-autolink.test.mjs
//        the 25-lookup cap counts its discards AFTER truncating, so the remainder is
//        always zero and no warning is raised. The five capped products still fall
//        back to a title match; the only thing that changes is that nobody is told.
//        A reviewed defect, kept as a control because "nothing is silently dropped"
//        is a claim about the warnings as much as about the buckets.
//   MUTATE=raced-both      node api/_kpi-autolink.test.mjs
//        a candidate that lost a race is added to `existing` but left in `proposed`,
//        so one item is reported in two buckets and the totals stop adding up. Also
//        a reviewed defect. Caught by section 9.
//
// Measured 2026-07-30, unmutated ALL PASS; title-first -> 5 failures, first-wins -> 3,
// overwrite -> 4, trust-proposed -> 3, cap-silent -> 4, raced-both -> 4.
//
// ─────────────────────────────────────────────────────────────────────────────
// WHAT THIS DOES NOT PROVE. Nothing here runs SQL or HTTP, so it does not prove the
// apply path's ON CONFLICT DO NOTHING actually behaves that way against PostgREST, it
// does not prove that PostgREST returns only the inserted rows under
// resolution=ignore-duplicates (which is where the `landed` set section 9 is handed
// comes from), and it does not prove the handler loads the rows it says it loads. It
// proves the DECISIONS, given the rows. The insert payload is checked as a pure
// function of the plan and the settled buckets as a pure function of the plan plus
// what landed, so an apply can only differ from the propose a human read where the
// database actually disagreed - but the write itself is unverified here.
//
// HARD RULE: never an em dash anywhere in this file. Hyphens only.

import fs from "node:fs";
import path from "node:path";
import { register } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";

// Answer @sentry/node locally. sentryApiEnabled is false outside VERCEL_ENV
// production, so withSentryApiRoute already passes the handler straight through and
// not one of these stubs is called on any path this file drives.
register(`data:text/javascript,${encodeURIComponent(`
  const STUB = "data:text/javascript,${encodeURIComponent(
    "export function init(){} export function captureMessage(){} export function captureException(){}" +
    " export function flush(){return Promise.resolve(true)}" +
    " export function withIsolationScope(fn){return fn({setTag(){},setContext(){}})}")}";
  export async function resolve(spec, ctx, next) {
    if (spec === "@sentry/node") return { url: STUB, shortCircuit: true, format: "module" };
    return next(spec, ctx);
  }
`)}`);

// kpi-setup.js reads these at import time to build real URLs. Nothing here calls out.
process.env.SUPABASE_URL = process.env.SUPABASE_URL || "https://stub.supabase.test";
process.env.VITE_SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "stub-service-key";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MUTATE = process.env.MUTATE || "";
const TARGET = "offers/kpi-setup.js";

// ─── the mutant copy mechanism ───────────────────────────────────────────────
const MUTANT_FILES = [];
const cleanupMutants = () => { while (MUTANT_FILES.length) { try { fs.unlinkSync(MUTANT_FILES.pop()); } catch (_) { /* best effort */ } } };
process.on("exit", cleanupMutants);

function mutateText(src, label, edits) {
  for (const [find, repl] of edits) {
    if (!src.includes(find)) {
      console.error(`\n❌ NEGATIVE CONTROL FAILED: MUTATE=${MUTATE} is pinned to text that is no longer in ${label}:\n\n${find}\n\n`
        + "   The code it was written against has moved or been reformatted, so this control breaks NOTHING\n"
        + "   and proves nothing. Re-point it at the current code, or delete it - do not leave it, because a\n"
        + "   control that fails to apply looks exactly like a control that passed.\n");
      process.exit(1);
    }
    src = src.split(find).join(repl);
  }
  return src;
}
let mutantCount = 0;
function writeMutant(rel, edits) {
  const abs = path.join(HERE, rel);
  const src = mutateText(fs.readFileSync(abs, "utf8"), `api/${rel}`, edits);
  const tmp = path.join(path.dirname(abs), `.mutant-${++mutantCount}-${path.basename(abs)}`);
  fs.writeFileSync(tmp, src);
  MUTANT_FILES.push(tmp);
  return tmp;
}

// The decision ladder, with the name consulted BEFORE the spine.
const TITLEFIRST_EDITS = [[
  `    if (live.length === 1)     v = verdictFor(live[0], strongBasis);
    else if (any.length === 1) v = verdictFor(any[0], strongBasis);
    else if (any.length > 1)   v = { reason: R_AMBIGUOUS }; // a split spine is a stop, not a cue to guess at names
    else {
      const hits = distinct(offersByTitle.get(normLabel(label)));
      if (hits.length === 1)   v = verdictFor(hits[0], "title");
      else if (hits.length > 1) v = { reason: R_AMBIGUOUS };
      else                      v = { reason: R_UNKNOWN };
    }`,
  `    const hits = distinct(offersByTitle.get(normLabel(label)));
    if (hits.length === 1)      v = verdictFor(hits[0], "title");
    else if (live.length === 1) v = verdictFor(live[0], strongBasis);
    else if (any.length === 1)  v = verdictFor(any[0], strongBasis);
    else if (any.length > 1)    v = { reason: R_AMBIGUOUS };
    else if (hits.length > 1)   v = { reason: R_AMBIGUOUS };
    else                        v = { reason: R_UNKNOWN };`,
]];
// A split signal resolved by picking one, instead of stopping.
const FIRSTWINS_EDITS = [[
  `    else if (any.length > 1)   v = { reason: R_AMBIGUOUS }; // a split spine is a stop, not a cue to guess at names`,
  `    else if (any.length > 1)   v = verdictFor(any[0], strongBasis);`,
]];
// The existing tie stops being consulted, so a human's link is up for grabs again.
const OVERWRITE_EDITS = [[
  `    const already = tiedTo.get(key);`,
  `    const already = null;`,
]];
// The AI price-matcher's unapproved proposal counts as a fact.
const TRUSTPROPOSED_EDITS = [[
  `    if (r.match_status !== "confirmed") continue; // 'proposed' is a guess, not a fact`,
  `    if (r.match_status === " never") continue;`,
]];

// The cap counted AFTER it truncates, so the discards report as zero. This is the
// original defect: needAll.slice() with nothing counting what the slice threw away.
const CAPSILENT_EDITS = [[
  `  const lookups = needAll.slice(0, cap);
  const skipped = needAll.length - lookups.length;`,
  `  const lookups = needAll.slice(0, cap);
  const skipped = lookups.length - lookups.length;`,
]];
// A raced candidate pushed into `existing` but left in `proposed` as well, so the
// same item is reported twice and the one-bucket contract quietly stops holding.
const RACEDBOTH_EDITS = [[
  `    proposed: [...applied],`,
  `    proposed: [...wasProposed],`,
]];

const EDITS_FOR = {
  "title-first": TITLEFIRST_EDITS,
  "first-wins": FIRSTWINS_EDITS,
  "overwrite": OVERWRITE_EDITS,
  "trust-proposed": TRUSTPROPOSED_EDITS,
  "cap-silent": CAPSILENT_EDITS,
  "raced-both": RACEDBOTH_EDITS,
};
if (MUTATE && !EDITS_FOR[MUTATE]) {
  console.error(`\n❌ unknown MUTATE=${MUTATE}. Known controls: ${Object.keys(EDITS_FOR).join(", ")}\n`);
  process.exit(2);
}

const SHIPPED_SRC = fs.readFileSync(path.join(HERE, TARGET), "utf8");
for (const fn of ["buildAutoLinkPlan", "autoLinkInserts", "normLabel", "planPriceLookups", "settleAutoLinkPlan"]) {
  if (!SHIPPED_SRC.includes(`export function ${fn}(`)) {
    console.error(`\n❌ api/${TARGET} no longer exports ${fn}(). This suite drives that function directly;\n`
      + "   re-point it at whatever replaced it rather than deleting the coverage.\n");
    process.exit(2);
  }
}

const modPath = MUTATE ? writeMutant(TARGET, EDITS_FOR[MUTATE]) : path.join(HERE, TARGET);
const MOD = await import(pathToFileURL(modPath).href);
cleanupMutants();
const { buildAutoLinkPlan, autoLinkInserts, normLabel, planPriceLookups, settleAutoLinkPlan } = MOD;

// ─── the fixture academy ─────────────────────────────────────────────────────
// One academy, sixteen candidates, chosen so that every branch of the ladder is the
// ONLY branch that produces the expected answer. Two offers deliberately normalize to
// the same title, and one product is deliberately named after the wrong offer.

const OFF_TRAINING = "off-training", OFF_STEADY = "off-steady", OFF_CAMP = "off-camp";
const OFF_DUP_A = "off-dup-a", OFF_DUP_B = "off-dup-b", OFF_ARCHIVED = "off-archived";

const OFFERS = [
  { id: OFF_TRAINING, title: "Training" },
  { id: OFF_STEADY,   title: "Steady" },
  { id: OFF_CAMP,     title: "Summer Camp" },
  { id: OFF_DUP_A,    title: "Skills Lab" },
  { id: OFF_DUP_B,    title: "skills   lab" }, // normalizes onto Skills Lab
];

const STRIPE_PRODUCTS = [
  { id: "prod_steady",     name: "Steady" },              // named for one offer, sold under another
  { id: "prod_locked",     name: "Summer Camp" },         // already tied by a human
  { id: "prod_guess",      name: "Summer Camp" },         // catalog row is only 'proposed'
  { id: "prod_split",      name: "Nothing Alike" },       // spine points two ways
  { id: "prod_repointed",  name: "Nothing Alike" },       // retired row and live row disagree
  { id: "prod_gone",       name: "Nothing Alike" },       // spine names an archived offer
  { id: "prod_orphan",     name: "Totally Unknown Thing" },
  { id: "prod_dup",        name: "  SKILLS   Lab " },     // title hits two offers
  { id: "prod_runtime",    name: "Nothing Alike" },       // known only to offer_prices
  { id: "prod_nullrow",    name: "Steady" },              // has a link row that ties nothing
];

const PIPELINES = [
  { id: "pipe_stamped", name: "Steady" },         // preset stamped it, and it is NAMED for another offer
  { id: "pipe_split",   name: "Mixed Bag" },      // THE ONE: stages stamped with two offers
  { id: "pipe_named",   name: "Summer Camp" },    // exact title, nothing stronger
  { id: "pipe_dup",     name: "Skills Lab" },     // title hits two offers
  { id: "pipe_blank",   name: "Sales" },          // nothing at all
  { id: "pipe_locked",  name: "Legacy" },         // already tied, and stamped otherwise
];

const LINKS = [
  { kind: "stripe_product", ref_id: "prod_locked", offer_id: OFF_CAMP,   label: "Summer Camp" },
  { kind: "ghl_pipeline",   ref_id: "pipe_locked", offer_id: OFF_STEADY, label: "Legacy" },
  // A row with no offer_id ties nothing. api/kpis-v15.js skips these, so an empty
  // slot must not read as "already handled".
  { kind: "stripe_product", ref_id: "prod_nullrow", offer_id: null, label: "Steady" },
];

const conf = (o) => ({ match_status: "confirmed", ...o });
const CATALOG_ROWS = [
  conf({ stripe_price_id: "price_a", stripe_product_id: "prod_steady", offer_id: OFF_TRAINING, is_routable: true }),
  conf({ stripe_price_id: "price_b", stripe_product_id: "prod_locked", offer_id: OFF_TRAINING, is_routable: true }),
  // 'proposed' = the AI suggested it and nobody approved it. Not a fact.
  { stripe_price_id: "price_c", stripe_product_id: "prod_guess", offer_id: OFF_TRAINING, is_routable: true, match_status: "proposed" },
  conf({ stripe_price_id: "price_d", stripe_product_id: "prod_split", offer_id: OFF_TRAINING, is_routable: true }),
  conf({ stripe_price_id: "price_e", stripe_product_id: "prod_split", offer_id: OFF_STEADY,   is_routable: true }),
  // Re-pointed: the old price still names Steady, the price actually sold names Training.
  conf({ stripe_price_id: "price_f", stripe_product_id: "prod_repointed", offer_id: OFF_STEADY,   is_routable: false }),
  conf({ stripe_price_id: "price_g", stripe_product_id: "prod_repointed", offer_id: OFF_TRAINING, is_routable: true }),
  conf({ stripe_price_id: "price_h", stripe_product_id: "prod_gone", offer_id: OFF_ARCHIVED, is_routable: true }),
];

const OFFER_PRICE_ROWS = [
  { stripe_price_id: "price_i", stripe_product_id: "prod_runtime", source_offer_id: OFF_CAMP, is_routable: true, is_active: true },
];

const STAGE_ROWS = [
  { ghl_pipeline_id: "pipe_stamped", offer_id: OFF_TRAINING },
  { ghl_pipeline_id: "pipe_stamped", offer_id: OFF_TRAINING },
  { ghl_pipeline_id: "pipe_stamped", offer_id: OFF_TRAINING },
  { ghl_pipeline_id: "pipe_split",   offer_id: OFF_TRAINING },
  { ghl_pipeline_id: "pipe_split",   offer_id: OFF_CAMP },
  { ghl_pipeline_id: "pipe_locked",  offer_id: OFF_TRAINING }, // loses to the human's tie
  { ghl_pipeline_id: null,           offer_id: OFF_TRAINING }, // a portal-only stage, no GHL pipeline
];

const INPUT = () => ({
  offers: OFFERS,
  stripeProducts: STRIPE_PRODUCTS,
  pipelines: PIPELINES,
  links: LINKS,
  catalogRows: JSON.parse(JSON.stringify(CATALOG_ROWS)),
  offerPriceRows: JSON.parse(JSON.stringify(OFFER_PRICE_ROWS)),
  stageRows: STAGE_ROWS,
});

// ─── harness ─────────────────────────────────────────────────────────────────
let fails = 0;
const check = (ok, msg) => { if (!ok) fails++; console.log(`  ${ok ? "PASS" : "FAIL"}  ${msg}`); };

const plan = buildAutoLinkPlan(INPUT());
const find = (bucket, kind, ref) => (plan[bucket] || []).find(x => x.kind === kind && x.ref_id === ref) || null;
const prop = (ref) => find("proposed", ref.startsWith("pipe") ? "ghl_pipeline" : "stripe_product", ref);
const unm  = (ref) => find("unmatched", ref.startsWith("pipe") ? "ghl_pipeline" : "stripe_product", ref);
const exi  = (ref) => find("existing", ref.startsWith("pipe") ? "ghl_pipeline" : "stripe_product", ref);
const desc = (e) => (e ? `${e.basis || e.reason || "existing"} -> ${e.offer_title || e.offer_id || "-"}` : "NOT IN THIS BUCKET");

console.log("\n── auto-link, one academy, 10 Stripe products and 6 GHL pipelines ──");
console.log("   Real buildAutoLinkPlan / autoLinkInserts out of api/offers/kpi-setup.js.");
if (MUTATE) console.log(`   MUTATE=${MUTATE} - this run is a negative control and MUST be caught.`);

const table = [
  ...plan.proposed.map(p => ["proposed", p.ref_id, `${p.basis} -> ${p.offer_title}`]),
  ...plan.existing.map(p => ["existing", p.ref_id, `already -> ${p.offer_title || p.offer_id}`]),
  ...plan.unmatched.map(p => ["unmatched", p.ref_id, p.reason]),
];
console.log("");
for (const [b, r, d] of table) console.log(`      | ${b.padEnd(10)} ${String(r).padEnd(15)} ${d}`);
console.log("");

// ── 1. the deterministic basis beats the name, even when the name is perfect ──
// prod_steady is called "Steady" and there IS a "Steady" offer. The catalog says it
// is sold under Training. If the name wins here, this academy's Steady revenue line
// is somebody else's money from the day it is seeded.
console.log("── 1. catalog beats title, on the same product, with the name pointing elsewhere ──");
check(prop("prod_steady") && prop("prod_steady").basis === "catalog",
  `prod_steady is proposed on the catalog basis (got ${desc(prop("prod_steady") || unm("prod_steady"))})`);
check(prop("prod_steady") && prop("prod_steady").offer_id === OFF_TRAINING,
  "and it ties to Training, the offer it is actually sold under - not the offer it is NAMED after");
check(!unm("prod_steady") && !exi("prod_steady"), "it appears in exactly one bucket");
check(prop("prod_runtime") && prop("prod_runtime").basis === "catalog" && prop("prod_runtime").offer_id === OFF_CAMP,
  "offer_prices.source_offer_id carries the same weight as pricing_catalog.offer_id");
// The re-pointed product: two confirmed catalog rows disagreeing, one retired and one
// live. That is not real ambiguity, it is history, and the live row is the answer.
check(prop("prod_repointed") && prop("prod_repointed").offer_id === OFF_TRAINING,
  `a product whose price was re-pointed ties to what it is sold under TODAY (got ${desc(prop("prod_repointed") || unm("prod_repointed"))})`);
check(prop("prod_nullrow") && prop("prod_nullrow").basis === "title" && prop("prod_nullrow").offer_id === OFF_STEADY,
  "a link row with a null offer_id ties nothing, so that product is still fair game (and honestly labelled title)");

// ── 2. a tie somebody already made is untouchable ──
console.log("\n── 2. existing links are skipped, never overwritten ──");
check(exi("prod_locked") && exi("prod_locked").offer_id === OFF_CAMP,
  `prod_locked stays tied to Summer Camp (got ${desc(exi("prod_locked") || prop("prod_locked"))})`);
check(!prop("prod_locked"),
  "and it is NOT proposed, even though the catalog would have said Training - the human's answer stands");
check(exi("pipe_locked") && exi("pipe_locked").offer_id === OFF_STEADY && !prop("pipe_locked"),
  "the same for a pipeline whose preset stamp disagrees with the human who tied it");
const inserts = autoLinkInserts(plan, "client-uuid");
check(!inserts.some(r => r.ref_id === "prod_locked" || r.ref_id === "pipe_locked"),
  "neither reaches the insert payload, so there is nothing for the database to overwrite");
check(inserts.every(r => r.client_id === "client-uuid" && r.offer_id && r.kind && r.ref_id),
  "every insert row is fully formed (client, kind, ref, offer)");

// ── 3. THE ONE: an unsure pipeline is not proposed at all ──
// pipe_split has stage rows stamped with two different offers. There is no safe
// answer, and a wrong pipeline tie corrupts the Sales KPIs without ever looking wrong.
console.log("\n── 3. an ambiguous pipeline is refused, not guessed ──");
check(!prop("pipe_split"), `pipe_split is NOT proposed (got ${desc(prop("pipe_split") || unm("pipe_split"))})`);
check(unm("pipe_split") && unm("pipe_split").reason === "ambiguous",
  "it comes back unmatched with reason 'ambiguous', so a human can see there is a decision to make");
check(!prop("pipe_dup") && unm("pipe_dup") && unm("pipe_dup").reason === "ambiguous",
  "a pipeline whose name matches two offers is refused for the same reason");
check(!prop("prod_split") && unm("prod_split") && unm("prod_split").reason === "ambiguous",
  "a split signal stops a PRODUCT too, and does not fall through to the name");
check(!prop("prod_dup") && unm("prod_dup") && unm("prod_dup").reason === "ambiguous",
  "nor does a product whose normalized name hits two offers");
check(prop("pipe_stamped") && prop("pipe_stamped").basis === "stamp" && prop("pipe_stamped").offer_id === OFF_TRAINING,
  `the pipeline that IS unambiguous still gets proposed on the stamp basis, and the stamp beats its misleading name (got ${desc(prop("pipe_stamped") || unm("pipe_stamped"))})`);
check(prop("pipe_named") && prop("pipe_named").basis === "title" && prop("pipe_named").offer_id === OFF_CAMP,
  "and a single exact title match is allowed, labelled title so its confidence is visible");

// ── 4. apply writes what propose showed ──
// Two claims. The plan is a function of its input alone (same rows in, same bytes
// out), and the insert payload is a function of the plan alone. Together those are
// what stop an apply from quietly deciding something the human never read.
console.log("\n── 4. no recompute drift between propose and apply ──");
const again = buildAutoLinkPlan(INPUT());
check(JSON.stringify(again) === JSON.stringify(plan),
  "the same rows produce byte-identical plans, so a propose and a later apply cannot disagree");
const payload = autoLinkInserts(plan, "client-uuid");
check(payload.length === plan.proposed.length,
  `the apply payload has exactly one row per proposal (${payload.length} vs ${plan.proposed.length})`);
check(payload.every((r, i) => r.kind === plan.proposed[i].kind && r.ref_id === plan.proposed[i].ref_id && r.offer_id === plan.proposed[i].offer_id),
  "and each row is the proposal it came from, in order - the writer never re-derives an offer");
check(JSON.stringify(autoLinkInserts(again, "client-uuid")) === JSON.stringify(payload),
  "recomputing the plan and re-deriving the payload lands on the same bytes");
check(!payload.some(r => plan.unmatched.some(u => u.kind === r.kind && u.ref_id === r.ref_id)),
  "nothing that was refused sneaks into the write");

// ── 5. the unapproved guess does not get to wear the label of a fact ──
console.log("\n── 5. a 'proposed' catalog row is a guess, and is labelled like one ──");
check(!(prop("prod_guess") && prop("prod_guess").basis === "catalog"),
  `prod_guess does not claim the catalog basis (got ${desc(prop("prod_guess") || unm("prod_guess"))})`);
check(prop("prod_guess") && prop("prod_guess").offer_id === OFF_CAMP && prop("prod_guess").basis === "title",
  "it falls through to its name, which says Summer Camp, and it says 'title' out loud");
check(prop("prod_guess") && prop("prod_guess").offer_id !== OFF_TRAINING,
  "the unapproved match to Training does not become a KPI tie");

// ── 6. nothing is silently dropped ──
console.log("\n── 6. every candidate lands in exactly one bucket, with a reason ──");
const all = [
  ...STRIPE_PRODUCTS.map(p => ["stripe_product", p.id]),
  ...PIPELINES.map(p => ["ghl_pipeline", p.id]),
];
let placed = 0, dupes = [];
for (const [kind, ref] of all) {
  const hits = ["proposed", "existing", "unmatched"].filter(b => find(b, kind, ref));
  if (hits.length === 1) placed++; else dupes.push(`${ref} in ${hits.length ? hits.join("+") : "NO bucket"}`);
}
check(placed === all.length, `all ${all.length} candidates accounted for exactly once${dupes.length ? ` (${dupes.join(", ")})` : ""}`);
check(plan.unmatched.every(u => ["ambiguous", "missing", "unknown"].includes(u.reason)),
  "every unmatched entry carries a one-word reason from the documented set");
check(unm("prod_gone") && unm("prod_gone").reason === "missing",
  `a spine pointing at an archived offer reads 'missing', not 'unknown' (got ${desc(unm("prod_gone") || prop("prod_gone"))})`);
check(!prop("prod_gone"),
  "and it is not quietly re-guessed by name - a real signal to an invisible offer is a fact to report, not a cue");
check(unm("prod_orphan") && unm("prod_orphan").reason === "unknown" && unm("pipe_blank") && unm("pipe_blank").reason === "unknown",
  "a candidate with no signal at all reads 'unknown'");
check(plan.proposed.every(p => p.offer_title && p.label !== undefined && ["catalog", "stamp", "title"].includes(p.basis)),
  "every proposal is legible on its own: a label, an offer title, and which basis produced it");

// ── 7. normalization is exactly what it claims and no wider ──
// The title basis is the guess, so its blast radius is worth pinning. Case and
// whitespace only. Anything that also stripped punctuation would tie "3/wk" to "3 wk".
console.log("\n── 7. title normalization: case and whitespace, nothing else ──");
check(normLabel("  Summer   CAMP ") === "summer camp", "case folded, runs of whitespace collapsed, ends trimmed");
check(normLabel("Skills Lab") === normLabel("skills   lab"), "the two fixture offers really do collide, which is why they are ambiguous");
check(normLabel("3/wk Training") !== normLabel("3 wk Training"), "punctuation is NOT stripped, so it cannot widen a tie");
check(normLabel(null) === "" && normLabel(undefined) === "", "a nameless candidate normalizes to empty");
check(!plan.proposed.some(p => p.basis === "title" && !p.label),
  "and an empty name never produces a title tie");

// ── 8. the lookup cap is a budget, and budgets get reported ──
// offer_prices.stripe_product_id is nullable, so some rows need a Stripe round trip to
// join their price to a product. That is capped. The danger is not the cap - it is a
// cap that truncates before anything counts what it threw away, because a discarded
// row loses its DETERMINISTIC signal and lands on a title match instead. Thirty needy
// rows, all of them named after the wrong offer, is that failure at full volume.
console.log("\n── 8. rows past the lookup cap are counted, not quietly downgraded ──");
const CAP_N = 30;
const capProducts = [], capPriceRows = [];
for (let i = 1; i <= CAP_N; i++) {
  const n = String(i).padStart(2, "0");
  capProducts.push({ id: `prod_cap_${n}`, name: "Steady" }); // the name points at the WRONG offer
  capPriceRows.push({ stripe_price_id: `price_cap_${n}`, stripe_product_id: null, source_offer_id: OFF_TRAINING, is_routable: true, is_active: true });
}
const lookup = planPriceLookups(capPriceRows, { stripeConnected: true });
check(lookup.lookups.length === 25, `25 rows are looked up (got ${lookup.lookups.length})`);
check(lookup.skipped === CAP_N - 25, `the remainder is counted as ${CAP_N - 25} (got ${lookup.skipped})`);
check(lookup.warnings.length === 1, `the discards produce exactly one warning (got ${lookup.warnings.length})`);
check(lookup.warnings[0] === "5 runtime price row(s) beyond the 25-lookup cap were not resolved, so their offer signal is missing and those products may fall back to a title match.",
  `and it names the TRUE remainder, not the capped count: ${JSON.stringify(lookup.warnings[0] || null)}`);

// Now finish the job the handler does: resolve only the rows the cap allowed, then
// plan. The five it could not resolve must degrade HONESTLY.
for (const r of lookup.lookups) r.stripe_product_id = `prod_cap_${r.stripe_price_id.slice(-2)}`;
const capPlan = buildAutoLinkPlan({ offers: OFFERS, stripeProducts: capProducts, pipelines: [], links: [], catalogRows: [], offerPriceRows: capPriceRows, stageRows: [] });
const capFind = (b, ref) => (capPlan[b] || []).find(x => x.ref_id === ref) || null;
check(capFind("proposed", "prod_cap_01") && capFind("proposed", "prod_cap_01").basis === "catalog" && capFind("proposed", "prod_cap_01").offer_id === OFF_TRAINING,
  "a resolved row still ties to Training on the catalog basis");
const capped = capFind("proposed", "prod_cap_30");
check(capped && capped.basis === "title" && capped.offer_id === OFF_STEADY,
  `the capped row falls back to its NAME and says so - basis title, not catalog (got ${desc(capped || capFind("unmatched", "prod_cap_30"))})`);
check(!capPlan.proposed.some(p => Number(p.ref_id.slice(-2)) > 25 && p.basis === "catalog"),
  "no capped row claims a deterministic basis it never actually resolved");
check(capPlan.proposed.filter(p => p.basis === "catalog").length === 25 && capPlan.proposed.filter(p => p.basis === "title").length === 5,
  `the split is exactly 25 catalog and 5 title (got ${capPlan.proposed.filter(p => p.basis === "catalog").length}/${capPlan.proposed.filter(p => p.basis === "title").length})`);
// The misattribution is real and visible: five products tied to Steady that the spine
// says are Training. The warning is the only thing standing between that and silence.
check(!!lookup.warnings[0] && lookup.warnings[0].includes("may fall back to a title match"),
  "and the warning says out loud what the five products just did");

const noStripe = planPriceLookups(capPriceRows.map(r => ({ ...r, stripe_product_id: null })), { stripeConnected: false });
check(noStripe.skipped === CAP_N && noStripe.warnings.length === 1 && noStripe.warnings[0].startsWith(`${CAP_N} runtime price row(s) carry no product id`),
  `with Stripe disconnected the warning names all ${CAP_N}, not the capped 25 (got ${JSON.stringify(noStripe.warnings[0] || null)})`);
check(JSON.stringify(planPriceLookups([], {})) === JSON.stringify({ lookups: [], skipped: 0, warnings: [] }),
  "and an academy with nothing to resolve gets no warning at all");

// ── 9. apply rebuilds the buckets around what the database accepted ──
// Between the propose a human read and the apply they clicked, somebody else can tie
// one of these. The row is NOT ours, and saying so in two buckets at once - proposed
// AND existing - is how a report starts lying about its own totals.
console.log("\n── 9. a candidate that loses a race leaves `proposed` ──");
const keyOf = (p) => `${p.kind}:${p.ref_id}`;
const allKeys = plan.proposed.map(keyOf);
const bucketsOf = (pl, kind, ref) => ["proposed", "existing", "unmatched"].filter(b => (pl[b] || []).some(x => x.kind === kind && x.ref_id === ref));

const settledAll = settleAutoLinkPlan(plan, new Set(allKeys));
check(settledAll.applied.length === plan.proposed.length && settledAll.proposed.length === plan.proposed.length,
  `when everything lands, applied and proposed both hold all ${plan.proposed.length}`);
check(settledAll.existing.length === plan.existing.length && !settledAll.existing.some(e => e.raced),
  "and nothing is marked raced");

const lost = keyOf(plan.proposed[0]);
const settled = settleAutoLinkPlan(plan, new Set(allKeys.filter(k => k !== lost)));
check(settled.applied.length === plan.proposed.length - 1, `one race lost means one fewer applied (got ${settled.applied.length})`);
check(!settled.proposed.some(p => keyOf(p) === lost), `${lost} is GONE from proposed, not merely copied elsewhere`);
const racedRow = settled.existing.find(e => `${e.kind}:${e.ref_id}` === lost);
check(!!racedRow && racedRow.raced === true, "it turns up in existing, flagged raced:true");
check(racedRow && !("offer_id" in racedRow),
  `and it carries NO offer_id key at all - null would claim "a row exists and ties nothing", which is the opposite of what happened (got ${JSON.stringify(racedRow && racedRow.offer_id)})`);
check(bucketsOf(settled, plan.proposed[0].kind, plan.proposed[0].ref_id).length === 1,
  "the one-bucket contract survives the write");
let settledPlaced = 0;
for (const [kind, ref] of all) if (bucketsOf(settled, kind, ref).length === 1) settledPlaced++;
check(settledPlaced === all.length, `all ${all.length} candidates still land in exactly one bucket after an apply (got ${settledPlaced})`);
check(settled.unmatched.length === plan.unmatched.length, "a race does not disturb the refusals");

const settledNone = settleAutoLinkPlan(plan, new Set());
check(settledNone.proposed.length === 0 && settledNone.applied.length === 0,
  "if nothing lands, nothing is reported as standing");
check(settledNone.existing.length === plan.existing.length + plan.proposed.length,
  `and every proposal moves to existing rather than vanishing (got ${settledNone.existing.length})`);
check(!settledNone.applied.some(a => !allKeys.includes(keyOf(a))),
  "applied never contains anything the database did not confirm");

console.log(fails ? `\nRESULT: ${fails} FAILURE(S)` : "\nRESULT: ALL PASS");

if (MUTATE) {
  console.log(fails
    ? `\n✅ NEGATIVE CONTROL PASSED: MUTATE=${MUTATE} was caught by ${fails} assertion(s).`
    : `\n❌ NEGATIVE CONTROL FAILED: MUTATE=${MUTATE} reverted a fix and every assertion still passed. That control is decorative.`);
  process.exit(fails ? 0 : 1);
}
process.exit(fails ? 1 : 0);
