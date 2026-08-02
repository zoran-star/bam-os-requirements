// LAST MONTH'S GROSS REVENUE: the Commissions page column, and why it is a
// different window from a billing cycle.
//
//   node api/_commission-monthly-revenue.test.mjs
//
// WHAT THIS IS ABOUT.
// The Commissions page showed a "Last cycle" column and nothing else, so the
// number Zoran actually wanted - each academy's gross revenue for last month -
// was not on the page at any point. It could not simply be read off the stored
// cycles either, for three separate reasons that all had to be fixed at once:
//
//   1. A CYCLE IS NOT A MONTH. closeCycle() windows renewal-date to renewal-date
//      (a Jul 25 signup runs Jul 25 -> Aug 25). "Last month's revenue" means the
//      calendar month, which is what an academy owner sees in their own Stripe
//      dashboard. Reporting a renewal window under a month's name would print a
//      number that disagrees with the client's own screen and be very hard to
//      argue with later.
//   2. A CYCLE ONLY EXISTS ON ONE DAY A MONTH, and only for a client whose
//      payment_model and subscription_renewal_date an admin already typed in.
//      Everyone else has no row, so there is nothing to show.
//   3. FLAT-RETAINER CLIENTS NEVER GET A PULL AT ALL - closeCycle skips the
//      Stripe read for them by design, storing gross_revenue: null.
//
// So the column reads Stripe live over calendar-month windows, independent of
// the cycle engine. That is what this suite pins.
//
// WHAT IT PROVES
//   1. THE WINDOW. lastCompletedMonthStart never returns the month in progress
//      (a half-finished month reported as "last month's revenue" is a wrong
//      number, not a partial one), and the pull window is [1st, next 1st) -
//      crossing a year boundary, out of a 31-day month, and out of February.
//   2. THE WINDOW IS NOT THE CYCLE WINDOW. Same client, same date, the two
//      windows are computed here side by side and asserted DIFFERENT for a
//      mid-month renewal. If someone later "simplifies" the column onto
//      addMonthsClamped(cycleDate, -1), this fails.
//   3. ONE BROKEN ACADEMY CANNOT BLANK THE COLUMN. grossForMonth never throws,
//      for any failure mode, so the Promise.all fan-out over every client
//      always resolves. This is the property the whole column rests on: with
//      ~47 clients and a handful connected, throwing was the default outcome.
//   4. MISSING IS TOLD APART FROM ZERO. A not-connected academy reports
//      "not_connected", a broken one reports "failed" and carries the reason. A
//      dash that reads as $0 is the failure mode this exists to prevent - a
//      real $0 month and an unlinked Stripe must never look the same.
//   5. THE CACHE CANNOT PIN A FAILURE. ok and not_connected cache; failed does
//      NOT, so a transient Stripe outage retries on the next page load instead
//      of sticking for six hours. Also: a completed month's raw charge total is
//      immutable, which is the only reason caching it at all is safe.
//   6. THE KEY GUARD MATCHES THE SEAM. stripeGetAll routes through
//      _stripe-transport.js, which reads STRIPE_CONNECT_SECRET_KEY ||
//      STRIPE_SECRET_KEY. The guard used to demand STRIPE_SECRET_KEY alone, so
//      a prod holding only the Connect key would have failed EVERY revenue read
//      while every other Stripe feature kept working. The two are compared.
//
// WHAT IT DOES NOT PROVE
//   - That any academy's Stripe is actually connected. That is an OAuth click
//     the academy owner makes in their own portal, and no test can stand in for
//     it. An unconnected academy renders "not connected" by design, which is
//     the honest answer, not a bug.
//   - That the dollar figures are right. This suite never reaches Stripe; it
//     pins the WINDOW and the FAILURE BEHAVIOR, and stubs the pull.
//   - That the column renders. src/views/CommissionsView.jsx is not exercised.
//
// HOW IT RUNS. No node_modules: api/commissions.js pulls _email.js and a PDF
// renderer through its imports, and a suite that needs an install is one the
// plain-node step cannot run. The functions are CUT OUT of the shipped file by
// their own declaration lines and imported as a temp module, so what executes
// below is the shipped code byte for byte. If a declaration is renamed the cut
// fails loudly rather than passing against nothing.

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import assert from "node:assert/strict";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = fs.readFileSync(path.join(HERE, "commissions.js"), "utf8");
const TRANSPORT = fs.readFileSync(path.join(HERE, "_stripe-transport.js"), "utf8");

