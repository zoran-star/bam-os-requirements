import { withSentryApiRoute } from "../_sentry.js";
import { pickGhlToken } from "./_core.js";
// Vercel Serverless Function — GHL contact search (for the Inbox "New message"
// compose picker).
//
//   GET /api/ghl/contacts-search?client_id=<uuid>&q=<text>
//     → { contacts: [{ id, name, email, phone }] }  (max 20)
//
// Auth: Supabase JWT — staff, or client_users membership for client_id.
// Token: per-academy GHL OAuth token (auto-refresh if near expiry).

const GHL_V2        = "https://services.leadconnectorhq.com";
const V2_VERSION    = "2021-07-28";

const SUPABASE_URL         = (process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || "").trim();
const SUPABASE_SERVICE_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || "").trim();

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
  const ur = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { apikey: SUPABASE_SERVICE_KEY, Authorization: `Bearer ${token}` } });
  if (!ur.ok) throw Object.assign(new Error("invalid token"), { status: 401 });
  const user = await ur.json();
  let staff = await sb(`staff?user_id=eq.${user.id}&select=id&limit=1`);
  if ((!staff || !staff[0]) && user.email) staff = await sb(`staff?email=eq.${encodeURIComponent(user.email)}&select=id&limit=1`);
  const isStaff = Array.isArray(staff) && staff[0];
  const m = await sb(`client_users?user_id=eq.${user.id}&status=eq.active&select=client_id`);
  const clientIds = Array.isArray(m) ? m.map(x => x.client_id) : [];
  return { isStaff, clientIds };
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function ghl(method, path, { token, body } = {}) {
  let res;
  for (let attempt = 0; attempt < 4; attempt++) {
    res = await fetch(`${GHL_V2}${path}`, {
      method,
      headers: { Authorization: `Bearer ${token}`, Version: V2_VERSION, Accept: "application/json", "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (res.status !== 429) break;
    const ra = Number(res.headers.get("retry-after"));
    await sleep(ra > 0 ? Math.min(ra * 1000, 5000) : Math.min(400 * 2 ** attempt, 5000));
  }
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch (_) { json = { raw: text }; }
  if (!res.ok) { const e = new Error((json && (json.message || json.error)) || `GHL ${res.status}`); e.status = res.status; throw e; }
  return json;
}

async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "GET only" });

  let ctx;
  try { ctx = await resolveUser(req); }
  catch (e) { return res.status(e.status || 401).json({ error: e.message }); }

  const clientId = req.query.client_id;
  const q = (req.query.q || "").trim();
  if (!clientId) return res.status(400).json({ error: "client_id required" });
  if (!ctx.isStaff && !ctx.clientIds.includes(clientId)) return res.status(403).json({ error: "not your academy" });
  if (q.length < 2) return res.status(200).json({ contacts: [] });

  const rows = await sb(`clients?id=eq.${clientId}&select=id,business_name,ghl_location_id,ghl_access_token,ghl_refresh_token,ghl_token_expires_at&limit=1`);
  const client = Array.isArray(rows) && rows[0];
  if (!client) return res.status(404).json({ error: "academy not found" });
  if (!client.ghl_location_id && !client.ghl_access_token) return res.status(400).json({ error: "Academy not connected to GHL." });

  let creds;
  try { creds = await pickGhlToken(client); }
  catch (e) { return res.status(500).json({ error: `GHL token refresh failed: ${e.message}` }); }
  if (!creds) return res.status(500).json({ error: "GHL not configured for this academy." });
  const { token, locationId } = creds;

  try {
    const params = new URLSearchParams({ locationId, limit: "20", query: q });
    const data = await ghl("GET", `/contacts/?${params}`, { token });
    const list = data?.contacts || data?.data || [];
    const contacts = list.map(c => ({
      id:    c.id || c.contactId,
      name:  c.contactName || [c.firstName, c.lastName].filter(Boolean).join(" ") || c.fullNameLowerCase || c.email || c.phone || "Unknown",
      email: c.email || null,
      phone: c.phone || null,
    })).filter(c => c.id);
    return res.status(200).json({ contacts });
  } catch (e) {
    return res.status(e.status || 502).json({ error: `GHL: ${e.message}` });
  }
}

export default withSentryApiRoute(handler);
