// THE MEMBER WORKBOOK PRE-SEED (scripts/seed-member-workbook.mjs): builds the
// members shells + the kind='member' workbook/cards/answers from an academy's
// Stripe, so the owner opens a true CONFIRM and not a blank form. No network, no
// database, no Stripe - Supabase is an in-memory PostgREST stub and the Stripe
// subscription list is a fixture.
//
//   node --test api/_seed-member-workbook.test.mjs
//   MUTATE=noskip node --test api/_seed-member-workbook.test.mjs   (the negative control)
//
// WHAT THIS PROVES
//   1. IDEMPOTENT RE-RUN. A second seed over the same DB creates NO duplicate
//      member, card or answer - every shell is found on the sub id, every card on
//      its card_key, every answer on its field. Row counts do not move.
//   2. GHL PREFILL LANDS IN `proposed`. athlete_name / parent_phone / age come
//      from the contacts join (matched by stripe_customer_id) and arrive as the
//      answer's proposed value; a sub with no contact seeds blank, never guessed.
//   3. AGE GOES TO member_field_values, NOT A members COLUMN. Apply writes a
//      member_field_values row typed by the Age def; the members row carries no
//      athlete_age key at all.
//   4. THE CARD/ANSWER SHAPE MATCHES THE ENGINE. Every seeded answer is
//      target_kind='member_row', target_table='members', target_id=the shell, and
//      its target_field is an own-property of MEMBER_T in api/workbook.js. The
//      only MEMBER_T leaves not seeded are the two off_card_* fields (minted by
//      the page when an owner marks a member off-card).
//   5. AGE ROUND-TRIP. Every age this seed can propose passes the apply engine's
//      tAgeStrOrEmpty (bare digits 1..99); a padded or out-of-range age proposes
//      nothing rather than a value apply would refuse.
//
// THE CONTROL: MUTATE=noskip disables the "skip a row that already exists" guard,
// so the second run duplicates. The suite asserts the duplicate appears - proof
// the guard is what keeps re-runs clean, not luck.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  seed, computeAnswers, cleanAge, ageFromCustomFields, normalizeSub,
  prefillFromContact, SEEDED_FIELDS, AGE_GHL_KEY,
} from "../scripts/seed-member-workbook.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MUTATE = process.env.MUTATE || "";

let pass = 0;
const failures = [];
function ok(cond, msg) {
  if (cond) { pass++; console.log(`  ✅ ${msg}`); }
  else { failures.push(msg); console.log(`  ❌ ${msg}`); }
}

// ── the MEMBER_T contract, read straight from the engine so it cannot drift ───
function memberTKeys() {
  const src = fs.readFileSync(path.join(HERE, "workbook.js"), "utf8");
  const start = src.indexOf("const MEMBER_T = {");
  if (start < 0) throw new Error("could not find MEMBER_T in api/workbook.js");
  const block = src.slice(start, src.indexOf("};", start));
  const keys = [];
  for (const line of block.split("\n").slice(1)) {
    const m = line.match(/^\s*([a-z_]+)\s*:/);
    if (m) keys.push(m[1]);
  }
  return keys;
}

// ── the in-memory world ───────────────────────────────────────────────────────
const CLIENT = "sj";
let DB, seq;
function reset() {
  seq = 0;
  DB = {
    contacts: [
      // matched to subs by stripe_customer_id. cus_a: full prefill; cus_b: object
      // custom_fields blob with age; cus_c: array-shaped custom_fields; sub with
      // cus_none: no contact at all -> blank.
      { id: "ct-a", client_id: CLIENT, stripe_customer_id: "cus_a", athlete_name: "Jenny Chung", name: "May Chung", phone: "408-555-0100", custom_fields: { [AGE_GHL_KEY]: "9" } },
      { id: "ct-b", client_id: CLIENT, stripe_customer_id: "cus_b", athlete_name: "Salvador Esparza", name: "Rosa Esparza", phone: "408-555-0101", custom_fields: { [AGE_GHL_KEY]: "12", other: "x" } },
      { id: "ct-c", client_id: CLIENT, stripe_customer_id: "cus_c", athlete_name: "Leo Park", name: "Anna Park", phone: null, custom_fields: [{ id: AGE_GHL_KEY, value: "11" }] },
    ],
    members: [],
    member_field_values: [],
    custom_field_defs: [{ id: "def-age", client_id: CLIENT, key: "athlete_age", label: "Athlete age", archived: false }],
    // One live offer with three plan families + one archived family (skipped), so
    // plan_options seeds the three live titles and never the archived one (D3).
    offers: [{
      id: "off-sj", client_id: CLIENT, status: "active",
      data: { pricing: { pricing_offerings: [
        { title: "Elementary Academy" },
        { title: "Academy 2x/week" },
        { title: "Academy Unlimited" },
        { title: "Old Pre Season", archived: true },
      ] } },
    }],
    workbooks: [],
    workbook_cards: [],
    workbook_answers: [],
  };
}

