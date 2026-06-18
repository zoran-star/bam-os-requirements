import { withSentryApiRoute } from "../_sentry.js";
import { getClientGhlToken } from "../website/availability.js";
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
  const rows = await sb(`clients?id=eq.${clientId}&select=id,business_name,time_zone,ghl_location_id,ghl_access_token,ghl_refresh_token,ghl_token_expires_at,ghl_kpi_config&limit=1`);
  return rows?.[0] || null;
}

// Fallback for locations that have a GHL_LOCATIONS_JSON API key but no OAuth yet.
function apiKeyForLocation(locationId) {
  try {
    const locs = JSON.parse(process.env.GHL_LOCATIONS_JSON || "[]");
    return locs.find(l => l.locationId === locationId)?.apiKeyV2 || null;
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
    let token;
    try { token = await getClientGhlToken(client); }
    catch (e) {
      const apiKey = apiKeyForLocation(locationId);
      if (!apiKey) return res.status(502).json({ error: `GHL access: ${e.message}` });
      token = apiKey;
    }
    const action = (req.query && req.query.action) || (req.body && req.body.action) || "";

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
