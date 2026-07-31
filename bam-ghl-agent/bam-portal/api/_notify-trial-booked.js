// The free-trial booking text - one notifier, every booking path.
//
// WHY THIS FILE EXISTS. `calendar_booking` shipped as a switch in the client
// portal and BAM GTA turned it ON. It fired from exactly one place: a GHL
// AppointmentCreate webhook. GTA books on the PORTAL spine (book_trial_slot,
// no GHL appointment at all), so across 25 bookings in 30 days it sent nothing,
// and the settings screen said it was on the whole time. A notification with
// five ways in and one wired trigger will always drift back to that, so every
// path now funnels through here and a test walks the call sites (see
// _notify-trial-booked.test.mjs).
//
//   notifyTrialBooked({ clientId, trialBookingId, kind })
//     kind: "booked" | "cancelled" | "rescheduled"
//
// The event key is declared BY THE PRESET (api/agent/presets.js -> free_trial
// .notifications), so this only speaks for academies actually running the free
// trial sales system. Everyone else gets silence, not a dead switch.
//
// WHO IT TEXTS. notifyOwners() -> the owner always, plus whichever teammates the
// owner picked for `free_trial_booked`, from the academy's own number.
//
// WHEN IT STAYS QUIET. Only the FAMILY's actions text (they booked, they
// cancelled, they moved it). Staff cancelling from the calendar drawer or the
// Confirm deck does not: the academy does not need a text about its own click.
// Those call sites pass nothing to this file at all - see the skip list in the
// test for the explicit record of which ones and why.
//
// Best-effort and NON-THROWING throughout. A booking must never fail because a
// text did not send.
import { notifyOwners } from "./_notify-owners.js";
import { presetNotifications } from "./agent/presets.js";
import { loadClassesFor, parentFacingClassName } from "./agent/_class-slots.js";

const SB_URL = (process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || "").trim();
const SB_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || "").trim();

export const TRIAL_BOOKED_EVENT = "free_trial_booked";