// The four active subscriptions the fixture Stripe returns. Amount + dates live on
// the ITEM (docs/plans/sj-price-match-log.md), exactly as the real API ships them.
function stripeSubs() {
  // `product` is the EXPANDED product object (the seed reads .name for plan_label).
  const sub = (id, customer, priceId, amount, start, end, productName) => ({
    id, customer, status: "active",
    items: { data: [{ id: `si_${id}`, current_period_start: start, current_period_end: end, price: { id: priceId, unit_amount: amount, product: productName ? { id: `prod_${id}`, name: productName } : null } }] },
  });
  // 2026-09-15 = 1789084800 ; 2026-08-18 = 1786060800 (period start), close enough for a fixture.
  return [
    sub("sub_a", "cus_a", "price_ele_m", 21875, 1786060800, 1789084800, "Elementary Academy"),
    sub("sub_b", "cus_b", "price_preseason_1x", 20000, 1786060800, 1789084800, "Old Pre Season 1x"),
    sub("sub_c", "cus_c", "price_two_m", 27344, 1786060800, 1789084800, "Academy 2x/week"),
    // No product expansion at all -> plan_label null, never the raw price id.
    sub("sub_none", "cus_none", "price_ele_m", 21875, 1786060800, 1789084800, null),
  ];
}

// A compact PostgREST over DB: eq / in filters, loose select projection, POST that
// appends with a generated id and honours return=representation.
function makeSb() {
  return async function sb(pathStr, init = {}) {
    const [table, qs = ""] = String(pathStr).split("?");
    const params = new URLSearchParams(qs);
    const method = String(init.method || "GET").toUpperCase();
    if (method === "GET") {
      let rows = (DB[table] || []).slice();
      for (const [k, v] of params.entries()) {
        if (["select", "order", "limit", "offset", "on_conflict"].includes(k)) continue;
        const s = String(v);
        if (s.startsWith("eq.")) { const val = s.slice(3); rows = rows.filter((r) => String(r[k] == null ? "" : r[k]) === val); }
        else if (s.startsWith("in.(")) { const vals = s.slice(4, -1).split(","); rows = rows.filter((r) => vals.includes(String(r[k]))); }
      }
      const sel = params.get("select");
      if (!sel || sel === "*") return rows.map((r) => ({ ...r }));
      const cols = sel.split(",").map((c) => c.trim());
      return rows.map((r) => Object.fromEntries(cols.map((c) => [c, r[c] === undefined ? null : r[c]])));
    }
    if (method === "POST") {
      const list = JSON.parse(init.body || "[]");
      const prefer = String((init.headers || {}).Prefer || "");
      const made = (Array.isArray(list) ? list : [list]).map((r) => {
        const row = { id: `${table}-${++seq}`, ...r };
        (DB[table] = DB[table] || []).push(row);
        return row;
      });
      return prefer.includes("return=representation") ? made : null;
    }
    throw new Error(`UNSTUBBED ${method} ${table}`);
  };
}

async function runSeed(mutate) {
  const deps = { sb: makeSb(), listActiveSubscriptions: async () => stripeSubs() };
  return seed({ clientId: CLIENT, stripeAccount: null, apply: true, deps, log: () => {}, mutate });
}

// ═══════════════════════════════════════════════════════════════════════════════
reset();
console.log("PURE HELPERS");
// cleanAge TRIMS then validates: " 9 " -> "9" is the SAFE result (a trimmed value
// passes tAgeStrOrEmpty), while a non-integer or out-of-range age proposes nothing.
ok(cleanAge("9") === "9" && cleanAge(" 9 ") === "9" && cleanAge("0") === null && cleanAge("100") === null && cleanAge("abc") === null,
  "cleanAge yields a trimmed bare-digit 1..99 or null, so age never proposes what tAgeStrOrEmpty refuses");
