// Vercel Serverless Function - mobile Sales preset card KPIs (read-only).
//
//   GET /api/sales-kpis?client_id=<uuid>
//     -> { qualified, closed, sales_week, closed_rows, open_rows }
//
//   qualified  = qualified trials in the last 30 days: post_trial_reviews marked
//                showed_up=true AND good_fit=true, via the cc_qualified_trials()
//                SQL function - the SAME source the desktop Sales KPIs use
//                (api/ghl/cc-sales-kpis.js). The RPC bridges the mixed
//                portal-UUID / GHL-id opportunity ids through the opportunities
//                table to members and pipeline_outcomes.
//   closed     = of those, outcome === 'won' per the RPC: the lead became a
//                paying member (members.status in live/paused/payment_failed -
//                ground truth), or an opportunity/outcome marks it won.
//   sales_week = new PAYING members in the last 7 calendar days
//                (members.joined_date, same paid-status filter as
//                cc-sales-kpis.js sales_7d - payment_method_required rows never
//                completed checkout and are not sales).
//   closed_rows / open_rows feed the "Qualified trials" focus overlay:
//     { athlete, parent, contact_id, trial_at, date_kind[, converted_at] }
//     trial_at is the booked slot's start_time (falling back to booked_at) with
//     date_kind 'trial'; when the review bridges to no booking at all, trial_at
//     is the review-filed time with date_kind 'review' so the UI can label the
//     date honestly. converted_at (closed rows) is members.joined_date when the
//     paying member is resolvable, else null.
//
// WHY the rewrite (2026-07-31): the first version counted "closed" from
// trial_bookings.converted_member_id / status CONVERTED and "sales_week" from
// trial_bookings.converted_at - columns NOTHING in the codebase ever writes
// (0 rows ever, verified against prod). The card showed 0 closed and 0 sales
// forever. This version reuses the proven desktop sources instead of inventing
// a second definition of "closed".
//
// Fully client_id-driven and preset-agnostic: no academy hardcoding, so every
// preset card can reuse the same KPI pattern.
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

const BOOKING_SEL = "id,ghl_contact_id,athlete_name,parent_name,slot_id,booked_at";
// A "sale" is a member who completed checkout (mirrors cc-sales-kpis.js).
const PAID = "status=in.(live,paused,payment_failed)";

