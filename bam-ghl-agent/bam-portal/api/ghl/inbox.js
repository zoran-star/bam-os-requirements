import { withSentryApiRoute } from "../_sentry.js";
// Vercel Serverless Function — Per-academy GHL Inbox
//
//   GET /api/ghl/inbox?client_id=<uuid>
//     → list of conversations for this academy, each annotated as
//       member / lead / unknown based on a member-table cross-reference.
//
//   GET /api/ghl/inbox?client_id=<uuid>&conversation_id=<id>
//     → full message thread for one conversation.
//
// Auth: Supabase JWT. Caller must own the academy via client_users OR be staff.
// Token: per-academy GHL OAuth token (clients.ghl_access_token). Auto-refresh
// if expiring within 60 seconds.

const GHL_V2        = "https://services.leadconnectorhq.com";
const GHL_TOKEN_URL = "https://services.leadconnectorhq.com/oauth/token";
const V2_VERSION    = "2021-07-28";

const SUPABASE_URL         = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
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

// ── GHL HTTP helpers ─────────────────────────────────────
async function ghl(method, path, { token, body } = {}) {
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

async function pickGhlToken(client) {
  if (client.ghl_access_token) {
    const expiresAt = client.ghl_token_expires_at ? new Date(client.ghl_token_expires_at).getTime() : 0;
    if (expiresAt - Date.now() <= 60_000 && client.ghl_refresh_token) {
      try { return await refreshGhlToken(client); } catch (_) {}
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
      if (entry && (entry.apiKeyV2 || entry.apiKey)) {
        return { token: entry.apiKeyV2 || entry.apiKey, locationId: entry.locationId || client.ghl_location_id };
      }
    }
  }
  const token = process.env.GHL_API_KEY || process.env.GHL_AGENCY_TOKEN || null;
  return token ? { token, locationId: client.ghl_location_id } : null;
}

// ─────────────────────────────────────────────────────────
// Handler
// ─────────────────────────────────────────────────────────
async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "GET only" });

  let ctx;
  try { ctx = await resolveUser(req); }
  catch (e) { return res.status(e.status || 401).json({ error: e.message }); }

  const clientId = req.query.client_id;
  if (!clientId) return res.status(400).json({ error: "client_id required" });
  if (!ctx.isStaff && !ctx.clientIds.includes(clientId)) {
    return res.status(403).json({ error: "not your academy" });
  }

  // Load the academy's row + GHL config
  const clientRows = await sb(
    `clients?id=eq.${clientId}` +
    `&select=id,business_name,ghl_location_id,ghl_access_token,ghl_refresh_token,ghl_token_expires_at` +
    `&limit=1`
  );
  const client = Array.isArray(clientRows) && clientRows[0];
  if (!client) return res.status(404).json({ error: "academy not found" });
  if (!client.ghl_location_id && !client.ghl_access_token) {
    return res.status(400).json({
      error: "Academy not connected to GHL.",
      hint:  "Click 'Connect GHL' on the Members tab first.",
    });
  }

  let creds;
  try { creds = await pickGhlToken(client); }
  catch (e) { return res.status(500).json({ error: `GHL token refresh failed: ${e.message}` }); }
  if (!creds) return res.status(500).json({ error: "GHL not configured for this academy." });
  const { token, locationId } = creds;

  const conversationId = req.query.conversation_id;

  // ────────────────────────────────────────────────────────
  // Mode B: single thread
  // ────────────────────────────────────────────────────────
  if (conversationId) {
    try {
      const data = await ghl("GET", `/conversations/${encodeURIComponent(conversationId)}/messages`, { token });
      const messages = (data.messages?.messages || data.messages || data.data || []).map(m => ({
        id:         m.id,
        body:       m.body || m.message || "",
        type:       m.type || m.messageType || "",
        direction:  m.direction || "",
        status:     m.status || "",
        date:       m.dateAdded || m.createdAt || m.timestamp || null,
        attachments: m.attachments || [],
        contactId:  m.contactId || null,
      }));
      return res.status(200).json({ conversation_id: conversationId, messages });
    } catch (e) {
      return res.status(e.status || 502).json({ error: `GHL: ${e.message}`, detail: e.body || null });
    }
  }

  // ────────────────────────────────────────────────────────
  // Mode A: list conversations
  // ────────────────────────────────────────────────────────
  let convos = [];
  try {
    const params = new URLSearchParams({ locationId, limit: "50" });
    const data = await ghl("GET", `/conversations/search?${params}`, { token });
    convos = data.conversations || data.data || [];
  } catch (e) {
    return res.status(e.status || 502).json({ error: `GHL: ${e.message}`, detail: e.body || null });
  }

  // Annotate each conversation: member / lead / unknown.
  // Primary key is ghl_contact_id (now backfilled across the roster — see
  // /api/ghl/backfill-contacts). Email + normalized-phone are fallbacks for
  // the rare case of a new member whose contact_id hasn't synced yet.
  const memberLookups = await sb(
    `members?client_id=eq.${clientId}` +
    `&select=id,athlete_name,parent_name,parent_email,parent_phone,ghl_contact_id,status`
  ).catch(() => []);
  const members = Array.isArray(memberLookups) ? memberLookups : [];

  // Strip everything that isn't a digit so "(416) 555-1234" matches "+14165551234".
  const normPhone = (p) => (p ? String(p).replace(/\D+/g, "") : "");

  const memberByContactId = new Map();
  const memberByEmail     = new Map();
  const memberByPhone     = new Map();
  for (const m of members) {
    if (m.ghl_contact_id) memberByContactId.set(m.ghl_contact_id, m);
    if (m.parent_email)   memberByEmail.set(m.parent_email.toLowerCase(), m);
    const p = normPhone(m.parent_phone);
    if (p) memberByPhone.set(p, m);
  }

  // Per-contact trainer assignment (drives the comms trainer tabs).
  const trainerByContact = new Map();
  try {
    const ct = await sb(`contact_trainers?client_id=eq.${clientId}&select=ghl_contact_id,trainer`);
    for (const r of (Array.isArray(ct) ? ct : [])) if (r.ghl_contact_id && r.trainer) trainerByContact.set(r.ghl_contact_id, r.trainer);
  } catch (_) {}

  // Lead/Client tag config from the training offer.
  let tagConfig = { lead_tag: null, client_tag: null };
  try {
    const offers = await sb(`offers?client_id=eq.${clientId}&type=eq.training&select=data&order=sort_order.asc&limit=1`);
    const d = offers?.[0]?.data || {};
    tagConfig = { lead_tag: d.lead_tag || null, client_tag: d.client_tag || null };
  } catch (_) {}

  const annotated = convos.map(c => {
    const m =
      (c.contactId && memberByContactId.get(c.contactId)) ||
      (c.email     && memberByEmail.get((c.email || "").toLowerCase())) ||
      (c.phone     && memberByPhone.get(normPhone(c.phone))) ||
      null;
    return {
      id:                c.id,
      contactId:         c.contactId,
      contactName:       c.fullName || c.contactName || "Unknown",
      email:             c.email || null,
      phone:             c.phone || null,
      lastMessageBody:   c.lastMessageBody || "",
      lastMessageDate:   c.lastMessageDate || c.dateUpdated || null,
      lastMessageType:   c.lastMessageType || "",
      lastMessageDirection: c.lastMessageDirection || "",
      unreadCount:       c.unreadCount || 0,
      classification:    m ? "member" : "lead",
      member: m ? { id: m.id, athlete_name: m.athlete_name, status: m.status } : null,
      trainer: (c.contactId && trainerByContact.get(c.contactId)) || null,
      channel: (c.lastMessageType || c.type || "").replace(/^TYPE_/, "").toLowerCase() || null,
    };
  });
  const trainers = [...new Set([...trainerByContact.values()])].sort((a, b) => a.localeCompare(b));

  // Sort by lastMessageDate desc (newest first)
  annotated.sort((a, b) => {
    const ta = a.lastMessageDate ? new Date(a.lastMessageDate).getTime() : 0;
    const tb = b.lastMessageDate ? new Date(b.lastMessageDate).getTime() : 0;
    return tb - ta;
  });

  return res.status(200).json({
    conversations: annotated,
    trainers,
    tagConfig,
    counts: {
      all:     annotated.length,
      members: annotated.filter(c => c.classification === "member").length,
      leads:   annotated.filter(c => c.classification === "lead").length,
      unread:  annotated.reduce((sum, c) => sum + (c.unreadCount || 0), 0),
    },
  });
}

export default withSentryApiRoute(handler);
