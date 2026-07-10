// Vercel Serverless Function - command-center Sales KPIs (off-GHL, V2).
//
//   GET /api/ghl/cc-sales-kpis?client_id=<uuid>
//     → { sales_7d, sales: [{id,name,joined_date}],
//         qualified_won, qualified_lost, qualified_pool, closing_rate }
//
// Fully off GHL - sourced from the portal's own tables:
//   sales_7d      = new PAYING members in the last 7 calendar days
//                   (members.joined_date, status in live/paused/payment_failed -
//                   payment_method_required = never completed checkout, not a sale)
//   sales         = those members listed out (id + athlete name) for the UI
//   closing_rate  = QUALIFIED TRIAL CLOSE RATE over the last 45 days (Zoran's
//                   definition, 2026-07-10). Population = post-trial cards marked
//                   SHOWED UP + GOOD FIT. Of those:
//                     won  = the lead became a paying member (ground truth), or an
//                            opportunity/outcome marks it won
//                     lost = the lead's opportunity/outcome is marked lost
//                     rate = won / (won + lost)   [null if 0; pending cards excluded]
//                   Computed by the cc_qualified_close_rate() SQL function, which
//                   bridges the mixed portal-UUID / GHL-id opportunity ids through
//                   the opportunities table (post_trial_reviews.opportunity_id can be
//                   either form, but members / pipeline_outcomes key on GHL ids).
//                   "won" is read from the members table first because
//                   opportunities.status lags the actual sale.
//
// Auth: Supabase JWT - staff (any academy) or a client_users member of client_id.

import { withSentryApiRoute } from "../_sentry.js";

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

async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "GET required" });
  const clientId = req.query.client_id;
  if (!clientId) return res.status(400).json({ error: "client_id required" });

  let ctx;
  try { ctx = await resolveUser(req); }
  catch (e) { return res.status(e.status || 401).json({ error: e.message }); }
  if (!ctx.isStaff && !ctx.clientIds.includes(clientId)) return res.status(403).json({ error: "not your academy" });

  // joined_date is a DATE column - compare with calendar days, not a timestamp,
  // or the 7-day window drifts with the time of day the endpoint is hit.
  const day = (days) => new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
  const cid = encodeURIComponent(clientId);
  const c7 = day(6), c45 = day(44); // inclusive: today + the N-1 days before it
  // A "sale" is a member who completed checkout. payment_method_required rows
  // signed up but never paid - they are not sales (and test rows live there too).
  const PAID = "status=in.(live,paused,payment_failed)";

  try {
    const [m7, rate] = await Promise.all([
      sb(`members?client_id=eq.${cid}&${PAID}&joined_date=gte.${c7}&select=id,athlete_name,joined_date&order=joined_date.desc`),
      // Qualified trial close rate over the rolling 45-day window. The SQL function
      // does the full showed-up + good-fit -> won/lost scoring (see header). Returns
      // a single row {pool, won, lost}; GET works because the function is STABLE.
      sb(`rpc/cc_qualified_close_rate?p_client_id=${cid}&p_since=${encodeURIComponent(c45)}`),
    ]);
    const sales = (m7 || []).map((m) => ({ id: m.id, name: m.athlete_name || "Member", joined_date: m.joined_date }));
    const sales_7d = sales.length;
    const r = (Array.isArray(rate) ? rate[0] : rate) || {};
    const qualified_won = r.won || 0;
    const qualified_lost = r.lost || 0;
    const qualified_pool = r.pool || 0;
    const denom = qualified_won + qualified_lost;
    const closing_rate = denom > 0 ? Math.round((qualified_won / denom) * 100) : null;
    return res.status(200).json({ sales_7d, sales, qualified_won, qualified_lost, qualified_pool, closing_rate });
  } catch (e) {
    return res.status(500).json({ error: e.message || "internal error" });
  }
}

export default withSentryApiRoute(handler);