async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "GET required" });
  const clientId = req.query.client_id;
  if (!clientId) return res.status(400).json({ error: "client_id required" });

  let ctx;
  try { ctx = await resolveUser(req); }
  catch (e) { return res.status(e.status || 401).json({ error: e.message }); }
  if (!ctx.isStaff && !ctx.clientIds.includes(clientId)) return res.status(403).json({ error: "not your academy" });

  const cid = encodeURIComponent(clientId);
  const now = Date.now();
  const iso30 = new Date(now - 30 * 86400000).toISOString();
  // joined_date is a DATE column - compare with calendar days, not a timestamp,
  // or the 7-day window drifts with the time of day the endpoint is hit.
  // day(6) = today + the 6 days before it, same as cc-sales-kpis.js.
  const day7 = new Date(now - 6 * 86400000).toISOString().slice(0, 10);

  try {
    const [rpcRows, reviews, sales7] = await Promise.all([
      // Source of truth for the qualified population + won/lost/pending outcome.
      sb(`rpc/cc_qualified_trials?p_client_id=${cid}&p_from=${encodeURIComponent(iso30)}&p_to=${encodeURIComponent(new Date(now).toISOString())}`),
      // The same review rows again, but with trial_booking_id, so each RPC row
      // can be bridged to its actual trial booking (real athlete/parent names +
      // the booked slot's start time).
      sb(`post_trial_reviews?client_id=eq.${cid}&showed_up=is.true&good_fit=is.true&created_at=gte.${encodeURIComponent(iso30)}&select=id,ghl_contact_id,trial_booking_id,created_at&limit=500`),
      sb(`members?client_id=eq.${cid}&${PAID}&joined_date=gte.${day7}&select=id&limit=1000`),
    ]);
    const rows = Array.isArray(rpcRows) ? rpcRows : [];
    const sales_week = Array.isArray(sales7) ? sales7.length : 0;

    // RPC rows carry the review's ghl_contact_id + created_at (as trial_date),
    // so contact|timestamp keys the two lists together.
    const key = (contact, ts) => String(contact || "") + "|" + Date.parse(ts);
    const reviewByKey = {};
    for (const r of (Array.isArray(reviews) ? reviews : [])) reviewByKey[key(r.ghl_contact_id, r.created_at)] = r;

    // Bridge each qualified trial to its booking: trial_booking_id first, then
    // the contact's most recent non-cancelled booking (older reviews predate
    // the trial_booking_id column, added 2026-07-10).
    const matched = rows.map(x => ({ x, rev: reviewByKey[key(x.ghl_contact_id, x.trial_date)] || null }));
    const bids = [...new Set(matched.map(m => m.rev && m.rev.trial_booking_id).filter(Boolean))];
    const contactIds = [...new Set(matched.filter(m => !(m.rev && m.rev.trial_booking_id) && m.x.ghl_contact_id).map(m => String(m.x.ghl_contact_id)))];
    const wonContacts = [...new Set(rows.filter(x => x.outcome === "won" && x.ghl_contact_id).map(x => String(x.ghl_contact_id)))];
    const inQuoted = (vals) => vals.map(v => encodeURIComponent(`"${String(v).replace(/"/g, "")}"`)).join(",");
    const [byIdRows, byContactRows, memberRows] = await Promise.all([
      bids.length ? sb(`trial_bookings?tenant_id=eq.${cid}&id=in.(${bids.join(",")})&select=${BOOKING_SEL}`) : [],
      contactIds.length ? sb(`trial_bookings?tenant_id=eq.${cid}&ghl_contact_id=in.(${inQuoted(contactIds)})&status=neq.CANCELLED&select=${BOOKING_SEL}&order=booked_at.desc&limit=1000`) : [],
      // Paying member per won contact -> joined_date for the "joined <date>" line.
      wonContacts.length ? sb(`members?client_id=eq.${cid}&${PAID}&ghl_contact_id=in.(${inQuoted(wonContacts)})&select=ghl_contact_id,joined_date&limit=1000`).catch(() => []) : [],
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
    const joinedByContact = {};
    for (const m of (memberRows || [])) if (m.ghl_contact_id && !joinedByContact[m.ghl_contact_id]) joinedByContact[m.ghl_contact_id] = m.joined_date;

    const closed_rows = [], open_rows = [];
    for (const { x, rev } of matched) {
      const b = (rev && rev.trial_booking_id && bookById[rev.trial_booking_id])
        || (x.ghl_contact_id && bookByContact[String(x.ghl_contact_id)]) || null;
      // 'Athlete' is the RPC's own last-resort placeholder - never prefer it
      // over a booking's real athlete name.
      const rpcName = x.name && x.name !== "Athlete" ? x.name : null;
      const trialAt = b ? ((b.slot_id && slotStart[b.slot_id]) || b.booked_at) : null;
      const row = {
        athlete: (b && b.athlete_name) || rpcName || null,
        parent: (b && b.parent_name) || null,
        contact_id: (b && b.ghl_contact_id) || x.ghl_contact_id || null,
        trial_at: trialAt || x.trial_date,
        date_kind: trialAt ? "trial" : "review",   // no booking -> the review-filed time
      };
      if (x.outcome === "won") {
        closed_rows.push({ ...row, converted_at: (x.ghl_contact_id && joinedByContact[String(x.ghl_contact_id)]) || null });
      } else {
        open_rows.push(row);
      }
    }
    closed_rows.sort((a, b) => new Date(b.converted_at || b.trial_at) - new Date(a.converted_at || a.trial_at));
    open_rows.sort((a, b) => new Date(b.trial_at) - new Date(a.trial_at));

    return res.status(200).json({
      qualified: rows.length,
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
