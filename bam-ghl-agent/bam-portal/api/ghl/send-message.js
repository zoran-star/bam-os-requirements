import { withSentryApiRoute } from "../_sentry.js";
// Vercel Serverless Function — GHL: send SMS or Email to an academy parent.
//
// POST /api/ghl/send-message
//   body: {
//     client_id:     <uuid>            // academy → looked up to get ghl_location_id
//     contact_phone: '+1xxx…'  (optional)
//     contact_email: 'x@y.com' (optional, fallback for SMS lookup)
//     contact_name:  'Jane'    (optional, only used if we have to create the contact)
//     type:          'SMS' | 'Email'
//     message:       'plain text body'   (required for SMS, used as html for Email)
//     html:          '<p>…</p>'           (optional, overrides message for Email)
//     subject:       'subject line'       (required for Email)
//   }
//
// Auth: caller must be staff OR belong to client_id via client_users.
//
// Returns: { ok, ghl_contact_id, ghl_conversation_id, ghl_message_id, sent_via }
// Or:      { error, hint? }
//
// Broken-case strategy:
//   - clients.ghl_location_id missing  → 400 "academy not connected to GHL"
//   - no GHL_AGENCY_TOKEN env var      → 400 "GHL not configured"
//   - contact lookup fails             → tries email; if both fail → 404
//   - GHL send fails                   → returns the raw GHL error so the UI can show it

const GHL_V2 = "https://services.leadconnectorhq.com";
const V2_VERSION = "2021-07-28";

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

const GHL_TOKEN_URL = "https://services.leadconnectorhq.com/oauth/token";

