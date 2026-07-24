// Shared GHL helpers — token picking/refresh, the v2 fetch wrapper, contact
// lookup/upsert, and a server-to-server SMS sender. Used by the authed
// /api/ghl/send-message endpoint AND by unauthenticated server paths (e.g. the
// Stripe webhook texting staff on a new signup), which can't carry a user token.
//
// Keep this provider-agnostic of auth: callers do their own authorization, then
// pass a loaded `clients` row (with the ghl_* fields) to these functions.

import { maybeSendSmsViaProvider } from "../messaging/provider.js";
import { mintForClient, markTokenTrouble, clearTokenTrouble, RENEW_WINDOW_MS } from "./_agency.js";

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

// Re-read a client's token straight from the DB and return it if another process
// has already renewed it. Null when there is nothing newer to use.
async function rereadToken(client) {
  try {
    const rows = await sb(`clients?id=eq.${client.id}&select=ghl_access_token,ghl_location_id,ghl_token_expires_at`);
    const fresh = rows && rows[0];
    if (!fresh?.ghl_access_token || fresh.ghl_access_token === client.ghl_access_token) return null;
    const fexp = fresh.ghl_token_expires_at ? new Date(fresh.ghl_token_expires_at).getTime() : 0;
    if (fexp <= Date.now()) return null;
    return { token: fresh.ghl_access_token, locationId: fresh.ghl_location_id || client.ghl_location_id };
  } catch (_) { return null; }
}

// Pick the GHL token for this academy: per-academy OAuth (auto-renew near
// expiry) → GHL_LOCATIONS_JSON entry → plain env fallback. Null if none usable.
//
// Renewal order is mint-then-refresh, on purpose:
//   1. Minting from the agency token always works while the agency is connected,
//      and is independent of which OAuth app issued the current token.
//   2. The refresh_token grant is the fallback. It is single-use and bound to the
//      issuing app, so a lost response permanently kills it - which is exactly how
//      academies used to go cold and need a human to open their Inbox.
// The renew window is hours, not seconds, so a transient failure gets many more
// attempts before the token actually expires.
export async function pickGhlToken(client) {
  if (client.ghl_access_token) {
    const expiresAt = client.ghl_token_expires_at ? new Date(client.ghl_token_expires_at).getTime() : 0;
    // No recorded expiry means we cannot tell how old the token is, so try to
    // renew it (matching the previous behaviour) but never treat that as an outage.
    const isExpired = expiresAt > 0 && expiresAt <= Date.now();
    if (!expiresAt || expiresAt - Date.now() <= RENEW_WINDOW_MS) {
      try {
        const minted = await mintForClient(client);
        if (minted) return minted;
      } catch (_) { /* fall through to the refresh grant */ }

      if (client.ghl_refresh_token) {
        try {
          const refreshed = await refreshGhlToken(client);
          await clearTokenTrouble(client.id);
          return refreshed;
        } catch (e) {
          // GHL refresh tokens are single-use, so a concurrent process (e.g. the
          // contacts-sync cron) may have just consumed ours and saved a fresh
          // access token. Re-read the row rather than falling back to the stale
          // in-memory token, which surfaced as "Invalid JWT".
          const fresh = await rereadToken(client);
          if (fresh) return fresh;

          // Only a token that is ALREADY expired is an outage. Inside the window
          // it is just an early attempt and the next tick will try again.
          if (isExpired) {
            console.error(`[ghl] token renew failed for ${client.business_name || client.id}: ${e.message}`);
            await markTokenTrouble(client.id, `renew failed: ${e.message}`);
          }
        }
      } else if (isExpired) {
        await markTokenTrouble(client.id, "token expired and no refresh_token; needs an agency re-mint");
      }
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

export async function ghl(method, path, { token, body, retries = 3 } = {}) {
  const headers = {
    Authorization: `Bearer ${token}`,
    Version:       V2_VERSION,
    Accept:        "application/json",
    "Content-Type": "application/json",
  };
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(`${GHL_V2}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
    const text = await res.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch (_) { json = { raw: text }; }
    // GHL throttles bursts (429). Back off and retry — honor Retry-After when sent,
    // else exponential (0.6s, 1.2s, 2.4s…), capped. This is what makes the detector
    // survive fetching several conversation threads in a row.
    if (res.status === 429 && attempt < retries) {
      const ra = parseInt(res.headers.get("retry-after") || "", 10);
      const waitMs = Number.isFinite(ra) && ra > 0 ? Math.min(ra * 1000, 10000) : Math.min(600 * 2 ** attempt, 6000);
      await new Promise(r => setTimeout(r, waitMs));
      continue;
    }
    if (!res.ok) {
      const err = new Error((json && (json.message || json.error)) || `GHL ${res.status}`);
      err.status = res.status; err.body = json;
      throw err;
    }
    return json;
  }
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
    // Provider gate: if this academy runs its own Twilio, send there + store and
    // skip GHL entirely. Inert until messaging_provider='twilio' + active creds.
    const viaProvider = await maybeSendSmsViaProvider(client, { toPhone, body: message, contactName, sentBy: "system" });
    if (viaProvider.handled) return viaProvider.ok ? { ok: true, via: "twilio", message_id: viaProvider.sid } : { ok: false, error: viaProvider.error };
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
