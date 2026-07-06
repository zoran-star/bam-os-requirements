// Vercel Serverless Function - command-center Sales KPIs (off-GHL, V2).
//
//   GET /api/ghl/cc-sales-kpis?client_id=<uuid>
//     → { sales_7d, converted_45d, not_a_fit_45d, closing_rate }
//
// Fully off GHL - sourced from the portal's own tables:
//   sales_7d      = new paying members in the last 7 days   (members.joined_date)
//   closing_rate  = trial closing rate over the last 45 days, BY RESOLUTION DATE
//                   (so conversion lag can't distort it):
//                     converted  = new members joined in the last 45 days
//                     not_a_fit  = post-trial reviews marked NOT a fit in 45 days
//                     rate       = converted / (converted + not_a_fit)   [null if 0]
//   NOTE: "lost" today = not-a-fit only. Good-fit trials that later ghosted / said
//   no are not yet counted (no trial->member link in the data); the true rate may be
//   a touch lower. Tighten once conversions link back to their trial.
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

  const iso = (days) => new Date(Date.now() - days * 86400000).toISOString();
  const cid = encodeURIComponent(clientId);
  const c7 = encodeURIComponent(iso(7)), c45 = encodeURIComponent(iso(45));

  try {
    const [m7, m45, notFit] = await Promise.all([
      sb(`members?client_id=eq.${cid}&joined_date=gte.${c7}&select=id`),
      sb(`members?client_id=eq.${cid}&joined_date=gte.${c45}&select=id`),
      sb(`post_trial_reviews?client_id=eq.${cid}&good_fit=eq.false&created_at=gte.${c45}&select=id`),
    ]);
    const sales_7d = (m7 || []).length;
    const converted_45d = (m45 || []).length;
    const not_a_fit_45d = (notFit || []).length;
    const denom = converted_45d + not_a_fit_45d;
    const closing_rate = denom > 0 ? Math.round((converted_45d / denom) * 100) : null;
    return res.status(200).json({ sales_7d, converted_45d, not_a_fit_45d, closing_rate });
  } catch (e) {
    return res.status(500).json({ error: e.message || "internal error" });
  }
}

export default withSentryApiRoute(handler);
