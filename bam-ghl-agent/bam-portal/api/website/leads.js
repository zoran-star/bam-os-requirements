// Public endpoint — receives form submissions from client websites.
// Saves to Supabase website_leads and (if configured) pushes to GHL as a contact.
//
// POST body: { client_id, form_type?, name, email, phone?, fields?, source_url? }
// fields is a free-form object for any extra form data (e.g. { message: "..." })
//
// GHL push activates automatically when the client has ghl_kpi_config.ghl_location
// set and that location is present in GHL_LOCATIONS_JSON.

import { withSentryApiRoute } from "../_sentry.js";

const SB_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;

const GHL_V2 = "https://services.leadconnectorhq.com";
const V2_VERSION = "2021-07-28";

const ALLOWED_ORIGINS = new Set([
  "https://byanymeansbball.com",
  "https://www.byanymeansbball.com",
  "https://by-any-means-lac.vercel.app",
  "http://localhost:3000",
  "http://localhost:5173",
  "http://127.0.0.1:5500",
]);

function setCors(req, res) {
  const origin = req.headers.origin || "";
  if (ALLOWED_ORIGINS.has(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
  }
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
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

async function pushToGhl(locName, ghlLocationId, { name, email, phone }) {
  const loc = loadLocations().find(l => l.name === locName);
  if (!loc) return null;

  const apiKey = loc.apiKeyV2 || loc.apiKey;
  if (!apiKey) return null;

  const [firstName, ...rest] = (name || "").trim().split(" ");
  const lastName = rest.join(" ") || undefined;

  const payload = {
    locationId: ghlLocationId,
    firstName,
    ...(lastName ? { lastName } : {}),
    ...(email ? { email: email.toLowerCase() } : {}),
    ...(phone ? { phone } : {}),
    source: "website-form",
  };

  const headers = {
    Authorization: `Bearer ${apiKey}`,
    Version: V2_VERSION,
    "Content-Type": "application/json",
    Accept: "application/json",
  };

  // Check for existing contact by email to avoid duplicates.
  if (email) {
    const searchRes = await fetch(
      `${GHL_V2}/contacts/?${new URLSearchParams({ locationId: ghlLocationId, email })}`,
      { headers }
    );
    if (searchRes.ok) {
      const existing = ((await searchRes.json()).contacts || [])[0];
      if (existing?.id) {
        const updateRes = await fetch(`${GHL_V2}/contacts/${existing.id}`, {
          method: "PUT", headers, body: JSON.stringify(payload),
        });
        if (updateRes.ok) return existing.id;
      }
    }
  }

  const createRes = await fetch(`${GHL_V2}/contacts/`, {
    method: "POST", headers, body: JSON.stringify(payload),
  });
  if (!createRes.ok) throw new Error(`GHL ${createRes.status}: ${(await createRes.text()).slice(0, 120)}`);
  const created = await createRes.json();
  return (created.contact || created).id || null;
}

async function handler(req, res) {
  setCors(req, res);
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "POST required" });

  const origin = req.headers.origin || "";
  if (!ALLOWED_ORIGINS.has(origin)) return res.status(403).json({ error: "Forbidden" });
  if (!SB_URL || !SB_KEY) return res.status(500).json({ error: "Supabase not configured" });

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
  } catch (e) { return res.status(500).json({ error: `save failed: ${e.message}` }); }

  // GHL push — non-blocking. Requires ghl_kpi_config.ghl_location to be set.
  let ghlContactId = null;
  const ghlLocName = client.ghl_kpi_config?.ghl_location;
  if (ghlLocName && client.ghl_location_id) {
    try {
      ghlContactId = await pushToGhl(ghlLocName, client.ghl_location_id, { name, email, phone });
      if (leadId && ghlContactId) {
        await sbReq(`website_leads?id=eq.${leadId}`, {
          method: "PATCH",
          headers: { Prefer: "return=minimal" },
          body: JSON.stringify({ ghl_contact_id: ghlContactId, ghl_synced_at: new Date().toISOString() }),
        });
      }
    } catch (e) {
      console.error("GHL push failed (non-fatal):", e.message);
    }
  }

  return res.status(200).json({ ok: true, id: leadId, ghl: !!ghlContactId });
}

export default withSentryApiRoute(handler);
