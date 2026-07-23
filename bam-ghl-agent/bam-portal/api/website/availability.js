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

import { RENEW_WINDOW_MS } from "../ghl/_agency.js";
const SB_URL = (process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || "").trim();
const SB_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || "").trim();

const GHL_V2 = "https://services.leadconnectorhq.com";
const GHL_TOKEN_URL = "https://services.leadconnectorhq.com/oauth/token";
const V2_VERSION = "2021-07-28";

function loadLocations() {
  try { return process.env.GHL_LOCATIONS_JSON ? JSON.parse(process.env.GHL_LOCATIONS_JSON) : []; }
  catch { return []; }
}

const DEV_ORIGINS = new Set([
  "http://localhost:3000",
  "http://localhost:5173",
  "http://127.0.0.1:5500",
  "https://portal.byanymeansbusiness.com",
]);

let originsCache = { set: null, patterns: null, at: 0 };
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

async function slotSpotsTakenBulk(tenantId, slotIds) {
  if (!slotIds.length) return new Map();
  const rows = await sbReq("rpc/slot_spots_taken_bulk", {
    method: "POST",
    body: JSON.stringify({
      p_tenant_id: tenantId,
      p_slot_ids: slotIds,
    }),
  });
  const counts = new Map();
  for (const row of rows || []) counts.set(row.slot_id, Number(row.spots_taken || 0));
  return counts;
}

async function getAllowedOrigins() {
  if (originsCache.set && Date.now() - originsCache.at < ORIGINS_TTL_MS) {
    return originsCache;
  }
  const set = new Set(DEV_ORIGINS);
  const patterns = [];
  const rows = await sbReq("clients?select=allowed_domains&allowed_domains=not.is.null");
  for (const row of rows || []) {
    for (const domain of row.allowed_domains || []) {
      if (domain.includes("*")) {
        patterns.push(new RegExp(`^https://${domain.replace(/\./g, "\\.").replace(/\*/g, "[a-z0-9-]+")}$`));
      } else {
        set.add(`https://${domain}`);
        set.add(`https://www.${domain}`);
      }
    }
  }
  originsCache = { set, patterns, at: Date.now() };
  return originsCache;
}

async function setCors(req, res) {
  const origin = req.headers.origin || "";
  // Same-origin requests (no Origin header) are always allowed.
  if (!origin) {
    res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    return true;
  }
  let allowed = false;
  try {
    const { set, patterns } = await getAllowedOrigins();
    allowed = set.has(origin) || patterns.some(p => p.test(origin));
  } catch { /* DB hiccup — treat as not allowed; GET will 403 */ }
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
  if (!client.ghl_access_token) {
    // Fall back to Private Integration API key from GHL_LOCATIONS_JSON.
    // The entry must have apiKeyV2 set to a Private Integration token with calendar scopes.
    // Match by locationId first (most reliable), then by ghl_kpi_config name.
    const locs = loadLocations();
    if (client.ghl_location_id) {
      const loc = locs.find(l => l.locationId === client.ghl_location_id);
      if (loc?.apiKeyV2 || loc?.apiKey) return loc.apiKeyV2 || loc.apiKey;
    }
    const locName = client.ghl_kpi_config?.ghl_location;
    if (locName) {
      const loc = locs.find(l => l.name === locName);
      if (loc?.apiKeyV2 || loc?.apiKey) return loc.apiKeyV2 || loc.apiKey;
    }
    throw new Error("academy not connected to GHL (no OAuth token or Private Integration key)");
  }
  const exp = client.ghl_token_expires_at ? new Date(client.ghl_token_expires_at).getTime() : 0;
  // Renew hours ahead, not seconds. A 60s window gave exactly one attempt per
  // 24h cycle, so one transient failure left the academy cold until a human
  // stepped in. Note this returns a bare token string, unlike ghl/_core.js.
  if (exp - Date.now() <= RENEW_WINDOW_MS && client.ghl_refresh_token) {
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
      `clients?id=eq.${client_id}&select=id,time_zone,booking_provider,ghl_location_id,ghl_kpi_config,ghl_access_token,ghl_refresh_token,ghl_token_expires_at&limit=1`
    );
    client = rows?.[0];
  } catch (e) { return res.status(500).json({ error: e.message }); }
  if (!client) return res.status(404).json({ error: "client not found" });

  // Only calendars the academy exposed as entry points are readable.
  let calEp;
  try {
    const eps = await sbReq(
      `entry_points?client_id=eq.${client_id}&type=eq.calendar&key=eq.${encodeURIComponent(calendar)}&enabled=eq.true&select=id,label&limit=1`
    );
    calEp = eps?.[0];
    if (!calEp) return res.status(404).json({ error: "calendar not available" });
  } catch (e) { return res.status(500).json({ error: e.message }); }

  const timezone = client.time_zone || "America/Toronto";

  // ── booking_provider='portal': serve OUR slots (schedule_slots), GHL never
  // consulted. Same response shape as the GHL branch, so client sites keep
  // working unchanged. The entry point's "Group N" label picks which template
  // family this calendar maps to; occupancy comes from the shared
  // slot_spots_taken function via the bulk RPC. The booking RPC re-checks
  // capacity transactionally, so a stale read can't overbook.
  if (client.booking_provider === "portal") {
    try {
      const groupMatch = /group\s*\d+/i.exec(calEp.label || "");
      const groupPrefix = groupMatch ? groupMatch[0].toLowerCase().replace(/\s+/g, " ") : null;
      const nowIso = new Date().toISOString();
      const endIso = new Date(Date.now() + days * 24 * 3600 * 1000).toISOString();
      const slots = (await sbReq(
        `schedule_slots?tenant_id=eq.${client_id}&is_cancelled=eq.false&start_time=gte.${encodeURIComponent(nowIso)}&start_time=lte.${encodeURIComponent(endIso)}&select=id,name,start_time,capacity&order=start_time.asc&limit=500`
      )) || [];
      const list = slots.filter(s => !groupPrefix || (s.name || "").toLowerCase().replace(/\s+/g, " ").includes(groupPrefix));
      const taken = await slotSpotsTakenBulk(client_id, list.map(s => s.id));
      // Emit local-offset ISO strings + local day keys (what GHL emitted), so
      // the site's picker + booking.start round-trip identically.
      const fmt = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false, timeZoneName: "longOffset" });
      const out = {};
      for (const s of list) {
        if ((s.capacity - (taken.get(s.id) || 0)) <= 0) continue;
        const parts = Object.fromEntries(fmt.formatToParts(new Date(s.start_time)).map(p => [p.type, p.value]));
        const off = (parts.timeZoneName || "GMT-04:00").replace("GMT", "") || "+00:00";
        const day = `${parts.year}-${parts.month}-${parts.day}`;
        const iso = `${day}T${parts.hour === "24" ? "00" : parts.hour}:${parts.minute}:${parts.second}${off}`;
        (out[day] = out[day] || []).push(iso);
      }
      res.setHeader("Cache-Control", "s-maxage=60, stale-while-revalidate=120");
      return res.status(200).json({ timezone, days: out });
    } catch (e) {
      return res.status(502).json({ error: `availability failed: ${e.message}` });
    }
  }

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