function cut(pin) {
  const at = SRC.indexOf(pin);
  if (at === -1) {
    throw new Error(
      `This suite is pinned to text that is no longer in api/commissions.js:\n\n  ${pin}\n\n` +
      `The code it was written against has moved or been renamed, so it proves nothing. Re-point it, or delete it.`
    );
  }
  let i = SRC.indexOf("{", at), depth = 0;
  for (; i < SRC.length; i++) {
    if (SRC[i] === "{") depth++;
    else if (SRC[i] === "}") { depth--; if (depth === 0) return SRC.slice(at, i + 1) + ";\n"; }
  }
  throw new Error(`unbalanced braces after ${pin} in api/commissions.js`);
}

// The shipped date + month helpers, the cache constants, and grossForMonth,
// with pullGrossRevenue swapped for a controllable stub.
const MODULE = `
${cut("function parseYMD(")}
${cut("function ymd(")}
${cut("function daysInMonth(")}
${cut("function addMonthsClamped(")}
${cut("function monthStartOf(")}
${cut("function lastCompletedMonthStart(")}
${cut("function completedMonthsBack(")}
${cut("function revenueSourceOf(")}
${SRC.match(/const REVENUE_CACHE_TTL_MS = [^;]+;/)[0]}
${SRC.match(/const monthRevenueCache = new Map\(\);/)[0]}

export let PULLS = [];
export let pullImpl = async () => 0;
export function setPull(fn) { pullImpl = fn; }
export function resetPulls() { PULLS = []; }
async function pullGrossRevenue(client, startStr, endStr) {
  PULLS.push({ client: client.id, start: startStr, end: endStr });
  return pullImpl(client, startStr, endStr);
}
${cut("async function grossForMonth(")}
export { addMonthsClamped, monthStartOf, lastCompletedMonthStart, completedMonthsBack, grossForMonth, revenueSourceOf, monthRevenueCache, REVENUE_CACHE_TTL_MS };
`;

const TMP = path.join(os.tmpdir(), `bam-monthly-rev-${process.pid}.mjs`);
fs.writeFileSync(TMP, MODULE);
let M;
try { M = await import(pathToFileURL(TMP).href); }
finally { fs.unlinkSync(TMP); }

let pass = 0;
const fails = [];
function check(name, fn) {
  try { fn(); pass++; }
  catch (e) { fails.push(`${name}\n    ${e.message.split("\n")[0]}`); }
}
async function checkAsync(name, fn) {
  try { await fn(); pass++; }
  catch (e) { fails.push(`${name}\n    ${e.message.split("\n")[0]}`); }
}

// ── 1. THE WINDOW ──────────────────────────────────────────────────────────
// The month in progress is never reported. On the 1st, on the 31st, and on any
// day between, "last month" is the same fully-closed month.
check("1a. the month in progress is never 'last month'", () => {
  for (const day of ["2026-08-01", "2026-08-02", "2026-08-15", "2026-08-31"]) {
    assert.equal(M.lastCompletedMonthStart(day), "2026-07-01", `on ${day}`);
  }
});

check("1b. January looks back into the previous YEAR", () => {
  assert.equal(M.lastCompletedMonthStart("2026-01-01"), "2025-12-01");
  assert.equal(M.lastCompletedMonthStart("2026-01-31"), "2025-12-01");
});

check("1c. the window is [1st, next 1st) across short and long months", () => {
  // February out of a 31-day March, and February in a leap year: the window
  // must land on the 1st both ways round, never on the 28th/29th/31st.
  const cases = [
    ["2026-01-01", "2026-02-01"],
    ["2026-02-01", "2026-03-01"],
    ["2024-02-01", "2024-03-01"], // leap
    ["2026-07-01", "2026-08-01"],
    ["2026-12-01", "2027-01-01"], // year rollover
  ];
  for (const [start, end] of cases) {
    assert.equal(M.addMonthsClamped(start, 1), end, `${start} + 1 month`);
  }
});

