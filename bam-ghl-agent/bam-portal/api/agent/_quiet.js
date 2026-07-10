// Quiet hours: the agent NEVER sends a parent-facing SMS outside this window.
// Applies to every send path — scheduled follow-ups, self-drive auto-sends, and
// human-approved "send now" clicks. A message that would go out outside the window
// is pushed to the next morning instead.
//
// The window is evaluated in the academy's local time. All current academies are
// GTA, and the agent already drafts in America/Toronto (see agent-approvals.js), so
// that's the default — change QUIET_TZ here if academies span timezones later.
export const QUIET_TZ = "America/Toronto";
export const QUIET_START_MIN = 8 * 60;        // 08:00
export const QUIET_END_MIN = 21 * 60 + 30;    // 21:30

// Minutes-since-local-midnight for `date` in `tz`.
function localMinutes(date, tz) {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(date);
  const h = Number(parts.find(p => p.type === "hour").value) % 24;
  const m = Number(parts.find(p => p.type === "minute").value);
  return h * 60 + m;
}

// UTC offset (minutes to ADD to UTC to get local) for `tz` at the instant `date`.
function tzOffsetMinutes(date, tz) {
  const m = {};
  for (const p of new Intl.DateTimeFormat("en-US", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }).formatToParts(date)) m[p.type] = p.value;
  const asUTC = Date.UTC(Number(m.year), Number(m.month) - 1, Number(m.day), Number(m.hour) % 24, Number(m.minute), Number(m.second));
  return (asUTC - date.getTime()) / 60000;
}

// The UTC instant for `targetMin` minutes past local midnight, on the local
// calendar day of `date` (+ dayOffset days). DST-correct via a single offset pass.
function atLocalTime(date, targetMin, tz, dayOffset) {
  const m = {};
  for (const p of new Intl.DateTimeFormat("en-US", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date)) m[p.type] = p.value;
  const hh = Math.floor(targetMin / 60), mm = targetMin % 60;
  const guessUTC = Date.UTC(Number(m.year), Number(m.month) - 1, Number(m.day) + dayOffset, hh, mm, 0);
  const off = tzOffsetMinutes(new Date(guessUTC), tz);
  return new Date(guessUTC - off * 60000);
}

// The academy's quiet-hours timezone: clients.time_zone if set, else the
// default (America/Toronto). Pass a client row (or any object with time_zone).
// Every send path resolves this once and threads it into withinQuietHours /
// nextSendableTime so a non-Toronto academy holds against ITS local window.
export function quietTz(client) {
  const tz = client && client.time_zone;
  return (typeof tz === "string" && tz.trim()) ? tz.trim() : QUIET_TZ;
}

// Is `date` inside the allowed send window?
export function withinQuietHours(date = new Date(), tz = QUIET_TZ) {
  const mins = localMinutes(date, tz);
  return mins >= QUIET_START_MIN && mins <= QUIET_END_MIN;
}

// The next instant at/after `date` that falls INSIDE the window:
//   inside window      → unchanged
//   before 8:00am      → today 8:00am
//   after 9:30pm       → tomorrow 8:00am
export function nextSendableTime(date = new Date(), tz = QUIET_TZ) {
  const mins = localMinutes(date, tz);
  if (mins >= QUIET_START_MIN && mins <= QUIET_END_MIN) return date;
  return atLocalTime(date, QUIET_START_MIN, tz, mins > QUIET_END_MIN ? 1 : 0);
}
