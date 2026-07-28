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

// A slot's local wall-clock parts, in the ACADEMY's time zone. An academy in San Jose
// must not have its evening sessions described in Toronto time - that is the same bug
// class as the trial confirmations, and it is why the zone is a parameter and has no
// default.
function localParts(iso, timeZone) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone, weekday: "short", hour: "numeric", minute: "numeric", hour12: false,
  });
  const parts = Object.fromEntries(fmt.formatToParts(d).map((p) => [p.type, p.value]));
  const dow = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(parts.weekday);
  if (dow < 0) return null;
  // en-US hour12:false renders midnight as "24" in some ICU versions.
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
  const seen = new Map();
  for (const s of slots || []) {
    if (s.is_cancelled) continue;
    const start = localParts(s.start_time, timeZone);
    if (!start) continue;
    const end = s.end_time ? localParts(s.end_time, timeZone) : null;
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
  const out = { location_venue: "", location_schedule: [], location_coaches: [] };
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
    const slots = await sb(`schedule_slots?tenant_id=eq.${id}&is_cancelled=is.false&select=name,start_time,end_time,is_cancelled&order=start_time.asc&limit=500`);
    out.location_schedule = weeklySchedule(slots, client.time_zone || "UTC");
  } catch (_) { /* same */ }

  return out;
}

export const VENUE_SOURCE = VENUE_FROM;