check("1d. the drilldown walks back N months, newest first, no gaps or repeats", () => {
  const got = M.completedMonthsBack("2026-01-01", 14);
  assert.equal(got[0], "2026-01-01");
  assert.equal(got[13], "2024-12-01");
  assert.equal(new Set(got).size, 14, "months repeat");
  for (let i = 1; i < got.length; i++) {
    assert.equal(M.addMonthsClamped(got[i], 1), got[i - 1], `gap before ${got[i - 1]}`);
  }
});

// ── 2. THE WINDOW IS NOT THE CYCLE WINDOW ──────────────────────────────────
check("2. a calendar month is not the billing cycle's window", () => {
  // closeCycle's window, straight from the shipped line, for a Jul 25 renewal.
  assert.ok(SRC.includes("const cycleStart = addMonthsClamped(cycleDate, -1);"),
    "closeCycle no longer computes cycleStart the way this test assumes");
  const cycleDate = "2026-07-25";
  const cycleStart = M.addMonthsClamped(cycleDate, -1);
  assert.equal(cycleStart, "2026-06-25");

  const monthStart = M.lastCompletedMonthStart("2026-08-02");
  const monthEnd = M.addMonthsClamped(monthStart, 1);
  assert.equal(monthStart, "2026-07-01");
  assert.equal(monthEnd, "2026-08-01");

  assert.notEqual(cycleStart, monthStart, "cycle start collapsed onto the month start");
  assert.notEqual(cycleDate, monthEnd, "cycle end collapsed onto the month end");
});

// ── 3 + 4. ONE BROKEN ACADEMY CANNOT BLANK THE COLUMN ──────────────────────
const connected = { id: "c-connected", stripe_connect_account_id: "acct_live" };
const viaField = { id: "c-field", revenue_integration_connection: "stripe_connect" };
const unlinked = { id: "c-unlinked" };

await checkAsync("3a. a Stripe failure resolves, it does not throw", async () => {
  M.monthRevenueCache.clear();
  M.setPull(async () => { throw new Error("Stripe 403: not authorized on acct_live"); });
  const r = await M.grossForMonth(connected, "2026-07-01");
  assert.equal(r.status, "failed");
  assert.match(r.error, /403/);
  assert.equal(r.gross, null, "a failed pull must not invent a number");
});

await checkAsync("3b. the whole-column fan-out survives a mix of good and broken", async () => {
  M.monthRevenueCache.clear();
  M.setPull(async (c) => {
    if (c.id === "c-connected") return 12345.67;
    throw new Error("boom");
  });
  const rows = await Promise.all(
    [connected, viaField, unlinked].map(c => M.grossForMonth(c, "2026-07-01").then(r => ({ client_id: c.id, ...r })))
  );
  assert.equal(rows.length, 3);
  assert.equal(rows[0].status, "ok");
  assert.equal(rows[0].gross, 12345.67);
  assert.equal(rows[1].status, "failed");
  assert.equal(rows[2].status, "not_connected");
});

await checkAsync("4a. an unlinked academy says so and never touches Stripe", async () => {
  M.monthRevenueCache.clear();
  M.resetPulls();
  M.setPull(async () => { throw new Error("should never be called"); });
  const r = await M.grossForMonth(unlinked, "2026-07-01");
  assert.equal(r.status, "not_connected");
  assert.equal(r.error, null);
  assert.equal(M.PULLS.length, 0, "called Stripe for a client with no revenue source");
});

await checkAsync("4b. a real $0 month is NOT the same as a missing one", async () => {
  M.monthRevenueCache.clear();
  M.setPull(async () => 0);
  const zero = await M.grossForMonth(connected, "2026-07-01");
  assert.equal(zero.status, "ok");
  assert.equal(zero.gross, 0, "a genuine zero must survive as a number");

  M.monthRevenueCache.clear();
  const missing = await M.grossForMonth(unlinked, "2026-07-01");
  assert.notEqual(missing.status, zero.status);
  assert.equal(missing.gross, null);
});

