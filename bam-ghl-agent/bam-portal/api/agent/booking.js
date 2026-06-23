// Booking helpers for the sales agent: resolve an academy's trial calendars,
// match a group to a calendar, and read open slots from GHL.
//
// Calendars live in the `entry_points` table (type='calendar'); the label says
// which group (e.g. "Booking Calendar: Group 1 (Elementary)").

const GHL = "https://services.leadconnectorhq.com";

// Normalize a calendar label to a group key the agent uses.
function groupOf(label) {
  const s = String(label || "").toLowerCase();
  if (/group\s*1|elementary|younger/.test(s)) return "Group 1";
  if (/group\s*2|high\s*school|older/.test(s)) return "Group 2";
  return null;
}

// [{ key, label, group }] for the academy's trial calendars.
export async function loadCalendars(sb, clientId) {
  try {
    const rows = await sb(`entry_points?client_id=eq.${clientId}&type=eq.calendar&select=key,label`);
    return (Array.isArray(rows) ? rows : [])
      .map(r => ({ key: r.key, label: r.label, group: groupOf(r.label) }))
      .filter(c => c.key);
  } catch (_) { return []; }
}

export function calendarForGroup(calendars, group) {
  if (!Array.isArray(calendars) || !calendars.length) return null;
  const g = String(group || "").toLowerCase().replace(/\s+/g, "");
  return calendars.find(c => String(c.group || "").toLowerCase().replace(/\s+/g, "") === g) || null;
}

// Open slots for a calendar over the next `days`. Returns { timezone, days:{ date:[iso,...] } }.
export async function freeSlots(token, calendarId, { days = 14, timezone = "America/Toronto", startMs } = {}) {
  const start = startMs || Date.now();
  const end = start + days * 24 * 3600 * 1000;
  const params = new URLSearchParams({ startDate: String(start), endDate: String(end), timezone });
  const r = await fetch(`${GHL}/calendars/${encodeURIComponent(calendarId)}/free-slots?${params}`, {
    headers: { Authorization: `Bearer ${token}`, Version: "2021-07-28", Accept: "application/json" },
  });
  const json = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(json.message || json.error || `GHL ${r.status}`);
  const out = {};
  for (const [k, v] of Object.entries(json)) if (v && Array.isArray(v.slots)) out[k] = v.slots;
  return { timezone, days: out };
}

// Flatten free-slots into a short, model-friendly list of upcoming open times.
export function summarizeSlots(slotsByDay, max = 25) {
  const flat = [];
  for (const [, slots] of Object.entries(slotsByDay || {})) for (const iso of slots) flat.push(iso);
  flat.sort();
  return flat.slice(0, max);
}
