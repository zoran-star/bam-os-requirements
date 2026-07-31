// Plain-node test for the slot auto-extend window planner
// (api/schedule/_extend-windows.js). No deps, no network, no DB:
//
//   node scripts/extend-windows.test.mjs
//
// Covers: (a) healthy coverage plans zero windows, (b) BAM GTA's real shape
// (32 days left as of 2026-07-31) plans windows reaching exactly 90 days out
// with every window inside generate-slots' 92-day inclusive cap, and (c) a
// negative control: a deliberately broken 93-day-inclusive window must be
// rejected by the validator. Exits nonzero on any failure.

import {
  planExtensionWindows, validateWindow, spanInclusiveDays, addDays, daysOut,
  MAX_GENERATION_DAYS, MIN_COVERAGE_DAYS, TARGET_COVERAGE_DAYS,
} from "../api/schedule/_extend-windows.js";

let failed = 0;
function check(name, ok, detail) {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` (${detail})` : ""}`);
  if (!ok) failed += 1;
}

const TODAY = "2026-07-31";

// (a) coverage already at or beyond MIN_COVERAGE_DAYS -> zero windows
{
  for (const days of [MIN_COVERAGE_DAYS, 75, 365]) {
    const { days_before, windows } = planExtensionWindows({ today: TODAY, coverageEnd: addDays(TODAY, days) });
    check(`healthy coverage (${days} days) plans zero windows`, windows.length === 0, `days_before=${days_before}`);
    check(`healthy coverage (${days} days) reports days_before correctly`, days_before === days);
  }
}

// (b) GTA's real shape: coverage ends 2026-09-01, 32 days out from 2026-07-31
{
  const coverageEnd = "2026-09-01";
  check("GTA fixture is 32 days out", daysOut(TODAY, coverageEnd) === 32);
  const { days_before, windows } = planExtensionWindows({ today: TODAY, coverageEnd });
  check("GTA shape (32 days left) plans at least one window", windows.length > 0, JSON.stringify(windows));
  check("GTA shape reports days_before=32", days_before === 32);
  check("first window starts the day AFTER current coverage ends", windows[0]?.date_from === addDays(coverageEnd, 1), `got ${windows[0]?.date_from}`);
  const last = windows[windows.length - 1];
  check(`windows reach exactly ${TARGET_COVERAGE_DAYS} days out`, last?.date_to === addDays(TODAY, TARGET_COVERAGE_DAYS), `got ${last?.date_to}, want ${addDays(TODAY, TARGET_COVERAGE_DAYS)}`);
  let contiguous = true, allCapped = true, allValid = true;
  for (let i = 0; i < windows.length; i++) {
    const w = windows[i];
    if (spanInclusiveDays(w.date_from, w.date_to) > MAX_GENERATION_DAYS) allCapped = false;
    if (validateWindow(w) !== null) allValid = false;
    if (i > 0 && w.date_from !== addDays(windows[i - 1].date_to, 1)) contiguous = false;
  }
  check(`every window spans at most ${MAX_GENERATION_DAYS} days inclusive`, allCapped);
  check("every window passes validateWindow", allValid);
  check("windows are contiguous with no gaps or overlap", contiguous);
}

// (b2) no coverage at all: start today, still reach 90 out, still capped
{
  const { days_before, windows } = planExtensionWindows({ today: TODAY, coverageEnd: null });
  check("no coverage reports days_before=null", days_before === null);
  check("no coverage starts today", windows[0]?.date_from === TODAY, `got ${windows[0]?.date_from}`);
  check("no coverage still reaches 90 days out", windows[windows.length - 1]?.date_to === addDays(TODAY, TARGET_COVERAGE_DAYS));
  check("no coverage windows all inside the 92-day cap", windows.every(w => validateWindow(w) === null));
}

// (b3) lapsed coverage (last slot in the past): never start before today
{
  const { windows } = planExtensionWindows({ today: TODAY, coverageEnd: "2026-06-01" });
  check("lapsed coverage starts today, never in the past", windows[0]?.date_from === TODAY, `got ${windows[0]?.date_from}`);
}

// (c) NEGATIVE CONTROL: a 93-day-inclusive window must be rejected
{
  const broken = { date_from: TODAY, date_to: addDays(TODAY, MAX_GENERATION_DAYS) }; // from+92 spans 93 inclusive
  const span = spanInclusiveDays(broken.date_from, broken.date_to);
  check("negative-control fixture really spans 93 days inclusive", span === 93, `span=${span}`);
  const err = validateWindow(broken);
  check("negative control: 93-day-inclusive window is rejected by the validator", err !== null, err || "validator accepted it");
  if (err !== null && span === 93) console.log("NEGATIVE CONTROL PASSED: the validator rejects a 93-day-inclusive window");
}

console.log(failed === 0 ? "\nALL CHECKS PASSED" : `\n${failed} CHECK(S) FAILED`);
process.exit(failed === 0 ? 0 : 1);
