// OFF-STRIPE PAYMENTS: the engine behind members.billing_mode='alternate'.
//
//   node api/_off-card.test.mjs
//
// WHAT THIS IS ABOUT. members.billing_mode has existed since June and has been
// DECORATIVE the whole time: setting a member to 'alternate' made the drawer say
// "not billed via Stripe", made the next-payment column say "pays another way"
// with no date, and stopped the Sorter complaining. No due date, no reminder, no
// ledger. A parent could train for a year and nobody would ever be told to
// collect. api/_off-card.js is the consequence the flag never had, and this
// suite is what says the consequence is real.
//
// WHAT THIS PROVES
//   1. THE DUE-DATE ENGINE FOLLOWS ANY COMMITMENT THE ACADEMY PRICED. Ruling D5,
//      in Zoran's words: "i just want to make sure its adaptable to any
//      commitment that is created in the pricing stage". A 9-month commitment
//      generates 9-month due dates; a 12-week one generates 84-day due dates and
//      is provably NOT the same as 3 calendar months. Nothing in the engine
//      carries a list of lengths - it resolves through the SAME
//      resolveInterval/addInterval the card path charges on
//      (api/_billing-cadence.js). MUTATE=hardcodedterms reinstates the old
//      closed 3/6-month world and this section fails loudly, which is the exact
//      requirement the ruling names.
//   2. DUE DATES CANNOT DRIFT. Period n is measured from the ANCHOR, never
//      stepped from the previous due date. JS month arithmetic clamps, so a
//      Jan-31 monthly anchor stepped one period at a time slides to Mar 3, then
//      Apr 3, then May 3, and the parent's pay day walks away from the pay day
//      forever. Measured from the anchor, the 31st comes back.
//   3. THE REMINDER LEADS THE MONEY. A collection is generated when its REMINDER
//      comes due (due_date - lead_days), not when its money does, because an
//      item created on the due date can never be a warning. One rule, so a
//      lead_days edit cannot leave the generator and the notifier disagreeing.
//   4. A PARTIAL NEVER AUTO-CLOSES. $100 against $199 leaves the collection open
//      with $99 owed and the action item open with $99 in its title. A ledger
//      that rounds a short payment up to paid is worse than no ledger, because
//      somebody trusts it.
//   5. GENERATION NEVER STOPS BECAUSE NOBODY PAID. Ruling D4: two missed periods
//      does NOTHING automatic. Unpaid-ness is not an input to the generator at
//      all - it cannot be, because the generator never reads a status. The
//      failure this whole build exists to prevent is a queue that quietly
//      empties itself.
//   6. THE DOUBLE-BILLING GUARD FIRES ON BOTH DOORS. Flagging a member off-card
//      while a Stripe subscription is live raises a stop-billing item, from the
//      deliberate endpoint AND from the raw field write that the drawer toggle
//      still uses. There is one member in production in exactly that state.
//   7. THE CRON CAN NOTIFY WITHOUT WEAKENING THE AUTHED ROUTE. The Slack/push/SMS
//      block was EXTRACTED from POST /api/action-items, not copied, and the JWT
//      gates it used to sit behind are still in front of it.
//   8. NO EM DASH REACHES AN OWNER. Every string this module can emit is checked.
//
// WHAT IT DOES NOT PROVE
//   - That any of this works against real Postgres. There is no database here.
//     The unique indexes (arrangement_id, period_index) and (client_id,
//     system_key) ARE the idempotency of the generator and the notifier, and
//     they are the database's job; this suite only proves the code treats a
//     23505 as the expected case rather than an error.
//   - That the migrations have been applied. They have NOT been - see
//     supabase/PENDING_SQL.md. Everything here runs against the source.
//   - That the drawer renders it. The client half is pinned by source text only,
//     and that is weak evidence, labeled as such where it is used.
//   - Anything about the member workbook. That is step 5 and is not built.
//
// ─────────────────────────────────────────────────────────────────────────────
// NEGATIVE CONTROLS. Each breaks ONE guarantee with ONE edit; the suite must
// PRINT "NEGATIVE CONTROL PASSED". A silent non-zero exit is not a report.
//
//   MUTATE=hardcodedterms   node api/_off-card.test.mjs
//       resolveArrangementInterval stops asking the shared cadence path and
//       looks the term up in a hardcoded {3_months, 6_months} map - the closed
//       world that existed before 2026-08-06, where "1 year" produced no key at
//       all. Ruling D5 says this must fail loudly. It does.
//       MEASURED: 12 failures.
//   MUTATE=stepfromlast     node api/_off-card.test.mjs
//       due dates step from the previous due date instead of the anchor. Every
//       assertion about a fixed rhythm still passes; what breaks is the Jan-31
//       case, where the day of the month never comes back. This is the control
//       that proves section 2 is not decorative.
//       MEASURED: 2 failures.
//   MUTATE=leadignored      node api/_off-card.test.mjs
//       generation waits for the due date instead of the reminder date, so the
//       row for a payment due in three days does not exist until the day it is
//       due and the lead time silently becomes zero.
//       MEASURED: 2 failures.
//   MUTATE=noend            node api/_off-card.test.mjs
//       commitment_end_date stops bounding generation, so an off-card member is
//       silently auto-renewed forever - the one thing the design says must never
//       happen without a human.
//       MEASURED: 2 failures.
//   MUTATE=uncapped         node api/_off-card.test.mjs
//       the per-run catch-up ceiling is removed. An arrangement anchored in 2019
//       by a typo mints a row and a Slack ping for every period since, which is a
//       denial of service on our own academy channel, written by us.
//       MEASURED: 1 failure.
//   MUTATE=partialcloses    node api/_off-card.test.mjs
//       a short payment records as 'paid' and closes the item. The parent who
//       handed over $100 of $199 is now settled and nobody will ever ask again.
//       MEASURED: 4 failures.
//   MUTATE=guardsilent      node api/_off-card.test.mjs
//       the double-billing guard stops looking at stripe_subscription_id, so
//       flagging a member off-card while Stripe keeps charging raises nothing.
//       This is the state ONE PRODUCTION MEMBER is in today.
//       MEASURED: 5 failures.
//   MUTATE=methodotherbare  node api/_off-card.test.mjs
//       'other' stops requiring its follow-up, so an academy ends up with "$85
//       other." on a row and nobody can collect it.
//       MEASURED: 2 failures.
//
// SOURCE-TEXT CONTROLS. These three mutate the SOURCE STRING the assertion
// reads, not the file. That is weaker evidence than the eight above and is
// labeled as such: it proves the pin genuinely depends on the text, not that the
// wiring behaves. It is still the difference between someone noticing these
// lines being removed and nobody noticing.
//   MUTATE=emptystringkept  node api/_off-card.test.mjs
//       actionUpdateProfile stops normalizing "" to null. billing_mode is still
//       a directly editable profile field and the drawer's generic field editor
//       passes an empty select value straight through, so the empty string
//       reaches the new CHECK on members.billing_mode and the write just fails.
//       MEASURED: 1 failure.
//   MUTATE=notifyinline     node api/_off-card.test.mjs
//       POST /api/action-items stops calling the extracted announcer, so the
//       cron's copy and the route's copy are free to drift apart.
//       MEASURED: 1 failure.
//   MUTATE=cronopen         node api/_off-card.test.mjs
//       the off-card cron loses its CRON_SECRET check, which would make a URL
//       that generates rows and fires Slack, push and SMS callable by anyone.
//       MEASURED: 2 failures.
//
// ELEVEN controls. A control run exits ZERO when the mutation IS caught.

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

