import { withSentryApiRoute } from "../_sentry.js";
import { getClientGhlToken } from "../website/availability.js";
import { bookPortalTrial } from "../agent/booking.js";
import { recordKpiEvent } from "../_kpi.js";
// Multiple live GHL calls per request (calendars + events + appointment +
// contact) — give it headroom past the default ~10s budget.
export const maxDuration = 60;
// Vercel Serverless Function — V1.5 Calendars tab (booking management).
//
// A booking-management surface over the academy's GHL calendars (distinct from
// the V2 website-availability panel). Powers the weekly grid + slot/booking
// drawers + appointment status changes + settings (regular + special hours) +
// create-appointment-for-an-existing-contact.
//
//   GET  ?action=list                                   → all GHL calendars
//   GET  ?action=events&calendar_ids=a,b&start=ms&end=ms → events across calendars
//   GET  ?action=appointment&id=<apptId>                → appointment + full contact
//   GET  ?action=settings&calendar=<calId>              → regular + special hours + capacity
//   POST ?action=set-status   { id, status }            → change appointment status
//   POST ?action=settings     { calendar, openHours?, capacity?, special? } → write calendar
//   POST ?action=create-appointment { calendar, contactId, start, end? }    → book
//
// Auth: Supabase JWT — staff (any academy) or client_users member of client_id.
// GHL via the academy OAuth token (auto-refresh, shared with availability.js).

const GHL_V2 = "https://services.leadconnectorhq.com";
const V2_VERSION = "2021-07-28";
const SUPABASE_URL = (process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || "").trim();
const SUPABASE_SERVICE_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || "").trim();

// GHL appointment statuses the drawer can set.
const APPT_STATUSES = ["confirmed", "showed", "noshow", "cancelled", "invalid"];

