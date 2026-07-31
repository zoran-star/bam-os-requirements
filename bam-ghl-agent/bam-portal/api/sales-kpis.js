// Vercel Serverless Function - mobile Sales preset card KPIs (read-only).
//
//   GET /api/sales-kpis?client_id=<uuid>
//     -> { qualified, closed, sales_week, closed_rows, open_rows }
//
//   qualified  = post_trial_reviews in the last 30 days marked showed_up=true
//                AND good_fit=true (the "qualified trials" population)
//   closed     = of those, how many trial bookings converted (trial_bookings.
//                converted_member_id set OR status CONVERTED)
//   sales_week = trial_bookings with converted_at in the last 7 days
//   closed_rows / open_rows feed the "Qualified trials" focus overlay:
//     { athlete, parent, contact_id, trial_at[, converted_at] } - trial_at is
//     the booked slot's start_time, falling back to booked_at / review time.
//
// Read-only SELECTs through the service-role sb() helper (same pattern as
// api/ghl/cc-sales-kpis.js). This endpoint never writes anything.
//
// Auth: Supabase JWT - staff (any academy) or a client_users member of client_id.

import { withSentryApiRoute } from "./_sentry.js";

const SUPABASE_URL = (process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || "").trim();
const SUPABASE_SERVICE_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || "").trim();

async function sb(path) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: { apikey: SUPABASE_SERVICE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`, Accept: "application/json" },
  });
  if (!res.ok) throw new Error(`Supabase ${res.status}: ${await res.text()}`);
  const t = await res.text();
  return t ? JSON.parse(t) : [];
}

async function resolveUser(req) {
  const token = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  if (!token) throw Object.assign(new Error("no token"), { status: 401 });
  const userRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: SUPABASE_SERVICE_KEY, Authorization: `Bearer ${token}` },
  });
  if (!userRes.ok) throw Object.assign(new Error("invalid token"), { status: 401 });
  const user = await userRes.json();
  let staff = await sb(`staff?user_id=eq.${user.id}&select=id&limit=1`);
  if ((!staff || !staff[0]) && user.email) {
    staff = await sb(`staff?email=eq.${encodeURIComponent(user.email)}&select=id&limit=1`);
  }
  const isStaff = Array.isArray(staff) && !!staff[0];
  const memberships = await sb(`client_users?user_id=eq.${user.id}&status=eq.active&select=client_id`);
  const clientIds = Array.isArray(memberships) ? memberships.map(m => m.client_id) : [];
  return { isStaff, clientIds };
}

const BOOKING_SEL = "id,ghl_contact_id,athlete_name,parent_name,status,converted_member_id,converted_at,slot_id,booked_at";

async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "GET required" });
  const clientId = req.query.client_id;
  if (!clientId) return res.status(400).json({ error: "client_id required" });

  let ctx;
  try { ctx = await resolveUser(req); }
  catch (e) { return res.status(e.status || 401).json({ error: e.message }); }
  if (!ctx.isStaff && !ctx.clientIds.includes(clientId)) return res.status(403).json({ error: "not your academy" });

  const cid = encodeURIComponent(clientId);
  const iso30 = encodeURIComponent(new Date(Date.now() - 30 * 86400000).toISOString());
  const iso7 = encodeURIComponent(new Date(Date.now() - 7 * 86400000).toISOString());

  try {
    const [reviews, sales7] = await Promise.all([
      sb(`post_trial_reviews?client_id=eq.${cid}&showed_up=is.true&good_fit=is.true&created_at=gte.${iso30}&select=id,ghl_contact_id,trial_booking_id,created_at&order=created_at.desc&limit=500`),
      sb(`trial_bookings?tenant_id=eq.${cid}&converted_at=gte.${iso7}&select=id&limit=1000`),
    ]);
    const revs = Array.isArray(reviews) ? reviews : [];
    const sales_week = Array.isArray(sales7) ? sales7.length : 0;

    // Bridge each review to its trial booking: trial_booking_id first, then the
    // contact's most recent non-cancelled booking (older reviews predate the
    // trial_booking_id column, added 2026-07-10).
    const bids = [...new Set(revs.map(r => r.trial_booking_id).filter(Boolean))];
    const contactIds = [...new Set(revs.filter(r => !r.trial_booking_id && r.ghl_contact_id).map(r => String(r.ghl_contact_id)))];
    const inQuoted = (vals) => vals.map(v => encodeURIComponent(`"${String(v).replace(/"/g, "")}"`)).join(",");
    const [byIdRows, byContactRows] = await Promise.all([
      bids.length ? sb(`trial_bookings?tenant_id=eq.${cid}&id=in.(${bids.join(",")})&select=${BOOKING_SEL}`) : [],
      contactIds.length ? sb(`trial_bookings?tenant_id=eq.${cid}&ghl_contact_id=in.(${inQuoted(contactIds)})&status=neq.CANCELLED&select=${BOOKING_SEL}&order=booked_at.desc&limit=1000`) : [],
    ]);

    const slotIds = [...new Set([...(byIdRows || []), ...(byContactRows || [])].map(b => b.slot_id).filter(Boolean))];
    const slots = slotIds.length
      ? await sb(`schedule_slots?tenant_id=eq.${cid}&id=in.(${slotIds.join(",")})&select=id,start_time&limit=1000`).catch(() => [])
      : [];
    const slotStart = {};
    for (const s of (slots || [])) slotStart[s.id] = s.start_time;

    const bookById = {};
    for (const b of (byIdRows || [])) bookById[b.id] = b;
    const bookByContact = {};                       // newest first (order=booked_at.desc)
    for (const b of (byContactRows || [])) if (!bookByContact[b.ghl_contact_id]) bookByContact[b.ghl_contact_id] = b;

    const closed_rows = [], open_rows = [];
    for (const r of revs) {
      const b = (r.trial_booking_id && bookById[r.trial_booking_id])
        || (r.ghl_contact_id && bookByContact[String(r.ghl_contact_id)]) || null;
      const won = !!(b && (b.converted_member_id || b.status === "CONVERTED"));
      const row = {
        athlete: (b && b.athlete_name) || null,
        parent: (b && b.parent_name) || null,
        contact_id: (b && b.ghl_contact_id) || r.ghl_contact_id || null,
        trial_at: (b && ((b.slot_id && slotStart[b.slot_id]) || b.booked_at)) || r.created_at,
      };
      if (won) closed_rows.push({ ...row, converted_at: b.converted_at || null });
      else open_rows.push(row);
    }
    closed_rows.sort((a, b) => new Date(b.converted_at || b.trial_at) - new Date(a.converted_at || a.trial_at));
    open_rows.sort((a, b) => new Date(b.trial_at) - new Date(a.trial_at));

    return res.status(200).json({
      qualified: revs.length,
      closed: closed_rows.length,
      sales_week,
      closed_rows,
      open_rows,
    });
  } catch (e) {
    return res.status(500).json({ error: e.message || "internal error" });
  }
}

export default withSentryApiRoute(handler);