const readSrc = (rel) => fs.readFileSync(path.join(HERE, rel), "utf8");
const readRepo = (...p) => fs.readFileSync(path.join(HERE, "..", ...p), "utf8");

// ── the module under test (real file, or a pinned mutant copy) ───────────────
const tmpFiles = [];
const cleanup = () => { for (const f of tmpFiles) { try { fs.unlinkSync(f); } catch (_) { /* best effort */ } } };
process.on("exit", cleanup);

function copyWith(edits) {
  let src = readSrc("_off-card.js");
  for (const [find, repl] of edits) {
    if (!src.includes(find)) {
      controlBroken = `MUTATE=${MUTATE} is pinned to text that is no longer in api/_off-card.js:\n\n${find}\n\nRe-point it or delete it - a pin that fails to apply looks exactly like a check that passed.`;
      throw new Error(controlBroken);
    }
    src = src.split(find).join(repl);
  }
  const copy = path.join(HERE, ".mutant-off-card.js");
  fs.writeFileSync(copy, src);
  tmpFiles.push(copy);
  return copy;
}

const MUTATIONS = {
  hardcodedterms: [[
    `  return resolveInterval({ billing_cadence: a.cadence ?? null }, a.term ?? null);`,
    `  // (control hardcodedterms) the closed 3/6-month world, back again
  const CLOSED = { "3_months": { interval: "month", interval_count: 3 }, "6_months": { interval: "month", interval_count: 6 } };
  return { ...(CLOSED[a.term] || { interval: "month", interval_count: 1 }), cadence: null, unknown_cadence: null };`,
  ]],
  stepfromlast: [[
    `  const stepped = addInterval(dateToUtc(arrangement.anchor_date), {
    interval: iv.interval,
    interval_count: (iv.interval_count || 1) * (n - 1),
  });
  return utcToDate(stepped);`,
    `  // (control stepfromlast) walk one period at a time from the previous due date
  let cur = dateToUtc(arrangement.anchor_date);
  for (let i = 1; i < n; i++) cur = addInterval(cur, { interval: iv.interval, interval_count: iv.interval_count || 1 });
  return utcToDate(cur);`,
  ]],
  leadignored: [[
    `    if (addDays(due, -lead) > today) break;`,
    `    if (due > today) break;   // (control leadignored) wait for the money, not the reminder`,
  ]],
  noend: [[
    `    if (end && due > end) break;`,
    `    if (false) break;   // (control noend) the commitment no longer bounds anything`,
  ]],
  uncapped: [[
    `  for (let guard = 0; guard < MAX_CATCH_UP; guard++) {`,
    `  for (let guard = 0; guard < 5000; guard++) {   // (control uncapped)`,
  ]],
  partialcloses: [[
    `  return { ok: true, status: "partial", remainder_cents: expected - collected, closes_item: false };`,
    `  return { ok: true, status: "paid", remainder_cents: 0, closes_item: true };   // (control partialcloses)`,
  ]],
  guardsilent: [[
    `  const sub = (member && member.stripe_subscription_id) || null;
  if (!sub) return null;`,
    `  const sub = null;   // (control guardsilent) stop looking at the subscription
  if (!sub) return null;`,
  ]],
  methodotherbare: [[
    `  if (method === "other" && !String(note || "").trim()) {`,
    `  if (false) {   // (control methodotherbare) "other" needs nothing`,
  ]],
};

let M;
{
  const target = MUTATIONS[MUTATE] ? copyWith(MUTATIONS[MUTATE]) : path.join(HERE, "_off-card.js");
  M = await import(pathToFileURL(target).href);
  console.log(MUTATIONS[MUTATE]
    ? `\n(running a MUTANT copy of api/_off-card.js: MUTATE=${MUTATE})`
    : "\n(running the real api/_off-card.js)");
}
const {
  resolveArrangementInterval, dueDateForPeriod, periodsDueAsOf, isOverdue,
  settleCollection, validateMethod, cadenceLabel, collectItemTitle,
  collectItemDescription, stopBillingItem, systemKeyForCollection,
  systemKeyForStopBilling, money, addDays, todayIso, MAX_CATCH_UP,
  COLLECTION_METHODS,
} = M;