async function sb(path, init = {}) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: { apikey: SUPABASE_SERVICE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`, "Content-Type": "application/json", ...(init.headers || {}) },
  });
  if (!r.ok) throw new Error(`Supabase ${r.status}: ${await r.text()}`);
  const t = await r.text();
  return t ? JSON.parse(t) : null;
}

async function resolveUser(req) {
  const token = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  if (!token) throw Object.assign(new Error("no token"), { status: 401 });
  const userRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { apikey: SUPABASE_SERVICE_KEY, Authorization: `Bearer ${token}` } });
  if (!userRes.ok) throw Object.assign(new Error("invalid token"), { status: 401 });
  const user = await userRes.json();
  let staff = await sb(`staff?user_id=eq.${user.id}&select=id&limit=1`);
  if ((!staff || !staff[0]) && user.email) staff = await sb(`staff?email=eq.${encodeURIComponent(user.email)}&select=id&limit=1`);
  const isStaff = Array.isArray(staff) && !!staff[0];
  const memberships = await sb(`client_users?user_id=eq.${user.id}&status=eq.active&select=client_id`);
  const clientIds = Array.isArray(memberships) ? memberships.map(m => m.client_id) : [];
  return { user, isStaff, clientIds };
}

async function ghl(token, method, path, body) {
  const r = await fetch(`${GHL_V2}${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, Version: V2_VERSION, Accept: "application/json", "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const txt = await r.text();
  let json = null;
  try { json = txt ? JSON.parse(txt) : null; } catch { json = { raw: txt }; }
  if (!r.ok) { const e = new Error(json?.message || json?.error || `GHL ${r.status}`); e.status = r.status; throw e; }
  return json;
}

const pad = n => String(n).padStart(2, "0");
// GHL occasionally returns array-ish fields (openHours, availabilities) as an
// object map. Coerce to a real array so downstream iteration never breaks.
const toArr = x => Array.isArray(x) ? x : (x && typeof x === "object" ? Object.values(x) : []);

// [midnight today, midnight tomorrow) as epoch-ms in an IANA timezone, so
// "trials today" matches the academy's local day, not the server's.
function todayBoundsMs(tz) {
  const tzOffsetMs = (d) => {
    const p = new Intl.DateTimeFormat("en-US", { timeZone: tz, hour12: false, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" })
      .formatToParts(d).reduce((a, x) => (a[x.type] = x.value, a), {});
    return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second) - d.getTime();
  };
  const now = new Date();
  const p = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" })
    .formatToParts(now).reduce((a, x) => (a[x.type] = x.value, a), {});
  const guess = Date.UTC(+p.year, +p.month - 1, +p.day, 0, 0, 0);
  const start = guess - tzOffsetMs(new Date(guess));
  return { start, end: start + 24 * 3600 * 1000 };
}

// availabilities[] (date overrides) → friendly {date, closed, open, close}.
function readSpecial(c) {
  const today = new Date().toISOString().slice(0, 10);
  return toArr(c.availabilities)
    .filter(a => !a.deleted)
    .map(a => {
      const h = (a.hours || [])[0];
      return {
        id: a._id || a.id || null,
        date: String(a.date).slice(0, 10),
        closed: !h,
        open: h ? `${pad(h.openHour)}:${pad(h.openMinute)}` : "",
        close: h ? `${pad(h.closeHour)}:${pad(h.closeMinute)}` : "",
      };
    })
    .filter(a => a.date >= today)
    .sort((a, b) => a.date.localeCompare(b.date));
}

function summarize(c) {
  return {
    id: c.id,
    name: c.name,
    isActive: c.isActive !== false,
    slotDuration: c.slotDuration,
    slotDurationUnit: c.slotDurationUnit || "mins",
    capacity: c.appoinmentPerSlot ?? null,
    openHours: toArr(c.openHours),
    special: readSpecial(c),
  };
}

async function loadClient(clientId) {
  const rows = await sb(`clients?id=eq.${clientId}&select=id,business_name,time_zone,ghl_location_id,ghl_access_token,ghl_refresh_token,ghl_token_expires_at,ghl_kpi_config,booking_provider&limit=1`);
  return rows?.[0] || null;
}

// ─────────────────────────────────────────────────────────────────────────────
// booking_provider='portal': the whole Calendars surface reads + writes the
// portal runtime spine (schedule_slots + trial_bookings) instead of GHL.
// Response shapes mirror the GHL branch exactly, so client-portal.html is
// untouched. Writes go through Luka's RPCs only (set_trial_outcome /
// cancel_trial_booking / book_trial_slot) - never direct inserts/updates.
// "Calendars" here = the academy's calendar entry_points; each maps to a
// template family by the "Group N" in its label.
// ─────────────────────────────────────────────────────────────────────────────

const TB_TO_GHL_STATUS = { BOOKED: "confirmed", SHOWED: "showed", NO_SHOW: "noshow", CANCELLED: "cancelled" };

function groupPrefixOf(label) {
  const m = /group\s*\d+/i.exec(String(label || ""));
  return m ? m[0].toLowerCase().replace(/\s+/g, " ") : null;
}
const slotMatchesGroup = (slotName, prefix) =>
  !prefix || String(slotName || "").toLowerCase().replace(/\s+/g, " ").includes(prefix);

// Whole-years age from a DOB (null if missing / unparseable). Athlete DOB is only
// present once the booking form captures it - falls back to the group band below.
function ageFromDob(dob) {
  if (!dob) return null;
  const d = new Date(dob);
  if (isNaN(d.getTime())) return null;
  const now = new Date();
  let a = now.getFullYear() - d.getFullYear();
  const m = now.getMonth() - d.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < d.getDate())) a--;
  return (a >= 0 && a < 120) ? a : null;
}
// The age band from a group slot name, e.g. "Group 1 (Elementary) - Weeknights"
// -> "Elementary". The parenthetical is the academy's own age-group label.
function groupFromSlot(name) {
  const m = String(name || "").match(/\(([^)]+)\)/);
  return m ? m[1].trim() : null;
}

async function portalCalendarEntries(clientId) {
  const rows = await sb(`entry_points?client_id=eq.${clientId}&type=eq.calendar&enabled=eq.true&select=key,label`);
  return (Array.isArray(rows) ? rows : []).map(r => ({ key: r.key, label: r.label || r.key, prefix: groupPrefixOf(r.label) }));
}

// One drawer-shaped contact from the portal contacts store (custom-field ids
// resolved to labels via custom_field_defs).
async function portalContactShape(clientId, ghlContactId) {
  if (!ghlContactId) return null;
  try {
    const rows = await sb(`contacts?client_id=eq.${clientId}&ghl_contact_id=eq.${encodeURIComponent(ghlContactId)}&select=ghl_contact_id,first_name,last_name,name,email,phone,tags,dnd,source,date_added,custom_fields&limit=1`);
    const c = rows?.[0];
    if (!c) return { id: ghlContactId };
    let cfNames = {};
    try {
      const defs = await sb(`custom_field_defs?client_id=eq.${clientId}&select=ghl_field_id,label`);
      for (const d of (defs || [])) if (d.ghl_field_id) cfNames[d.ghl_field_id] = d.label || null;
    } catch (_) {}
    const cf = c.custom_fields && typeof c.custom_fields === "object" ? c.custom_fields : {};
    return {
      id: c.ghl_contact_id,
      name: c.name || [c.first_name, c.last_name].filter(Boolean).join(" ") || null,
      firstName: c.first_name || null, lastName: c.last_name || null,
      email: c.email || null, phone: c.phone || null,
      tags: c.tags || [], dnd: !!c.dnd,
      source: c.source || null, type: null,
      dateAdded: c.date_added || null,
      customFields: Object.entries(cf).map(([id, value]) => ({ id, name: cfNames[id] || null, value })),
    };
  } catch (_) { return { id: ghlContactId }; }
}

