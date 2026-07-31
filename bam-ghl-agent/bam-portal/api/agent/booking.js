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

// groupOf() USED TO LIVE HERE, and its removal is the point of build B.
//
// It read a calendar label and returned "Group 1" or "Group 2" by matching
// /group 1|elementary|younger/ and /group 2|high school|older/. That is BAM
// GTA's own label convention wearing machinery's clothes: measured 2026-07-30,
// of the six trial calendars in production only GTA's two matched, and CH3
// Training's and DETAIL Miami's both resolved to null. So the "two-bucket
// contract" was never a general mechanism - it was one academy's naming, and
// every other academy was already routing on nothing.
//
// It is replaced by classForCalendar (api/agent/_class-slots.js), which matches
// the label against the academy's OWN class titles from its training offer. An
// academy that calls its classes "Group 1" and "Group 2" gets exactly the
// narrowing it always had, because the words now come from that academy's data
// instead of from this file. Never reintroduce a vocabulary here.
import {
  classIndex, classForCalendar, classByName, loadClassesFor,
  routeSlots, chooseSlotToBook, parentFacingClassName,
} from "./_class-slots.js";
import { notifyTrialBooked } from "../_notify-trial-booked.js";
export { loadClassesFor };

// [{ key, label }] for the academy's trial calendars.
export async function loadCalendars(sb, clientId) {
  try {
    const rows = await sb(`entry_points?client_id=eq.${clientId}&type=eq.calendar&select=key,label`);
    return (Array.isArray(rows) ? rows : [])
      .map(r => ({ key: r.key, label: r.label }))
      .filter(c => c.key);
  } catch (_) { return []; }
}

/**
 * The calendar that serves a named CLASS. Replaces calendarForGroup.
 *
 * `className` is the academy's real class name, as it appears on its own offer
 * and in its own schedule - which is what the agent now works in. Matching is
 * done by looking for that class's title inside each calendar's label, so GTA's
 * "Booking Calendar: Group 1 (Elementary)" still resolves for its "Group 1"
 * class and nothing about GTA moves.
 *
 * A single-calendar academy always resolves to that calendar: when there is only
 * one door, the class does not choose it.
 */
export function calendarForClass(calendars, className, classes) {
  const cals = Array.isArray(calendars) ? calendars.filter(c => c && c.key) : [];
  if (!cals.length) return null;
  const idx = classIndex(classes);
  const cls = classByName(className, idx);
  if (cls) {
    const hit = cals.find(c => classForCalendar(c.label, idx) === cls.key);
    if (hit) return hit;
  }
  return cals.length === 1 ? cals[0] : null;
}

// The local-offset ISO builder now lives in api/_local-iso.js, because
// api/website/availability.js needs the SAME one and used to carry a second copy
// that no test could execute. Re-exported here so `localIsoParts` stays available
// from this module for anything that already imports it from the agent surface.
import { localIsoParts } from "../_local-iso.js";
export { localIsoParts };

// Portal slots the athlete may be OFFERED over the window. Occupancy comes from
// the shared slot_spots_taken function via the bulk RPC; the booking RPC
// re-checks capacity transactionally, so a stale read can't overbook.
//
// THIS is the half of the fix that matters. The write path below was already
// precise - it resolves an exact start_time - so a child booked into the wrong
// class got there by being SHOWN a time that was never for them. Filtering here
// is what stops that, and a build that only fixed the write would have looked
// finished and changed nothing.
async function portalFreeSlots(clientId, { days = 14, timezone = "America/Toronto", startMs, calLabel, athleteAge, classes } = {}) {
  // LOAD THE CLASSES WHEN THE CALLER DID NOT PASS THEM, the same way
  // bookPortalTrial already does. A caller that forgets is not a hypothetical:
  // the Hawkeye Book-it picker forgot, and the academy read as having no classes
  // at all. Defaulting to a fresh read means the worst a forgetful caller gets is
  // one extra query, never a wrong answer.
  const cls = Array.isArray(classes) ? classes : await loadClassesFor(sbFetch, clientId);
  const start = startMs || Date.now();
  const nowIso = new Date(start).toISOString();
  const endIso = new Date(start + days * 24 * 3600 * 1000).toISOString();
  const slots = (await sbFetch(
    `schedule_slots?tenant_id=eq.${encodeURIComponent(clientId)}&is_cancelled=eq.false&start_time=gte.${encodeURIComponent(nowIso)}&start_time=lte.${encodeURIComponent(endIso)}&select=id,name,start_time,capacity,source_offer_class_key&order=start_time.asc&limit=500`
  )) || [];
  const route = routeSlots({ slots, classes: cls, rawAge: athleteAge, calendarLabel: calLabel });
  const taken = await slotSpotsTakenBulk(clientId, route.slots.map(s => s.id));
  const out = {};
  for (const s of route.slots) {
    if ((s.capacity - (taken.get(s.id) || 0)) <= 0) continue;
    const { day, iso } = localIsoParts(s.start_time, timezone);
    (out[day] = out[day] || []).push(iso);
  }
  return { timezone, days: out, routing: route };
}