// ── the sources the wiring pins read ─────────────────────────────────────────
let OFFCARD_SRC = readSrc("_off-card.js");
let MEMBERS_SRC = readSrc("members.js");
let ACTIONITEMS_SRC = readSrc("action-items.js");
const PORTAL_SRC = readRepo("public", "client-portal.html");
const VERCEL = readRepo("vercel.json");
const MIG_TABLES = readRepo("supabase", "migrations", "20260807T140000_off_card_billing.sql");
const MIG_KEY = readRepo("supabase", "migrations", "20260807T140100_action_items_system_key.sql");

// The three source-text controls, applied to the STRING the pins read.
function mutateSource(name, src, find, repl) {
  if (MUTATE !== name) return src;
  if (!src.includes(find)) {
    controlBroken = `MUTATE=${name} is pinned to text that is no longer present:\n\n${find}`;
    throw new Error(controlBroken);
  }
  return src.split(find).join(repl);
}
MEMBERS_SRC = mutateSource("emptystringkept", MEMBERS_SRC,
  `    updates[k] = (v === "" || v === undefined) ? null : v;`,
  `    updates[k] = v;   // (control emptystringkept)`);
MEMBERS_SRC = mutateSource("cronopen", MEMBERS_SRC,
  `  if (req.query.action === "cron-collect-off-card") {
    const got = (req.headers.authorization || "").replace(/^Bearer\\s+/i, "");
    const expected = process.env.CRON_SECRET;`,
  `  if (req.query.action === "cron-collect-off-card") {
    const got = "";   // (control cronopen) anybody may run it
    const expected = "";`);
ACTIONITEMS_SRC = mutateSource("notifyinline", ACTIONITEMS_SRC,
  `      await announceActionItem(clientId, item, { req, who });`,
  `      await postClientSlackNotification(clientId, \`ping \${title}\`, req);   // (control notifyinline)`);

const arr = (over = {}) => ({
  id: "arr-1", client_id: "c-1", member_id: "m-1",
  method: "cash", amount_cents: 19900, currency: "cad",
  term: "4_weeks", cadence: null, cadence_source: "plan",
  anchor_date: "2026-03-15", grace_days: 3, lead_days: 3,
  status: "active", commitment_end_date: null, ...over,
});
const daysBetween = (a, b) =>
  Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000);

