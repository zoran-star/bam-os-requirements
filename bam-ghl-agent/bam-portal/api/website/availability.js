// Public endpoint — free booking slots for a client's calendar, consumed by
// client websites (e.g. the BAM GTA free-trial page).
//
//   GET /api/website/availability?client_id=<uuid>&calendar=<ghl calendar id>&days=<n>
//     → { timezone, days: { "2026-06-12": ["2026-06-12T16:00:00-04:00", ...], ... } }
//
// The calendar id must be one of the client's entry_points rows of type
// "calendar" — websites can only read calendars the academy has exposed.
// Same CORS allow-list as the leads endpoint (clients.allowed_domains).
// GHL access uses the academy's OAuth token (auto-refresh), since the
// static location keys don't carry calendar scopes.

import { withSentryApiRoute } from "../_sentry.js";

const SB_URL = (process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || "").trim();
const SB_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || "").trim();

const GHL_V2 = "https://services.leadconnectorhq.com";
const GHL_TOKEN_URL = "https://services.leadconnectorhq.com/oauth/token";
const V2_VERSION = "2021-07-28";

const DEV_ORIGINS = new Set([
  "http://localhost:3000",
  "http://localhost:5173",
  "http://127.0.0.1:5500",
]);

let originsCache = { set: null, at: 0 };
const ORIGINS_TTL_MS = 60_000;

async function sbReq(path, init = {}) {
  const r = await fetch(`${SB_URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: SB_KEY,
      Authorization: `Bearer ${SB_KEY}`,
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
  });
  if (!r.ok) throw new Error(`Supabase ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const txt = await r.text();
  return txt ? JSON.parse(txt) : null;
}

async function getAllowedOrigins() {
  if (originsCache.set && Date.now() - originsCache.at < ORIGINS_TTL_MS) {
    return originsCache.set;
  }
  const set = new Set(DEV_ORIGINS);
  const rows = await sbReq("clients?select=allowed_domains&allowed_domains=not.is.null");
  for (const row of rows || []) {
    for (const domain of row.allowed_domains || []) {
      set.add(`https://${domain}`);
      set.add(`https://www.${domain}`);
    }
  }
  originsCache = { set, at: Date.now() };
  return set;
}

async function setCors(req, res) {
  const origin = req.headers.origin || "";
  let allowed = false;
  try { allowed = (await getAllowedOrigins()).has(origin); } catch { /* 403 below */ }
  if (allowed) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
  }
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  return allowed;
}

export async function refreshGhlToken(client) {
  const cid = (process.env.GHL_OAUTH_CLIENT_ID || "").trim();
  const sec = (process.env.GHL_OAUTH_CLIENT_SECRET || "").trim();
  if (!cid || !sec) throw new Error("GHL_OAUTH_CLIENT_ID/SECRET not configured");
  if (!client.ghl_refresh_token) throw new Error("academy has no GHL refresh_token");
  const tokenRes = await fetch(GHL_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: cid, client_secret: sec,
      grant_type: "refresh_token",
      refresh_token: client.ghl_refresh_token,
      user_type: "Location",
    }),
  });
  const tok = await tokenRes.json();
  if (!tokenRes.ok || !tok?.access_token) {
    throw new Error(tok?.error_description || tok?.error || "GHL token refresh failed");
  }
  const expiresAt = new Date(Date.now() + (Number(tok.expires_in) || 86400) * 1000).toISOString();
  await sbReq(`clients?id=eq.${client.id}`, {
    method: "PATCH",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({
      ghl_access_token: tok.access_token,
      ghl_refresh_token: tok.refresh_token || client.ghl_refresh_token,
      ghl_token_expires_at: expiresAt,
    }),
  });
  return tok.access_token;
}

export async function getClientGhlToken(client) {
  if (!client.ghl_access_token) throw new Error("academy not connected to GHL (no OAuth token)");
  const exp = client.ghl_token_expires_at ? new Date(client.ghl_token_expires_at).getTime() : 0;
  if (exp - Date.now() <= 60_000 && client.ghl_refresh_token) {
    return await refreshGhlToken(client);
  }
  return client.ghl_access_token;
}

async function handler(req, res) {
  if (!SB_URL || !SB_KEY) return res.status(500).json({ error: "Supabase not configured" });

  const allowed = await setCors(req, res);
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "GET") return res.status(405).json({ error: "GET required" });
  if (!allowed) return res.status(403).json({ error: "Forbidden" });

  const { client_id, calendar } = req.query;
  const days = Math.min(Math.max(parseInt(req.query.days, 10) || 21, 1), 60);
  if (!client_id || !calendar) return res.status(400).json({ error: "client_id and calendar required" });

  let client;
  try {
    const rows = await sbReq(
      `clients?id=eq.${client_id}&select=id,time_zone,ghl_location_id,ghl_access_token,ghl_refresh_token,ghl_token_expires_at&limit=1`
    );
    client = rows?.[0];
  } catch (e) { return res.status(500).json({ error: e.message }); }
  if (!client) return res.status(404).json({ error: "client not found" });

  // Only calendars the academy exposed as entry points are readable.
  try {
    const eps = await sbReq(
      `entry_points?client_id=eq.${client_id}&type=eq.calendar&key=eq.${encodeURIComponent(calendar)}&enabled=eq.true&select=id&limit=1`
    );
    if (!eps?.[0]) return res.status(404).json({ error: "calendar not available" });
  } catch (e) { return res.status(500).json({ error: e.message }); }

  const timezone = client.time_zone || "America/Toronto";
  try {
    const token = await getClientGhlToken(client);
    const start = Date.now();
    const end = start + days * 24 * 3600 * 1000;
    const params = new URLSearchParams({
      startDate: String(start),
      endDate: String(end),
      timezone,
    });
    const r = await fetch(`${GHL_V2}/calendars/${encodeURIComponent(calendar)}/free-slots?${params}`, {
      headers: { Authorization: `Bearer ${token}`, Version: V2_VERSION, Accept: "application/json" },
    });
    const json = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(json.message || json.error || `GHL ${r.status}`);

    // GHL returns { "<date>": { slots: [iso, ...] }, traceId } — normalize.
    const out = {};
    for (const [k, v] of Object.entries(json)) {
      if (v && Array.isArray(v.slots)) out[k] = v.slots;
    }
    res.setHeader("Cache-Control", "s-maxage=60, stale-while-revalidate=120");
    return res.status(200).json({ timezone, days: out });
  } catch (e) {
    return res.status(502).json({ error: `availability failed: ${e.message}` });
  }
}

export default withSentryApiRoute(handler);
