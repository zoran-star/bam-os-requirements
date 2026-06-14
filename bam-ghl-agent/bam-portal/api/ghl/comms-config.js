// Vercel Serverless Function — Communications classification config.
//
//   GET /api/ghl/comms-config?client_id=<uuid>
//     → { tags:[all location tags], lead_tag, client_tag, recommend:{lead,client} }
//   PATCH /api/ghl/comms-config?client_id=<uuid>
//     body: { lead_tag?, client_tag? } → saved on the training offer.
//
// Lead/Client tabs in the comms view are split by these GHL tags. The
// selections live on the TRAINING offer (offers.data.lead_tag / client_tag)
// since that's the only offer in play. `recommend` is a heuristic best-guess
// the UI surfaces as "Recommended".
//
// Auth: Supabase JWT — staff, or client_users membership for client_id.

import { withSentryApiRoute } from "../_sentry.js";

const SUPABASE_URL = (process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || "").trim();
const SUPABASE_SERVICE_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || "").trim();
const GHL_V2 = "https://services.leadconnectorhq.com";
const GHL_TOKEN_URL = "https://services.leadconnectorhq.com/oauth/token";
const V2_VERSION = "2021-07-28";

async function sb(path, init = {}) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: { apikey: SUPABASE_SERVICE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`, "Content-Type": "application/json", ...(init.headers || {}) },
  });
  if (!r.ok) throw new Error(`Supabase ${r.status}: ${await r.text()}`);
  const t = await r.text(); return t ? JSON.parse(t) : null;
}

async function resolveUser(req) {
  const token = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  if (!token) throw Object.assign(new Error("no token"), { status: 401 });
  const ur = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { apikey: SUPABASE_SERVICE_KEY, Authorization: `Bearer ${token}` } });
  if (!ur.ok) throw Object.assign(new Error("invalid token"), { status: 401 });
  const user = await ur.json();
  let staff = await sb(`staff?user_id=eq.${user.id}&select=id&limit=1`);
  if ((!staff || !staff[0]) && user.email) staff = await sb(`staff?email=eq.${encodeURIComponent(user.email)}&select=id&limit=1`);
  const m = await sb(`client_users?user_id=eq.${user.id}&status=eq.active&select=client_id`);
  return { isStaff: Array.isArray(staff) && staff[0], clientIds: Array.isArray(m) ? m.map(x => x.client_id) : [] };
}

async function getToken(client) {
  if (!client.ghl_access_token) return null;
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

function recommend(tags) {
  const lc = tags.map(t => t.toLowerCase());
  const pick = (cands) => { for (const c of cands) { const i = lc.findIndex(t => t.includes(c)); if (i >= 0) return tags[i]; } return null; };
  return {
    lead: pick(["website-inquiry", "lead", "trial form", "new lead", "inquiry"]),
    client: pick(["member", "client", "active member", "won", "enrolled", "signed up"]),
  };
}

async function trainingOffer(clientId) {
  const rows = await sb(`offers?client_id=eq.${clientId}&type=eq.training&select=id,data&order=sort_order.asc&limit=1`);
  return rows?.[0] || null;
}

async function handler(req, res) {
  let ctx; try { ctx = await resolveUser(req); } catch (e) { return res.status(e.status || 401).json({ error: e.message }); }
  const clientId = req.query.client_id;
  if (!clientId) return res.status(400).json({ error: "client_id required" });
  if (!ctx.isStaff && !ctx.clientIds.includes(clientId)) return res.status(403).json({ error: "not your academy" });

  const offer = await trainingOffer(clientId);

  if (req.method === "PATCH") {
    if (!offer) return res.status(404).json({ error: "no training offer" });
    const b = req.body || {};
    const data = { ...(offer.data || {}) };
    if ("lead_tag" in b) data.lead_tag = b.lead_tag || null;
    if ("client_tag" in b) data.client_tag = b.client_tag || null;
    await sb(`offers?id=eq.${offer.id}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ data, updated_at: new Date().toISOString() }) });
    return res.status(200).json({ ok: true, lead_tag: data.lead_tag || null, client_tag: data.client_tag || null });
  }

  // GET — list location tags + current selections + recommendation.
  const rows = await sb(`clients?id=eq.${clientId}&select=id,ghl_location_id,ghl_access_token,ghl_refresh_token,ghl_token_expires_at&limit=1`);
  const client = rows?.[0];
  let tags = [];
  if (client) {
    try {
      const token = await getToken(client);
      if (token) {
        const r = await fetch(`${GHL_V2}/locations/${encodeURIComponent(client.ghl_location_id)}/tags`, { headers: { Authorization: `Bearer ${token}`, Version: V2_VERSION, Accept: "application/json" } });
        if (r.ok) tags = ((await r.json()).tags || []).map(t => t.name).filter(Boolean).sort((a, b) => a.localeCompare(b));
      }
    } catch (_) {}
  }
  return res.status(200).json({
    tags,
    lead_tag: offer?.data?.lead_tag || null,
    client_tag: offer?.data?.client_tag || null,
    recommend: recommend(tags),
  });
}

export default withSentryApiRoute(handler);