// ═════════════════════════════════════════════════════════════════════════════
// 1. RULING D5: any commitment the academy priced, with no code change
// ═════════════════════════════════════════════════════════════════════════════
console.log("\n── 1. the due-date engine follows whatever was priced ──");
{
  // THE CASE THE RULING NAMES. A 9-month commitment. The term vocabulary was
  // CLOSED to monthly/3_months/6_months until 2026-08-06 and "1 year" produced
  // no key at all; off-card must consume the open vocabulary, not re-close it.
  const nine = arr({ term: "9_months", anchor_date: "2026-01-15" });
  const iv9 = resolveArrangementInterval(nine);
  ok(iv9.interval === "month" && iv9.interval_count === 9,
    `a 9-month commitment resolves to month x9 (got ${iv9.interval} x${iv9.interval_count})`);
  ok(dueDateForPeriod(nine, 1) === "2026-01-15", `period 1 IS the anchor (${dueDateForPeriod(nine, 1)})`);
  ok(dueDateForPeriod(nine, 2) === "2026-10-15", `period 2 is nine months on (${dueDateForPeriod(nine, 2)})`);
  ok(dueDateForPeriod(nine, 3) === "2027-07-15", `period 3 is eighteen months on (${dueDateForPeriod(nine, 3)})`);
  // Named explicitly, because this is the failure mode the ruling describes:
  // a 3/6 assumption would put period 2 in April or July.
  ok(dueDateForPeriod(nine, 2) !== "2026-04-15" && dueDateForPeriod(nine, 2) !== "2026-07-15",
    "and it is NOT what a hardcoded 3-month or 6-month assumption would give");

  // AND ONE DECLARED IN WEEKS. Production carries both notations for the same
  // thing (GTA "12 Weeks (3 Months)", San Jose "3 Months (12 Weeks)"), which is
  // why the cadence is DATA and not prose. A 12-week rhythm is 84 days, and 84
  // days is not 3 calendar months.
  const weeks = arr({ term: "3_months", cadence: "12_weeks", anchor_date: "2026-01-15" });
  const ivW = resolveArrangementInterval(weeks);
  ok(ivW.interval === "week" && ivW.interval_count === 12,
    `a commitment declared in weeks resolves to week x12 (got ${ivW.interval} x${ivW.interval_count})`);
  ok(daysBetween(weeks.anchor_date, dueDateForPeriod(weeks, 2)) === 84,
    `and period 2 is exactly 84 days on (${dueDateForPeriod(weeks, 2)})`);
  const asMonths = arr({ term: "3_months", anchor_date: "2026-01-15" });
  ok(dueDateForPeriod(weeks, 2) !== dueDateForPeriod(asMonths, 2),
    `12 weeks and 3 calendar months are genuinely different dates (${dueDateForPeriod(weeks, 2)} vs ${dueDateForPeriod(asMonths, 2)})`);

  // A 24-week prepay rung, and a long one nobody has priced yet.
  ok(daysBetween("2026-01-15", dueDateForPeriod(arr({ term: "6_months", cadence: "24_weeks", anchor_date: "2026-01-15" }), 2)) === 168,
    "a 24-week rung steps 168 days");
  const eighteen = arr({ term: "18_months", anchor_date: "2026-01-15" });
  ok(dueDateForPeriod(eighteen, 2) === "2027-07-15",
    `an 18-month commitment nobody has priced yet still works (${dueDateForPeriod(eighteen, 2)})`);
  const oneMonth = arr({ term: "1_months", anchor_date: "2026-01-15" });
  ok(dueDateForPeriod(oneMonth, 2) === "2026-02-15", "and so does a 1-month one");

  // The legacy shapes, unchanged: an unrecognised term still bills every 4 weeks,
  // which is what every live academy's monthly rows arrive as.
  ok(daysBetween("2026-03-15", dueDateForPeriod(arr(), 2)) === 28, "the 4-week default still steps 28 days");
  ok(daysBetween("2026-03-15", dueDateForPeriod(arr({ term: "monthly", cadence: "monthly" }), 2)) === 31,
    "true calendar monthly exists and is not the 4-week default");

  // THE STRUCTURAL HALF. Behaviour can be right by accident; this says the
  // engine physically has no arithmetic of its own to be right or wrong with.
  ok(/from "\.\/_billing-cadence\.js"/.test(OFFCARD_SRC),
    "_off-card.js gets its interval arithmetic by import, from the same module the card path charges on");
  ok(!/setUTCMonth|setUTCFullYear/.test(OFFCARD_SRC),
    "_off-card.js contains NO month or year arithmetic of its own - there is nothing here to fork");
  ok(!/["'](3|6)_months["']\s*:/.test(OFFCARD_SRC),
    "_off-card.js contains no map keyed by commitment length");
}

// ═════════════════════════════════════════════════════════════════════════════
// 2. due dates are measured from the anchor, so they cannot drift
// ═════════════════════════════════════════════════════════════════════════════
console.log("\n── 2. the 31st comes back ──");
{
  // A parent who pays on the 31st. JS month arithmetic CLAMPS, so Feb 31 lands
  // in March - that is unavoidable and both approaches show it. What separates
  // them is what happens NEXT: measured from the anchor the day of the month
  // returns, stepped from the last due date it never does.
  const a = arr({ term: "monthly", cadence: "monthly", anchor_date: "2026-01-31" });
  const dates = [1, 2, 3, 4, 5].map((n) => dueDateForPeriod(a, n));
  ok(dates[0] === "2026-01-31", `period 1 is the anchor (${dates[0]})`);
  ok(dates[2] === "2026-03-31", `period 3 is back on the 31st (${dates[2]}) - stepping from the previous date gives 2026-04-03`);
  ok(dates[4] === "2026-05-31", `period 5 is still on the 31st (${dates[4]}) - stepping gives 2026-06-03, and it never recovers`);
  console.log(`     (the five dates: ${dates.join(", ")})`);

  // A leap-year February, for the same reason.
  const feb = arr({ term: "monthly", cadence: "monthly", anchor_date: "2028-01-29" });
  ok(dueDateForPeriod(feb, 2) === "2028-02-29", `a Jan-29 anchor lands on Feb 29 in a leap year (${dueDateForPeriod(feb, 2)})`);
}

// ═════════════════════════════════════════════════════════════════════════════
// 3. which periods should exist right now
// ═════════════════════════════════════════════════════════════════════════════
console.log("\n── 3. a collection appears when its REMINDER is due, not its money ──");
{
  const TODAY = "2026-06-01";
  // The reminder leads by lead_days. A payment due in 10 days is not generated
  // yet; one due in 3 days is, because that is when the owner must be told.
  const far = arr({ anchor_date: addDays(TODAY, 10) });
  ok(periodsDueAsOf(far, { today: TODAY }).length === 0,
    "a payment due in 10 days with 3 days lead: nothing generated yet");
  const soon = arr({ anchor_date: addDays(TODAY, 3) });
  const soonRows = periodsDueAsOf(soon, { today: TODAY });
  ok(soonRows.length === 1 && soonRows[0].period_index === 1,
    `a payment due in 3 days: period 1 generated (${JSON.stringify(soonRows)})`);
  ok(periodsDueAsOf(arr({ anchor_date: addDays(TODAY, 4) }), { today: TODAY }).length === 0,
    "and one day earlier than that, still nothing - the boundary is exact");

  // A longer lead moves the boundary and nothing else.
  ok(periodsDueAsOf(arr({ anchor_date: addDays(TODAY, 10), lead_days: 10 }), { today: TODAY }).length === 1,
    "lead_days is honoured, not assumed: 10 days lead generates the 10-days-away period");

  // COMMITMENT END. Generation stops at the boundary. It does not renew, it does
  // not decide, it stops - and a human picks it up.
  const bounded = arr({ anchor_date: "2026-01-15", commitment_end_date: "2026-03-01" });
  const boundedRows = periodsDueAsOf(bounded, { today: TODAY });
  ok(boundedRows.every((r) => r.due_date <= "2026-03-01"),
    `nothing is generated past commitment_end_date (${boundedRows.map((r) => r.due_date).join(", ") || "none"})`);
  ok(boundedRows.length === 2 && boundedRows[1].due_date === "2026-02-12",
    `and the last one inside the commitment IS generated (${JSON.stringify(boundedRows.map((r) => r.due_date))})`);

  // PAUSED. A pause is a skip, not a forgiveness: nothing new is generated, and
  // what was already due is not touched here at all.
  ok(periodsDueAsOf(arr({ status: "paused", anchor_date: "2026-01-15" }), { today: TODAY }).length === 0,
    "a paused arrangement generates nothing");
  ok(periodsDueAsOf(arr({ status: "ended", anchor_date: "2026-01-15" }), { today: TODAY }).length === 0,
    "an ended one generates nothing");

  // THE CATCH-UP CEILING. An arrangement anchored years ago by a typo must not
  // mint a row and a Slack ping for every period since.
  const ancient = arr({ anchor_date: "2019-01-15" });
  const caught = periodsDueAsOf(ancient, { today: TODAY });
  ok(caught.length === MAX_CATCH_UP,
    `a 2019 anchor mints at most ${MAX_CATCH_UP} rows in one run (got ${caught.length}), so the mistake stays visible instead of exploding`);

  // RULING D4, AS AN ABSENCE. Two missed periods does NOTHING. The proof is
  // structural rather than behavioural: payment state is not an argument to this
  // function and cannot be. Generation continues so the debt stays visible.
  const resumed = periodsDueAsOf(ancient, { today: TODAY, highestExisting: 3 });
  ok(resumed.length > 0 && resumed[0].period_index === 4,
    `with periods 1-3 already existing and unpaid, generation continues at 4 (${resumed[0].period_index})`);
  ok(/periodsDueAsOf\(arrangement, \{ today: ocToday\(\), highestExisting: highest \}\)/.test(MEMBERS_SRC),
    "and the caller passes only the highest period index, never a paid/unpaid state");
  ok(!/status=(eq|in)\.\((?:[^)]*)\)&[^`]*order=period_index/.test(MEMBERS_SRC),
    "generateForArrangement's high-water read does not filter on status, so an unpaid period cannot stall it");
}

console.log("\n── 3b. late is due_date + grace_days, and lateness only re-pings ──");
{
  const a = arr({ grace_days: 3 });
  const due = { status: "due", due_date: "2026-06-01" };
  ok(isOverdue(due, a, "2026-06-03") === false, "3 days past due with 3 days grace: still 'due'");
  ok(isOverdue(due, a, "2026-06-04") === false, "on the grace boundary: still 'due'");
  ok(isOverdue(due, a, "2026-06-05") === true, "one day past the grace boundary: overdue");
  ok(isOverdue({ status: "partial", due_date: "2026-01-01" }, a, "2026-06-05") === false,
    "a PARTIAL is not swept into overdue by this - it is already open with a remainder");
  ok(isOverdue({ status: "paid", due_date: "2026-01-01" }, a, "2026-06-05") === false, "and a paid one never is");
  ok(isOverdue(due, arr({ grace_days: 0 }), "2026-06-02") === true, "grace_days is read per arrangement, not assumed");
}

// ═════════════════════════════════════════════════════════════════════════════
// 4. marking it collected
// ═════════════════════════════════════════════════════════════════════════════
console.log("\n── 4. a partial never auto-closes ──");
{
  const full = settleCollection({ expected_cents: 19900, collected_cents: 19900 });
  ok(full.status === "paid" && full.closes_item === true && full.remainder_cents === 0,
    `the whole amount closes it (${JSON.stringify(full)})`);

  const part = settleCollection({ expected_cents: 19900, collected_cents: 10000 });
  ok(part.status === "partial", `$100 against $199 is 'partial', not 'paid' (${part.status})`);
  ok(part.closes_item === false, "and it does NOT close the action item");
  ok(part.remainder_cents === 9900, `the remainder is carried, in cents (${part.remainder_cents})`);
  ok(collectItemTitle({ amount_cents: 19900, currency: "cad", parent_name: "Christy Hang", athlete_name: "Christopher", due_date: "2026-08-20", remainder_cents: part.remainder_cents })
    === "Collect the remaining $99.00 from Christy Hang (Christopher) - was due 2026-08-20",
    "and the open item's title says what is still owed");

  const over = settleCollection({ expected_cents: 19900, collected_cents: 25000 });
  ok(over.status === "paid" && over.remainder_cents === 0, "overpaying closes it, it does not go negative");

  const zero = settleCollection({ expected_cents: 19900, collected_cents: 0 });
  ok(zero.ok === false, `zero is refused rather than recorded as a partial of nothing (${zero.error || ""})`);
  ok(settleCollection({ expected_cents: 19900, collected_cents: -500 }).ok === false, "and so is a negative amount");
  ok(settleCollection({ expected_cents: 19900, collected_cents: "" }).ok === false, "and an empty box");

  const waived = settleCollection({ expected_cents: 19900, collected_cents: 0, waive: true });
  ok(waived.ok === true && waived.status === "waived" && waived.closes_item === true,
    "waiving is a deliberate separate act, and it closes without claiming money arrived");
}

console.log("\n── 4b. what the mark-collected endpoint records ──");
{
  // Source pins over api/members.js. Weak evidence, labeled: these live inside an
  // HTTP handler that cannot run without a database.
  ok(/case "mark-collected"|action === "mark-collected"/.test(MEMBERS_SRC), "mark-collected is a routed action");
  for (const field of ["amount_collected_cents", "collected_on", "method", "marked_by", "reference"]) {
    ok(new RegExp(`${field}`).test(MEMBERS_SRC), `it records ${field}`);
  }
  ok(/const collectedOn = ocIsDate\(b\.collected_on\) \? String\(b\.collected_on\)\.slice\(0, 10\) : ocToday\(\)/.test(MEMBERS_SRC),
    "collected_on defaults to today and is EDITABLE, because cash arrives late");
  ok(/collectedOn > ocToday\(\)/.test(MEMBERS_SRC), "but it cannot be in the future");
  ok(/action_type: "off-card-collected"/.test(MEMBERS_SRC), "and every marking writes a member_audit_log row");
  ok(/\["paid", "waived", "void"\]\.includes\(collection\.status\)/.test(MEMBERS_SRC),
    "a settled row is not editable - corrections are a new entry, never an edit-away");
  ok(/collection\.client_id !== member\.client_id \|\| collection\.member_id !== member\.id/.test(MEMBERS_SRC),
    "and the collection is scoped to the member being acted on, which is the only guard there is when the row has no FK");
  ok(/if \(settled\.closes_item\) \{/.test(MEMBERS_SRC) && /completed_at: nowIso\(\)/.test(MEMBERS_SRC),
    "the action item mirrors the collection: closed only when the collection closed");
}

// ═════════════════════════════════════════════════════════════════════════════
// 5. the double-billing guard
// ═════════════════════════════════════════════════════════════════════════════
console.log("\n── 5. off-card + a live Stripe sub raises stop-billing ──");
{
  const withSub = { id: "m-9", client_id: "c-1", athlete_name: "Christopher", parent_name: "Christy Hang", stripe_subscription_id: "sub_1TkPHlRxInSEtAh8eGtXUfri" };
  const item = stopBillingItem(withSub);
  ok(!!item, "a member with a live subscription raises an item");
  ok(item && item.system_key === "stop-billing:m-9",
    `and it is found by a TYPED key, not by matching its title text (${item && item.system_key})`);
  ok(item && item.description.includes("sub_1TkPHlRxInSEtAh8eGtXUfri"),
    "the description names the subscription id, because somebody has to go and cancel it");
  ok(item && /paying twice/.test(item.description), "and says plainly what goes wrong if nobody does");
  ok(item && /cancelled in Stripe directly/.test(item.description),
    "including the San Jose case, where every sub is foreign and the portal cannot touch it");

  ok(stopBillingItem({ id: "m-2", stripe_subscription_id: null }) === null,
    "a member with no subscription raises nothing");
  ok(stopBillingItem({ id: "m-3" }) === null, "and neither does one with no field at all");
  ok(systemKeyForStopBilling("x") === "stop-billing:x" && systemKeyForCollection("y") === "collect:y",
    "the two system keys are namespaced so they cannot collide");

  // BOTH DOORS. set-off-card is the front door; billing_mode is still in
  // PROFILE_EDITABLE_FIELDS, so the raw field write is the side door, and the
  // guard has to be on both or it can be walked past.
  ok(/const stopItem = await raiseStopBillingIfSubscribed\(member\);/.test(MEMBERS_SRC),
    "the deliberate endpoint checks it");
  ok(/if \(updates\.billing_mode === "alternate" && member\.billing_mode !== "alternate"\) \{\n\s*guardItem = await raiseStopBillingIfSubscribed\(member\);/.test(MEMBERS_SRC),
    "and so does the raw field write the drawer toggle still uses");
  ok(/"billing_mode",/.test(MEMBERS_SRC), "which is necessary, because billing_mode is still a directly editable profile field");
}

// ═════════════════════════════════════════════════════════════════════════════
// 6. the cron, and what extracting the notifier did and did not change
// ═════════════════════════════════════════════════════════════════════════════
console.log("\n── 6. a cron with no JWT can notify, and the authed route did not get weaker ──");
{
  ok(/export async function announceActionItem\(/.test(ACTIONITEMS_SRC),
    "the Slack + push + SMS block is now one exported function");
  ok(/await announceActionItem\(clientId, item, \{ req, who \}\)/.test(ACTIONITEMS_SRC),
    "POST /api/action-items CALLS it rather than carrying its own copy");
  const inlineSlack = (ACTIONITEMS_SRC.match(/📋 New action item/g) || []).length;
  ok(inlineSlack === 2,
    `and the announcement text exists in exactly one place, the function itself (${inlineSlack} occurrences, both inside it)`);

  // THE GATES ARE STILL IN FRONT OF IT. Extracting the announcement must not have
  // moved a single authorisation check.
  ok(/if \(!canAccess\(ctx, clientId\)\) return res\.status\(403\)/.test(ACTIONITEMS_SRC),
    "the authed POST still refuses an academy the caller cannot access");
  ok(/created_by: ctx\.user\.id,/.test(ACTIONITEMS_SRC),
    "and still stamps the real user id, so the route still requires a JWT");

  // The cron itself.
  ok(/req\.query\.action === "cron-collect-off-card"/.test(MEMBERS_SRC), "the cron is a routed action on api/members.js");
  // Read the cron's OWN block, not the whole file: the pause cron beside it has
  // an identical secret check, so a whole-file grep would pass on its strength
  // and this route could ship wide open.
  const cronBlock = (() => {
    const at = MEMBERS_SRC.indexOf('req.query.action === "cron-collect-off-card"');
    return at === -1 ? "" : MEMBERS_SRC.slice(at, at + 900);
  })();
  ok(/process\.env\.CRON_SECRET/.test(cronBlock),
    "the off-card cron's own block reads CRON_SECRET");
  ok(/req\.headers\.authorization/.test(cronBlock) && /timingSafeEqual\(gotBuf, expBuf\)/.test(cronBlock),
    "and compares the bearer against it in constant time, the same shape as the pause cron beside it");
  ok(/return res\.status\(401\)\.json\(\{ error: "unauthorized" \}\)/.test(cronBlock),
    "a wrong secret is 401, not a run - this URL generates rows and fires Slack, push and SMS");
  ok(MEMBERS_SRC.indexOf('req.query.action === "cron-collect-off-card"') < MEMBERS_SRC.indexOf("ctx = await resolveUser(req)"),
    "and it runs BEFORE the user resolver, because a cron has no user");
  ok(/"\/api\/members\?action=cron-collect-off-card"/.test(VERCEL), "vercel.json schedules it");
  ok(/created_by_role: "system"/.test(MEMBERS_SRC), "cron-created items declare themselves 'system', not a fake human");
  ok(/created_by: null,/.test(MEMBERS_SRC), "with no invented user id");
  ok(/isDuplicateErr\(e\)/.test(MEMBERS_SRC) && /23505\|duplicate key/.test(MEMBERS_SRC),
    "and both generators treat a unique-index collision as the expected case, not an error - the index IS the idempotency");
  ok(/if \(created && item\)/.test(MEMBERS_SRC),
    "so a losing race announces nothing, and the owner is not pinged twice for one collection");

  // The item is created at due - lead, which is the whole point of phase B.
  ok(/if \(ocAddDays\(c\.due_date, -lead\) > today\) continue;/.test(MEMBERS_SRC),
    "the item is created at due_date - lead_days, not when the collection row was generated");
}

// ═════════════════════════════════════════════════════════════════════════════
// 7. the schema says what the code assumes
// ═════════════════════════════════════════════════════════════════════════════
console.log("\n── 7. the migrations ──");
{
  ok(/CHECK \(billing_mode IS NULL OR billing_mode IN \('alternate', 'card'\)\)/.test(MIG_TABLES),
    "members.billing_mode admits NULL, 'alternate' and 'card', and nothing else");
  ok(!/'stripe'|''/.test(MIG_TABLES.slice(MIG_TABLES.indexOf("members_billing_mode_check"), MIG_TABLES.indexOf("members_staging"))),
    "the empty string is NOT admitted, which is what makes the \"\" -> null normalization load-bearing");
  ok(/members_staging_billing_mode_check/.test(MIG_TABLES),
    "and members_staging carries the same vocabulary, or the Sorter's promote could write a value members refuses");

  // THE NO-FK DECISION, and the comment that carries the reason forward.
  const collBlock = MIG_TABLES.slice(MIG_TABLES.indexOf("CREATE TABLE IF NOT EXISTS public.member_collections"));
  ok(/member_id      uuid,/.test(collBlock) && !/member_id[^\n]*REFERENCES public\.members/.test(collBlock),
    "member_collections carries NO foreign key to members");
  ok(/outlive the membership/.test(collBlock),
    "and says why, in the same words member_receipts uses: a record of money paid must outlive a deleted membership");
  ok(/deleted on cancellation/i.test(MIG_TABLES), "naming the actual mechanism - member rows are DELETED, not archived");
  ok(/arrangement_id uuid NOT NULL REFERENCES public\.member_billing_arrangements\(id\),/.test(collBlock),
    "the arrangement link is a plain FK with no cascade, so a delete is refused rather than erasing a payment history");

  ok(/CREATE UNIQUE INDEX IF NOT EXISTS member_collections_period_uk[\s\S]*?\(arrangement_id, period_index\)/.test(MIG_TABLES),
    "one row per period, enforced by the database");
  ok(/member_billing_arrangements_live_uk[\s\S]*?WHERE status IN \('active','paused'\)/.test(MIG_TABLES),
    "one live arrangement per member, so nobody gets chased twice for the same money");
  ok(/CHECK \(method <> 'other' OR COALESCE\(btrim\(method_note\), ''\) <> ''\)/.test(MIG_TABLES),
    "and 'other' cannot be bare in the database either, not just in the API");

  ok(/ADD COLUMN IF NOT EXISTS system_key text/.test(MIG_KEY), "action_items gains system_key");
  ok(/CREATE UNIQUE INDEX IF NOT EXISTS action_items_client_system_key_uk[\s\S]*?\(client_id, system_key\)/.test(MIG_KEY),
    "with the unique index that makes a system-created item idempotent");
  ok(/CHECK \(created_by_role IS NULL OR created_by_role IN \('client','staff','system'\)\)/.test(MIG_KEY),
    "and created_by_role is widened to admit 'system', not dropped");
  ok(/title=ilike/.test(MIG_KEY), "the migration names the title-matching precedent it exists to replace");
  ok(/title=ilike\.\*Cancel%20old%20Stripe%20sub\*/.test(MEMBERS_SRC),
    "and that old path is deliberately still in place - this pass makes the NEW one correct, it does not rip out the old one");
}

// ═════════════════════════════════════════════════════════════════════════════
// 8. the copy, and the empty-string normalization it depends on
// ═════════════════════════════════════════════════════════════════════════════
console.log("\n── 8. what a human reads ──");
{
  // Written to survive a stop-billing item that came back null: under
  // MUTATE=guardsilent it does, and this section must still REPORT rather than
  // crash - a suite that throws prints no verdict at all.
  const stopSpec = stopBillingItem({ id: "m-1", athlete_name: "A", parent_name: "P", stripe_subscription_id: "sub_x" }) || {};
  const strings = [
    collectItemTitle({ amount_cents: 19900, currency: "cad", parent_name: "Christy Hang", athlete_name: "Christopher", due_date: "2026-08-20" }),
    collectItemTitle({ amount_cents: 8500, currency: "cad", parent_name: null, athlete_name: null, due_date: "2026-08-20", remainder_cents: 2500 }),
    collectItemDescription({ method: "e_transfer", method_note: null, collector_name: "Lij", cadence_label: "every 4 weeks" }),
    collectItemDescription({ method: "other", method_note: "drops it at the gym", collector_name: null, cadence_label: null }),
    stopSpec.title || "",
    stopSpec.description || "",
    settleCollection({ expected_cents: 100, collected_cents: 0 }).error,
    validateMethod("other", "").error,
    validateMethod("bitcoin", "").error,
  ];
  ok(strings.every((s) => typeof s === "string" && !s.includes("—")),
    "no em dash reaches an owner, in any string this module can emit");
  ok(strings.every((s) => !/[\u{1F300}-\u{1FAFF}☀-➿]/u.test(s)), "and no emoji");
  // Nothing may claim the money already moved. Narrow on purpose: the copy is
  // ALLOWED to say "nothing is charged automatically" and "they are being charged
  // by Stripe", because both are true and both are the point. What it may never
  // say is that WE took this payment.
  ok(!strings.some((s) => /we (charged|billed|took)|payment received|has been (charged|paid)|charged (you|them|their card)/i.test(s)),
    "and nothing claims we took the money - we did not, somebody has to go and collect it");
  ok(strings.some((s) => /nothing is charged automatically/.test(s)),
    "the reminder says the opposite out loud, so an owner cannot assume the portal handled it");
  ok(collectItemTitle({ amount_cents: 19900, currency: "cad", parent_name: "Christy Hang", athlete_name: "Christopher", due_date: "2026-08-20" })
    === "Collect $199.00 from Christy Hang (Christopher) - due 2026-08-20",
    "the title names the amount, the parent, the athlete and the date");
  ok(money(19900) === "$199.00" && money(19900, "usd") === "$199.00 USD", "money renders the currency when it is not the default");
  ok(cadenceLabel(arr({ term: "9_months" })) === "every 9 months", "the rhythm is described in plain English, derived and never stored");
  ok(cadenceLabel(arr({ term: "3_months", cadence: "12_weeks" })) === "every 12 weeks",
    "and a weeks-declared commitment says weeks, so the owner reads what actually happens");

  const bare = validateMethod("other", "  ");
  ok(bare.ok === false, `"other" with a blank follow-up is refused (${bare.error || ""})`);
  ok(validateMethod("other", "drops it at the gym").ok === true, "with a real follow-up it is accepted");
  ok(COLLECTION_METHODS.every((m) => validateMethod(m, "x").ok), "every method in the vocabulary validates");
  ok(validateMethod("venmo", "x").ok === false, "and one outside it does not");

  // THE NORMALIZATION. Three facts that only matter together: billing_mode is
  // STILL a directly editable profile field, the drawer's generic field editor
  // passes a <select>'s value straight through and an empty option sends "", and
  // the new CHECK constraint refuses "". This one line is what stands between
  // those three and a 400 nobody can explain. The drawer's own toggle no longer
  // takes that path (it routes through end-off-card), but every other caller of
  // update-profile still can.
  ok(/"billing_mode",/.test(MEMBERS_SRC),
    "billing_mode is still in PROFILE_EDITABLE_FIELDS, so a raw \"\" write is still reachable");
  ok(/_memberUpdateField\('\$\{m\.id\}','\$\{field\}',this\.value\)/.test(PORTAL_SRC),
    "and the drawer's generic field editor passes a select value through unchanged (weak evidence: source text)");
  ok(/updates\[k\] = \(v === "" \|\| v === undefined\) \? null : v;/.test(MEMBERS_SRC),
    "so update-profile normalizing \"\" to null before the write is what the new CHECK constraint makes load-bearing");
}

// ═════════════════════════════════════════════════════════════════════════════
// 9. the portal hook, and ruling D2
// ═════════════════════════════════════════════════════════════════════════════
// Source text only, and that is weak evidence: there is no DOM here. It is still
// the difference between someone noticing these lines going and nobody noticing.
console.log("\n── 9. the drawer, and who owns the reminder ──");
{
  ok(/id="member-offcard-section"/.test(PORTAL_SRC), "the drawer has a place for the arrangement and the ledger");
  ok(/_loadMemberOffCard\(m\);/.test(PORTAL_SRC), "and loads it when a member is opened");
  ok(/action=off-card&member_id=/.test(PORTAL_SRC), "reading it through the scoped GET");
  ok(/'mark-collected', \{[\s\S]{0,220}amount_collected_cents/.test(PORTAL_SRC),
    "Mark collected sends the amount that actually came in");
  ok(/collected_on: on, method: how, reference: ref/.test(PORTAL_SRC), "plus the date, the method and the reference");
  ok(/max="\$\{_ocTodayIso\(\)\}"/.test(PORTAL_SRC), "the date box cannot be set in the future");
  ok(/Change it if the money came in earlier than today/.test(PORTAL_SRC),
    "and says out loud that it is editable, because cash arrives late");
  ok(/r && r\.remainder_cents > 0[\s\S]{0,140}still owed/.test(PORTAL_SRC),
    "a partial is REPORTED as a partial - 'Recorded.' on its own is how somebody walks away believing it is settled");

  // The toggle no longer writes the raw field. That write set a claim and created
  // nothing to collect, which is what made the flag decorative in the first place.
  ok(/_mEndOffCard\('\$\{m\.id\}'\)/.test(PORTAL_SRC) && /_mSetOffCard\('\$\{m\.id\}'\)/.test(PORTAL_SRC),
    "the drawer toggle routes through the endpoints, not through a raw billing_mode write");
  ok(!/_memberUpdateField\('\$\{m\.id\}','billing_mode','alternate'\)/.test(PORTAL_SRC),
    "and the old raw-write button is gone from the drawer");
  ok(/there is no payment arrangement set up, so nothing is due and no reminder will ever be sent/.test(PORTAL_SRC),
    "a flag with no arrangement SAYS it will never remind anyone, rather than looking configured");
  ok(/Nothing is charged automatically\. Somebody has to collect it\./.test(PORTAL_SRC),
    "and the panel repeats what the portal cannot do");

  // RULING D2: owner by DEFAULT, reassignable. The default is in the cron
  // (loadOwnerAssignee); the reassignment is the action-item edit modal that
  // already exists, which is why no new control was built for it.
  ok(/role=eq\.owner&status=eq\.active/.test(MEMBERS_SRC),
    "the reminder defaults to the academy OWNER");
  ok(/const assignee = named \|\| \(await loadOwnerAssignee\(a\.client_id\)\);/.test(MEMBERS_SRC),
    "and a named collector is the delegation, not the default");
  ok(/assignee_id: document\.getElementById\('aiAssignee'\)\.value \|\| null/.test(PORTAL_SRC),
    "reassigning it is the action-item modal that already exists, so no second control was invented");
  ok(/notifyOwners\(clientId, "action_item"/.test(ACTIONITEMS_SRC),
    "and the owner is texted regardless of who it is assigned to, so delegation never cuts them out");
}

// ─── report ──────────────────────────────────────────────────────────────────
cleanup();
console.log("");
if (MUTATE) {
  if (controlBroken) { console.log(`❌ NEGATIVE CONTROL FAILED: ${controlBroken}`); process.exit(1); }
  const caught = fail > 0;
  console.log(caught
    ? `✅ NEGATIVE CONTROL PASSED: MUTATE=${MUTATE} was caught by ${fail} assertion(s):\n   - ${failures.slice(0, 5).join("\n   - ")}`
    : `❌ NEGATIVE CONTROL FAILED: MUTATE=${MUTATE} broke a real guarantee and every assertion still passed. That check is decorative.`);
  process.exit(caught ? 0 : 1);
}
console.log(fail ? `❌ ${pass} passed, ${fail} failed.` : `✅ ${pass} passed, 0 failed.`);
process.exit(fail ? 1 : 0);