// Bookings (trial_bookings joined to their slots) for a set of calendar entries
// within [startMs, endMs). Emits GHL-events-shaped rows.
async function portalBookingsInRange(clientId, entries, startMs, endMs, { includeCancelled = true } = {}) {
  const slots = (await sb(
    `schedule_slots?tenant_id=eq.${clientId}&start_time=gte.${encodeURIComponent(new Date(startMs).toISOString())}&start_time=lt.${encodeURIComponent(new Date(endMs).toISOString())}&select=id,name,start_time,end_time&limit=1000`
  )) || [];
  if (!slots.length) return [];
  const slotById = new Map(slots.map(s => [s.id, s]));
  const inList = slots.map(s => encodeURIComponent(s.id)).join(",");
  const tbs = (await sb(
    `trial_bookings?tenant_id=eq.${clientId}&slot_id=in.(${inList})&select=id,slot_id,status,ghl_contact_id,parent_name,athlete_name,athlete_dob&limit=2000`
  )) || [];
  const events = [];
  for (const tb of tbs) {
    if (!includeCancelled && tb.status === "CANCELLED") continue;
    const s = slotById.get(tb.slot_id);
    if (!s) continue;
    const entry = entries.find(e => slotMatchesGroup(s.name, e.prefix)) || entries[0];
    events.push({
      id: tb.id,
      calendarId: entry ? entry.key : null,
      start: s.start_time,
      end: s.end_time,
      title: tb.athlete_name || tb.parent_name || s.name || null,
      status: TB_TO_GHL_STATUS[tb.status] || null,
      contactId: tb.ghl_contact_id || null,
      contactName: tb.parent_name || tb.athlete_name || null,
      athlete: tb.athlete_name || null,
      parent: tb.parent_name || null,
      dob: tb.athlete_dob || null,
      slotName: s.name || null,
    });
  }
  return events;
}

