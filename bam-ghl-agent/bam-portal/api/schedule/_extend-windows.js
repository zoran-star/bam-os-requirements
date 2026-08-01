// Pure window-planning for slot auto-extension (no DB, no fetch - so
// scripts/extend-windows.test.mjs can exercise it with plain node).
//
// generate-slots validates the INCLUSIVE span (daySpanInclusive counts both
// endpoints, api/runtime/schedule/_shared.ts), so a valid window ends at most
// from+91 days - ending at from+92 spans 93 and fails validation (the same
// off-by-one documented in sync-offer.js step 4).
//
// Policy: if an academy's coverage ends less than MIN_COVERAGE_DAYS out,
// extend it to TARGET_COVERAGE_DAYS out, starting the day AFTER current
// coverage ends (never before today - generate-slots upserts, so overlap is
// merely wasted work, but the windows should not ask for it).

export const MAX_GENERATION_DAYS = 92;   // generate-slots hard cap, inclusive
export const MIN_COVERAGE_DAYS = 60;     // below this the cron extends
export const TARGET_COVERAGE_DAYS = 90;  // extend out to today + this
export const ALERT_BELOW_DAYS = 30;      // still below this AFTER extending -> Slack

const DAY_MS = 86400000;
const toMs = (ymdStr) => Date.parse(`${ymdStr}T00:00:00Z`);
export const msToYmd = (ms) => new Date(ms).toISOString().slice(0, 10);
export const addDays = (ymdStr, n) => msToYmd(toMs(ymdStr) + n * DAY_MS);

// Both endpoints count: from == to spans 1 day.
export const spanInclusiveDays = (from, to) => Math.round((toMs(to) - toMs(from)) / DAY_MS) + 1;

// Returns null when the window is safe to send to generate-slots, else a
// human-readable reason it would be rejected.
export function validateWindow(w) {
  if (!w || !w.date_from || !w.date_to) return "window missing date_from/date_to";
  if (!Number.isFinite(toMs(w.date_from)) || !Number.isFinite(toMs(w.date_to))) return "window dates not YYYY-MM-DD";
  if (toMs(w.date_to) < toMs(w.date_from)) return "date_to before date_from";
  const span = spanInclusiveDays(w.date_from, w.date_to);
  if (span > MAX_GENERATION_DAYS) return `window spans ${span} days inclusive - generate-slots caps at ${MAX_GENERATION_DAYS}`;
  return null;
}

// Days of coverage left: today counts as 0, null coverage stays null.
export const daysOut = (today, coverageEnd) =>
  coverageEnd ? Math.round((toMs(coverageEnd) - toMs(today)) / DAY_MS) : null;

// today: "YYYY-MM-DD"; coverageEnd: "YYYY-MM-DD" of the last future slot, or
// null when the academy has no slots at all. Returns { days_before, windows }
// where windows is [] when coverage is already healthy. Every returned window
// passes validateWindow by construction (asserted before returning).
export function planExtensionWindows({ today, coverageEnd }) {
  const daysBefore = daysOut(today, coverageEnd);
  if (daysBefore !== null && daysBefore >= MIN_COVERAGE_DAYS) {
    return { days_before: daysBefore, windows: [] };
  }

  const target = addDays(today, TARGET_COVERAGE_DAYS);
  // Day after current coverage ends, but never before today (coverage may
  // already have lapsed entirely, or there may be none).
  let from = (coverageEnd && toMs(coverageEnd) >= toMs(today)) ? addDays(coverageEnd, 1) : today;

  const windows = [];
  while (toMs(from) <= toMs(target)) {
    const capped = Math.min(toMs(addDays(from, MAX_GENERATION_DAYS - 1)), toMs(target));
    const w = { date_from: from, date_to: msToYmd(capped) };
    windows.push(w);
    from = addDays(w.date_to, 1);
  }
  for (const w of windows) {
    const err = validateWindow(w);
    if (err) throw new Error(`planner produced an invalid window: ${err}`);
  }
  return { days_before: daysBefore, windows };
}
