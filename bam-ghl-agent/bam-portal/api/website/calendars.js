// Vercel Serverless Function — Booking calendar management (per academy)
//
//   GET   /api/website/calendars?client_id=<uuid>
//     → entry-point calendars with their live GHL config + upcoming bookings:
//       [{ id, label, ghl: { name, slotDuration, capacity, openHours,
//          blockedDates }, upcoming: [{ start, title, contactName }] }]
//
//   PATCH /api/website/calendars?client_id=<uuid>&calendar=<ghl id>
//     body: { openHours?, capacity?, blockDate?, unblockDate? }
//     → writes to the GHL calendar. openHours uses GHL's shape
//       ([{daysOfTheWeek:[d], hours:[{openHour,openMinute,closeHour,closeMinute}]}]).
//       blockDate/unblockDate are 'YYYY-MM-DD' date overrides (empty hours).
//
//   POST  /api/website/calendars?client_id=<uuid>
//     body: { name, capacity, slotDurationMinutes, openHours }
//     → creates the GHL event calendar AND its entry_points row.
//
// Auth: Supabase JWT — staff, or client_users membership (same as
// entry-points). GHL access via the academy OAuth token (auto-refresh).

import { withSentryApiRoute } from "../_sentry.js";
import { getClientGhlToken } from "./availability.js";

const SUPABASE_URL = (process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || "").trim();
const SUPABASE_SERVICE_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || "").trim();
const GHL_V2 = "https://services.leadconnectorhq.com";
const V2_VERSION = "2021-07-28";

async function sb(path, init = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: SUPABASE_SERVICE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
  });
  if (!res.ok) throw new Error(`Supabase ${res.status}: ${await res.text()}`);
  const txt = await res.text();
  return txt ? JSON.parse(txt) : null;
}

async function resolveUser(req) {
  const token = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  if (!token) throw Object.assign(new Error("no token"), { status: 401 });
  const userRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: SUPABASE_SERVICE_KEY, Authorization: `Bearer ${token}` },
  });
  if (!userRes.ok) throw Object.assign(new Error("invalid token"), { status: 401 });
  const user = await userRes.json();

  let staff = await sb(`staff?user_id=eq.${user.id}&select=id,role&limit=1`);
  if ((!staff || !staff[0]) && user.email) {
    staff = await sb(`staff?email=eq.${encodeURIComponent(user.email)}&select=id,role&limit=1`);
  }
  const isStaff = Array.isArray(staff) && staff[0];

  const memberships = await sb(
    `client_users?user_id=eq.${user.id}&status=eq.active&select=client_id`
  );
  const clientIds = Array.isArray(memberships) ? memberships.map(m => m.client_id) : [];
  return { user, isStaff, clientIds };
}

