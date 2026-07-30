// The member-facing facts that are NOT on the clients row: the training venue and
// the weekly schedule.
//
// WHY THEY ARE NOT IN clientVars
// clientVars(client) is pure and synchronous - it turns one row into merge vars, and
// every caller that has the row can use it. These two need other tables, so they need
// a caller with database access. That is exactly the shape next_session already has:
// the worker resolves it and spreads it into `vars` at send time. This module is the
// same pattern for two more facts, rather than a second way of doing it.
//
// WHY THEY EXIST AT ALL
// GTA's welcome sequence had its training times and its gym address TYPED into the
// message. That is the single biggest reason the welcome email cannot be copied to
// another academy: copying it texts one academy's schedule and address to another
// academy's members. Both facts are already real data in the system - 86 live
// schedule_slots rows and a locations row - so the message can be generated from them
// instead of transcribed, and it is then correct on the day it sends rather than on
// the day somebody typed it.
//
// FAILS TO EMPTY, ALWAYS. No sessions on file means no schedule, which means the
// schedule block does not render and the schedule step stays off. An academy that has
// entered nothing sends a shorter message. It never sends somebody else's.

// clients.address is the BUSINESS address, not the gym. GTA's is "2205 Rosemount
// Cres" while members train at 1079 Linbrook Rd. Never substitute one for the other.
import { resolveTestimonials } from "./_testimonials.js";

const VENUE_FROM = "locations, lowest sort_order";

// Mon..Sun, as the plural day names the copy uses.
const DAY_NAMES = ["Sundays", "Mondays", "Tuesdays", "Wednesdays", "Thursdays", "Fridays", "Saturdays"];

// "19:00" -> "7pm", "19:30" -> "7:30pm". Minutes are dropped when they are zero,
// which is what a person writes.
function clockLabel(h, m) {
  const ampm = h >= 12 ? "pm" : "am";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return m ? `${h12}:${String(m).padStart(2, "0")}${ampm}` : `${h12}${ampm}`;
}

// A time zone Intl will actually accept. An academy row can hold something Intl
// rejects outright (a Rails-style "Eastern Time (US & Canada)"), and a RangeError
// thrown per slot would have been swallowed by the caller's catch, emptying the whole
// schedule with no sign that anything went wrong. An EMPTY zone is safe because it
// falls back to UTC; a wrong non-empty one is not, so it is caught here and named, and
// weeklySchedule then declines to build a schedule at all rather than build a wrong one.
// Pro Precision is the live example waiting to happen: its time zone says Toronto and
// its address is in Australia.
export function safeTimeZone(timeZone) {
  const tz = String(timeZone || "").trim();
  if (!tz) return { zone: "UTC", problem: "" };
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz }).format(new Date(0));
    return { zone: tz, problem: "" };
  } catch (_) {
    return { zone: "UTC", problem: `clients.time_zone is ${JSON.stringify(tz)}, which is not a time zone this system recognises. The schedule was built in UTC, so its days and times are probably wrong. Fix the academy's time zone.` };
  }
}

// A slot's local wall-clock parts, in the ACADEMY's time zone. An academy in San Jose
// must not have its evening sessions described in Toronto time - that is the same bug
// class as the trial confirmations, and it is why the zone is a parameter and has no
// default.
//
// hourCycle: "h23", NOT hour12: false. `hour12` is a HINT the engine RESOLVES to a
// cycle, and Node 20 resolves it to h24 (midnight renders "24") while Node 24
// resolves it to h23 ("00"). A midnight class then read as hour 24, and this helper
// is what describes class times to a parent. Do not put `hour12` back: per ECMA-402
// it OVERRIDES `hourCycle`, so the two cannot coexist.
//
// This note lives ABOVE the signature on purpose. Case 4 of api/_local-day.test.mjs
// pins that the function BODY contains no "hour12" at all, comments included, which
// is a stricter and much cheaper rule than teaching the pin to parse comments.
function localParts(iso, timeZone) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone, weekday: "short", hour: "numeric", minute: "numeric", hourCycle: "h23",
  });
  const parts = Object.fromEntries(fmt.formatToParts(d).map((p) => [p.type, p.value]));
  const dow = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(parts.weekday);
  if (dow < 0) return null;
  // BELT AND BRACES, not the fix. h23 never renders 24, so under the cycle above
  // this `% 24` is the identity - kept only to catch the value if the cycle is
  // ever wrong again. Case 10 of api/_local-day.test.mjs proves it still bites by
  // forcing h24 here and requiring the right answer anyway.
  const hour = Number(parts.hour) % 24;
  return { dow, hour, minute: Number(parts.minute) };
}