ok(ageFromCustomFields({ [AGE_GHL_KEY]: "10" }) === "10" && ageFromCustomFields([{ id: AGE_GHL_KEY, value: "11" }]) === "11" && ageFromCustomFields({}) === null,
  "ageFromCustomFields reads both the object and the array GHL blob shapes");
const nsub = normalizeSub(stripeSubs()[0]);
const expLast = new Date(1786060800 * 1000).toISOString().slice(0, 10);
const expNext = new Date(1789084800 * 1000).toISOString().slice(0, 10);
ok(nsub.id === "sub_a" && nsub.price_id === "price_ele_m" && nsub.amount_cents === 21875 && nsub.next_date === expNext && nsub.last_date === expLast && nsub.next_date > nsub.last_date,
  `normalizeSub pulls price id, amount and item-level next/last dates from items.data[0] (last ${nsub.last_date}, next ${nsub.next_date})`);

console.log("\n4. CARD/ANSWER SHAPE MATCHES THE ENGINE (MEMBER_T)");
const mt = memberTKeys();
const seededSet = new Set(SEEDED_FIELDS);
ok(SEEDED_FIELDS.every((f) => mt.includes(f)), "every seeded field is an own MEMBER_T leaf");
const notSeeded = mt.filter((f) => !seededSet.has(f)).sort();
// D1: EVERY editable member field is pre-seeded now, off_card_* included - a
// member card cannot mint, so a field with no seeded row could never be saved.
ok(notSeeded.length === 0,
  `every MEMBER_T leaf is seeded, off_card_* included (unseeded: ${notSeeded.join(", ") || "none"})`);
ok(seededSet.has("off_card_method") && seededSet.has("off_card_method_note"),
  "the two off_card_* fields are seeded, so the page saves an off-card member by id, never a null-id mint");
const sampleAnswers = computeAnswers({ dbMember: {}, dbAge: null, prefill: prefillFromContact(DB.contacts[0]), sub: nsub });
ok(sampleAnswers.length === SEEDED_FIELDS.length && sampleAnswers.every((a) => seededSet.has(a.target_field)),
  "computeAnswers emits exactly the seeded field set");
// off_card_* seed EMPTY: the row exists but has no value until the owner marks the
// member off-card.
const offA = sampleAnswers.find((a) => a.target_field === "off_card_method");
const offN = sampleAnswers.find((a) => a.target_field === "off_card_method_note");
ok(offA && offA.proposed == null && offA.current_value == null && offN && offN.proposed == null && offN.current_value == null,
  "the off_card_* answers seed empty (proposed and current_value both null)");
ok(sampleAnswers.every((a) => a.answered === undefined || a.answered == null) || sampleAnswers.every((a) => !("answered" in a)),
  "computeAnswers leaves answered unset (the seed row sets answered=null on the wire)");

console.log("\n2. GHL PREFILL LANDS IN proposed");
reset();
const r1 = await runSeed(MUTATE);
const memberA = DB.members.find((m) => m.stripe_subscription_id === "sub_a");
const nameAnsA = DB.workbook_answers.find((a) => a.target_id === memberA.id && a.target_field === "athlete_name");
const phoneAnsA = DB.workbook_answers.find((a) => a.target_id === memberA.id && a.target_field === "parent_phone");
const ageAnsA = DB.workbook_answers.find((a) => a.target_id === memberA.id && a.target_field === "athlete_age");
ok(nameAnsA && nameAnsA.proposed === "Jenny Chung", "athlete_name prefill from the contacts join is the answer's proposed value");
ok(phoneAnsA && phoneAnsA.proposed === "408-555-0100", "parent_phone prefill lands in proposed");
ok(ageAnsA && ageAnsA.proposed === "9", "athlete_age prefill (from the GHL custom_fields blob) lands in proposed");
const memberNone = DB.members.find((m) => m.stripe_subscription_id === "sub_none");
const nameAnsNone = DB.workbook_answers.find((a) => a.target_id === memberNone.id && a.target_field === "athlete_name");
ok(memberNone.athlete_name === "" && nameAnsNone.proposed == null, "a sub with no matching contact seeds a blank shell + null proposed, never a guess");
ok(r1.summary.prefilled_from_ghl === 3 && r1.summary.blank === 1, "summary counts 3 prefilled-from-GHL and 1 blank");
ok(DB.workbook_answers.every((a) => a.target_kind === "member_row" && a.target_table === "members" && a.target_id),
  "every seeded answer targets member_row / members / the shell id");

