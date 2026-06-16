// Shared GHL helpers — token picking/refresh, the v2 fetch wrapper, contact
// lookup/upsert, and a server-to-server SMS sender. Used by the authed
// /api/ghl/send-message endpoint AND by unauthenticated server paths (e.g. the
// Stripe webhook texting staff on a new signup), which can't carry a user token.
//
// Keep this provider-agnostic of auth: callers do their own authorization, then
// pass a loaded `clients` row (with the ghl_* fields) to these functions.

const GHL_V2 = "https://services.leadconnectorhq.com";
const V2_VERSION = "2021-07-28";
const GHL_TOKEN_URL = "https://services.leadconnectorhq.com/oauth/token";

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;

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

// Refresh the academy's GHL OAuth token; persists the new token on the client.
export async function refreshGhlToken(client) {
  const clientId     = (process.env.GHL_OAUTH_CLIENT_ID || "").trim();
  const clientSecret = (process.env.GHL_OAUTH_CLIENT_SECRET || "").trim();
  if (!clientId || !clientSecret) throw new Error("GHL_OAUTH_CLIENT_ID/SECRET not configured");
  if (!client.ghl_refresh_token)  throw new Error("academy has no GHL refresh_token");

  const tokenRes = await fetch(GHL_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id:     clientId,
      client_secret: clientSecret,
      grant_type:    "refresh_token",
      refresh_token: client.ghl_refresh_token,
      user_type:     "Location",
    }),
  });
  const tok = await tokenRes.json();
  if (!tokenRes.ok || !tok?.access_token) {
    throw new Error(tok?.error_description || tok?.error || "GHL token refresh failed");
  }
  const expiresAt = new Date(Date.now() + (Number(tok.expires_in) || 86400) * 1000).toISOString();

  await sb(`clients?id=eq.${client.id}`, {
    method: "PATCH",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({
      ghl_access_token:     tok.access_token,
      ghl_refresh_token:    tok.refresh_token || client.ghl_refresh_token,
      ghl_token_expires_at: expiresAt,
    }),
  });

  return { token: tok.access_token, locationId: tok.locationId || client.ghl_location_id };
}

// Pick the GHL token for this academy: per-academy OAuth (auto-refresh near
// expiry) → GHL_LOCATIONS_JSON entry → plain env fallback. Null if none usable.
export async function pickGhlToken(client) {
  if (client.ghl_access_token) {
    const expiresAt = client.ghl_token_expires_at ? new Date(client.ghl_token_expires_at).getTime() : 0;
    const skewMs    = 60 * 1000;
    if (expiresAt - Date.now() <= skewMs && client.ghl_refresh_token) {
      try { return await refreshGhlToken(client); }
      catch (_) { /* fall through to existing token; GHL may still accept */ }
    }
    return { token: client.ghl_access_token, locationId: client.ghl_location_id };
  }
  if (process.env.GHL_LOCATIONS_JSON) {
    let locs;
    try { locs = JSON.parse(process.env.GHL_LOCATIONS_JSON); } catch (_) { locs = []; }
    if (Array.isArray(locs)) {
      const entry =
        locs.find(l => l.locationId && l.locationId === client.ghl_location_id) ||
        locs.find(l => l.name && client.business_name && l.name.toLowerCase() === client.business_name.toLowerCase());
      if (entry) {
        const token = entry.apiKeyV2 || entry.apiKey || null;
        const locationId = entry.locationId || client.ghl_location_id || null;
        if (token) return { token, locationId };
      }
    }
  }
  const token = process.env.GHL_API_KEY || process.env.GHL_AGENCY_TOKEN || null;
  if (token) return { token, locationId: client.ghl_location_id };
  return null;
}

export async function ghl(method, path, { token, body } = {}) {
  const headers = {
    Authorization: `Bearer ${token}`,
    Version:       V2_VERSION,
    Accept:        "application/json",
    "Content-Type": "application/json",
  };
  const res = await fetch(`${GHL_V2}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch (_) { json = { raw: text }; }
  if (!res.ok) {
    const err = new Error((json && (json.message || json.error)) || `GHL ${res.status}`);
    err.status = res.status; err.body = json;
    throw err;
  }
  return json;
}

// Find a GHL contact by phone, then email. Returns contactId or null.
export async function lookupContact({ token, locationId, phone, email }) {
  const params = new URLSearchParams({ locationId, limit: "5" });
  if (phone) params.set("query", phone);
  else if (email) params.set("query", email);
  else return null;
  let data;
  try { data = await ghl("GET", `/contacts/?${params}`, { token }); } catch (_) { return null; }
  const contacts = data?.contacts || data?.data || [];
  if (!contacts.length && email && phone) {
    const p2 = new URLSearchParams({ locationId, limit: "5", query: email });
    try { data = await ghl("GET", `/contacts/?${p2}`, { token }); } catch (_) { return null; }
    const c2 = data?.contacts || data?.data || [];
    return c2[0]?.id || c2[0]?.contactId || null;
  }
  return contacts[0]?.id || contacts[0]?.contactId || null;
}

// Find-or-create a contact for a phone number (so staff who aren't yet a GHL
// contact still get the text). Returns contactId or null.
export async function upsertContactByPhone({ token, locationId, phone, name }) {
  const found = await lookupContact({ token, locationId, phone });
  if (found) return found;
  try {
    const resp = await ghl("POST", `/contacts/upsert`, {
      token,
      body: { locationId, phone, ...(name ? { name } : {}) },
    });
    return resp?.contact?.id || resp?.id || null;
  } catch (_) { return null; }
}

// Server-to-server SMS: load the GHL token for `client`, ensure a contact for
// `toPhone`, send the message. Returns { ok, ... } or { ok:false, error }.
// Never throws — safe to call from a webhook (caller decides on the result).
export async function sendSms({ client, toPhone, message, contactName }) {
  try {
    if (!client) return { ok: false, error: "no client" };
    if (!toPhone) return { ok: false, error: "no destination phone" };
    if (!client.ghl_location_id && !client.ghl_access_token) return { ok: false, error: "academy not connected to GHL" };
    const creds = await pickGhlToken(client);
    if (!creds) return { ok: false, error: "no GHL token for academy" };
    const { token, locationId } = creds;
    const contactId = await upsertContactByPhone({ token, locationId, phone: toPhone, name: contactName });
    if (!contactId) return { ok: false, error: "could not find/create a GHL contact for the staff phone" };
    const resp = await ghl("POST", `/conversations/messages`, { token, body: { type: "SMS", contactId, message } });
    return { ok: true, contact_id: contactId, message_id: resp?.messageId || null };
  } catch (e) {
    return { ok: false, error: (e && e.message) || String(e) };
  }
}