// Collapse many dated sessions into ONE typical week.
//
// schedule_slots holds every individual session, so GTA's 86 live rows are the same
// handful of weekly classes repeated across the term. A member wants the pattern, not
// the list, so identical (weekday, class name, start, end) rows collapse to one entry.
// Order is by weekday then start time, which is the order a person reads a timetable
// in and is stable regardless of which rows the query happened to return first.
export function weeklySchedule(slots, timeZone) {
  const { zone, problem } = safeTimeZone(timeZone);
  // FAIL CLOSED, and loudly. An unrecognised zone could be computed in UTC instead,
  // and that is the worse answer: it produces a plausible-looking timetable on the
  // wrong days at the wrong times, which a member has no way to tell from a right one.
  // No schedule at all is visibly missing and stops the message sending. Note the
  // EMPTY case is different and safe - no zone on file means UTC, and an academy that
  // has not set a zone has almost always not set sessions either.
  if (problem) { console.warn(`[academy-facts] ${problem}`); return []; }
  const seen = new Map();
  for (const s of slots || []) {
    if (s.is_cancelled) continue;
    const start = localParts(s.start_time, zone);
    if (!start) continue;
    const end = s.end_time ? localParts(s.end_time, zone) : null;
    const name = String(s.name || "").trim();
    if (!name) continue;
    // "7-8pm", not "7pm-8pm": when both ends of a range fall in the same half of the
    // day, the first am/pm is redundant and nobody writes it. When they straddle noon
    // it stays on both, so "11:30am-12:30pm" cannot be misread as a morning session -
    // which is a small improvement on the hand-typed copy, where GTA's Saturday
    // "11:30-12:30pm" reads as though it starts at half past eleven at night.
    const sameHalf = end && (start.hour < 12) === (end.hour < 12);
    const time = end
      ? `${sameHalf ? clockLabel(start.hour, start.minute).replace(/[ap]m$/, "") : clockLabel(start.hour, start.minute)}-${clockLabel(end.hour, end.minute)}`
      : clockLabel(start.hour, start.minute);
    const key = `${start.dow}|${name}|${time}`;
    if (seen.has(key)) continue;
    seen.set(key, { dow: start.dow, sort: start.hour * 60 + start.minute, name, time });
  }
  const rows = [...seen.values()].sort((a, b) => (a.dow - b.dow) || (a.sort - b.sort) || a.name.localeCompare(b.name));
  const week = [];
  for (const r of rows) {
    let day = week.find((d) => d.dow === r.dow);
    if (!day) { day = { dow: r.dow, day: DAY_NAMES[r.dow], groups: [] }; week.push(day); }
    day.groups.push({ name: r.name, time: r.time });
  }
  // Monday-first, so a week reads Mon..Sun rather than Sun..Sat.
  return week.sort((a, b) => ((a.dow + 6) % 7) - ((b.dow + 6) % 7)).map(({ day, groups }) => ({ day, groups }));
}

// The vars a send needs on top of clientVars(client). `sb` is a function taking a
// PostgREST path and returning parsed JSON, the same shape api/automations.js already
// uses, so this module needs no client of its own and no credentials.
//
// Every failure here is swallowed into an empty fact on purpose: a schedule lookup
// that throws must not stop a welcome email from sending. A shorter email beats none.
export async function academyFacts(sb, client) {
  const out = { location_venue: "", location_schedule: [], location_coaches: [], location_testimonials: [] };
  const id = client && client.id;
  if (!sb || !id) return out;

  try {
    // Only people the academy actually shows on its team, and only those who have
    // given a handle. hide_from_team is how an academy marks somebody internal (BAM
    // staff sit on these rows too), so it decides this list as well - a member should
    // never be told to follow our own operations people.
    const team = await sb(`client_users?client_id=eq.${id}&status=eq.active&hide_from_team=is.false&instagram=not.is.null&select=name,instagram,created_at&order=created_at.asc`);
    out.location_coaches = (Array.isArray(team) ? team : [])
      .map((u) => ({ name: String(u.name || "").trim().split(/\s+/)[0], instagram: String(u.instagram || "").trim() }))
      .filter((u) => u.name && u.instagram);
  } catch (_) { /* no handles is a shorter email */ }

  try {
    const rows = await sb(`locations?client_id=eq.${id}&select=address,sort_order&order=sort_order.asc&limit=1`);
    out.location_venue = (Array.isArray(rows) && rows[0] && String(rows[0].address || "").trim()) || "";
  } catch (_) { /* no venue is a shorter email, never a failed send */ }

  try {
    // UPCOMING sessions only, and that bound is load-bearing twice over. Without it
    // last term's cancelled-by-attrition classes stay in the "typical week" forever
    // beside this term's, and - worse - the 500-row cap starts returning the OLDEST
    // 500 once an academy passes it (about two years at GTA's rate), freezing the
    // schedule on a dead timetable that never moves again. Every other reader of this
    // table bounds it the same way (api/website/availability.js, calendars.js).
    const from = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const slots = await sb(`schedule_slots?tenant_id=eq.${id}&is_cancelled=is.false&start_time=gte.${from}&select=name,start_time,end_time,is_cancelled&order=start_time.asc&limit=500`);
    out.location_schedule = weeklySchedule(slots, client.time_zone || "UTC");
  } catch (_) { /* same */ }

  try {
    // The academy's OWN approved quotes, straight from THE resolver so the email
    // cannot order or filter them differently from the website and the agent.
    // Reader injected: this module holds no credentials, and a second resolver
    // entry point would be the fork api/_testimonials.js forbids.
    const { testimonials } = await resolveTestimonials(id, sb);
    out.location_testimonials = Array.isArray(testimonials) ? testimonials : [];
  } catch (_) {
    // Swallowed like every other fact here: a store read that throws must not
    // stop a send. It leaves the list EMPTY, which drops the quote block and
    // its lead-in rather than sending a hollow section.
    //
    // ⚠️ AND THAT IS WHY THE REAL DROP RULE LIVES AT SEED TIME, NOT HERE. Zoran
    // approved "empty store means the email is dropped"; he did not approve "a
    // failed lookup means the email is dropped". At render time, empty and
    // unreachable are indistinguishable, so this layer must never be the thing
    // deciding whether the testimonials email exists. The seeder decides that,
    // where a throw can fail loudly instead of quietly looking like no data.
  }

  return out;
}

export const VENUE_SOURCE = VENUE_FROM;