async function portalHandler(req, res, { client, clientId, action }) {
  const timezone = client.time_zone || "America/Toronto";

  if (req.method === "GET") {
    if (action === "list") {
      const entries = await portalCalendarEntries(clientId);
      // capacity from the matching slot templates (falls back to null).
      let tpls = [];
      try { tpls = (await sb(`slot_templates?tenant_id=eq.${clientId}&is_active=eq.true&select=name,default_capacity`)) || []; } catch (_) {}
      const calendars = entries.map(e => {
        const t = tpls.find(t => slotMatchesGroup(t.name, e.prefix));
        return { id: e.key, name: e.label, isActive: true, slotDuration: 60, slotDurationUnit: "mins", capacity: t ? t.default_capacity : null };
      }).sort((a, b) => String(a.name || "").localeCompare(String(b.name || "")));
      return res.status(200).json({ calendars, timezone });
    }

    if (action === "events") {
      const ids = String((req.query && req.query.calendar_ids) || "").split(",").map(s => s.trim()).filter(Boolean);
      const start = Number(req.query.start), end = Number(req.query.end);
      if (!ids.length || !start || !end) return res.status(400).json({ error: "calendar_ids + start + end required" });
      const entries = (await portalCalendarEntries(clientId)).filter(e => ids.includes(e.key));
      const all = await portalBookingsInRange(clientId, entries.length ? entries : await portalCalendarEntries(clientId), start, end);
      return res.status(200).json({ events: all.filter(ev => !ev.calendarId || ids.includes(ev.calendarId)) });
    }

    if (action === "trials-today") {
      const cfg = client.ghl_kpi_config || {};
      const calIds = Array.isArray(cfg.booking_calendar_ids) ? cfg.booking_calendar_ids.filter(Boolean) : [];
      const entries = (await portalCalendarEntries(clientId)).filter(e => !calIds.length || calIds.includes(e.key));
      const { start, end } = todayBoundsMs(timezone);
      const evs = await portalBookingsInRange(clientId, entries, start, end, { includeCancelled: false });
      const trials = evs
        .map(ev => ({
          id: ev.id, start: ev.start, status: ev.status, contactId: ev.contactId,
          contactName: ev.contactName || "Trial booking",
          athlete: ev.athlete || null,
          parent: ev.parent || null,
          age: ageFromDob(ev.dob),          // exact age once DOB is captured, else null
          group: groupFromSlot(ev.slotName), // age-band fallback, e.g. "Elementary"
        }))
        .sort((a, b) => new Date(a.start || 0) - new Date(b.start || 0));
      return res.status(200).json({ trials, timezone });
    }

    if (action === "slots-today") {
      // Today's full session schedule (schedule_slots) with fill counts - the
      // Home "Today's schedule" panel. Trials-as-people come from trials-today;
      // this is the room-level view (session name + booked/capacity).
      const { start, end } = todayBoundsMs(timezone);
      let rows = [];
      try {
        rows = (await sb(
          `schedule_slots?tenant_id=eq.${clientId}&is_cancelled=eq.false&start_time=gte.${encodeURIComponent(new Date(start).toISOString())}&start_time=lt.${encodeURIComponent(new Date(end).toISOString())}&select=id,name,start_time,end_time,capacity&order=start_time.asc&limit=200`
        )) || [];
      } catch (_) { rows = []; }
      const counts = new Map();
      if (rows.length) {
        try {
          const c = await sb(`rpc/slot_spots_taken_bulk`, {
            method: "POST",
            body: JSON.stringify({ p_tenant_id: clientId, p_slot_ids: rows.map(r => r.id) }),
          });
          for (const row of (c || [])) counts.set(row.slot_id, Number(row.spots_taken || 0));
        } catch (_) { /* fill counts are best-effort */ }
      }
      const slots = rows.map(s => ({
        id: s.id, name: s.name, start: s.start_time, end: s.end_time,
        capacity: s.capacity, booked: counts.has(s.id) ? counts.get(s.id) : null,
      }));
      return res.status(200).json({ slots, timezone });
    }

    if (action === "appointment") {
      const id = req.query.id;
      if (!id) return res.status(400).json({ error: "id required" });
      const rows = await sb(`trial_bookings?tenant_id=eq.${clientId}&id=eq.${encodeURIComponent(id)}&select=id,slot_id,status,ghl_contact_id,parent_name,athlete_name,metadata&limit=1`);
      const tb = rows?.[0];
      if (!tb) return res.status(404).json({ error: "booking not found" });
      let slot = null;
      try { slot = ((await sb(`schedule_slots?id=eq.${tb.slot_id}&select=name,start_time,end_time,location_label&limit=1`)) || [])[0]; } catch (_) {}
      const contact = await portalContactShape(clientId, tb.ghl_contact_id);
      return res.status(200).json({
        appointment: {
          id: tb.id,
          calendarId: null,
          title: slot?.name || "Free Trial",
          status: TB_TO_GHL_STATUS[tb.status] || null,
          start: slot?.start_time || null,
          end: slot?.end_time || null,
          notes: null,
          address: slot?.location_label || null,
        },
        contact,
        statuses: APPT_STATUSES,
      });
    }

    if (action === "contact") {
      const cid = req.query.id;
      if (!cid) return res.status(400).json({ error: "id required" });
      const contact = await portalContactShape(clientId, cid);
      return res.status(200).json({ contact, location_id: client.ghl_location_id || null });
    }

    if (action === "settings") {
      const calId = req.query.calendar;
      if (!calId) return res.status(400).json({ error: "calendar required" });
      const entries = await portalCalendarEntries(clientId);
      const entry = entries.find(e => e.key === calId);
      let tpls = [];
      try { tpls = (await sb(`slot_templates?tenant_id=eq.${clientId}&is_active=eq.true&select=name,default_capacity,default_start_time,default_end_time,recurrence_rule`)) || []; } catch (_) {}
      const mine = tpls.filter(t => slotMatchesGroup(t.name, entry ? entry.prefix : null));
      const DOW = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 };
      const openHours = mine.map(t => {
        const daysTok = String(t.recurrence_rule || "").replace(/^WEEKLY:/i, "").split(",").map(s => s.trim()).filter(Boolean);
        const [oh, om] = String(t.default_start_time || "00:00").split(":").map(Number);
        const [ch, cm] = String(t.default_end_time || "00:00").split(":").map(Number);
        return { daysOfTheWeek: daysTok.map(d => DOW[d]).filter(d => d != null), hours: [{ openHour: oh || 0, openMinute: om || 0, closeHour: ch || 0, closeMinute: cm || 0 }] };
      });
      return res.status(200).json({ calendar: {
        id: calId, name: entry ? entry.label : calId, isActive: true,
        slotDuration: 60, slotDurationUnit: "mins",
        capacity: mine[0] ? mine[0].default_capacity : null,
        openHours, special: [],
        read_only: true,   // schedule edits go through the schedule templates, not here
      } });
    }

    return res.status(400).json({ error: "unknown action" });
  }

  if (req.method === "POST") {
    const b = (req.body && typeof req.body === "object") ? req.body : {};

    if (action === "set-status") {
      const id = b.id, status = b.status;
      if (!id || !APPT_STATUSES.includes(status)) return res.status(400).json({ error: "id + valid status required" });
      try {
        if (status === "cancelled" || status === "invalid") {
          await sb(`rpc/cancel_trial_booking`, { method: "POST", body: JSON.stringify({ p_tenant_id: clientId, p_trial_booking_id: id }) });
        } else {
          const map = { confirmed: "BOOKED", showed: "SHOWED", noshow: "NO_SHOW" };
          await sb(`rpc/set_trial_outcome`, { method: "POST", body: JSON.stringify({ p_tenant_id: clientId, p_trial_booking_id: id, p_status: map[status] }) });
        }
      } catch (e) { return res.status(502).json({ error: `status update failed: ${e.message}` }); }
      // KPI event log: attended / no-show from the calendar drawer (idempotent).
      if (status === "showed" || status === "noshow") {
        try {
          const tb = ((await sb(`trial_bookings?tenant_id=eq.${clientId}&id=eq.${encodeURIComponent(id)}&select=ghl_contact_id,parent_name&limit=1`)) || [])[0];
          await recordKpiEvent({
            clientId, step: status === "showed" ? "trial_attended" : "trial_no_show",
            ghlContactId: tb?.ghl_contact_id || null, contactName: tb?.parent_name || null,
            ref: `trialoutcome-tb:${id}`, meta: { trial_booking_id: id, via: "calendar-drawer" },
          });
        } catch (_) {}
      }
      return res.status(200).json({ ok: true, id, status });
    }

    if (action === "create-appointment") {
      const calId = b.calendar, contactId = b.contactId, start = b.start;
      if (!calId || !contactId || !start) return res.status(400).json({ error: "calendar + contactId + start required" });
      const entries = await portalCalendarEntries(clientId);
      const entry = entries.find(e => e.key === calId);
      try {
        const tbId = await bookPortalTrial(clientId, { slotAtIso: new Date(start).toISOString(), calLabel: entry ? entry.label : null, contactId, contactName: b.title || null });
        return res.status(200).json({ ok: true, appointment: { id: tbId, calendarId: calId, startTime: new Date(start).toISOString() } });
      } catch (e) { return res.status(502).json({ error: `book: ${e.message}` }); }
    }

    if (action === "settings") {
      return res.status(400).json({ error: "This academy's schedule is managed on the portal calendar system - session hours and capacity are edited through the schedule templates, not here." });
    }

    return res.status(400).json({ error: "unknown action" });
  }

  return res.status(405).json({ error: "GET or POST" });
}

