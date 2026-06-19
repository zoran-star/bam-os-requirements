// Vercel Serverless Function — list the academy's GHL workflows.
//
//   GET /api/ghl/workflows?client_id=<uuid>  → { workflows: [{ id, name, status }] }
//
// Used by the offer editor (Sales step) so the owner can pick the "missed-trial"
// automation to fire when a trainer marks an athlete as not attended.
//
// Auth: Supabase JWT — staff, or client_users membership for client_id.

import { withSentryApiRoute } from "../_sentry.js";

const SUPABASE_URL = (process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || "").trim();
const SUPABASE_SERVICE_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || "").trim();
const GHL_V2 = "https://services.leadconnectorhq.com";
const GHL_TOKEN_URL = "https://services.leadconnectorhq.com/oauth/token";
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
  let staff = await sb(`staff?user_id=eq.${user.id}&select=id&limit=1`);
  if ((!staff || !staff[0]) && user.email) {
    staff = await sb(`staff?email=eq.${encodeURIComponent(user.email)}&select=id&limit=1`);
  }
  const isStaff = Array.isArray(staff) && staff[0];
  const memberships = await sb(`client_users?user_id=eq.${user.id}&status=eq.active&select=client_id`);
  const clientIds = Array.isArray(memberships) ? memberships.map(m => m.client_id) : [];
  return { isStaff, clientIds };
}

async function ghl(method, path, { token } = {}) {
  const res = await fetch(`${GHL_V2}${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, Version: V2_VERSION, Accept: "application/json" },
  });
  const txt = await res.text();
  let json = null; try { json = txt ? JSON.parse(txt) : null; } catch { json = { raw: txt }; }
  if (!res.ok) { const e = new Error((json && (json.message || json.error)) || `GHL ${res.status}`); e.status = res.status; throw e; }
  return json;
}

async function getToken(client) {
  if (!client.ghl_access_token) throw new Error("academy not connected to GHL");
  const exp = client.ghl_token_expires_at ? new Date(client.ghl_token_expires_at).getTime() : 0;
  if (exp - Date.now() > 60_000 || !client.ghl_refresh_token) return client.ghl_access_token;
  const cid = (process.env.GHL_OAUTH_CLIENT_ID || "").trim(), sec = (process.env.GHL_OAUTH_CLIENT_SECRET || "").trim();
  if (!cid || !sec) return client.ghl_access_token;
  const r = await fetch(GHL_TOKEN_URL, {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: cid, client_secret: sec, grant_type: "refresh_token", refresh_token: client.ghl_refresh_token, user_type: "Location" }),
  });
  const tok = await r.json();
  if (!r.ok || !tok?.access_token) return client.ghl_access_token;
  await sb(`clients?id=eq.${client.id}`, {
    method: "PATCH", headers: { Prefer: "return=minimal" },
    body: JSON.stringify({ ghl_access_token: tok.access_token, ghl_refresh_token: tok.refresh_token || client.ghl_refresh_token, ghl_token_expires_at: new Date(Date.now() + (Number(tok.expires_in) || 86400) * 1000).toISOString() }),
  });
  return tok.access_token;
}

async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "GET required" });
  let ctx;
  try { ctx = await resolveUser(req); }
  catch (e) { return res.status(e.status || 401).json({ error: e.message }); }

  const clientId = req.query.client_id;
  if (!clientId) return res.status(400).json({ error: "client_id required" });
  if (!ctx.isStaff && !ctx.clientIds.includes(clientId)) return res.status(403).json({ error: "not your academy" });

  const rows = await sb(`clients?id=eq.${clientId}&select=id,ghl_location_id,ghl_access_token,ghl_refresh_token,ghl_token_expires_at&limit=1`);
  const client = rows?.[0];
  if (!client) return res.status(404).json({ error: "academy not found" });
  if (!client.ghl_location_id) return res.status(200).json({ workflows: [], note: "GHL not connected" });

  let token;
  try { token = await getToken(client); }
  catch (e) { return res.status(502).json({ error: `GHL token: ${e.message}` }); }

  try {
    const data = await ghl("GET", `/workflows/?locationId=${encodeURIComponent(client.ghl_location_id)}`, { token });
    const workflows = (data?.workflows || []).map(w => ({ id: w.id, name: w.name || "(unnamed)", status: w.status || null }));
    return res.status(200).json({ workflows });
  } catch (e) {
    return res.status(e.status || 502).json({ error: `GHL workflows: ${e.message}` });
  }
}

export default withSentryApiRoute(handler);
