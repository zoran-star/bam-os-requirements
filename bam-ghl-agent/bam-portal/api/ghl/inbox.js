import { withSentryApiRoute } from "../_sentry.js";
import { smsProvider } from "../messaging/provider.js";
import { readStoreThreadInbox, readStoreThreadById, listStoreThreads } from "../messaging/read-thread.js";
import { emailProvider } from "../messaging/email-provider.js";
import { readEmailStoreThreadInbox, readEmailStoreThreadById, listEmailStoreThreads } from "../messaging/email-read-thread.js";
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
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function ghl(method, path, { token, body } = {}) {
  const headers = {
    Authorization: `Bearer ${token}`,
    Version:       V2_VERSION,
    Accept:        "application/json",
    "Content-Type": "application/json",
  };
  // Retry on GHL rate-limit (429) with backoff — respects Retry-After if sent.
  let res;
  for (let attempt = 0; attempt < 4; attempt++) {
    res = await fetch(`${GHL_V2}${path}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });
    if (res.status !== 429) break;
    const ra = Number(res.headers.get("retry-after"));
    const wait = ra > 0 ? Math.min(ra * 1000, 5000) : Math.min(400 * 2 ** attempt, 5000);
    await sleep(wait);
  }
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

// ── Inbox-list cache (per academy) ──────────────────────────────────────────
// The list payload is cached for a few seconds so rapid reloads + the approval
// count refresh cost ZERO GHL calls, and so a GHL rate-limit (429) serves the
// last good payload instead of failing the whole inbox.
const INBOX_CACHE_TTL_MS = 12000;
async function readInboxCache(clientId) {
  try {
    const rows = await sb(`ghl_inbox_cache?client_id=eq.${clientId}&select=payload,updated_at&limit=1`);
    return Array.isArray(rows) && rows[0] ? rows[0] : null;
  } catch (_) { return null; }
}
function writeInboxCache(clientId, payload) {
  // Fire-and-forget upsert — never block the response on the cache write.
  sb(`ghl_inbox_cache?on_conflict=client_id`, {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify([{ client_id: clientId, payload, updated_at: new Date().toISOString() }]),
  }).catch(() => {});
}

// ── Per-user read state (GHL has no reliable mark-read API, so we track it) ──
// Map of ghl_conversation_id → last_read_at (ms) for this user+academy.
async function loadUserReads(clientId, userId) {
  const map = new Map();
  if (!userId) return map;
  try {
    const rows = await sb(`ghl_conversation_reads?client_id=eq.${clientId}&auth_user_id=eq.${userId}&select=ghl_conversation_id,last_read_at`);
    for (const r of (rows || [])) {
      if (r.ghl_conversation_id) map.set(r.ghl_conversation_id, r.last_read_at ? new Date(r.last_read_at).getTime() : 0);
    }
  } catch (_) { /* best-effort — falls back to GHL's unreadCount */ }
  return map;
}
// A conversation is READ for this user when they've opened it AFTER its last
// message. We only ever CLEAR unread (never invent it) — so outbound/already-read
// threads stay at 0, and a new inbound (date > last_read_at) flips back to unread.
function applyReads(convos, readsMap) {
  if (!readsMap || !readsMap.size) return convos || [];
  return (convos || []).map(c => {
    const r = readsMap.get(c.id);
    if (r == null) return c;
    const lastMs = c.lastMessageDate ? new Date(c.lastMessageDate).getTime() : 0;
    return r >= lastMs ? { ...c, unreadCount: 0 } : c;
  });
}
function sortByUnreadThenDate(arr) {
  return [...(arr || [])].sort((a, b) => {
    const ua = (a.unreadCount || 0) > 0 ? 1 : 0;
    const ub = (b.unreadCount || 0) > 0 ? 1 : 0;
    if (ua !== ub) return ub - ua;
    const ta = a.lastMessageDate ? new Date(a.lastMessageDate).getTime() : 0;
    const tb = b.lastMessageDate ? new Date(b.lastMessageDate).getTime() : 0;
    return tb - ta;
  });
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
      try { return await refreshGhlToken(client); }
      catch (_) {
        // Refresh failed — GHL refresh tokens are single-use, so a concurrent
        // process (e.g. the contacts-sync cron) likely just consumed it and saved
        // a fresh access token. Re-read the row and use that instead of falling
        // back to the now-stale in-memory token (which caused "Invalid JWT").
        try {
          const rows = await sb(`clients?id=eq.${client.id}&select=ghl_access_token,ghl_location_id,ghl_token_expires_at,ghl_refresh_token`);
          const fresh = rows && rows[0];
          if (fresh && fresh.ghl_access_token && fresh.ghl_access_token !== client.ghl_access_token) {
            const fexp = fresh.ghl_token_expires_at ? new Date(fresh.ghl_token_expires_at).getTime() : 0;
            if (fexp - Date.now() > 60_000) return { token: fresh.ghl_access_token, locationId: fresh.ghl_location_id || client.ghl_location_id };
            try { return await refreshGhlToken(fresh); } catch (_) {}
            return { token: fresh.ghl_access_token, locationId: fresh.ghl_location_id || client.ghl_location_id };
          }
        } catch (_) {}
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
      if (entry && (entry.apiKeyV2 || entry.apiKey)) {
        return { token: entry.apiKeyV2 || entry.apiKey, locationId: entry.locationId || client.ghl_location_id };
      }
    }
  }
  const token = process.env.GHL_API_KEY || process.env.GHL_AGENCY_TOKEN || null;
  return token ? { token, locationId: client.ghl_location_id } : null;
}

// Off-GHL classifier for the own-store inbox (twilio/resend academies).
// A conversation is a MEMBER if its contact matches a row in the portal
// `members` table (by portal contact id, phone, or email); everyone else who
// reaches out — funnel leads AND random inbound — is a LEAD, so nothing hides
// in "All" only. Uses portal data exclusively; makes zero GHL calls.
async function classifyStoreConversations(clientId, conversations) {
  const rows = await sb(
    `members?client_id=eq.${clientId}` +
    `&select=id,athlete_name,parent_email,parent_phone,ghl_contact_id,status`
  ).catch(() => []);
  const members = Array.isArray(rows) ? rows : [];
  const normPhone = (p) => (p ? String(p).replace(/\D+/g, "") : "");

  const byContactId = new Map();
  const byPhone     = new Map();
  const byEmail     = new Map();
  for (const m of members) {
    if (m.ghl_contact_id) byContactId.set(m.ghl_contact_id, m);
    const p = normPhone(m.parent_phone);
    if (p) byPhone.set(p, m);
    if (m.parent_email) byEmail.set(m.parent_email.toLowerCase(), m);
  }

  return conversations.map((c) => {
    const m =
      (c.contactId && byContactId.get(c.contactId)) ||
      (c.phone     && byPhone.get(normPhone(c.phone))) ||
      (c.email     && byEmail.get(String(c.email).toLowerCase())) ||
      null;
    return {
      ...c,
      classification: m ? "member" : "lead",
      member: m ? { id: m.id, athlete_name: m.athlete_name, status: m.status } : null,
    };
  });
}

// ─────────────────────────────────────────────────────────
// Handler
// ─────────────────────────────────────────────────────────
async function handler(req, res) {
  if (req.method !== "GET" && req.method !== "POST") return res.status(405).json({ error: "GET or POST" });

  let ctx;
  try { ctx = await resolveUser(req); }
  catch (e) { return res.status(e.status || 401).json({ error: e.message }); }

  const clientId = req.query.client_id || (req.body && req.body.client_id);
  if (!clientId) return res.status(400).json({ error: "client_id required" });
  if (!ctx.isStaff && !ctx.clientIds.includes(clientId)) {
    return res.status(403).json({ error: "not your academy" });
  }

  // ── POST ?action=mark-read ── Per-user read receipt for a GHL conversation.
  // Called when the user opens a thread. Idempotent upsert. No GHL call.
  if (req.method === "POST") {
    if (req.query.action !== "mark-read") return res.status(400).json({ error: "unsupported POST action" });
    const convId = (req.body && req.body.conversation_id) || req.query.conversation_id;
    if (!convId) return res.status(400).json({ error: "conversation_id required" });
    try {
      await sb(`ghl_conversation_reads?on_conflict=auth_user_id,ghl_conversation_id`, {
        method: "POST",
        headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
        body: JSON.stringify([{
          client_id: clientId, ghl_conversation_id: String(convId),
          auth_user_id: ctx.user.id, last_read_at: new Date().toISOString(),
        }]),
      });
      return res.status(200).json({ ok: true });
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
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

  // Mode S: sender info — the email + phone number synced with GHL (V1.5 Inbox
  // setup just lists these so staff know what they send from).
  if (req.query.action === "sender-info") {
    try {
      const loc = (await ghl("GET", `/locations/${encodeURIComponent(locationId)}`, { token })).location || {};
      let phone = loc.phone || null;
      // Prefer a real SMS-capable number from the location's phone numbers, if exposed.
      try {
        const nums = await ghl("GET", `/phone-system/numbers/location/${encodeURIComponent(locationId)}`, { token });
        const list = nums?.numbers || nums?.data || [];
        const first = list.find(n => n.phoneNumber || n.number);
        if (first) phone = first.phoneNumber || first.number || phone;
      } catch (_) { /* numbers endpoint not available on this plan — fall back to location.phone */ }
      return res.status(200).json({ email: loc.email || null, phone, location_name: loc.name || null });
    } catch (e) {
      return res.status(e.status || 500).json({ error: e.message });
    }
  }

  const conversationId = req.query.conversation_id;
  const contactId = req.query.contact_id;

  // Own-store academies: serve the inbox from the portal store, not GHL. SMS
  // (messaging_provider='twilio') and Email (email_provider='resend') each have
  // their own store; when both are on we MERGE them into one inbox. Dormant for
  // an academy on neither → falls through to the GHL read below unchanged.
  try {
    const [smsOn, emailOn] = await Promise.all([
      smsProvider(clientId).then((p) => p === "twilio").catch(() => false),
      emailProvider(clientId).then((p) => p === "resend").catch(() => false),
    ]);
    if (smsOn || emailOn) {
      // Single thread by contact: merge this contact's SMS + Email messages.
      if (contactId) {
        const parts = await Promise.all([
          smsOn ? readStoreThreadInbox(clientId, contactId).catch(() => ({ messages: [] })) : { messages: [] },
          emailOn ? readEmailStoreThreadInbox(clientId, contactId).catch(() => ({ messages: [] })) : { messages: [] },
        ]);
        const messages = [...(parts[0].messages || []), ...(parts[1].messages || [])].sort((a, b) => new Date(a.date || 0) - new Date(b.date || 0));
        const conversation_id = parts[0].conversation_id || parts[1].conversation_id || null;
        return res.status(200).json({ conversation_id, messages });
      }
      // Thread by id: try whichever store owns it (both are uuids).
      if (conversationId) {
        if (smsOn) { const t = await readStoreThreadById(conversationId).catch(() => null); if (t && t.messages && t.messages.length) return res.status(200).json(t); }
        if (emailOn) { const t = await readEmailStoreThreadById(conversationId).catch(() => null); if (t) return res.status(200).json(t); }
        return res.status(200).json({ conversation_id: conversationId, messages: [] });
      }
      // List: merge both stores' conversations, newest activity first, then
      // classify member/lead off-GHL so the Members/Leads filters + counts work.
      const lists = await Promise.all([
        smsOn ? listStoreThreads(clientId).catch(() => []) : [],
        emailOn ? listEmailStoreThreads(clientId).catch(() => []) : [],
      ]);
      const merged = [...lists[0], ...lists[1]].sort((a, b) => new Date(b.lastMessageDate || 0) - new Date(a.lastMessageDate || 0));
      const conversations = await classifyStoreConversations(clientId, merged);
      const counts = {
        all:     conversations.length,
        members: conversations.filter((c) => c.classification === "member").length,
        leads:   conversations.filter((c) => c.classification === "lead").length,
        unread:  conversations.reduce((s, c) => s + (c.unreadCount || 0), 0),
      };
      return res.status(200).json({ conversations, counts });
    }
  } catch (e) { console.error("inbox store-read:", e.message); /* fall through to GHL */ }

  // GHL returns `type` as a number for some channels — always coerce to a
  // string so the client can safely call .replace() on it.
  const mapMsg = (m) => ({
    id:         m.id,
    body:       m.body || m.message || "",
    type:       String(m.type ?? m.messageType ?? ""),
    direction:  m.direction || "",
    status:     m.status || "",
    date:       m.dateAdded || m.createdAt || m.timestamp || null,
    attachments: m.attachments || [],
    contactId:  m.contactId || null,
  });

  // ────────────────────────────────────────────────────────
  // Mode B: single thread (by conversation_id)
  // ────────────────────────────────────────────────────────
  if (conversationId) {
    try {
      const data = await ghl("GET", `/conversations/${encodeURIComponent(conversationId)}/messages?limit=100`, { token });
      const messages = (data.messages?.messages || data.messages || data.data || []).map(mapMsg);
      return res.status(200).json({ conversation_id: conversationId, messages });
    } catch (e) {
      return res.status(e.status || 502).json({ error: `GHL: ${e.message}`, detail: e.body || null });
    }
  }

  // ────────────────────────────────────────────────────────
  // Mode C: a contact's thread (by contact_id) — find their conversation,
  // then return its messages. Used by the Sales pipeline card drawer.
  // ────────────────────────────────────────────────────────
  if (contactId) {
    try {
      const params = new URLSearchParams({ locationId, contactId });
      const search = await ghl("GET", `/conversations/search?${params}`, { token });
      const convo = (search.conversations || search.data || [])[0];
      if (!convo) return res.status(200).json({ conversation_id: null, messages: [] });
      const data = await ghl("GET", `/conversations/${encodeURIComponent(convo.id)}/messages`, { token });
      const messages = (data.messages?.messages || data.messages || data.data || []).map(mapMsg);
      return res.status(200).json({ conversation_id: convo.id, messages });
    } catch (e) {
      return res.status(e.status || 502).json({ error: `GHL: ${e.message}`, detail: e.body || null });
    }
  }

  // ────────────────────────────────────────────────────────
  // Mode A: list conversations  (cached — see readInboxCache)
  // ────────────────────────────────────────────────────────
  // Per-user read state — applied on top of the (user-agnostic) cache so each
  // person sees their own unread, and a thread they've read drops off the top.
  const readsMap = await loadUserReads(clientId, ctx.user.id);
  const finishList = (payload, flags) => {
    const conversations = sortByUnreadThenDate(applyReads(payload.conversations || [], readsMap));
    const counts = { ...(payload.counts || {}), unread: conversations.reduce((s, c) => s + (c.unreadCount || 0), 0) };
    return res.status(200).json({ ...payload, conversations, counts, ...(flags || {}) });
  };

  const wantFresh = req.query.fresh === "1" || req.query.nocache === "1";
  const cached = await readInboxCache(clientId);
  if (!wantFresh && cached && cached.updated_at &&
      (Date.now() - new Date(cached.updated_at).getTime()) < INBOX_CACHE_TTL_MS) {
    return finishList(cached.payload, { cached: true });
  }

  let convos = [];
  try {
    const params = new URLSearchParams({ locationId, limit: "100" });
    const data = await ghl("GET", `/conversations/search?${params}`, { token });
    convos = data.conversations || data.data || [];
  } catch (e) {
    // GHL failed (usually 429). Serve the last good payload instead of breaking
    // the inbox; only error out if we have nothing cached at all.
    if (cached) return finishList(cached.payload, { stale: true });
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

  // Client (member) tag config from the training offer.
  //   client_tag (default "liveclient") → member. Everyone who isn't a member
  //   is a lead, so lead_tags[] no longer drives classification — it's kept in
  //   tagConfig for reference only.
  let leadTags = [];
  let clientTag = "liveclient";
  try {
    const offers = await sb(`offers?client_id=eq.${clientId}&type=eq.training&select=data&order=sort_order.asc&limit=1`);
    const d = offers?.[0]?.data || {};
    if (Array.isArray(d.lead_tags)) leadTags = d.lead_tags.filter(Boolean);
    else if (d.lead_tag)            leadTags = [d.lead_tag];   // legacy single value
    if (d.client_tag)               clientTag = d.client_tag;  // override the default
  } catch (_) {}
  const tagConfig = { lead_tags: leadTags, client_tag: clientTag };

  // Resolve which GHL contactIds carry each tag (member tag + each lead tag)
  // so we can classify conversations. One search per tag; degrades silently to
  // the members-table match if the GHL search endpoint rejects the query.
  const lc = (s) => String(s || "").toLowerCase();
  async function contactIdsWithTag(tag) {
    const ids = new Set();
    if (!tag) return ids;
    try {
      // Cap at 2 pages (200 contacts) to keep GHL rate-limit usage low.
      for (let page = 1; page <= 2; page++) {
        const data = await ghl("POST", `/contacts/search`, {
          token,
          body: { locationId, page, pageLimit: 100, filters: [{ field: "tags", operator: "contains", value: tag }] },
        });
        const list = data.contacts || data.data || [];
        for (const c of list) { const id = c.id || c.contactId; if (id) ids.add(id); }
        if (list.length < 100) break;
      }
    } catch (_) { /* search unsupported / failed — fall back to convo tags + members table */ }
    return ids;
  }
  // Only the member tag needs a GHL search — everyone who isn't a member is a
  // lead (see classification below), so the old per-lead-tag searches are gone.
  const memberTagSet = await contactIdsWithTag(clientTag);

  const annotated = convos.map(c => {
    const m =
      (c.contactId && memberByContactId.get(c.contactId)) ||
      (c.email     && memberByEmail.get((c.email || "").toLowerCase())) ||
      (c.phone     && memberByPhone.get(normPhone(c.phone))) ||
      null;
    // Tags carried directly on the conversation, if GHL returned them.
    const convoTags = Array.isArray(c.tags)
      ? c.tags.map(t => lc(typeof t === "string" ? t : (t.name || t.tag)))
      : [];
    const cid = c.contactId;
    // Member wins: members-table match OR the member tag (set or inline).
    // Everyone else who reaches out is a lead (funnel leads AND random inbound)
    // so nothing ever hides in "All" only.
    const isMember = !!m
      || (cid && memberTagSet.has(cid))
      || convoTags.includes(lc(clientTag));
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
      lastMessageStatus: String(c.lastMessageStatus || c.status || "").toLowerCase(),
      unreadCount:       c.unreadCount || 0,
      classification:    isMember ? "member" : "lead",
      member: m ? { id: m.id, athlete_name: m.athlete_name, status: m.status } : null,
      trainer: (c.contactId && trainerByContact.get(c.contactId)) || null,
      channel: String(c.lastMessageType || c.type || "").replace(/^TYPE_/, "").toLowerCase() || null,
    };
  });
  const trainers = [...new Set([...trainerByContact.values()])].sort((a, b) => a.localeCompare(b));

  // Cache the RAW (user-agnostic) payload with GHL's unreadCount; finishList
  // applies this user's read state + the unread-on-top sort for the response.
  const payload = {
    conversations: annotated,
    location_id: locationId,   // for the "Open in GHL" deep link
    trainers,
    tagConfig,
    counts: {
      all:     annotated.length,
      members: annotated.filter(c => c.classification === "member").length,
      leads:   annotated.filter(c => c.classification === "lead").length,
      unread:  annotated.reduce((sum, c) => sum + (c.unreadCount || 0), 0),
    },
  };
  writeInboxCache(clientId, payload);   // refresh the cache for the next load (fire-and-forget)
  return finishList(payload, {});
}

export default withSentryApiRoute(handler);
