// Unified GHL Serverless Function — locations, contacts, conversations, pipelines
// Supports both V1 (rest.gohighlevel.com) and V2 (services.leadconnectorhq.com) APIs
// Routes via ?action=locations|contacts|conversations|pipelines

const GHL_V1 = "https://rest.gohighlevel.com/v1";
const GHL_V2 = "https://services.leadconnectorhq.com";
const V2_VERSION = "2021-07-28";

// ─── Response Cache (in-memory with TTL) ───
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const _responseCache = new Map();

function cacheKey(action, location, params) {
  const sorted = Object.keys(params).sort().map(k => `${k}=${params[k]}`).join("&");
  return `${action}:${location}:${sorted}`;
}

function cacheGet(key) {
  const entry = _responseCache.get(key);
  if (!entry) return null;
  const age = Date.now() - entry.ts;
  return { ...entry, age, fresh: age < CACHE_TTL_MS };
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
  const v2Actions = ["conversations", "contacts", "contact", "messages"];
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

export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  const action = req.query.action || "locations";

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

    return res.status(400).json({ error: "Invalid action. Use: locations, contacts, conversations, pipelines, contact, messages" });
  } catch (err) {
    console.error(`GHL error (${locationName}):`, err.message);
    // On network errors, return cached data if available (even stale)
    if (cached) {
      return sendCached(res, cached, true);
    }
    return res.status(500).json({ error: err.message });
  }
}