await checkAsync("4c. the pull is handed the calendar-month window, not a cycle window", async () => {
  M.monthRevenueCache.clear();
  M.resetPulls();
  M.setPull(async () => 500);
  await M.grossForMonth(connected, "2026-07-01");
  assert.deepEqual(M.PULLS[0], { client: "c-connected", start: "2026-07-01", end: "2026-08-01" });
});

// ── 5. THE CACHE CANNOT PIN A FAILURE ──────────────────────────────────────
await checkAsync("5a. a failure is never cached - the next load retries", async () => {
  M.monthRevenueCache.clear();
  M.resetPulls();
  M.setPull(async () => { throw new Error("transient"); });
  await M.grossForMonth(connected, "2026-07-01");
  await M.grossForMonth(connected, "2026-07-01");
  assert.equal(M.PULLS.length, 2, "a failed pull was cached and never retried");

  M.setPull(async () => 999);
  const recovered = await M.grossForMonth(connected, "2026-07-01");
  assert.equal(recovered.status, "ok", "Stripe recovered but the cache held the failure");
  assert.equal(recovered.gross, 999);
});

await checkAsync("5b. a good answer IS cached, per client and per month", async () => {
  M.monthRevenueCache.clear();
  M.resetPulls();
  M.setPull(async () => 100);
  await M.grossForMonth(connected, "2026-07-01");
  await M.grossForMonth(connected, "2026-07-01");
  assert.equal(M.PULLS.length, 1, "cache did not hold a successful month");

  await M.grossForMonth(connected, "2026-06-01");
  assert.equal(M.PULLS.length, 2, "a different month must be its own cache entry");
  await M.grossForMonth(viaField, "2026-07-01");
  assert.equal(M.PULLS.length, 3, "a different client must be its own cache entry");
});

check("5c. the cache TTL is bounded, and only completed months are cacheable", () => {
  assert.ok(M.REVENUE_CACHE_TTL_MS > 0 && M.REVENUE_CACHE_TTL_MS <= 24 * 60 * 60 * 1000,
    "TTL outside a sane range - a stale figure would outlive the day it was read");
  // The safety argument for caching at all: the endpoint only ever asks for
  // months that have already ended, whose raw charge totals cannot change.
  assert.ok(SRC.includes("lastCompletedMonthStart(todayET())"),
    "the endpoint no longer starts from the last COMPLETED month, so caching is no longer safe");
});

// ── 6. THE KEY GUARD MATCHES THE SEAM ──────────────────────────────────────
check("6. the revenue read guards the key the transport actually uses", () => {
  const seam = TRANSPORT.match(/function platformKey\(\)\s*\{[^}]*\}/)[0];
  const usesConnect = seam.includes("STRIPE_CONNECT_SECRET_KEY");
  const usesPlain = seam.includes("STRIPE_SECRET_KEY");
  assert.ok(usesConnect && usesPlain, "the seam's key resolution changed shape");

  const guard = SRC.slice(SRC.indexOf("async function stripeGetAll("));
  const body = guard.slice(0, guard.indexOf("const out = []"));
  assert.ok(body.includes("STRIPE_CONNECT_SECRET_KEY"),
    "stripeGetAll does not accept STRIPE_CONNECT_SECRET_KEY, so a Connect-key-only prod " +
    "fails every revenue read while every other Stripe feature keeps working");
  assert.ok(body.includes("STRIPE_SECRET_KEY"),
    "stripeGetAll no longer accepts STRIPE_SECRET_KEY, breaking today's prod");
});

// ── report ─────────────────────────────────────────────────────────────────
if (fails.length) {
  console.error(`\n  ${fails.length} FAILED, ${pass} passed\n`);
  fails.forEach(f => console.error(`  x ${f}\n`));
  process.exit(1);
}
console.log(`  ${pass} passed - last month's gross revenue: window, failure behavior, cache, key guard`);