// Open slots for a calendar over the next `days`. Returns { timezone, days:{ date:[iso,...] }, routing }.
// Pass clientId (+ the calendar's label) to make this provider-aware; portal
// academies never touch GHL here. Pass athleteAge + the academy's classes to
// have the OFFER narrowed to the classes that athlete actually belongs in.
export async function freeSlots(token, calendarId, { days = 14, timezone = "America/Toronto", startMs, clientId, calLabel, athleteAge, classes } = {}) {
  if (clientId && (await bookingProviderOf(clientId)) === "portal") {
    return portalFreeSlots(clientId, { days, timezone, startMs, calLabel: calLabel || "", athleteAge, classes });
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
  // GHL owns the calendar for these academies, so there is nothing here to route:
  // the slots come back already scoped to whichever GHL calendar was asked for.
  return { timezone, days: out, routing: null };
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
        `schedule_slots?id=in.(${ids.map(encodeURIComponent).join(",")})&is_cancelled=eq.false&start_time=gt.${encodeURIComponent(new Date(nowMs).toISOString())}&select=name,start_time,end_time,location_label,source_offer_class_key&order=start_time.asc&limit=1`
      )) || [];
      const s = slots[0];
      if (!s) return null;
      // DECISION 3 (Zoran, 30 July 2026). This `title` becomes the event title in
      // the add-to-calendar links the trial confirmation sends, so it is read by
      // a parent, in their own calendar, for as long as they keep the event. It
      // used to be the raw slot name - our internal filing label - which for
      // DETAIL Miami reads "Training - DETAIL Academy (Mon, Wed, Fri)". It is now
      // the class's real name.
      const classTitle = parentFacingClassName(s, await loadClassesFor(sbFetch, clientId));
      return { startTime: s.start_time, endTime: s.end_time, address: s.location_label || null, calendarId: null, title: classTitle || "Free Trial", status: "confirmed" };
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
// `className` is the academy's real class name (the value the agent now emits in
// book_group). `athleteAge` narrows by age when the academy is armed for it.
export async function bookPortalTrial(clientId, { slotAtIso, group, className, calLabel, contactId, contactName, athleteName, athleteAge, classes }) {
  const t = new Date(slotAtIso);
  if (isNaN(t.getTime())) throw new Error("invalid slot time");
  const rows = (await sbFetch(
    `schedule_slots?tenant_id=eq.${encodeURIComponent(clientId)}&is_cancelled=eq.false&start_time=eq.${encodeURIComponent(t.toISOString())}&select=id,name,source_offer_class_key&limit=10`
  )) || [];
  const cls = Array.isArray(classes) ? classes : await loadClassesFor(sbFetch, clientId);
  // `group` is the legacy argument name of the same value; the column it comes
  // from still carries it, so both spellings are accepted and mean "the class".
  const picked = chooseSlotToBook({
    rows, classes: cls, rawAge: athleteAge,
    calendarLabel: calLabel, className: className || group || null,
  });
  const slot = picked.slot;
  if (!slot) throw new Error(picked.reason || "no portal slot at that time");
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
      // How the slot was chosen rides along, so an unidentified slot (one with no
      // source_offer_class_key that no class title matched) is recorded rather
      // than silently indistinguishable from a clean age match.
      p_metadata: { via: "agent-confirm-book", slot_name: slot.name, class_key: slot.source_offer_class_key || null, routed_by: picked.via },
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
  // A trial the agent locked in on the family's behalf is still news to the
  // owner - the staff member approving a Book-it card is not the person who
  // needs to know a Tuesday slot just filled. Non-throwing.
  await notifyTrialBooked({ clientId, trialBookingId: id, kind: "booked" });
  return id;
}

// Flatten free-slots into a short, model-friendly list of upcoming open times.
//
// Takes EITHER freeSlots' whole return value or just its `days` map, because one
// caller passed the whole envelope and the difference was invisible: the object
// has string and object values, `for...of` a string silently iterates its
// characters, and `for...of` an object throws "slots is not iterable" straight
// into a bare catch. The Hawkeye Book-it picker was empty for months on that.
// Accepting both removes the trap rather than fixing the one caller who fell in.
export function summarizeSlots(slotsByDay, max = 25) {
  const src = (slotsByDay && typeof slotsByDay === "object" && slotsByDay.days && typeof slotsByDay.days === "object")
    ? slotsByDay.days : slotsByDay;
  const flat = [];
  // A day whose value is not a list is skipped rather than iterated: the point of
  // this guard is that a wrong shape must produce nothing, never nonsense.
  for (const [, slots] of Object.entries(src || {})) { if (!Array.isArray(slots)) continue; for (const iso of slots) flat.push(iso); }
  flat.sort();
  return flat.slice(0, max);
}