async function ghl(token, method, path, body) {
  const r = await fetch(`${GHL_V2}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Version: V2_VERSION,
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const txt = await r.text();
  let json = null;
  try { json = txt ? JSON.parse(txt) : null; } catch { json = { raw: txt }; }
  if (!r.ok) throw new Error(json?.message || json?.error || `GHL ${r.status}`);
  return json;
}

function summarizeCalendar(c) {
  const blockedDates = (c.availabilities || [])
    .filter(a => Array.isArray(a.hours) && a.hours.length === 0 && !a.deleted)
    .map(a => ({ id: a._id || a.id, date: String(a.date).slice(0, 10) }))
    .filter(a => a.date >= new Date().toISOString().slice(0, 10));
  return {
    name: c.name,
    isActive: c.isActive !== false,
    slotDuration: c.slotDuration,
    slotDurationUnit: c.slotDurationUnit || "minutes",
    capacity: c.appoinmentPerSlot ?? null,
    openHours: c.openHours || [],
    blockedDates,
  };
}

async function loadClient(clientId) {
  const rows = await sb(
    `clients?id=eq.${clientId}&select=id,time_zone,ghl_location_id,ghl_kpi_config,ghl_access_token,ghl_refresh_token,ghl_token_expires_at&limit=1`
  );
  return rows?.[0] || null;
}

async function handler(req, res) {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    return res.status(500).json({ error: "Supabase not configured" });
  }

  let ctx;
  try { ctx = await resolveUser(req); }
  catch (e) { return res.status(e.status || 401).json({ error: e.message }); }

  const clientId = req.query.client_id;
  if (!clientId) return res.status(400).json({ error: "client_id required" });
  if (!ctx.isStaff && !ctx.clientIds.includes(clientId)) {
    return res.status(403).json({ error: "not your academy" });
  }

  let client;
  try { client = await loadClient(clientId); }
  catch (e) { return res.status(500).json({ error: e.message }); }
  if (!client) return res.status(404).json({ error: "academy not found" });

  let token;
  try { token = await getClientGhlToken(client); }
  catch (e) { return res.status(502).json({ error: `GHL access: ${e.message}` }); }

  // ── GET: entry-point calendars + config + upcoming bookings ──
  if (req.method === "GET") {
    try {
      const eps = await sb(
        `entry_points?client_id=eq.${clientId}&type=eq.calendar&enabled=eq.true&select=id,key,label,pipeline_name,stage_name&order=label.asc`
      );
      const now = Date.now();
      const horizon = now + 28 * 24 * 3600 * 1000;
      const out = [];
      for (const ep of eps || []) {
        let ghlCal = null, upcoming = [];
        try {
          const calRes = await ghl(token, "GET", `/calendars/${encodeURIComponent(ep.key)}`);
          ghlCal = summarizeCalendar(calRes.calendar || calRes);
        } catch (e) { ghlCal = { error: e.message }; }
        try {
          const evRes = await ghl(token, "GET",
            `/calendars/events?locationId=${encodeURIComponent(client.ghl_location_id)}&calendarId=${encodeURIComponent(ep.key)}&startTime=${now}&endTime=${horizon}`);
          upcoming = (evRes.events || [])
            .filter(ev => ev.appointmentStatus !== "cancelled")
            .map(ev => ({
              start: ev.startTime,
              title: ev.title || null,
              contactName: ev.contact?.name || ev.contactName || null,
              status: ev.appointmentStatus || null,
            }))
            .sort((a, b) => String(a.start).localeCompare(String(b.start)))
            .slice(0, 50);
        } catch { /* events optional */ }
        out.push({ entry_point_id: ep.id, calendar_id: ep.key, label: ep.label, pipeline_name: ep.pipeline_name, stage_name: ep.stage_name, ghl: ghlCal, upcoming });
      }
      return res.status(200).json({ calendars: out, timezone: client.time_zone || "America/Toronto" });
    } catch (e) { return res.status(500).json({ error: e.message }); }
  }

  // ── PATCH: update hours / capacity / blocked dates ──
  if (req.method === "PATCH") {
    const calendarId = req.query.calendar;
    if (!calendarId) return res.status(400).json({ error: "calendar required" });
    try {
      const eps = await sb(
        `entry_points?client_id=eq.${clientId}&type=eq.calendar&key=eq.${encodeURIComponent(calendarId)}&enabled=eq.true&select=id&limit=1`
      );
      if (!eps?.[0]) return res.status(404).json({ error: "calendar not available" });
    } catch (e) { return res.status(500).json({ error: e.message }); }

    const b = req.body || {};
    const update = {};
    if (Array.isArray(b.openHours)) update.openHours = b.openHours;
    if (b.capacity !== undefined) update.appoinmentPerSlot = Number(b.capacity);

    try {
      if (b.blockDate || b.unblockDate) {
        const calRes = await ghl(token, "GET", `/calendars/${encodeURIComponent(calendarId)}`);
        const cal = calRes.calendar || calRes;
        let availabilities = (cal.availabilities || []).map(a => ({
          id: a._id || a.id, date: a.date, hours: a.hours || [], deleted: false,
        }));
        if (b.blockDate) {
          const iso = `${b.blockDate}T00:00:00.000Z`;
          if (!availabilities.some(a => String(a.date).slice(0, 10) === b.blockDate)) {
            availabilities.push({ date: iso, hours: [], deleted: false });
          }
        }
        if (b.unblockDate) {
          availabilities = availabilities.map(a =>
            String(a.date).slice(0, 10) === b.unblockDate ? { ...a, deleted: true } : a
          );
        }
        update.availabilities = availabilities;
      }
      if (!Object.keys(update).length) return res.status(400).json({ error: "nothing to update" });
      const result = await ghl(token, "PUT", `/calendars/${encodeURIComponent(calendarId)}`, update);
      return res.status(200).json({ ok: true, calendar: summarizeCalendar(result.calendar || result) });
    } catch (e) { return res.status(502).json({ error: e.message }); }
  }

  // ── POST: create a new booking calendar + entry point ──
  if (req.method === "POST") {
    const b = req.body || {};
    const name = (b.name || "").trim();
    if (!name) return res.status(400).json({ error: "name required" });
    const capacity = Math.max(1, Number(b.capacity) || 1);
    const slotMinutes = Math.max(15, Number(b.slotDurationMinutes) || 60);
    const openHours = Array.isArray(b.openHours) ? b.openHours : [];

    try {
      const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")
        + "-" + Math.abs([...name + clientId].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) | 0, 7)).toString(36).slice(0, 5);
      const created = await ghl(token, "POST", "/calendars/", {
        locationId: client.ghl_location_id,
        name,
        calendarType: "event",
        slug,
        widgetSlug: slug,
        slotDuration: slotMinutes,
        slotDurationUnit: "mins",
        appoinmentPerSlot: capacity,
        openHours,
        autoConfirm: true,
        isActive: true,
      });
      const cal = created.calendar || created;
      if (!cal.id) throw new Error("GHL did not return a calendar id");

      const rows = await sb("entry_points", {
        method: "POST",
        headers: { Prefer: "return=representation" },
        body: JSON.stringify({
          client_id: clientId,
          type: "calendar",
          key: cal.id,
          label: `Booking Calendar: ${name}`,
          tags: [],
        }),
      });
      return res.status(200).json({ ok: true, calendar_id: cal.id, entry_point_id: rows?.[0]?.id });
    } catch (e) { return res.status(502).json({ error: e.message }); }
  }

  return res.status(405).json({ error: "GET, PATCH or POST required" });
}

export default withSentryApiRoute(handler);
