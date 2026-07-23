import { withSentryApiRoute } from "../_sentry.js";
import { smsProvider } from "../messaging/provider.js";
import { readStoreThreadInbox, readStoreThreadById, listStoreThreads } from "../messaging/read-thread.js";
import { emailProvider } from "../messaging/email-provider.js";
import { readEmailStoreThreadInbox, readEmailStoreThreadById, listEmailStoreThreads } from "../messaging/email-read-thread.js";
import { hasActiveMailbox } from "../email/_mailbox.js";
import { metaDmConfig, listDmThreads, readDmThreadById, readDmThreadInbox } from "../meta/_dm.js";
import { pickGhlToken } from "./_core.js";
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

// Off-GHL classifier for the own-store inbox (twilio/resend academies).
// A conversation is a MEMBER if its contact matches a row in the portal
// `members` table (by portal contact id, phone, or email); everyone else who
// reaches out — funnel leads AND random inbound — is a LEAD, so nothing hides
// in "All" only. Also resolves a display NAME for threads whose store row only
// has a phone/email: contacts store first, members table second. Uses portal
// data exclusively; makes zero GHL calls.
const _nameless = (s) => {
  const v = String(s || "").trim();
  return !v || /^[\s()+\-.\d]+$/.test(v) || (v.includes("@") && !v.includes(" "));
};
async function classifyStoreConversations(clientId, conversations) {
  const rows = await sb(
    `members?client_id=eq.${clientId}` +
    `&select=id,athlete_name,parent_name,parent_email,parent_phone,ghl_contact_id,status`
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

  // Resolve real names from the portal contacts store for threads that only
  // carry a phone/email (sms_threads.contact_name is often empty).
  const needIds = [...new Set(conversations
    .filter((c) => _nameless(c.contactName) && c.contactId)
    .map((c) => c.contactId))];
  const nameByContactId = new Map();
  for (let i = 0; i < needIds.length; i += 100) {
    const chunk = needIds.slice(i, i + 100);
    const crows = await sb(
      `contacts?client_id=eq.${clientId}` +
      `&ghl_contact_id=in.(${chunk.map(encodeURIComponent).join(",")})` +
      `&select=ghl_contact_id,name,first_name,last_name`
    ).catch(() => []);
    for (const r of (Array.isArray(crows) ? crows : [])) {
      const nm = String(r.name || `${r.first_name || ""} ${r.last_name || ""}`).trim();
      if (r.ghl_contact_id && nm && !_nameless(nm)) nameByContactId.set(r.ghl_contact_id, nm);
    }
  }
  // Still nameless (a lead with no contacts-store name)? Pull the name from their
  // trial booking (parent first, else athlete) so an inbox row isn't just a phone.
  const stillNeed = needIds.filter((id) => !nameByContactId.has(id));
  for (let i = 0; i < stillNeed.length; i += 100) {
    const chunk = stillNeed.slice(i, i + 100);
    const brows = await sb(
      `trial_bookings?tenant_id=eq.${clientId}` +
      `&ghl_contact_id=in.(${chunk.map(encodeURIComponent).join(",")})` +
      `&select=ghl_contact_id,parent_name,athlete_name&order=created_at.desc`
    ).catch(() => []);
    for (const r of (Array.isArray(brows) ? brows : [])) {
      if (!r.ghl_contact_id || nameByContactId.has(r.ghl_contact_id)) continue;
      const nm = String(r.parent_name || r.athlete_name || "").trim();
      if (nm && !_nameless(nm)) nameByContactId.set(r.ghl_contact_id, nm);
    }
  }

  // A thread may have NO ghl_contact_id but still match a NAMED contact by phone or
  // email (common for Twilio threads - the thread row has a number but no id). Build
  // name-by-phone/email from the contacts store so those rows show a name, not a bare
  // number.
  const nameByPhone10 = new Map();
  const nameByEmailC = new Map();
  try {
    const named = await sb(`contacts?client_id=eq.${clientId}&select=name,first_name,last_name,phone,email&limit=8000`).catch(() => []);
    for (const r of (Array.isArray(named) ? named : [])) {
      const nm = String(r.name || `${r.first_name || ""} ${r.last_name || ""}`).trim();
      if (!nm || _nameless(nm)) continue;
      const p10 = normPhone(r.phone).slice(-10);
      if (p10.length === 10 && !nameByPhone10.has(p10)) nameByPhone10.set(p10, nm);
      const em = r.email ? String(r.email).toLowerCase() : "";
      if (em && !nameByEmailC.has(em)) nameByEmailC.set(em, nm);
    }
  } catch (_) {}

  // Manually spam-marked contacts (a global mute tagged reason='spam'): the inbox
  // hides them into its Spam group and the sales agent skips them.
  let spamSet = new Set();
  try {
    const srows = await sb(`agent_mutes?client_id=eq.${clientId}&reason=eq.spam&agent=is.null&select=ghl_contact_id`).catch(() => []);
    spamSet = new Set((Array.isArray(srows) ? srows : []).map((r) => r.ghl_contact_id).filter(Boolean));
  } catch (_) {}

  return conversations.map((c) => {
    const m =
      (c.contactId && byContactId.get(c.contactId)) ||
      (c.phone     && byPhone.get(normPhone(c.phone))) ||
      (c.email     && byEmail.get(String(c.email).toLowerCase())) ||
      null;
    let contactName = c.contactName;
    if (_nameless(contactName)) {
      const p10 = c.phone ? normPhone(c.phone).slice(-10) : "";
      const em = c.email ? String(c.email).toLowerCase() : "";
      contactName = (c.contactId && nameByContactId.get(c.contactId))
        || (p10.length === 10 && nameByPhone10.get(p10))
        || (em && nameByEmailC.get(em))
        || (m && (m.parent_name || m.athlete_name))
        || contactName;
    }
    return {
      ...c,
      contactName,
      classification: (c.contactId && spamSet.has(c.contactId)) ? "spam" : (m ? "member" : "lead"),
      member: m ? { id: m.id, athlete_name: m.athlete_name, status: m.status } : null,
    };
  });
}

// ── Social passthrough (store academies) ────────────────────────────────
// IG/FB/WhatsApp/Live_Chat/GMB DMs have no portal store yet — they still live
// ONLY in GHL. Without this, flipping an academy to the own-store inbox
// silently hides its social threads (an Instagram DM looks like silence).
// Read them straight from GHL and merge into the store inbox; replies already
// route per-channel through send-message.js. SMS/Email GHL conversations stay
// excluded — they froze at the flip and would duplicate the store threads.
// Uses ghl_inbox_cache (12s TTL) so the inbox's frequent count refresh doesn't
// hammer GHL; a 429 serves the last cached social rows. The direct Meta spine
// (dm_threads) replaces this later.
const SOCIAL_CHANNELS = new Set(["ig", "fb", "whatsapp", "live_chat", "gmb"]);
const channelOf = (c) => String(c.lastMessageType || c.type || "").replace(/^TYPE_/i, "").toLowerCase() || null;
async function listGhlSocialThreads(clientId, token, locationId) {
  const cached = await readInboxCache(clientId);
  if (cached && cached.updated_at &&
      (Date.now() - new Date(cached.updated_at).getTime()) < INBOX_CACHE_TTL_MS) {
    return (cached.payload && cached.payload.conversations) || [];
  }
  let rows;
  try {
    const data = await ghl("GET", `/conversations/search?${new URLSearchParams({ locationId, limit: "100" })}`, { token });
    rows = (data.conversations || data.data || [])
      .filter((c) => SOCIAL_CHANNELS.has(channelOf(c)))
      .map((c) => ({
        id:                   c.id,
        contactId:            c.contactId || null,
        contactName:          c.fullName || c.contactName || "Lead",
        email:                c.email || null,
        phone:                c.phone || null,
        lastMessageBody:      c.lastMessageBody || "",
        lastMessageDate:      c.lastMessageDate || c.dateUpdated || null,
        lastMessageType:      c.lastMessageType || "",
        lastMessageDirection: c.lastMessageDirection || "",
        unreadCount:          c.unreadCount || 0,
        channel:              channelOf(c),
      }));
  } catch (e) {
    if (cached) return (cached.payload && cached.payload.conversations) || [];  // stale beats missing
    throw e;
  }
  writeInboxCache(clientId, { conversations: rows });
  return rows;
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

  // Own-store academies: serve the inbox from the portal store, not GHL. SMS
  // (messaging_provider='twilio'), Email (email_provider='resend'), and IG/FB
  // DMs (client_meta_messaging_config.status='active' → dm_threads) each have
  // their own store; whatever is on gets MERGED into one inbox. Social threads
  // still passthrough from GHL (listGhlSocialThreads), minus IG/FB once the
  // Meta spine is active (see the dedupe below). Dormant for an academy on
  // none of the three → falls through to the GHL read below unchanged.
  try {
    const [smsOn, emailOn, metaCfg] = await Promise.all([
      smsProvider(clientId).then((p) => p === "twilio").catch(() => false),
      // Email store is on when the academy sends bulk via Resend OR has a connected
      // mailbox (Gmail) - both write to email_threads/email_messages, same read path.
      Promise.all([
        emailProvider(clientId).then((p) => p === "resend").catch(() => false),
        hasActiveMailbox(clientId).catch(() => false),
      ]).then(([r, mb]) => r || mb),
      metaDmConfig(clientId, { requireInboxLive: true }).catch(() => null),
    ]);
    const metaOn = !!metaCfg;
    if (smsOn || emailOn || metaOn) {
      // Single thread by contact: merge this contact's SMS + Email + DM messages.
      if (contactId) {
        const parts = await Promise.all([
          smsOn ? readStoreThreadInbox(clientId, contactId).catch(() => ({ messages: [] })) : { messages: [] },
          emailOn ? readEmailStoreThreadInbox(clientId, contactId).catch(() => ({ messages: [] })) : { messages: [] },
          metaOn ? readDmThreadInbox(clientId, contactId).catch(() => ({ messages: [] })) : { messages: [] },
        ]);
        const messages = [...(parts[0].messages || []), ...(parts[1].messages || []), ...(parts[2].messages || [])].sort((a, b) => new Date(a.date || 0) - new Date(b.date || 0));
        const conversation_id = parts[0].conversation_id || parts[1].conversation_id || parts[2].conversation_id || null;
        if (!messages.length) {
          // Nothing in the store — could be a social-only lead (IG/FB threads
          // have no store yet). Serve their GHL social thread if one exists;
          // any GHL failure falls back to the empty store result.
          try {
            const search = await ghl("GET", `/conversations/search?${new URLSearchParams({ locationId, contactId })}`, { token });
            const convo = (search.conversations || search.data || [])[0];
            if (convo && SOCIAL_CHANNELS.has(channelOf(convo))) {
              const data = await ghl("GET", `/conversations/${encodeURIComponent(convo.id)}/messages`, { token });
              const msgs = (data.messages?.messages || data.messages || data.data || []).map(mapMsg);
              if (msgs.length) return res.status(200).json({ conversation_id: convo.id, messages: msgs });
            }
          } catch (_) { /* fall back to the empty store thread */ }
        }
        return res.status(200).json({ conversation_id, messages });
      }
      // Thread by id: store thread ids are uuids; anything else is a GHL
      // conversation id (a social passthrough row) → fall through to the GHL
      // thread read below.
      if (conversationId) {
        const isStoreId = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(conversationId);
        if (isStoreId) {
          if (smsOn) { const t = await readStoreThreadById(conversationId).catch(() => null); if (t && t.messages && t.messages.length) return res.status(200).json(t); }
          if (metaOn) { const t = await readDmThreadById(conversationId).catch(() => null); if (t) return res.status(200).json(t); }
          if (emailOn) { const t = await readEmailStoreThreadById(conversationId).catch(() => null); if (t) return res.status(200).json(t); }
          return res.status(200).json({ conversation_id: conversationId, messages: [] });
        }
      }
      // List: merge both stores' conversations + the GHL social passthrough,
      // then classify member/lead off-GHL so the Members/Leads filters +
      // counts work. Per-user read receipts (the same ghl_conversation_reads
      // the mark-read action writes, keyed here by the store thread uuid or
      // the GHL conversation id for social rows) are applied so a thread you
      // opened STAYS read across reloads and devices; sort matches the GHL
      // path (unread first, then newest).
      if (!conversationId) {
        const [lists, readsMap] = await Promise.all([
          Promise.all([
            smsOn ? listStoreThreads(clientId).catch(() => []) : [],
            emailOn ? listEmailStoreThreads(clientId).catch(() => []) : [],
            listGhlSocialThreads(clientId, token, locationId).catch(() => []),
            metaOn ? listDmThreads(clientId).catch(() => []) : [],
          ]),
          loadUserReads(clientId, ctx.user.id),
        ]);
        // Meta-spine dedupe: once the academy's DMs come in directly
        // (dm_threads), drop IG/FB rows from the GHL passthrough - GHL still
        // receives the same DMs while its Meta integration stays connected,
        // and both showing would duplicate every thread.
        const META_CHANNELS = new Set(["ig", "fb", "instagram", "facebook"]);
        const social = metaOn ? lists[2].filter((c) => !META_CHANNELS.has(c.channel)) : lists[2];
        const merged = [...lists[0], ...lists[1], ...social, ...lists[3]];
        const classified = await classifyStoreConversations(clientId, merged);
        const conversations = sortByUnreadThenDate(applyReads(classified, readsMap));
        const counts = {
          all:     conversations.length,
          members: conversations.filter((c) => c.classification === "member").length,
          leads:   conversations.filter((c) => c.classification === "lead").length,
          unread:  conversations.reduce((s, c) => s + (c.unreadCount || 0), 0),
        };
        return res.status(200).json({ conversations, counts });
      }
      // conversationId is a GHL conversation id (a social passthrough row) —
      // fall through to the GHL thread read below.
    }
  } catch (e) { console.error("inbox store-read:", e.message); /* fall through to GHL */ }

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
