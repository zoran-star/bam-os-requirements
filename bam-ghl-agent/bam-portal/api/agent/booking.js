// Booking helpers for the sales agents - provider-aware (calendars-off-GHL ②).
//
// Calendars live in the `entry_points` table (type='calendar'); the label says
// which group (e.g. "Booking Calendar: Group 1 (Elementary)").
//
// booking_provider='portal' academies read + book on the portal runtime spine
// (schedule_slots + trial_bookings; booking ALWAYS via the capacity-safe
// book_trial_slot RPC - never a direct insert, per docs/parent-app-db-boundary.md).
// Every other academy keeps the exact GHL calendar calls.

const GHL = "https://services.leadconnectorhq.com";
const SB_URL = (process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || "").trim();
const SB_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || "").trim();

async function sbFetch(path, init = {}) {
  const r = await fetch(`${SB_URL}/rest/v1/${path}`, {
    ...init,
    headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, "Content-Type": "application/json", ...(init.headers || {}) },
  });
  if (!r.ok) throw new Error(`Supabase ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const t = await r.text();
  return t ? JSON.parse(t) : null;
}

async function slotSpotsTakenBulk(tenantId, slotIds) {
  if (!slotIds.length) return new Map();
  const rows = await sbFetch("rpc/slot_spots_taken_bulk", {
    method: "POST",
    body: JSON.stringify({
      p_tenant_id: tenantId,
      p_slot_ids: slotIds,
    }),
  });
  const counts = new Map();
  for (const row of rows || []) counts.set(row.slot_id, Number(row.spots_taken || 0));
  return counts;
}

// The academy's trial-booking system of record. Best-effort: any hiccup means
// 'ghl', so a lookup failure can never silently flip an academy off GHL.
export async function bookingProviderOf(clientId) {
  try {
    if (!clientId) return "ghl";
    const rows = await sbFetch(`clients?id=eq.${encodeURIComponent(clientId)}&select=booking_provider&limit=1`);
    return rows?.[0]?.booking_provider === "portal" ? "portal" : "ghl";
  } catch (_) { return "ghl"; }
}

// Contacts whose BOOKED trial time has already PASSED with no post-trial review
// yet: once the trial runs, the lead belongs to the post-trial form card on the
// Confirm tab (Zoran 2026-07-09) - NOT another Booking reply or Confirm touch.
// Both agents use this set to skip drafting and to retire lingering cards.
// Portal-booking academies only (their trial spine lives in trial_bookings).
// NO expiry (Zoran 2026-07-10): the lead stays in this set until the form is
// filled - an unreviewed trial never silently ages out of the deck. EXCEPT a
// contact with an UPCOMING booked slot (they rebooked): they're back in confirm
// land - never starve the new trial's confirmations on an old unreviewed one;
// the new trial makes its own form card when it runs.
// Fails to an empty set so a lookup hiccup never wrongly hides live cards.
export async function passedTrialContactIds(clientId) {
  try {
    if (!clientId) return new Set();
    if ((await bookingProviderOf(clientId)) !== "portal") return new Set();
    const nowIso = new Date().toISOString();
    const bks = await sbFetch(`trial_bookings?tenant_id=eq.${clientId}&status=eq.BOOKED&select=id,ghl_contact_id,schedule_slots(start_time)`) || [];
    const rows = (Array.isArray(bks) ? bks : []).filter(t => t.ghl_contact_id && t.schedule_slots && t.schedule_slots.start_time);
    const upcoming = new Set(rows.filter(t => t.schedule_slots.start_time > nowIso).map(t => String(t.ghl_contact_id)));
    const due = rows.filter(t => t.schedule_slots.start_time <= nowIso && !upcoming.has(String(t.ghl_contact_id)));
    if (!due.length) return new Set();
    // Key on the TRIAL, not the CONTACT (Zoran 2026-07-10): reviews carry
    // trial_booking_id, so a rebooked lead's prior-trial review no longer marks
    // the new trial reviewed. Mirrors the list-ready gate in api/agent-confirm.js.
    const revs = await sbFetch(`post_trial_reviews?client_id=eq.${clientId}&select=trial_booking_id`) || [];
    const reviewedBookings = new Set((Array.isArray(revs) ? revs : []).map(r => String(r.trial_booking_id || "")).filter(Boolean));
    return new Set(due.filter(t => !reviewedBookings.has(String(t.id))).map(t => String(t.ghl_contact_id)).filter(Boolean));
  } catch (_) { return new Set(); }
}

// Contacts with an UPCOMING booked trial (slot start still in the future): they
// are already locked into a slot, so the Booking detector must NOT draft another
// Book-it / reply card for them. Without this, a stage-move hiccup that leaves a
// just-booked lead in Responded lets the detector re-queue a SECOND Book-it ->
// double booking (Yaz/Tara, GTA 2026-07-11). Read-time gates hide any lingering
// Booking card the same way. Portal-booking academies only (their trial spine
// lives in trial_bookings). The Confirm agent uses this set ONLY to skip/retire
// the overdue "did they show up?" nag for rebooked leads (a portal rebooking is
// invisible to GHL appointment reads) - never to hide confirm cards, since a
// booked lead belongs in confirm land (that is where confirmations happen).
// Fails to an empty set so a lookup hiccup never wrongly hides live cards.
export async function upcomingBookedContactIds(clientId) {
  try {
    if (!clientId) return new Set();
    if ((await bookingProviderOf(clientId)) !== "portal") return new Set();
    const nowIso = new Date().toISOString();
    const bks = await sbFetch(`trial_bookings?tenant_id=eq.${clientId}&status=eq.BOOKED&select=ghl_contact_id,schedule_slots(start_time)`) || [];
    const rows = (Array.isArray(bks) ? bks : []).filter(t => t.ghl_contact_id && t.schedule_slots && t.schedule_slots.start_time);
    return new Set(rows.filter(t => t.schedule_slots.start_time > nowIso).map(t => String(t.ghl_contact_id)));
  } catch (_) { return new Set(); }
}

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

// "2026-07-07T19:00:00-04:00"-style local-offset ISO + local day key, matching
// what the GHL free-slots API emitted so downstream consumers are unchanged.
function localIsoParts(dateUtc, timeZone) {
  const fmt = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false, timeZoneName: "longOffset" });
  const parts = Object.fromEntries(fmt.formatToParts(new Date(dateUtc)).map(p => [p.type, p.value]));
  const off = (parts.timeZoneName || "GMT+00:00").replace("GMT", "") || "+00:00";
  const day = `${parts.year}-${parts.month}-${parts.day}`;
  return { day, iso: `${day}T${parts.hour === "24" ? "00" : parts.hour}:${parts.minute}:${parts.second}${off}` };
}

// Portal slots for a group over the window. Occupancy comes from the shared
// slot_spots_taken function via the bulk RPC; the booking RPC re-checks capacity
// transactionally, so a stale read can't overbook.
async function portalFreeSlots(clientId, groupLabel, { days = 14, timezone = "America/Toronto", startMs } = {}) {
  const start = startMs || Date.now();
  const nowIso = new Date(start).toISOString();
  const endIso = new Date(start + days * 24 * 3600 * 1000).toISOString();
  const slots = (await sbFetch(
    `schedule_slots?tenant_id=eq.${encodeURIComponent(clientId)}&is_cancelled=eq.false&start_time=gte.${encodeURIComponent(nowIso)}&start_time=lte.${encodeURIComponent(endIso)}&select=id,name,start_time,capacity&order=start_time.asc&limit=500`
  )) || [];
  const g = String(groupOf(groupLabel) || groupLabel || "").toLowerCase();
  const list = slots.filter(s => !g || (s.name || "").toLowerCase().includes(g));
  const taken = await slotSpotsTakenBulk(clientId, list.map(s => s.id));
  const out = {};
  for (const s of list) {
    if ((s.capacity - (taken.get(s.id) || 0)) <= 0) continue;
    const { day, iso } = localIsoParts(s.start_time, timezone);
    (out[day] = out[day] || []).push(iso);
  }
  return { timezone, days: out };
}

// Open slots for a calendar over the next `days`. Returns { timezone, days:{ date:[iso,...] } }.
// Pass clientId (+ the calendar's label) to make this provider-aware; portal
// academies never touch GHL here.
export async function freeSlots(token, calendarId, { days = 14, timezone = "America/Toronto", startMs, clientId, calLabel } = {}) {
  if (clientId && (await bookingProviderOf(clientId)) === "portal") {
    return portalFreeSlots(clientId, calLabel || "", { days, timezone, startMs });
  }
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

// The contact's next upcoming booked appointment (the trial the confirm agent is
// confirming). Returns { startTime, calendarId, title, status } or null. Best-effort:
// shapes vary, so we read defensively and never throw (callers fall back to a
// generic "your booked trial"). `nowMs` lets callers pass a clock for determinism.
// Pass clientId to make this provider-aware (portal reads trial_bookings).
export async function nextAppointment(token, contactId, { nowMs = Date.now(), clientId } = {}) {
  if (clientId && (await bookingProviderOf(clientId)) === "portal") {
    try {
      const tbs = (await sbFetch(
        `trial_bookings?tenant_id=eq.${encodeURIComponent(clientId)}&ghl_contact_id=eq.${encodeURIComponent(contactId)}&status=eq.BOOKED&select=slot_id&limit=50`
      )) || [];
      const ids = tbs.map(t => t.slot_id).filter(Boolean);
      if (!ids.length) return null;
      const slots = (await sbFetch(
        `schedule_slots?id=in.(${ids.map(encodeURIComponent).join(",")})&is_cancelled=eq.false&start_time=gt.${encodeURIComponent(new Date(nowMs).toISOString())}&select=name,start_time,end_time,location_label&order=start_time.asc&limit=1`
      )) || [];
      const s = slots[0];
      if (!s) return null;
      return { startTime: s.start_time, endTime: s.end_time, address: s.location_label || null, calendarId: null, title: s.name || "Free Trial", status: "confirmed" };
    } catch (_) { return null; }
  }
  try {
    const r = await fetch(`${GHL}/contacts/${encodeURIComponent(contactId)}/appointments`, {
      headers: { Authorization: `Bearer ${token}`, Version: "2021-07-28", Accept: "application/json" },
    });
    const json = await r.json().catch(() => ({}));
    if (!r.ok) return null;
    const events = json.events || json.appointments || json.data || [];
    const upcoming = (Array.isArray(events) ? events : [])
      .map(e => ({ startTime: e.startTime || e.startAt || e.start_time || null, endTime: e.endTime || e.endAt || e.end_time || null, address: e.address || e.location || e.meetingLocation || e.meeting_location || null, calendarId: e.calendarId || e.calendar_id || null, title: e.title || null, status: (e.appointmentStatus || e.status || "").toLowerCase() }))
      .filter(e => e.startTime && e.status !== "cancelled" && e.status !== "canceled" && new Date(e.startTime).getTime() > nowMs)
      .sort((a, b) => new Date(a.startTime) - new Date(b.startTime));
    return upcoming[0] || null;
  } catch (_) { return null; }
}

// Book a trial on the PORTAL spine (staff/agent path) via the capacity-safe
// book_trial_slot RPC. Resolves the chosen ISO time to a schedule_slots row
// scoped to the group, enriches parent details from the contacts store, and
// returns the trial_booking id. Throws with a human message on failure
// (no slot at that time / slot full) so callers surface it to staff.
export async function bookPortalTrial(clientId, { slotAtIso, group, calLabel, contactId, contactName, athleteName }) {
  const t = new Date(slotAtIso);
  if (isNaN(t.getTime())) throw new Error("invalid slot time");
  const rows = (await sbFetch(
    `schedule_slots?tenant_id=eq.${encodeURIComponent(clientId)}&is_cancelled=eq.false&start_time=eq.${encodeURIComponent(t.toISOString())}&select=id,name&limit=10`
  )) || [];
  const g = String(group || groupOf(calLabel) || "").toLowerCase().trim();
  const slot = rows.find(s => !g || (s.name || "").toLowerCase().includes(g)) || rows[0];
  if (!slot) throw new Error("no portal slot at that time");
  let c = {};
  try {
    const cr = await sbFetch(`contacts?client_id=eq.${encodeURIComponent(clientId)}&ghl_contact_id=eq.${encodeURIComponent(contactId)}&select=name,email,phone,athlete_name&limit=1`);
    c = (Array.isArray(cr) && cr[0]) || {};
  } catch (_) {}
  // Athlete name resolution: the name staff typed on the Book-it card wins, then
  // whatever's already stored on the contact. The book_trial_slot RPC HARD-requires
  // it, so if both are empty we throw a clean, human message here instead of letting
  // the raw Postgres "P0001: Athlete name is required." surface to the deck.
  const resolvedAthlete = (athleteName || c.athlete_name || "").trim() || null;
  if (!resolvedAthlete) throw new Error("Enter the athlete's name to book this trial");
  // Offer lineage: the lead's open pipeline card knows which offer's funnel
  // this trial belongs to (Wave 1 stamping). Best-effort - never blocks a book.
  let oppOfferId = null;
  try {
    const opps = await sbFetch(`opportunities?client_id=eq.${encodeURIComponent(clientId)}&ghl_contact_id=eq.${encodeURIComponent(contactId)}&status=eq.open&select=offer_id&limit=1`);
    oppOfferId = (Array.isArray(opps) && opps[0] && opps[0].offer_id) || null;
  } catch (_) {}
  const r = await sbFetch(`rpc/book_trial_slot`, {
    method: "POST",
    body: JSON.stringify({
      p_tenant_id: clientId,
      p_slot_id: slot.id,
      p_parent_name: contactName || c.name || null,
      p_parent_email: c.email || null,
      p_athlete_name: resolvedAthlete,
      p_parent_phone: c.phone || null,
      p_athlete_dob: null,
      p_entry_point_id: null,
      p_offer_id: oppOfferId,
      p_ghl_contact_id: contactId,
      p_source: "staff",
      p_metadata: { via: "agent-confirm-book", slot_name: slot.name },
    }),
  });
  const id = typeof r === "string" ? r : (r && r.trial_booking_id) || null;
  if (!id) throw new Error("trial booking failed");
  // Backfill the resolved athlete name onto the contact so it's saved for next
  // time (agent personalization + future books). Best-effort - never fail a
  // successful booking over this. Only writes when the contact had none.
  if (resolvedAthlete && !c.athlete_name) {
    try {
      await sbFetch(`contacts?client_id=eq.${encodeURIComponent(clientId)}&ghl_contact_id=eq.${encodeURIComponent(contactId)}`, {
        method: "PATCH",
        headers: { Prefer: "return=minimal" },
        body: JSON.stringify({ athlete_name: resolvedAthlete }),
      });
    } catch (_) {}
  }
  return id;
}

// Flatten free-slots into a short, model-friendly list of upcoming open times.
export function summarizeSlots(slotsByDay, max = 25) {
  const flat = [];
  for (const [, slots] of Object.entries(slotsByDay || {})) for (const iso of slots) flat.push(iso);
  flat.sort();
  return flat.slice(0, max);
}