async function sb(path) {
  const r = await fetch(`${SB_URL}/rest/v1/${path}`, {
    headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` },
  });
  if (!r.ok) throw new Error(`Supabase ${r.status}`);
  const t = await r.text();
  return t ? JSON.parse(t) : null;
}

// Does a preset stamp declare the event?
const stampDeclares = (presetKey) =>
  !!presetKey && presetNotifications(presetKey).some((n) => n.key === TRIAL_BOOKED_EVENT);

// Does this academy run a preset that declares the event? The stamp lives on the
// offer (offer.data.sales.preset_key), written by apply-preset. No stamp means no
// pill in the portal, so sending would be a text nobody can turn off.
async function academyRunsEvent(clientId) {
  try {
    const rows = await sb(
      `offers?client_id=eq.${encodeURIComponent(clientId)}&status=neq.archived&select=preset_key:data->sales->>preset_key`,
    );
    return (rows || []).some((row) => stampDeclares(row && row.preset_key));
  } catch (_) {
    return false;
  }
}

// Which event a GHL AppointmentCreate should fire.
//
// Academies still booking IN GHL never touch trial_bookings, so their text comes
// from the appointment webhook instead. It must land on the SAME pill as a portal
// booking, or applying the preset would hand them a switch that does nothing -
// the exact failure this whole change exists to remove. But not every GHL
// calendar is a free trial (BAM runs a Coach Cert calendar), so the upgrade is
// earned per-calendar: the appointment's calendar must be an entry point tied to
// an offer whose preset stamp declares the event. Anything else keeps the
// generic `calendar_booking` it has always used.
export async function trialBookingEventForGhlCalendar(clientId, calendarId) {
  try {
    if (!clientId || !calendarId) return "calendar_booking";
    const eps = await sb(
      `entry_points?client_id=eq.${encodeURIComponent(clientId)}&type=eq.calendar`
      + `&key=eq.${encodeURIComponent(String(calendarId))}&select=offer_id&limit=1`,
    );
    const offerId = Array.isArray(eps) && eps[0] && eps[0].offer_id;
    if (!offerId) return "calendar_booking";
    const offers = await sb(
      `offers?id=eq.${encodeURIComponent(offerId)}&select=preset_key:data->sales->>preset_key&limit=1`,
    );
    const key = Array.isArray(offers) && offers[0] && offers[0].preset_key;
    return stampDeclares(key) ? TRIAL_BOOKED_EVENT : "calendar_booking";
  } catch (_) {
    return "calendar_booking";
  }
}

// "Tue Aug 5, 5:30 PM" in the ACADEMY's timezone, not the server's. An owner in
// Toronto reading a UTC time would take it at face value and show up wrong.
export function formatSlotTime(startTime, timeZone) {
  if (!startTime) return "";
  const d = new Date(startTime);
  if (isNaN(d.getTime())) return "";
  // hourCycle: "h12", NOT hour12: true - the hint resolves per engine and h11
  // renders noon as "0:00 PM". See scripts/check-no-hour12.mjs.
  const opts = { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", hourCycle: "h12" };
  try {
    return d.toLocaleString("en-US", { ...opts, timeZone: timeZone || "America/Toronto" });
  } catch (_) {
    // An unknown/garbage tz string throws rather than falling back, and a
    // booking text with no time is worse than one in the wrong zone.
    return d.toLocaleString("en-US", opts);
  }
}

const HEADS = {
  booked:      "📅 New free trial booked",
  cancelled:   "❌ Free trial cancelled",
  rescheduled: "🔁 Free trial moved",
};

// Build the SMS. Exported so the test asserts on the real string rather than on
// a reimplementation of it.
export function renderTrialBookedSms({ kind, className, athleteName, athleteAge, parentName, parentPhone, when }) {
  const head = HEADS[kind] || HEADS.booked;
  const age = Number.isFinite(Number(athleteAge)) && Number(athleteAge) > 0 ? ` (${Number(athleteAge)})` : "";
  const lines = [
    className ? `${head} - ${className}` : head,
    athleteName ? `Athlete: ${athleteName}${age}` : "",
    parentName || parentPhone ? `Parent: ${[parentName, parentPhone].filter(Boolean).join(" - ")}` : "",
    when ? `When: ${when}` : "",
  ];
  return lines.filter(Boolean).join("\n");
}

// Age at the trial, from the athlete's DOB. Null when there is no DOB - the
// message simply drops the age rather than guessing one.
function ageFromDob(dob) {
  if (!dob) return null;
  const b = new Date(dob);
  if (isNaN(b.getTime())) return null;
  const now = new Date();
  let age = now.getUTCFullYear() - b.getUTCFullYear();
  const m = now.getUTCMonth() - b.getUTCMonth();
  if (m < 0 || (m === 0 && now.getUTCDate() < b.getUTCDate())) age--;
  return age >= 0 && age < 120 ? age : null;
}

export async function notifyTrialBooked({ clientId, trialBookingId, kind = "booked" }) {
  const result = { ok: false, sent: 0 };
  try {
    if (!clientId || !trialBookingId) return result;
    if (!(await academyRunsEvent(clientId))) return { ok: true, sent: 0, skipped: "preset does not declare the event" };

    const rows = await sb(
      `trial_bookings?id=eq.${encodeURIComponent(trialBookingId)}&tenant_id=eq.${encodeURIComponent(clientId)}`
      + `&select=id,parent_name,parent_phone,athlete_name,athlete_dob,schedule_slots(name,start_time,source_offer_class_key)&limit=1`,
    );
    const booking = Array.isArray(rows) ? rows[0] : rows;
    if (!booking) return { ok: true, sent: 0, skipped: "booking not found" };

    const cRows = await sb(`clients?id=eq.${encodeURIComponent(clientId)}&select=time_zone&limit=1`);
    const tz = (Array.isArray(cRows) && cRows[0] && cRows[0].time_zone) || null;
    const slot = booking.schedule_slots || {};
    // The class's real title from the academy's training offer, via the same
    // shared resolver the funnel and the agent use, so the owner's text and the
    // parent's confirmation cannot name the same class two different things.
    // Falls back to the raw slot name on its own.
    const className = parentFacingClassName(slot, await loadClassesFor(sb, clientId)) || slot.name || "";

    const message = renderTrialBookedSms({
      kind,
      className,
      athleteName: booking.athlete_name || "",
      athleteAge: ageFromDob(booking.athlete_dob),
      parentName: booking.parent_name || "",
      parentPhone: booking.parent_phone || "",
      when: formatSlotTime(slot.start_time, tz),
    });

    const r = await notifyOwners(clientId, TRIAL_BOOKED_EVENT, message);
    return { ok: !!(r && r.ok), sent: (r && r.sent) || 0, kind };
  } catch (e) {
    return { ok: false, sent: 0, error: String((e && e.message) || e) };
  }
}