console.log("\n3. AGE -> member_field_values, NOT A members COLUMN");
const mfvA = DB.member_field_values.find((v) => v.member_id === memberA.id);
ok(mfvA && mfvA.field_id === "def-age" && mfvA.value === "9", "age is written to member_field_values, typed by the Age def");
ok(DB.members.every((m) => !("athlete_age" in m)), "no members row carries an athlete_age column");
ok(r1.summary.ages_written === 3, "summary reports 3 ages written (the sub with no contact has none)");

console.log("\n5. CARD meta: plan_label (readable) + plan_options (picker) - D3");
// The seed paints each card's meta so the page never renders the raw price id and
// can offer a plan picker even with an empty pricing_catalog.
const cardA = DB.workbook_cards.find((c) => c.card_key === "member:sub_a");
const cardNone = DB.workbook_cards.find((c) => c.card_key === "member:sub_none");
ok(cardA && cardA.meta && cardA.meta.plan_label === "Elementary Academy",
  "a member's plan_label is the Stripe product name, not the price id");
ok(cardA && Array.isArray(cardA.meta.plan_options) && cardA.meta.plan_options.length === 3
  && cardA.meta.plan_options.every((o) => o.plan && o.label && o.offer_id === "off-sj"),
  "plan_options carries the 3 LIVE families (archived skipped), each with plan/label/offer_id");
ok(cardA && !cardA.meta.plan_options.some((o) => o.plan === "Old Pre Season"),
  "the archived family is NOT offered as a plan option");
ok(cardNone && cardNone.meta && cardNone.meta.plan_label == null,
  "a sub with no expanded product seeds plan_label null (the page falls back to the plan answer, never the price id)");
ok(cardNone && Array.isArray(cardNone.meta.plan_options) && cardNone.meta.plan_options.length === 3,
  "and still carries the picker options so a plan can be chosen");

console.log("\n1. IDEMPOTENT RE-RUN (no MUTATE)");
if (MUTATE === "noskip") {
  console.log("  (skipped under MUTATE=noskip; the control block below asserts the opposite)");
} else {
  const membersBefore = DB.members.length;
  const cardsBefore = DB.workbook_cards.length;
  const answersBefore = DB.workbook_answers.length;
  const agesBefore = DB.member_field_values.length;
  const r2 = await runSeed("");
  ok(DB.members.length === membersBefore, `re-run created no new member (${membersBefore} -> ${DB.members.length})`);
  ok(DB.workbook_cards.length === cardsBefore, `re-run created no new card (${cardsBefore} -> ${DB.workbook_cards.length})`);
  ok(DB.workbook_answers.length === answersBefore, `re-run created no new answer (${answersBefore} -> ${DB.workbook_answers.length})`);
  ok(DB.member_field_values.length === agesBefore, "re-run wrote no duplicate age");
  ok(r2.summary.shells_found === 4 && r2.summary.cards_found === 4 && r2.summary.answers_created === 0,
    "re-run summary: 4 shells found, 4 cards found, 0 answers created");
  ok(DB.workbooks.length === 1, "re-run reused the one member workbook (no second workbook)");
}

// ── the negative control ──────────────────────────────────────────────────────
console.log("\nNEGATIVE CONTROL (MUTATE=noskip disables the skip-existing guard)");
if (MUTATE === "noskip") {
  reset();
  await runSeed("noskip");
  const membersAfter1 = DB.members.length;
  await runSeed("noskip");
  ok(DB.members.length === membersAfter1 * 2, `with the guard off, a second run DUPLICATES members (${membersAfter1} -> ${DB.members.length})`);
  ok(DB.workbook_answers.length === membersAfter1 * SEEDED_FIELDS.length * 2, "and duplicates every answer");
  console.log(failures.length === 0
    ? `\n✅ NEGATIVE CONTROL PASSED: MUTATE=noskip produced the duplicates the guard prevents.`
    : `\n❌ NEGATIVE CONTROL FAILED.`);
} else {
  console.log("  (run `MUTATE=noskip node --test api/_seed-member-workbook.test.mjs` to exercise the control)");
}

console.log(`\n${failures.length === 0 ? "✅ ALL PASSED" : "❌ FAILURES"}: ${pass} checks passed, ${failures.length} failed.`);
if (failures.length) { for (const f of failures) console.log(`   - ${f}`); process.exit(1); }
