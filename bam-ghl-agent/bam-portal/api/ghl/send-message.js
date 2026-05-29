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

// Pick the GHL token for this academy. Order of preference:
//
//   1. Per-academy entry in GHL_LOCATIONS_JSON, matched by locationId or
//      by business_name (this matches the existing api/ghl.js setup so
//      no new env vars are needed).
//   2. Plain GHL_API_KEY env var as a last-resort fallback.
//
// Returns { token, locationId } or null if nothing usable is found.
function pickGhlToken(client) {
  // Try GHL_LOCATIONS_JSON first — same env var the existing api/ghl.js uses.
  if (process.env.GHL_LOCATIONS_JSON) {
    let locs;
    try { locs = JSON.parse(process.env.GHL_LOCATIONS_JSON); } catch (_) { locs = []; }
    if (Array.isArray(locs)) {
      // Match by locationId first (most reliable), then by business_name.
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
  // Fallback to a plain env var.
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

export default async function handler(req, res) {
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
  const clientRows = await sb(`clients?id=eq.${clientId}&select=id,business_name,ghl_location_id&limit=1`);
  const client = Array.isArray(clientRows) && clientRows[0];
  if (!client) return res.status(404).json({ error: "academy not found" });
  if (!client.ghl_location_id) {
    return res.status(400).json({
      error: "Academy not connected to GHL.",
      hint:  "Set clients.ghl_location_id (Settings → GHL connection) before sending.",
    });
  }

  const creds = pickGhlToken(client);
  if (!creds) {
    return res.status(500).json({
      error: "GHL not configured for this academy.",
      hint:  "Either add this academy to GHL_LOCATIONS_JSON (matched by locationId or name) or set a fallback GHL_API_KEY env var.",
    });
  }
  const { token, locationId } = creds;

  const type = (body.type || "SMS").toUpperCase() === "EMAIL" ? "Email" : "SMS";
  const message = (body.message || "").trim();
  const subject = (body.subject || "").trim();
  const html    = (body.html    || "").trim();

  if (!message && !html) return res.status(400).json({ error: "message (or html for Email) required" });
  if (type === "Email" && !subject) return res.status(400).json({ error: "subject required for Email" });

  // Find the contact
  const contactId = await lookupContact({
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
    sendResp = await ghl("POST", `/conversations/messages`, {
      token,
      body: type === "Email"
        ? { type: "Email", contactId, subject, html: html || `<p>${message}</p>` }
        : { type: "SMS",   contactId, message },
    });
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
