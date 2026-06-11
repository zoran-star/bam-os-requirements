// Public endpoint — receives form submissions from client websites.
// Lead data lives in OUR database first: every submission writes a
// website_leads row, then syncs to the client's GHL (contact + inbox
// message) when configured. The row is stamped with the sync receipt
// (ghl_contact_id / ghl_synced_at / ghl_error) so failed syncs are
// visible and retryable, and migrating a client off GHL is just
// "stop syncing" — their lead history is already home.
//
// POST body: { client_id, form_type?, name, email, phone?, fields?, source_url? }
// fields is a free-form object for any extra form data (e.g. { message: "..." })
//
// Allowed origins come from clients.allowed_domains (text[] of bare domains,
// e.g. {"byanymeansbball.com","bam-gta.vercel.app"}) — onboarding a new
// client site is a DB row update, not a code change. GHL push activates
// automatically when the client has ghl_kpi_config.ghl_location set and
// that location is present in GHL_LOCATIONS_JSON.

import { withSentryApiRoute } from "../_sentry.js";

const SB_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;

const GHL_V2 = "https://services.leadconnectorhq.com";
const V2_VERSION = "2021-07-28";

const DEV_ORIGINS = new Set([
  "http://localhost:3000",
  "http://localhost:5173",
  "http://127.0.0.1:5500",
]);

// Module-level cache so warm serverless instances don't hit the DB on
// every preflight. 60s is fine — domain changes are rare.
let originsCache = { set: null, at: 0 };
const ORIGINS_TTL_MS = 60_000;

async function getAllowedOrigins() {
  if (originsCache.set && Date.now() - originsCache.at < ORIGINS_TTL_MS) {
    return originsCache.set;
  }
  const set = new Set(DEV_ORIGINS);
  const rows = await sbReq("clients?select=allowed_domains&allowed_domains=not.is.null");
  for (const row of rows || []) {
    for (const domain of row.allowed_domains || []) {
      set.add(`https://${domain}`);
      set.add(`https://www.${domain}`);
    }
  }
  originsCache = { set, at: Date.now() };
  return set;
}

async function setCors(req, res) {
  const origin = req.headers.origin || "";
  let allowed = false;
  try {
    allowed = (await getAllowedOrigins()).has(origin);
  } catch { /* DB hiccup — treat as not allowed; POST will 403 */ }
  if (allowed) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
  }
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  return allowed;
}