// Refresh the academy's GHL OAuth token using its refresh_token. Persists
// the new access_token + expiry on the clients row. Returns the new access
// token (or throws). Mirrors the GHL OAuth refresh spec.
async function refreshGhlToken(client) {
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

// Pick the GHL token for this academy. Order of preference:
//
//   1. Per-academy OAuth token (clients.ghl_access_token) — Pattern A,
//      the white-label vision. Auto-refreshes if near expiry.
//   2. Per-academy entry in GHL_LOCATIONS_JSON — legacy / interim,
//      matches the existing api/ghl.js setup.
//   3. Plain GHL_API_KEY env var — last-resort fallback.
//
// Returns { token, locationId } or null if nothing usable is found.
async function pickGhlToken(client) {
  // 1. Per-academy OAuth
  if (client.ghl_access_token) {
    const expiresAt = client.ghl_token_expires_at ? new Date(client.ghl_token_expires_at).getTime() : 0;
    const skewMs    = 60 * 1000; // refresh if expiring within 60s
    if (expiresAt - Date.now() <= skewMs && client.ghl_refresh_token) {
      try { return await refreshGhlToken(client); }
      catch (_) { /* fall through to existing token; GHL may still accept */ }
    }
    return { token: client.ghl_access_token, locationId: client.ghl_location_id };
  }

  // 2. GHL_LOCATIONS_JSON
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

  // 3. Fallback
  const token = process.env.GHL_API_KEY || process.env.GHL_AGENCY_TOKEN || null;
  if (token) return { token, locationId: client.ghl_location_id };
  return null;
}

async function ghl(method, path, { token, locationId, body } = {}) {
  const headers = {
    Authorization: `Bearer ${token}`,
    Version:       V2_VERSION,
    Accept:        "application/json",
    "Content-Type": "application/json",
  };
  const res = await fetch(`${GHL_V2}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch (_) { json = { raw: text }; }
  if (!res.ok) {
    const err = new Error((json && (json.message || json.error)) || `GHL ${res.status}`);
    err.status = res.status;
    err.body = json;
    throw err;
  }
  return json;
}

// Look up a GHL contact by phone, falling back to email. Returns the
// contactId or null if no match.
async function lookupContact({ token, locationId, phone, email }) {
  const params = new URLSearchParams({ locationId, limit: "5" });
  if (phone) params.set("query", phone);
  else if (email) params.set("query", email);
  else return null;

  let data;
  try {
    data = await ghl("GET", `/contacts/?${params}`, { token });
  } catch (_) { return null; }
  const contacts = data?.contacts || data?.data || [];
  if (!contacts.length && email && phone) {
    // Retry with email if phone lookup found nothing
    const p2 = new URLSearchParams({ locationId, limit: "5", query: email });
    try { data = await ghl("GET", `/contacts/?${p2}`, { token }); } catch (_) { return null; }
    const c2 = data?.contacts || data?.data || [];
    if (c2[0]) return c2[0].id || c2[0].contactId;
    return null;
  }
  return contacts[0]?.id || contacts[0]?.contactId || null;
}

async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  let ctx;
  try {
    ctx = await resolveUser(req);
  } catch (e) {
    return res.status(e.status || 401).json({ error: e.message });
  }

  const body = (req.body && typeof req.body === "object") ? req.body : {};
  const clientId = body.client_id;
  if (!clientId) return res.status(400).json({ error: "client_id required" });
  if (!ctx.isStaff && !ctx.clientIds.includes(clientId)) {
    return res.status(403).json({ error: "not your academy" });
  }

  // Load academy GHL config
  const clientRows = await sb(
    `clients?id=eq.${clientId}` +
    `&select=id,business_name,ghl_location_id,ghl_access_token,ghl_refresh_token,ghl_token_expires_at,ghl_connect_status` +
    `&limit=1`
  );
  const client = Array.isArray(clientRows) && clientRows[0];
  if (!client) return res.status(404).json({ error: "academy not found" });
  if (!client.ghl_location_id && !client.ghl_access_token) {
    return res.status(400).json({
      error: "Academy not connected to GHL.",
      hint:  "Click 'Connect GHL' on the Members tab to start the OAuth flow.",
    });
  }

  let creds;
  try {
    creds = await pickGhlToken(client);
  } catch (e) {
    return res.status(500).json({ error: `GHL token refresh failed: ${e.message}` });
  }
  if (!creds) {
    return res.status(500).json({
      error: "GHL not configured for this academy.",
      hint:  "Click 'Connect GHL' to authorize, or add this academy to GHL_LOCATIONS_JSON as an interim.",
    });
  }
  const { token, locationId } = creds;

  const type = (body.type || "SMS").toUpperCase() === "EMAIL" ? "Email" : "SMS";
  const message = (body.message || "").trim();
  const subject = (body.subject || "").trim();
  const html    = (body.html    || "").trim();
  // Public URLs of any files the sender attached. GHL accepts an `attachments`
  // URL array on both SMS (→ MMS) and Email messages.
  const attachments = Array.isArray(body.attachments)
    ? body.attachments.filter(u => typeof u === "string" && u)
    : [];

  if (!message && !html && !attachments.length) {
    return res.status(400).json({ error: "message, html, or an attachment is required" });
  }
  if (type === "Email" && !subject) return res.status(400).json({ error: "subject required for Email" });

  // Find the contact. Callers can pass contact_id directly (Inbox reply
  // case — we already know who we're replying to) to skip the lookup.
  const contactId = body.contact_id || await lookupContact({
    token,
    locationId,
    phone:      body.contact_phone,
    email:      body.contact_email,
  });
  if (!contactId) {
    return res.status(404).json({
      error: "No GHL contact found for this parent.",
      hint:  "Searched by phone, then email. Add them in GHL first, or copy the link to send manually.",
    });
  }

  // Send the message
  let sendResp;
  try {
    const sendBody = type === "Email"
      ? { type: "Email", contactId, subject, html: html || `<p>${message}</p>` }
      : { type: "SMS",   contactId, message };
    if (attachments.length) sendBody.attachments = attachments;
    sendResp = await ghl("POST", `/conversations/messages`, { token, body: sendBody });
  } catch (e) {
    return res.status(e.status || 502).json({
      error: `GHL send failed: ${e.message}`,
      detail: e.body || null,
    });
  }

  return res.status(200).json({
    ok: true,
    sent_via:            type,
    ghl_contact_id:      contactId,
    ghl_conversation_id: sendResp.conversationId || null,
    ghl_message_id:      sendResp.messageId      || null,
  });
}

export default withSentryApiRoute(handler);
