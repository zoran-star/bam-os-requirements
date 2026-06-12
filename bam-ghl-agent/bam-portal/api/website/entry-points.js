// Vercel Serverless Function — Entry Points (lead routing per academy)
//
//   GET   /api/website/entry-points?client_id=<uuid>
//     → all entry_points rows for the academy (website forms, GHL forms,
//       calendars, funnels). "Connected" = pipeline_name + stage_name set.
//
//   PATCH /api/website/entry-points?client_id=<uuid>&id=<uuid>
//     body: { pipeline_name, stage_name, tags? }
//     → saves the routing for one entry point. Pass nulls to disconnect.
//
// The website leads API (api/website/leads.js) reads website-form rows to
// route submissions; ghl-form/calendar rows standardize the config that is
// enforced inside GHL (workflows) for now.
//
// Auth: Supabase JWT — staff, or client_users membership for client_id.

import { withSentryApiRoute } from "../_sentry.js";

const SUPABASE_URL = (process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || "").trim();
const SUPABASE_SERVICE_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || "").trim();

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

  if (req.method === "GET") {
    try {
      const rows = await sb(
        `entry_points?client_id=eq.${clientId}` +
        `&select=id,type,key,label,tags,pipeline_name,stage_name,enabled,updated_at&order=type.asc,label.asc`
      );
      return res.status(200).json({ entry_points: rows || [] });
    } catch (e) { return res.status(500).json({ error: e.message }); }
  }

  if (req.method === "PATCH") {
    const id = req.query.id;
    if (!id) return res.status(400).json({ error: "id required" });
    const b = req.body || {};
    const patch = { updated_at: new Date().toISOString() };
    if ("pipeline_name" in b) patch.pipeline_name = b.pipeline_name || null;
    if ("stage_name" in b) patch.stage_name = b.stage_name || null;
    if (Array.isArray(b.tags)) patch.tags = b.tags;
    if ("enabled" in b) patch.enabled = !!b.enabled;
    try {
      const rows = await sb(`entry_points?id=eq.${id}&client_id=eq.${clientId}`, {
        method: "PATCH",
        headers: { Prefer: "return=representation" },
        body: JSON.stringify(patch),
      });
      if (!rows || !rows[0]) return res.status(404).json({ error: "entry point not found" });
      return res.status(200).json({ entry_point: rows[0] });
    } catch (e) { return res.status(500).json({ error: e.message }); }
  }

  return res.status(405).json({ error: "GET or PATCH required" });
}

export default withSentryApiRoute(handler);