async function sbReq(path, init = {}) {
  const r = await fetch(`${SB_URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: SB_KEY,
      Authorization: `Bearer ${SB_KEY}`,
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
  });
  if (!r.ok) throw new Error(`Supabase ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const txt = await r.text();
  return txt ? JSON.parse(txt) : null;
}

function loadLocations() {
  try {
    return process.env.GHL_LOCATIONS_JSON ? JSON.parse(process.env.GHL_LOCATIONS_JSON) : [];
  } catch { return []; }
}

async function pushToGhl(locName, ghlLocationId, { name, email, phone, message, messageFieldId }) {
  const loc = loadLocations().find(l => l.name === locName);
  if (!loc) return null;

  const apiKey = loc.apiKeyV2 || loc.apiKey;
  if (!apiKey) return null;

  const [firstName, ...rest] = (name || "").trim().split(" ");
  const lastName = rest.join(" ") || undefined;

  const customFields = messageFieldId && message
    ? [{ id: messageFieldId, field_value: message }]
    : [];

  const payload = {
    locationId: ghlLocationId,
    firstName,
    ...(lastName ? { lastName } : {}),
    ...(email ? { email: email.toLowerCase() } : {}),
    ...(phone ? { phone } : {}),
    source: "website-form",
    tags: ["website-inquiry"],
    ...(customFields.length ? { customFields } : {}),
  };

  const headers = {
    Authorization: `Bearer ${apiKey}`,
    Version: V2_VERSION,
    "Content-Type": "application/json",
    Accept: "application/json",
  };

  // Upsert: GHL matches on email/phone and creates or updates in one call.
  // (Search-then-create raced with GHL's duplicate prevention and failed on
  // repeat submissions from the same email.)
  const upsertRes = await fetch(`${GHL_V2}/contacts/upsert`, {
    method: "POST", headers, body: JSON.stringify(payload),
  });
  if (!upsertRes.ok) throw new Error(`GHL ${upsertRes.status}: ${(await upsertRes.text()).slice(0, 120)}`);
  const upserted = await upsertRes.json();
  const contactId = (upserted.contact || upserted).id || null;

  // Post message as inbound conversation so it appears in GHL inbox + fires notifications.
  if (contactId && message) {
    try {
      const convoRes = await fetch(`${GHL_V2}/conversations/`, {
        method: "POST",
        headers,
        body: JSON.stringify({ locationId: ghlLocationId, contactId }),
      });
      const convoId = convoRes.ok ? ((await convoRes.json()).conversation?.id || null) : null;
      if (convoId) {
        await fetch(`${GHL_V2}/conversations/messages`, {
          method: "POST",
          headers,
          body: JSON.stringify({
            type: "Custom",
            message,
            conversationId: convoId,
            direction: "inbound",
          }),
        });
      }
    } catch { /* non-fatal — contact already saved */ }
  }

  return contactId;
}

async function handler(req, res) {
  if (!SB_URL || !SB_KEY) return res.status(500).json({ error: "Supabase not configured" });

  const allowed = await setCors(req, res);
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "POST required" });
  if (!allowed) return res.status(403).json({ error: "Forbidden" });

  const b = req.body || {};
  const { client_id, form_type = "contact", name, email, phone, fields = {}, source_url } = b;

  if (!client_id) return res.status(400).json({ error: "client_id required" });
  if (!name && !email) return res.status(400).json({ error: "name or email required" });
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: "invalid email" });
  }

  let client;
  try {
    const rows = await sbReq(`clients?id=eq.${client_id}&select=id,ghl_location_id,ghl_kpi_config&limit=1`);
    client = rows?.[0];
  } catch (e) { return res.status(500).json({ error: e.message }); }
  if (!client) return res.status(404).json({ error: "client not found" });

  // 1. Save — our database is the source of truth for every lead.
  let leadId;
  try {
    const rows = await sbReq("website_leads", {
      method: "POST",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify({
        client_id: client.id,
        form_type,
        name: name || null,
        email: email?.toLowerCase() || null,
        phone: phone || null,
        fields,
        source_url: source_url || null,
      }),
    });
    leadId = rows?.[0]?.id;
  } catch (e) {
    return res.status(500).json({ error: `submission failed: ${e.message}` });
  }

  // 2. Deliver — sync to the client's GHL when configured.
  const ghlLocName = client.ghl_kpi_config?.ghl_location;
  const messageFieldId = client.ghl_kpi_config?.message_field_id || null;
  const message = fields?.message || null;

  let ghlStatus = "not-configured";
  if (ghlLocName && client.ghl_location_id) {
    let receipt;
    try {
      const ghlContactId = await pushToGhl(ghlLocName, client.ghl_location_id, { name, email, phone, message, messageFieldId });
      if (ghlContactId) {
        ghlStatus = "synced";
        receipt = { ghl_contact_id: ghlContactId, ghl_synced_at: new Date().toISOString(), ghl_error: null };
      } else {
        ghlStatus = "failed";
        receipt = { ghl_error: "location not found in GHL_LOCATIONS_JSON or no API key" };
      }
    } catch (e) {
      console.error("GHL sync failed — lead is saved, stamping error:", e.message);
      ghlStatus = "failed";
      receipt = { ghl_error: e.message.slice(0, 500) };
    }

    // 3. Receipt — stamp the lead row; never fail the request over it.
    try {
      await sbReq(`website_leads?id=eq.${leadId}`, {
        method: "PATCH",
        body: JSON.stringify(receipt),
      });
    } catch (e) {
      console.error("Failed to stamp GHL receipt on lead", leadId, e.message);
    }
  }

  return res.status(200).json({ ok: true, id: leadId, ghl: ghlStatus });
}

export default withSentryApiRoute(handler);
