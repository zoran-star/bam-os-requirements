// Vercel Serverless Function — full contact detail for the post-trial form.
//
//   GET /api/ghl/contact-detail?client_id=<uuid>&contact_id=<ghl id>
//     → { basics: {name,email,phone}, fields: [{label, value}], website: {...} }
//   Merges the GHL contact's populated custom fields (resolved to their human
//   names) with anything we hold in website_leads for that contact, so the
//   coach sees everything captured about the lead.
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
    headers: { apikey: SUPABASE_SERVICE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`, "Content-Type": "application/json", ...(init.headers || {}) },
  });
  if (!res.ok) throw new Error(`Supabase ${res.status}`);
  const txt = await res.text();
  return txt ? JSON.parse(txt) : null;
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
  return { isStaff, clientIds: Array.isArray(m) ? m.map(x => x.client_id) : [] };
}

async function ghl(method, path, token) {
  const r = await fetch(`${GHL_V2}${path}`, { headers: { Authorization: `Bearer ${token}`, Version: V2_VERSION, Accept: "application/json" } });
  const t = await r.text(); let j = null; try { j = t ? JSON.parse(t) : null; } catch { j = {}; }
  if (!r.ok) throw Object.assign(new Error((j && (j.message || j.error)) || `GHL ${r.status}`), { status: r.status });
  return j;
}

async function getToken(client) {
  if (!client.ghl_access_token) throw new Error("not connected to GHL");
  const exp = client.ghl_token_expires_at ? new Date(client.ghl_token_expires_at).getTime() : 0;
  if (exp - Date.now() > 60_000 || !client.ghl_refresh_token) return client.ghl_access_token;
  const cid = (process.env.GHL_OAUTH_CLIENT_ID || "").trim(), sec = (process.env.GHL_OAUTH_CLIENT_SECRET || "").trim();
  if (!cid || !sec) return client.ghl_access_token;
  const r = await fetch(GHL_TOKEN_URL, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ client_id: cid, client_secret: sec, grant_type: "refresh_token", refresh_token: client.ghl_refresh_token, user_type: "Location" }) });
  const tok = await r.json();
  if (!r.ok || !tok?.access_token) return client.ghl_access_token;
  await sb(`clients?id=eq.${client.id}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ ghl_access_token: tok.access_token, ghl_refresh_token: tok.refresh_token || client.ghl_refresh_token, ghl_token_expires_at: new Date(Date.now() + (Number(tok.expires_in) || 86400) * 1000).toISOString() }) });
  return tok.access_token;
}

async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "GET required" });
  let ctx; try { ctx = await resolveUser(req); } catch (e) { return res.status(e.status || 401).json({ error: e.message }); }
  const clientId = req.query.client_id, contactId = req.query.contact_id;
  if (!clientId || !contactId) return res.status(400).json({ error: "client_id and contact_id required" });
  if (!ctx.isStaff && !ctx.clientIds.includes(clientId)) return res.status(403).json({ error: "not your academy" });

  const rows = await sb(`clients?id=eq.${clientId}&select=id,ghl_location_id,ghl_access_token,ghl_refresh_token,ghl_token_expires_at&limit=1`);
  const client = rows?.[0];
  if (!client) return res.status(404).json({ error: "academy not found" });

  let token; try { token = await getToken(client); } catch (e) { return res.status(502).json({ error: e.message }); }

  const out = { basics: {}, fields: [], website: null };
  try {
    const c = (await ghl("GET", `/contacts/${encodeURIComponent(contactId)}`, token)).contact || {};
    out.basics = {
      name: c.contactName || `${c.firstName || ""} ${c.lastName || ""}`.trim() || null,
      email: c.email || null, phone: c.phone || null,
    };
    // Resolve custom field ids → human names, keep only populated ones.
    const defs = (await ghl("GET", `/locations/${encodeURIComponent(client.ghl_location_id)}/customFields`, token)).customFields || [];
    const nameById = new Map(defs.map(f => [f.id, f.name]));
    for (const cf of (c.customFields || [])) {
      const val = Array.isArray(cf.value) ? cf.value.join(", ") : cf.value;
      if (val === undefined || val === null || String(val).trim() === "") continue;
      const label = nameById.get(cf.id) || null;
      if (label) out.fields.push({ label, value: String(val) });
    }
  } catch (e) { out.error = e.message; }

  // Our own website_leads capture (richest for website-origin leads).
  try {
    const wl = await sb(`website_leads?client_id=eq.${clientId}&ghl_contact_id=eq.${encodeURIComponent(contactId)}&select=fields,created_at&order=created_at.desc&limit=5`);
    const merged = {};
    for (const r of (Array.isArray(wl) ? wl : []).reverse()) Object.assign(merged, r.fields || {});
    if (Object.keys(merged).length) out.website = merged;
  } catch (_) {}

  return res.status(200).json(out);
}

export default withSentryApiRoute(handler);