// Fallback for locations that have a GHL_LOCATIONS_JSON API key but no OAuth yet.
function apiKeyForLocation(locationId) {
  try {
    const locs = JSON.parse(process.env.GHL_LOCATIONS_JSON || "[]");
    const loc = locs.find(l => l.locationId === locationId);
    return (loc?.apiKeyV2 || loc?.apiKey) || null;
  } catch { return null; }
}

async function handler(req, res) {
  try {
    if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) return res.status(500).json({ error: "Supabase not configured" });
    const ctx = await resolveUser(req);
    const clientId = (req.query && req.query.client_id) || (req.body && req.body.client_id) || ctx.clientIds[0];
    if (!clientId) return res.status(400).json({ error: "client_id required" });
    if (!ctx.isStaff && !ctx.clientIds.includes(clientId)) return res.status(403).json({ error: "not your academy" });

    const client = await loadClient(clientId);
    if (!client) return res.status(404).json({ error: "academy not found" });
    const locationId = client.ghl_location_id;
    const action = (req.query && req.query.action) || (req.body && req.body.action) || "";

    // Per-contact trial date + coach for the contact drawer. Supabase-only and
    // provider-agnostic (runs before the portal split, no GHL token needed) so the
    // drawer can show the trial + coach without loading the whole pipeline first.
    // Sources, best-effort in order: portal trial_bookings → website_leads.booked_slot
    // for the date; latest post_trial_reviews for the coach. Missing data → null.
    if (action === "contact-trial") {
      const cid = (req.query && req.query.id) || (req.body && req.body.id) || "";
      if (!cid) return res.status(400).json({ error: "id required" });
      const enc = encodeURIComponent(String(cid));
      let trial_date = null, trial_status = null, coach = null;
      try {
        const pr = await sb(`post_trial_reviews?client_id=eq.${clientId}&ghl_contact_id=eq.${enc}&select=trainer&order=created_at.desc&limit=1`);
        coach = (Array.isArray(pr) && pr[0] && pr[0].trainer) || null;
      } catch (_) {}
      try {
        const tb = await sb(`trial_bookings?tenant_id=eq.${clientId}&ghl_contact_id=eq.${enc}&select=status,created_at,schedule_slots(start_time)&order=created_at.desc&limit=1`);
        const row = Array.isArray(tb) && tb[0];
        if (row) { trial_date = (row.schedule_slots && row.schedule_slots.start_time) || null; trial_status = row.status || null; }
      } catch (_) {}
      if (!trial_date) {
        try {
          const wl = await sb(`website_leads?client_id=eq.${clientId}&ghl_contact_id=eq.${enc}&select=fields,created_at&order=created_at.desc&limit=50`);
          for (const r of (Array.isArray(wl) ? wl : [])) { const bs = r && r.fields && r.fields.booked_slot; if (bs) { trial_date = bs; break; } }
        } catch (_) {}
      }
      return res.status(200).json({ trial_date, trial_status, coach });
    }

    // booking_provider='portal': the entire surface runs on the portal spine -
    // no GHL token needed at all. Every other academy continues below unchanged.
    if (client.booking_provider === "portal") {
      return await portalHandler(req, res, { client, clientId, action });
    }

    let token;
    try { token = await getClientGhlToken(client); }
    catch (e) {
      const apiKey = apiKeyForLocation(locationId);
      if (!apiKey) return res.status(502).json({ error: `GHL access: ${e.message}` });
      token = apiKey;
    }

    // ─────────────── GET ───────────────
    if (req.method === "GET") {
      if (action === "list") {
        const r = await ghl(token, "GET", `/calendars/?locationId=${encodeURIComponent(locationId)}`);
        const cals = (r.calendars || []).map(c => ({
          id: c.id, name: c.name, isActive: c.isActive !== false,
          slotDuration: c.slotDuration, slotDurationUnit: c.slotDurationUnit || "mins",
          capacity: c.appoinmentPerSlot ?? null,
        })).sort((a, b) => String(a.name || "").localeCompare(String(b.name || "")));
        return res.status(200).json({ calendars: cals, timezone: client.time_zone || "America/Toronto" });
      }

      if (action === "events") {
        const ids = String((req.query && req.query.calendar_ids) || "").split(",").map(s => s.trim()).filter(Boolean);
        const start = Number(req.query.start), end = Number(req.query.end);
        if (!ids.length || !start || !end) return res.status(400).json({ error: "calendar_ids + start + end required" });
        const events = [];
        for (const calId of ids) {
          try {
            const r = await ghl(token, "GET", `/calendars/events?locationId=${encodeURIComponent(locationId)}&calendarId=${encodeURIComponent(calId)}&startTime=${start}&endTime=${end}`);
            for (const ev of (r.events || [])) {
              // GHL leaks events past endTime - keep only those starting in range.
              const t = ev.startTime ? new Date(ev.startTime).getTime() : NaN;
              if (!(t >= start && t < end)) continue;
              events.push({
                id: ev.id || ev._id,
                calendarId: calId,
                start: ev.startTime,
                end: ev.endTime,
                title: ev.title || null,
                status: ev.appointmentStatus || null,
                contactId: ev.contactId || (ev.contact && ev.contact.id) || null,
                contactName: (ev.contact && ev.contact.name) || ev.contactName || ev.title || null,
              });
            }
          } catch (_) { /* one calendar failing shouldn't kill the week */ }
        }
        return res.status(200).json({ events });
      }

      // Today's trial bookings — for the V1.5 Home dashboard. Trial calendars are
      // whatever staff picked in KPI config (clients.ghl_kpi_config.booking_calendar_ids).
      if (action === "trials-today") {
        const cfg = client.ghl_kpi_config || {};
        const calIds = Array.isArray(cfg.booking_calendar_ids) ? cfg.booking_calendar_ids.filter(Boolean) : [];
        if (!calIds.length) return res.status(200).json({ trials: [], no_config: true });
        const { start, end } = todayBoundsMs(client.time_zone || "America/Toronto");
        const nameById = {};
        let trials = [];
        for (const calId of calIds) {
          try {
            const r = await ghl(token, "GET", `/calendars/events?locationId=${encodeURIComponent(locationId)}&calendarId=${encodeURIComponent(calId)}&startTime=${start}&endTime=${end}`);
            for (const ev of (r.events || [])) {
              if (ev.appointmentStatus === "cancelled") continue;
              // GHL's /calendars/events leaks events past endTime (it returned
              // tomorrow's trials too), so re-check the real start is within today.
              const t = ev.startTime ? new Date(ev.startTime).getTime() : NaN;
              if (!(t >= start && t < end)) continue;
              const cid = ev.contactId || (ev.contact && ev.contact.id) || null;
              trials.push({ id: ev.id || ev._id, start: ev.startTime, status: ev.appointmentStatus || null, contactId: cid, contactName: (ev.contact && ev.contact.name) || ev.contactName || null });
            }
          } catch (_) {}
        }
        // Calendar events rarely carry the contact name — resolve the misses from
        // GHL so we show the person, not the calendar title (capped).
        const missing = [...new Set(trials.filter(t => !t.contactName && t.contactId).map(t => t.contactId))].slice(0, 25);
        await Promise.all(missing.map(async (cid) => {
          try {
            const cr = await ghl(token, "GET", `/contacts/${encodeURIComponent(cid)}`);
            const c = cr.contact || cr;
            nameById[cid] = c.contactName || [c.firstName, c.lastName].filter(Boolean).join(" ") || c.name || null;
          } catch (_) {}
        }));
        trials = trials.map(t => ({ ...t, contactName: t.contactName || (t.contactId && nameById[t.contactId]) || "Trial booking" }))
          .sort((a, b) => new Date(a.start || 0) - new Date(b.start || 0));
        return res.status(200).json({ trials, timezone: client.time_zone || "America/Toronto" });
      }

      if (action === "appointment") {
        const id = req.query.id;
        if (!id) return res.status(400).json({ error: "id required" });
        const ar = await ghl(token, "GET", `/calendars/events/appointments/${encodeURIComponent(id)}`);
        const appt = ar.appointment || ar.event || ar;
        let contact = null;
        const cid = appt.contactId || (appt.contact && appt.contact.id);
        if (cid) {
          try {
            const cr = await ghl(token, "GET", `/contacts/${encodeURIComponent(cid)}`);
            const c = cr.contact || cr;
            // Resolve custom-field IDs → human labels so the drawer shows
            // "Skill level: Intermediate", not "894T652B: Intermediate".
            let cfNames = {};
            try {
              const fr = await ghl(token, "GET", `/locations/${encodeURIComponent(locationId)}/customFields`);
              for (const d of (fr.customFields || [])) cfNames[d.id] = d.name || d.fieldKey || null;
            } catch (_) {}
            contact = {
              id: c.id, name: c.contactName || [c.firstName, c.lastName].filter(Boolean).join(" ") || c.name || null,
              firstName: c.firstName || null, lastName: c.lastName || null,
              email: c.email || null, phone: c.phone || null,
              tags: c.tags || [], dnd: !!c.dnd,
              source: c.source || null, type: c.type || null,
              dateAdded: c.dateAdded || null,
              customFields: (c.customFields || c.customField || []).map(f => ({ id: f.id, name: cfNames[f.id] || null, value: f.value != null ? f.value : f.field_value })),
            };
          } catch (_) { contact = { id: cid }; }
        }
        return res.status(200).json({
          appointment: {
            id: appt.id || appt._id || id,
            calendarId: appt.calendarId || null,
            title: appt.title || null,
            status: appt.appointmentStatus || null,
            start: appt.startTime || null,
            end: appt.endTime || null,
            notes: appt.notes || null,
            address: appt.address || null,
          },
          contact,
          statuses: APPT_STATUSES,
        });
      }

      // Full GHL contact by id — used by the KPIs "click a name" drawer.
      if (action === "contact") {
        const cid = req.query.id;
        if (!cid) return res.status(400).json({ error: "id required" });
        let cfNames = {};
        try {
          const fr = await ghl(token, "GET", `/locations/${encodeURIComponent(locationId)}/customFields`);
          for (const d of (fr.customFields || [])) cfNames[d.id] = d.name || d.fieldKey || null;
        } catch (_) {}
        const cr = await ghl(token, "GET", `/contacts/${encodeURIComponent(cid)}`);
        const c = cr.contact || cr;
        return res.status(200).json({
          contact: {
            id: c.id, name: c.contactName || [c.firstName, c.lastName].filter(Boolean).join(" ") || c.name || null,
            firstName: c.firstName || null, lastName: c.lastName || null,
            email: c.email || null, phone: c.phone || null,
            tags: c.tags || [], dnd: !!c.dnd,
            source: c.source || null, type: c.type || null,
            dateAdded: c.dateAdded || null,
            customFields: (c.customFields || c.customField || []).map(f => ({ id: f.id, name: cfNames[f.id] || null, value: f.value != null ? f.value : f.field_value })),
          },
          location_id: locationId,   // for the "Open in GHL" deep link
        });
      }

      if (action === "settings") {
        const calId = req.query.calendar;
        if (!calId) return res.status(400).json({ error: "calendar required" });
        const r = await ghl(token, "GET", `/calendars/${encodeURIComponent(calId)}`);
        return res.status(200).json({ calendar: summarize(r.calendar || r) });
      }

      return res.status(400).json({ error: "unknown action" });
    }

    // ─────────────── POST ───────────────
    if (req.method === "POST") {
      const b = (req.body && typeof req.body === "object") ? req.body : {};

      if (action === "set-status") {
        const id = b.id, status = b.status;
        if (!id || !APPT_STATUSES.includes(status)) return res.status(400).json({ error: "id + valid status required" });
        await ghl(token, "PUT", `/calendars/events/appointments/${encodeURIComponent(id)}`, { appointmentStatus: status });
        return res.status(200).json({ ok: true, id, status });
      }

      if (action === "create-appointment") {
        const calId = b.calendar, contactId = b.contactId, start = b.start;
        if (!calId || !contactId || !start) return res.status(400).json({ error: "calendar + contactId + start required" });
        const startTime = new Date(start).toISOString();
        const endTime = b.end ? new Date(b.end).toISOString() : null;
        const payload = {
          calendarId: calId, locationId, contactId, startTime,
          ...(endTime ? { endTime } : {}),
          ...(b.title ? { title: b.title } : {}),
          appointmentStatus: "confirmed",
          ignoreDateRange: true, toNotify: true,
        };
        const r = await ghl(token, "POST", `/calendars/events/appointments`, payload);
        return res.status(200).json({ ok: true, appointment: r.appointment || r });
      }

      if (action === "settings") {
        const calId = b.calendar;
        if (!calId) return res.status(400).json({ error: "calendar required" });
        const update = {};
        if (Array.isArray(b.openHours)) update.openHours = b.openHours;
        if (b.capacity !== undefined && b.capacity !== null) update.appoinmentPerSlot = Math.max(1, Number(b.capacity));
        // Special hours = date-specific availability overrides. Merge with the
        // current set so existing ids are reused (and dropped dates get deleted).
        if (Array.isArray(b.special)) {
          const cur = await ghl(token, "GET", `/calendars/${encodeURIComponent(calId)}`);
          const existing = ((cur.calendar || cur).availabilities || []).filter(a => !a.deleted);
          const byDate = {};
          for (const a of existing) byDate[String(a.date).slice(0, 10)] = a;
          const incomingDates = new Set();
          const availabilities = [];
          for (const sp of b.special) {
            const date = String(sp.date || "").slice(0, 10);
            if (!date) continue;
            incomingDates.add(date);
            const prev = byDate[date];
            let hours = [];
            if (!sp.closed) {
              const [oh, om] = String(sp.open || "").split(":");
              const [ch, cm] = String(sp.close || "").split(":");
              if (oh != null && ch != null && om != null && cm != null && oh !== "" && ch !== "") {
                hours = [{ openHour: +oh, openMinute: +om, closeHour: +ch, closeMinute: +cm }];
              }
            }
            availabilities.push({ ...(prev && (prev._id || prev.id) ? { id: prev._id || prev.id } : {}), date: `${date}T00:00:00.000Z`, hours, deleted: false });
          }
          // dates removed in the UI → mark deleted so GHL drops them
          for (const a of existing) {
            const d = String(a.date).slice(0, 10);
            if (!incomingDates.has(d)) availabilities.push({ id: a._id || a.id, date: a.date, hours: a.hours || [], deleted: true });
          }
          update.availabilities = availabilities;
        }
        if (!Object.keys(update).length) return res.status(400).json({ error: "nothing to update" });
        const result = await ghl(token, "PUT", `/calendars/${encodeURIComponent(calId)}`, update);
        return res.status(200).json({ ok: true, calendar: summarize(result.calendar || result) });
      }

      return res.status(400).json({ error: "unknown action" });
    }

    return res.status(405).json({ error: "GET or POST" });
  } catch (e) {
    let msg = e && e.message; if (!msg) { try { msg = JSON.stringify(e); } catch (_) { msg = String(e); } }
    console.error("calendars-v15 error:", msg, e && e.stack);
    return res.status((e && e.status) || 500).json({ error: msg || "unknown error" });
  }
}

export default withSentryApiRoute(handler);
