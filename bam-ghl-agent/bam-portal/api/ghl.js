// Unified GHL Serverless Function — locations, contacts, conversations, pipelines
// Supports both V1 (rest.gohighlevel.com) and V2 (services.leadconnectorhq.com) APIs
// Routes via ?action=locations|contacts|conversations|pipelines|forms|webhook

const GHL_V1 = "https://rest.gohighlevel.com/v1";
const GHL_V2 = "https://services.leadconnectorhq.com";
const V2_VERSION = "2021-07-28";

// Supabase (service role) — only used by the stage-tracking cron.
const SB_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
async function sbReq(path, init = {}) {
  const r = await fetch(`${SB_URL}/rest/v1/${path}`, {
    ...init,
    headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, "Content-Type": "application/json", ...(init.headers || {}) },
  });
  if (!r.ok) throw new Error(`Supabase ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const txt = await r.text();
  return txt ? JSON.parse(txt) : null;
}

// ─── Response Cache (in-memory with TTL) ───
// Default 5 min. Some endpoints (locations) are essentially static — use the
// LONG TTL for those. Conversations/contacts stay short.
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes (default)
const CACHE_TTL_LONG_MS = 60 * 60 * 1000; // 60 minutes
const LONG_TTL_ACTIONS = new Set(["locations"]);
const _responseCache = new Map();

function cacheKey(action, location, params) {
  const sorted = Object.keys(params).sort().map(k => `${k}=${params[k]}`).join("&");
  return `${action}:${location}:${sorted}`;
}

function cacheGet(key) {
  const entry = _responseCache.get(key);
  if (!entry) return null;
  const age = Date.now() - entry.ts;
  const action = key.split(":")[0];
  const ttl = LONG_TTL_ACTIONS.has(action) ? CACHE_TTL_LONG_MS : CACHE_TTL_MS;
  return { ...entry, age, fresh: age < ttl };
}

function cacheSet(key, status, body) {
  _responseCache.set(key, { status, body, ts: Date.now() });
  // Evict old entries if cache grows too large (max 500 entries)
  if (_responseCache.size > 500) {
    const oldest = _responseCache.keys().next().value;
    _responseCache.delete(oldest);
  }
}

function isRateLimited(status, body) {
  if (status === 429) return true;
  if (typeof body === "string" && body.toLowerCase().includes("too many requests")) return true;
  if (typeof body === "object" && body?.error && typeof body.error === "string"
      && body.error.toLowerCase().includes("too many requests")) return true;
  return false;
}

function sendCached(res, cached, fromRateLimit = false) {
  const ageSeconds = Math.round(cached.age / 1000);
  res.setHeader("X-GHL-Cache", fromRateLimit ? "stale-rate-limited" : "hit");
  res.setHeader("X-GHL-Cache-Age", `${ageSeconds}s`);
  return res.status(cached.status).json(cached.body);
}

let _cache = null;
function loadLocations() {
  if (_cache) return _cache;
  try {
    if (process.env.GHL_LOCATIONS_JSON) {
      _cache = JSON.parse(process.env.GHL_LOCATIONS_JSON);
      return _cache;
    }
    return [];
  } catch { return []; }
}

function getLocation(name) {
  return loadLocations().find(l => l.name === name) || null;
}

// Get a version-specific view of a location
// If loc has both apiKey (V1) and apiKeyV2, we can pick the right one per action
function getLocForAction(loc, action) {
  // Actions that need V2 (conversations, contacts, messages)
  const v2Actions = ["conversations", "contacts", "contact", "messages", "forms", "calendars"];
  // Actions that need V1 (pipelines/opportunities when V1 key is available)
  const v1Actions = ["pipelines"];

  if (v1Actions.includes(action) && loc.apiKey?.startsWith("eyJ")) {
    // Use V1 for pipelines
    return { ...loc, _useV2: false };
  }
  if (v2Actions.includes(action) && loc.apiKeyV2) {
    // Use V2 key for conversations/contacts/messages
    return { ...loc, apiKey: loc.apiKeyV2, _useV2: true };
  }
  // Default: use whatever key is configured
  return { ...loc, _useV2: isV2(loc) };
}

function isV2(loc) {
  if (loc._useV2 !== undefined) return loc._useV2;
  // V1 exclusively uses JWT tokens (start with "eyJ"). Everything else is V2.
  if (loc?.version === 2) return true;
  if (loc?.version === 1) return false;
  if (!loc?.apiKey) return false;
  return !loc.apiKey.startsWith("eyJ");
}

function makeHeaders(loc) {
  const key = loc.apiKey;
  const headers = { Authorization: `Bearer ${key}` };
  if (isV2(loc)) {
    headers["Version"] = V2_VERSION;
    headers["Accept"] = "application/json";
  }
  return headers;
}

function getBaseUrl(loc) {
  return isV2(loc) ? GHL_V2 : GHL_V1;
}

// Extract locationId from JWT payload (V1 keys)
function getLocationIdSync(loc) {
  if (loc.locationId) return loc.locationId;
  if (!loc.apiKey?.startsWith("eyJ")) return null;
  try {
    const payload = JSON.parse(Buffer.from(loc.apiKey.split(".")[1], "base64").toString());
    return payload.location_id || null;
  } catch { return null; }
}

// V2 locationId cache (avoids re-fetching on every request in same cold start)
const _locationIdCache = {};

// For V2 tokens: discover locationId by probing a lightweight V2 endpoint
async function discoverV2LocationId(loc) {
  const cacheKey = loc.name || loc.apiKey;
  if (_locationIdCache[cacheKey]) return _locationIdCache[cacheKey];

  const headers = makeHeaders(loc);
  try {
    // Probe: fetch 1 contact — the response includes locationId in meta or contact data
    const res = await fetch(`${GHL_V2}/contacts/?limit=1`, { headers });
    if (res.ok) {
      const data = await res.json();
      // GHL V2 sometimes returns locationId in the contacts or meta
      const firstContact = (data.contacts || [])[0];
      if (firstContact?.locationId) {
        _locationIdCache[cacheKey] = firstContact.locationId;
        return firstContact.locationId;
      }
    }
    // Try users endpoint — sub-account tokens can list their own users
    const res2 = await fetch(`${GHL_V2}/users/`, { headers });
    if (res2.ok) {
      const data2 = await res2.json();
      const firstUser = (data2.users || [])[0];
      if (firstUser?.locationId) {
        _locationIdCache[cacheKey] = firstUser.locationId;
        return firstUser.locationId;
      }
      // Some responses have location at top level
      if (data2.locationId) {
        _locationIdCache[cacheKey] = data2.locationId;
        return data2.locationId;
      }
    }
  } catch (e) {
    console.error(`GHL V2 locationId discovery failed for ${loc.name}:`, e.message);
  }
  return null;
}

async function getLocationId(loc) {
  // Check config first (explicit locationId in JSON)
  if (loc.locationId) return loc.locationId;

  // V1: extract from JWT
  const syncId = getLocationIdSync(loc);
  if (syncId) return syncId;

  // V2: try auto-discovery
  if (isV2(loc)) {
    return await discoverV2LocationId(loc);
  }
  return null;
}

// Helper: build V2 URL with locationId param only if we have one
function v2Params(locationId, extra = {}) {
  const params = new URLSearchParams(extra);
  if (locationId) params.set("locationId", locationId);
  return params.toString();
}

function mapContact(c) {
  return {
    id: c.id,
    name: [c.firstName, c.lastName].filter(Boolean).join(" ") || c.email || "Unknown",
    firstName: c.firstName || "", lastName: c.lastName || "",
    email: c.email || "", phone: c.phone || "",
    tags: c.tags || [], source: c.source || "",
    dateAdded: c.dateAdded || "", lastActivity: c.lastActivity || "",
  };
}

function mapConvo(c) {
  return {
    id: c.id, contactId: c.contactId,
    contactName: c.fullName || c.contactName || "Unknown",
    lastMessageBody: c.lastMessageBody || "",
    lastMessageDate: c.lastMessageDate || c.dateUpdated || "",
    lastMessageType: c.lastMessageType || "",
    lastMessageDirection: c.lastMessageDirection || "",
    unreadCount: c.unreadCount || 0, type: c.type || "",
  };
}

// Funnel-event webhook ingest. GHL workflows POST here on form submit / inbound
// message / appointment booked; we classify and log to ghl_funnel_events. The
// recommended workflow payload is { event, locationId, contactId, email, phone,
// formId, refId } but we also best-effort parse GHL's native fields. Lead events
// only count for forms in the client's ghl_kpi_config.lead_form_ids.
async function ghlWebhook(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST required" });
  const secret = process.env.GHL_WEBHOOK_SECRET;
  if (secret && (req.query.key || "") !== secret) return res.status(401).json({ error: "unauthorized" });
  if (!SB_URL || !SB_KEY) return res.status(500).json({ error: "Supabase not configured" });

  const b = req.body || {};
  const locationId = b.locationId || b.location_id || b.location?.id || null;
  const contactId  = b.contactId  || b.contact_id  || b.contact?.id  || null;
  const email = (b.email || b.contact?.email || "").toLowerCase() || null;
  const phone = b.phone || b.contact?.phone || null;
  const formId = b.formId || b.form_id || b.form?.id || null;
  const apptId = b.appointmentId || b.appointment?.id || b.calendar?.appointmentId || null;
  const msgId  = b.messageId || b.message?.id || null;
  const direction = (b.direction || b.message?.direction || "").toLowerCase();
  const explicit  = (b.event || b.type || b.eventType || "").toLowerCase();
  const occurredAt = b.occurredAt || b.dateAdded || b.date || new Date().toISOString();

  // Match to a portal client by GHL location.
  let client = null;
  if (locationId) {
    try {
      const rows = await sbReq(`clients?ghl_location_id=eq.${encodeURIComponent(locationId)}&select=id,ghl_kpi_config&limit=1`);
      client = rows?.[0] || null;
    } catch { /* leave unmatched */ }
  }

  let eventType = null, ref = null;
  if (formId || explicit.includes("form")) {
    const leadForms = client?.ghl_kpi_config?.lead_form_ids || [];
    if (formId && leadForms.length && !leadForms.includes(formId)) return res.status(200).json({ ok: true, skipped: "form not in lead set" });
    if (formId && !leadForms.length) return res.status(200).json({ ok: true, skipped: "no lead forms configured" });
    eventType = "lead";
    ref = b.refId || b.submissionId || (formId ? `${formId}:${contactId || ""}:${occurredAt}` : null);
  } else if (apptId || explicit.includes("appointment") || explicit.includes("booking")) {
    eventType = "booking";
    ref = apptId || b.refId || null;
  } else if (explicit.includes("inbound") || direction === "inbound" || (explicit.includes("message") && direction === "inbound")) {
    eventType = "response";
    ref = msgId || b.refId || null;
  } else if (["lead", "response", "booking"].includes(explicit)) {
    eventType = explicit;
    ref = b.refId || null;
  }
  if (!eventType) return res.status(200).json({ ok: true, skipped: "unclassified" });

  const row = {
    client_id: client?.id || null, ghl_location: locationId, event_type: eventType,
    contact_id: contactId, contact_email: email, contact_phone: phone,
    ref, occurred_at: occurredAt, raw: b,
  };
  try {
    await sbReq("ghl_funnel_events", { method: "POST", headers: { Prefer: "return=minimal" }, body: JSON.stringify(row) });
  } catch (e) {
    // Most likely a duplicate (unique event_type+ref) on a webhook retry — ack so GHL stops retrying.
    return res.status(200).json({ ok: true, note: (e.message || "").slice(0, 120) });
  }
  return res.status(200).json({ ok: true, event: eventType });
}

// Minimal auth: verify the caller is a logged-in Supabase user (staff or client).
async function requireUser(req) {
  const token = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  if (!token || !SB_URL || !SB_KEY) return null;
  try {
    const r = await fetch(`${SB_URL}/auth/v1/user`, { headers: { apikey: SB_KEY, Authorization: `Bearer ${token}` } });
    if (!r.ok) return null;
    const u = await r.json();
    return u?.id ? u : null;
  } catch { return null; }
}

async function insertEvents(rows) {
  if (!rows.length) return 0;
  try {
    await sbReq("ghl_funnel_events?on_conflict=event_type,ref", {
      method: "POST",
      headers: { Prefer: "resolution=ignore-duplicates,return=minimal" },
      body: JSON.stringify(rows),
    });
  } catch { /* dupes / partial — non-fatal */ }
  return rows.length;
}

// Pull leads (form submissions) + bookings (calendar) + responses (conversations)
// for ONE client into ghl_funnel_events, then stamp clients.ghl_synced_at. Each
// source is best-effort (try/catch) so one failing doesn't block the others.
// Reads the GHL location + lead form ids from clients.ghl_kpi_config.
async function refreshFunnel(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST required" });
  const user = await requireUser(req);
  if (!user) return res.status(401).json({ error: "auth required" });
  if (!SB_URL || !SB_KEY) return res.status(500).json({ error: "Supabase not configured" });

  const clientId = req.query.client_id;
  if (!clientId) return res.status(400).json({ error: "client_id required" });

  let client;
  try {
    const rows = await sbReq(`clients?id=eq.${clientId}&select=id,ghl_kpi_config,stripe_connect_account_id&limit=1`);
    client = rows?.[0];
  } catch (e) { return res.status(500).json({ error: e.message }); }
  const cfg = client?.ghl_kpi_config || {};
  const locName = cfg.ghl_location;
  if (!locName) return res.status(200).json({ ok: true, skipped: "no ghl_location in config" });

  const rawLoc = getLocation(locName);
  if (!rawLoc) return res.status(200).json({ ok: true, skipped: `location "${locName}" not configured` });
  const loc = getLocForAction(rawLoc, "contacts"); // V2
  if (!isV2(loc)) return res.status(200).json({ ok: true, skipped: "v1 location" });
  const base = getBaseUrl(loc);
  const headers = makeHeaders(loc);
  const locationId = await getLocationId(loc);
  if (!locationId) return res.status(200).json({ ok: true, skipped: "no locationId" });

  const sinceMs = Date.now() - 95 * 86400000; // 95d pull covers selectable ranges up to 90d (each source capped at 100 rows/call)
  const result = { leads: 0, trials: 0, clients_new: 0, clients_existing: 0, errors: [] };

  // ── Leads: submissions of the configured lead forms ──
  const leadFormIds = Array.isArray(cfg.lead_form_ids) ? cfg.lead_form_ids : [];
  for (const formId of leadFormIds) {
    try {
      const url = `${base}/forms/submissions?` + new URLSearchParams({ locationId, formId, limit: "100" });
      const r = await fetch(url, { headers });
      if (!r.ok) { result.errors.push(`forms ${r.status}`); continue; }
      const j = await r.json();
      const subs = j.submissions || j.data || [];
      const rows = [];
      for (const s of subs) {
        const created = s.createdAt || s.dateAdded || s.date || null;
        if (created && new Date(created).getTime() < sinceMs) continue;
        rows.push({
          client_id: clientId, ghl_location: locationId, event_type: "lead",
          contact_id: s.contactId || s.contact?.id || null,
          contact_email: (s.email || s.contact?.email || "").toLowerCase() || null,
          ref: `sub:${s.id}`, occurred_at: created || new Date().toISOString(),
          raw: { formId, submissionId: s.id },
        });
      }
      result.leads += await insertEvents(rows);
    } catch (e) { result.errors.push(`forms:${(e.message || "").slice(0, 60)}`); }
  }

  // ── Trials: appointments in the selected trial calendar(s). Stored per
  // appointment; the read endpoint dedupes to one trial per person. ──
  const calIds = Array.isArray(cfg.booking_calendar_ids) ? cfg.booking_calendar_ids : [];
  for (const calId of calIds) {
    try {
      const params = { locationId, calendarId: calId, startTime: String(sinceMs), endTime: String(Date.now()) };
      const r = await fetch(`${base}/calendars/events?` + new URLSearchParams(params), { headers });
      if (!r.ok) { result.errors.push(`calendar ${r.status}`); continue; }
      const j = await r.json();
      const events = j.events || j.data || [];
      const rows = events.map(ev => ({
        client_id: clientId, ghl_location: locationId, event_type: "trial",
        contact_id: ev.contactId || null,
        ref: `appt:${ev.id}`, occurred_at: ev.startTime || ev.dateAdded || new Date().toISOString(),
        raw: { appointmentId: ev.id, calendarId: calId, status: ev.appointmentStatus || ev.status || null },
      }));
      result.trials += await insertEvents(rows);
    } catch (e) { result.errors.push(`calendar:${(e.message || "").slice(0, 60)}`); }
  }

  // ── New clients: purchases on the client's connected Stripe account.
  // 'client_new' if the buyer is NOT already a member of this academy (no member
  // row for that email starting before this purchase), else 'client_existing'
  // (already in the system). Counts new subscriptions + standalone one-time
  // charges (a charge with no invoice = a product purchase). ──
  const stripeAcct = client.stripe_connect_account_id;
  const stripeKey = process.env.STRIPE_CONNECT_SECRET_KEY || process.env.STRIPE_SECRET_KEY;
  if (stripeAcct && stripeKey) {
    const sinceSec = Math.floor(sinceMs / 1000);
    const sFetch = async (path) => {
      const r = await fetch(`https://api.stripe.com/v1${path}`, { headers: { Authorization: `Bearer ${stripeKey}`, "Stripe-Account": stripeAcct } });
      if (!r.ok) throw new Error(`stripe ${r.status}`);
      return r.json();
    };

    // Existing-member lookup: earliest membership start (seconds) per email for
    // THIS academy. A buyer is "existing" if a membership for their email began
    // before this purchase (the purchase's own member row starts ~now, so it
    // won't falsely flag a genuinely new client).
    const memberStart = {};
    try {
      const members = await sbReq(`members?client_id=eq.${clientId}&select=parent_email,stripe_joined_at,joined_date,created_at&limit=5000`);
      for (const m of (members || [])) {
        const email = (m.parent_email || "").toLowerCase();
        if (!email) continue;
        const t = [m.stripe_joined_at, m.joined_date, m.created_at].map(d => d ? new Date(d).getTime() : null).filter(Boolean);
        const earliest = t.length ? Math.min(...t) : 0; // 0 = exists but undated → treat as pre-existing
        memberStart[email] = email in memberStart ? Math.min(memberStart[email], earliest) : earliest;
      }
    } catch (e) { result.errors.push(`members:${(e.message || "").slice(0, 40)}`); }

    const EPS = 60 * 1000; // 60s tolerance so the purchase's own member row reads as new
    const classify = (email, purchaseSec) => {
      const e = (email || "").toLowerCase();
      if (!(e in memberStart)) return "client_new";
      const start = memberStart[e];
      if (start === 0) return "client_existing";          // member exists, undated → pre-existing
      return start < (purchaseSec * 1000 - EPS) ? "client_existing" : "client_new";
    };
    const pushClient = async (id, cust, occurredSec) => {
      const email = (cust && cust.email || "").toLowerCase() || null;
      const evType = classify(email, occurredSec || sinceSec);
      const n = await insertEvents([{
        client_id: clientId, ghl_location: locationId, event_type: evType,
        contact_email: email, ref: id,
        occurred_at: new Date((occurredSec || sinceSec) * 1000).toISOString(),
        raw: { stripe_account: stripeAcct },
      }]);
      if (evType === "client_new") result.clients_new += n; else result.clients_existing += n;
    };
    try {
      const subs = await sFetch(`/subscriptions?status=all&created[gte]=${sinceSec}&limit=100&expand[]=data.customer`);
      for (const s of (subs.data || [])) await pushClient(`sub:${s.id}`, s.customer, s.created);
    } catch (e) { result.errors.push(`stripe-subs:${(e.message || "").slice(0, 40)}`); }
    try {
      const charges = await sFetch(`/charges?created[gte]=${sinceSec}&limit=100&expand[]=data.customer`);
      for (const c of (charges.data || [])) {
        if (!c.paid || c.refunded || c.invoice) continue; // standalone product purchases only
        await pushClient(`ch:${c.id}`, c.customer, c.created);
      }
    } catch (e) { result.errors.push(`stripe-charges:${(e.message || "").slice(0, 40)}`); }
  } else {
    result.errors.push("no stripe_connect_account_id");
  }

  // Stamp last-synced.
  try {
    await sbReq(`clients?id=eq.${clientId}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ ghl_synced_at: new Date().toISOString() }) });
  } catch { /* non-fatal */ }

  return res.status(200).json({ ok: true, ...result });
}

export default async function handler(req, res) {
  const action = req.query.action || "locations";

  // POST actions — these run BEFORE the GET-only guard (they do their own method
  // check). Putting them after the guard 405'd every POST.
  if (action === "webhook") {
    return ghlWebhook(req, res);
  }
  if (action === "refresh-funnel") {
    return refreshFunnel(req, res);
  }

  // Everything below is GET.
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  // --- Locations (no auth needed, not cached) ---
  if (action === "locations") {
    return res.status(200).json({
      data: loadLocations().map(l => ({
        name: l.name,
        version: isV2(l) ? 2 : 1,
      })),
    });
  }

  // --- All other actions need a location ---
  const locationName = req.query.location;
  if (!locationName) return res.status(400).json({ error: "location param required" });
  const rawLoc = getLocation(locationName);
  if (!rawLoc) return res.status(404).json({ error: `Location "${locationName}" not found` });

  // Build cache key from action + location + relevant query params
  const { action: _a, location: _l, ...extraParams } = req.query;
  const ck = cacheKey(action, locationName, extraParams);

  // Check cache — return fresh hits immediately
  const cached = cacheGet(ck);
  if (cached && cached.fresh) {
    return sendCached(res, cached);
  }

  // Pick the right API key (V1 vs V2) based on the action
  const loc = getLocForAction(rawLoc, action);
  const base = getBaseUrl(loc);
  const headers = makeHeaders(loc);
  const v2 = isV2(loc);
  const locationId = await getLocationId(loc);

  try {
    // ─── Contacts ───
    if (action === "contacts") {
      const limit = req.query.limit || 20;
      const query = req.query.query || "";

      let url;
      if (v2) {
        const params = { limit };
        if (locationId) params.locationId = locationId;
        if (query) params.query = query;
        url = `${base}/contacts/?${new URLSearchParams(params)}`;
      } else {
        url = `${base}/contacts/?limit=${limit}`;
        if (query) url += `&query=${encodeURIComponent(query)}`;
      }

      let response = await fetch(url, { headers });

      // V2 fallback: if locationId missing/wrong, try discovery then retry
      if (v2 && !response.ok && !locationId) {
        const discovered = await discoverV2LocationId(loc);
        if (discovered) {
          const retryParams = { limit, locationId: discovered };
          if (query) retryParams.query = query;
          const retryUrl = `${base}/contacts/?${new URLSearchParams(retryParams)}`;
          response = await fetch(retryUrl, { headers });
        }
      }

      if (!response.ok) {
        const errText = await response.text();
        console.error(`GHL contacts error (${locationName}, v${v2 ? 2 : 1}):`, response.status, errText);
        // Rate limited — return cached data if available (even stale)
        if (isRateLimited(response.status, errText) && cached) {
          return sendCached(res, cached, true);
        }
        if (v2 && !locationId) {
          return res.status(response.status).json({
            error: errText,
            hint: `V2 location "${locationName}" needs a locationId. Add "locationId":"xxx" to this entry in GHL_LOCATIONS_JSON. Find it in GHL > Settings > Business Info (URL contains the ID).`,
          });
        }
        return res.status(response.status).json({ error: errText });
      }
      const data = await response.json();
      const contacts = (data.contacts || []).map(mapContact);
      const body = { data: contacts, total: data.meta?.total || contacts.length };
      cacheSet(ck, 200, body);
      res.setHeader("X-GHL-Cache", "miss");
      res.setHeader("X-GHL-Cache-Age", "0s");
      return res.status(200).json(body);
    }

    // ─── Conversations ───
    // ─── Forms (list a location's forms — powers the lead-form picker) ───
    // Handles BOTH V2 (services.leadconnectorhq.com) and V1 (rest.gohighlevel.com).
    // Always 200s with diagnostics (version/status/count/reason) so the picker can
    // explain an empty result instead of silently showing nothing.
    if (action === "forms") {
      let response, usedUrl;
      if (v2) {
        const params = { limit: "100" };
        if (locationId) params.locationId = locationId;
        usedUrl = `${base}/forms/?${new URLSearchParams(params)}`;
        response = await fetch(usedUrl, { headers });
        // V2 token without a known locationId → discover it, then retry.
        if (!response.ok && !locationId) {
          const discovered = await discoverV2LocationId(loc);
          if (discovered) {
            usedUrl = `${base}/forms/?${new URLSearchParams({ limit: "100", locationId: discovered })}`;
            response = await fetch(usedUrl, { headers });
          }
        }
      } else {
        // V1: GET https://rest.gohighlevel.com/v1/forms/
        usedUrl = `${base}/forms/?limit=100`;
        response = await fetch(usedUrl, { headers });
      }

      if (!response.ok) {
        const errText = await response.text();
        if (isRateLimited(response.status, errText) && cached) return sendCached(res, cached, true);
        return res.status(200).json({ data: [], count: 0, version: v2 ? 2 : 1, location: locationName, reason: "ghl_error", status: response.status, error: errText.slice(0, 160) });
      }
      const data = await response.json();
      const forms = (data.forms || data.data || []).map(f => ({ id: f.id, name: f.name || f.formName || "(unnamed form)" }));
      const body = { data: forms, count: forms.length, version: v2 ? 2 : 1, location: locationName };
      cacheSet(ck, 200, body);
      return res.status(200).json(body);
    }

    // ─── Calendars (list a location's calendars — powers the trial-calendar picker) ───
    if (action === "calendars") {
      let response, usedUrl;
      if (v2) {
        const params = {};
        if (locationId) params.locationId = locationId;
        usedUrl = `${base}/calendars/?${new URLSearchParams(params)}`;
        response = await fetch(usedUrl, { headers });
        if (!response.ok && !locationId) {
          const discovered = await discoverV2LocationId(loc);
          if (discovered) {
            usedUrl = `${base}/calendars/?${new URLSearchParams({ locationId: discovered })}`;
            response = await fetch(usedUrl, { headers });
          }
        }
      } else {
        usedUrl = `${base}/calendars/`;
        response = await fetch(usedUrl, { headers });
      }
      if (!response.ok) {
        const errText = await response.text();
        if (isRateLimited(response.status, errText) && cached) return sendCached(res, cached, true);
        return res.status(200).json({ data: [], count: 0, version: v2 ? 2 : 1, location: locationName, reason: "ghl_error", status: response.status, error: errText.slice(0, 160) });
      }
      const data = await response.json();
      const cals = (data.calendars || data.data || []).map(c => ({ id: c.id, name: c.name || c.calendarName || "(unnamed calendar)" }));
      const body = { data: cals, count: cals.length, version: v2 ? 2 : 1, location: locationName };
      cacheSet(ck, 200, body);
      return res.status(200).json(body);
    }

    if (action === "conversations") {
      const contactId = req.query.contactId;
      let url;
      if (v2) {
        const params = {};
        if (locationId) params.locationId = locationId;
        if (contactId) params.contactId = contactId;
        url = `${base}/conversations/search?${new URLSearchParams(params)}`;
      } else {
        url = contactId
          ? `${base}/conversations/search?contactId=${contactId}`
          : `${base}/conversations/`;
      }

      const response = await fetch(url, { headers });
      if (!response.ok) {
        const errText = await response.text();
        console.error(`GHL conversations error (${locationName}, v${v2 ? 2 : 1}):`, response.status, errText);
        if (isRateLimited(response.status, errText) && cached) {
          return sendCached(res, cached, true);
        }
        return res.status(response.status).json({ error: errText });
      }
      const data = await response.json();
      const body = { data: (data.conversations || []).map(mapConvo) };
      cacheSet(ck, 200, body);
      res.setHeader("X-GHL-Cache", "miss");
      res.setHeader("X-GHL-Cache-Age", "0s");
      return res.status(200).json(body);
    }

    // ─── Pipelines + Opportunities ───
    if (action === "pipelines") {
      let pipelines = [];
      let opportunities = [];

      if (v2) {
        // V2: GET /opportunities/pipelines
        const pipeParams = locationId ? `?locationId=${locationId}` : "";
        const pipelineRes = await fetch(`${base}/opportunities/pipelines${pipeParams}`, { headers });
        if (pipelineRes.ok) {
          const pData = await pipelineRes.json();
          pipelines = (pData.pipelines || []).map(p => ({
            id: p.id, name: p.name,
            stages: (p.stages || []).map(s => ({ id: s.id, name: s.name, position: s.position })),
          }));
        }

        // V2: GET /opportunities/search
        const pipelineId = req.query.pipelineId || (pipelines[0]?.id);
        if (pipelineId) {
          const stageMap = {};
          const selectedPipeline = pipelines.find(p => p.id === pipelineId);
          if (selectedPipeline) {
            selectedPipeline.stages.forEach(s => { stageMap[s.id] = s.name; });
          }

          const oppParams = { pipelineId, limit: 100 };
          if (locationId) oppParams.locationId = locationId;
          const oppRes = await fetch(
            `${base}/opportunities/search?${new URLSearchParams(oppParams)}`,
            { headers }
          );
          if (oppRes.ok) {
            const oppData = await oppRes.json();
            opportunities = (oppData.opportunities || []).map(o => ({
              id: o.id, name: o.name || o.contact?.name || o.contactName || "",
              contactName: o.contact?.name || o.contactName || "",
              contactEmail: o.contact?.email || "",
              contactPhone: o.contact?.phone || "",
              stageId: o.pipelineStageId || "",
              stageName: stageMap[o.pipelineStageId] || "",
              status: o.status || "",
              monetaryValue: o.monetaryValue || 0,
              source: o.source || "",
              assignedTo: o.assignedTo || "",
              lastActivity: o.lastActivity || "",
              createdAt: o.createdAt || "",
            }));
          }
        }
      } else {
        // V1: GET /pipelines/
        const pipelineRes = await fetch(`${base}/pipelines/`, { headers });
        if (!pipelineRes.ok) {
          const errText = await pipelineRes.text();
          if (isRateLimited(pipelineRes.status, errText) && cached) {
            return sendCached(res, cached, true);
          }
          return res.status(pipelineRes.status).json({ error: errText });
        }
        const pipelineData = await pipelineRes.json();
        pipelines = (pipelineData.pipelines || []).map(p => ({
          id: p.id, name: p.name,
          stages: (p.stages || []).map(s => ({ id: s.id, name: s.name, position: s.position })),
        }));

        const pipelineId = req.query.pipelineId || (pipelines[0]?.id);
        if (pipelineId) {
          const stageMap = {};
          const selectedPipeline = pipelines.find(p => p.id === pipelineId);
          if (selectedPipeline) {
            selectedPipeline.stages.forEach(s => { stageMap[s.id] = s.name; });
          }

          let allOpps = [];
          let startAfter = 0;
          for (let page = 0; page < 4; page++) {
            const url = `${base}/pipelines/${pipelineId}/opportunities?limit=50${startAfter ? `&startAfter=${startAfter}` : ""}`;
            const oppRes = await fetch(url, { headers });
            if (!oppRes.ok) break;
            const oppData = await oppRes.json();
            const batch = oppData.opportunities || [];
            allOpps = allOpps.concat(batch);
            if (batch.length < 50) break;
            startAfter = batch.length;
          }

          opportunities = allOpps.map(o => ({
            id: o.id, name: o.name || o.contact?.name || o.contactName || "",
            contactName: o.contact?.name || o.contactName || "",
            contactEmail: o.contact?.email || "",
            contactPhone: o.contact?.phone || "",
            stageId: o.pipelineStageId || "",
            stageName: stageMap[o.pipelineStageId] || "",
            status: o.status || "",
            monetaryValue: o.monetaryValue || 0,
            source: o.source || "",
            assignedTo: o.assignedTo || "",
            lastActivity: o.lastActivity || "",
            createdAt: o.createdAt || "",
          }));
        }
      }

      const body = { data: { pipelines, opportunities } };
      cacheSet(ck, 200, body);
      res.setHeader("X-GHL-Cache", "miss");
      res.setHeader("X-GHL-Cache-Age", "0s");
      return res.status(200).json(body);
    }

    // ─── Single Contact Detail ───
    if (action === "contact") {
      const contactId = req.query.contactId;
      if (!contactId) return res.status(400).json({ error: "contactId param required" });

      const url = v2
        ? `${base}/contacts/${contactId}`
        : `${base}/contacts/${contactId}`;
      const response = await fetch(url, { headers });
      if (!response.ok) {
        const errText = await response.text();
        if (isRateLimited(response.status, errText) && cached) {
          return sendCached(res, cached, true);
        }
        return res.status(response.status).json({ error: errText });
      }
      const data = await response.json();
      const c = data.contact || data;
      const body = {
        data: {
          id: c.id,
          name: [c.firstName, c.lastName].filter(Boolean).join(" ") || c.contactName || c.email || "Unknown",
          firstName: c.firstName || "",
          lastName: c.lastName || "",
          email: c.email || "",
          phone: c.phone || "",
          tags: c.tags || [],
          source: c.source || "",
          dateAdded: c.dateAdded || c.createdAt || "",
          lastActivity: c.lastActivity || "",
          address: c.address1 || c.address || "",
          city: c.city || "",
          state: c.state || "",
          country: c.country || "",
          website: c.website || "",
          companyName: c.companyName || "",
          timezone: c.timezone || "",
          dnd: c.dnd || false,
          type: c.type || "",
          customFields: c.customField || c.customFields || [],
        },
      };
      cacheSet(ck, 200, body);
      res.setHeader("X-GHL-Cache", "miss");
      res.setHeader("X-GHL-Cache-Age", "0s");
      return res.status(200).json(body);
    }

    // ─── Conversation Messages (thread) ───
    if (action === "messages") {
      const conversationId = req.query.conversationId;
      if (!conversationId) return res.status(400).json({ error: "conversationId param required" });

      const url = v2
        ? `${base}/conversations/${conversationId}/messages`
        : `${base}/conversations/${conversationId}/messages`;
      const response = await fetch(url, { headers });
      if (!response.ok) {
        const errText = await response.text();
        if (isRateLimited(response.status, errText) && cached) {
          return sendCached(res, cached, true);
        }
        return res.status(response.status).json({ error: errText });
      }
      const data = await response.json();
      const msgs = (data.messages || data.data || []).map(m => ({
        id: m.id,
        body: m.body || m.message || "",
        direction: m.direction || "",
        status: m.status || "",
        type: m.type || m.messageType || "",
        dateAdded: m.dateAdded || m.createdAt || "",
        contactId: m.contactId || "",
        conversationId: m.conversationId || conversationId,
        attachments: m.attachments || [],
        contentType: m.contentType || "",
      }));
      const body = { data: msgs };
      cacheSet(ck, 200, body);
      res.setHeader("X-GHL-Cache", "miss");
      res.setHeader("X-GHL-Cache-Age", "0s");
      return res.status(200).json(body);
    }

    return res.status(400).json({ error: "Invalid action. Use: locations, contacts, conversations, pipelines, forms, contact, messages" });
  } catch (err) {
    console.error(`GHL error (${locationName}):`, err.message);
    // On network errors, return cached data if available (even stale)
    if (cached) {
      return sendCached(res, cached, true);
    }
    return res.status(500).json({ error: err.message });
  }
}
