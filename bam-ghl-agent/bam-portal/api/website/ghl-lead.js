import { withSentryApiRoute } from "../_sentry.js";
import { getClientGhlToken } from "./availability.js";
// Website form -> GHL, for clients whose token lives on the clients row
// (OAuth, auto-refreshed via getClientGhlToken) rather than the agency key
// store. Upserts the contact, maps fields via the entry_point field_map, and
// enrols in the entry_point's workflow. CORS allowlist = clients.allowed_domains.
//
//   POST /api/website/ghl-lead
//   body: { client_id, form_type, name, email, phone?, fields?{} }
//     -> { ok, contactId, workflow }

export const maxDuration = 30;

const SB_URL = (process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || "").trim();
const SB_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || "").trim();
const GHL_V2 = "https://services.leadconnectorhq.com";
const V2 = "2021-07-28";
const DEV_ORIGINS = new Set(["http://localhost:3000", "http://localhost:5173"]);

async function sb(path, init = {}) {
  const r = await fetch(`${SB_URL}/rest/v1/${path}`, { ...init, headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, "Content-Type": "application/json", ...(init.headers || {}) } });
  if (!r.ok) throw new Error(`sb ${r.status}: ${await r.text()}`);
  const t = await r.text();
  return t ? JSON.parse(t) : null;
}

let originsCache = { set: null, at: 0 };
async function allowedOrigin(origin) {
  if (!origin) return false;
  if (DEV_ORIGINS.has(origin)) return true;
  if (!originsCache.set || Date.now() - originsCache.at > 60000) {
    const set = new Set();
    try {
      const rows = await sb(`clients?select=allowed_domains&allowed_domains=not.is.null`);
      for (const row of rows || []) for (const d of row.allowed_domains || []) {
        set.add(`https://${d}`); set.add(`https://www.${d}`);
      }
    } catch (_) {}
    originsCache = { set, at: Date.now() };
  }
  return originsCache.set.has(origin);
}

async function handler(req, res) {
  const origin = req.headers.origin || "";
  const ok = await allowedOrigin(origin);
  if (ok) { res.setHeader("Access-Control-Allow-Origin", origin); res.setHeader("Vary", "Origin"); }
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "POST required" });
  if (!ok) return res.status(403).json({ error: "Forbidden" });

  const b = (req.body && typeof req.body === "object") ? req.body : (() => { try { return JSON.parse(req.body || "{}"); } catch { return {}; } })();
  const clientId = b.client_id;
  const formType = (b.form_type || "contact").toString();
  const name = (b.name || "").toString().trim();
  const email = b.email ? String(b.email).toLowerCase() : null;
  const phone = b.phone ? String(b.phone) : null;
  const fields = (b.fields && typeof b.fields === "object") ? b.fields : {};
  if (!clientId || (!email && !phone)) return res.status(400).json({ error: "client_id and email/phone required" });

  try {
    const rows = await sb(`clients?id=eq.${encodeURIComponent(clientId)}&select=id,business_name,ghl_location_id,ghl_access_token,ghl_refresh_token,ghl_token_expires_at,ghl_kpi_config&limit=1`);
    const client = rows?.[0];
    if (!client || !client.ghl_location_id) return res.status(404).json({ error: "client not GHL-connected" });

    const eps = await sb(`entry_points?client_id=eq.${encodeURIComponent(clientId)}&type=eq.website-form&key=eq.${encodeURIComponent(formType)}&enabled=eq.true&select=field_map,ghl_workflow_id,tags&limit=1`);
    const ep = eps?.[0] || {};
    const fieldMap = ep.field_map || {};
    const workflowId = ep.ghl_workflow_id || null;

    const token = await getClientGhlToken(client);
    const H = { Authorization: `Bearer ${token}`, Version: V2, "Content-Type": "application/json", Accept: "application/json" };

    const [firstName, ...rest] = name.split(/\s+/).filter(Boolean);
    const customFields = [];
    for (const [key, id] of Object.entries(fieldMap)) {
      const v = fields[key];
      if (id && v != null && String(v).trim() !== "") customFields.push({ id, field_value: String(v) });
    }
    const tags = [...new Set(["website-inquiry", `${formType.replace(/-/g, " ")} form filled`, ...(ep.tags || [])])];

    const up = await fetch(`${GHL_V2}/contacts/upsert`, { method: "POST", headers: H, body: JSON.stringify({
      locationId: client.ghl_location_id,
      firstName: firstName || name || "Lead",
      ...(rest.length ? { lastName: rest.join(" ") } : {}),
      ...(email ? { email } : {}),
      ...(phone ? { phone } : {}),
      ...(customFields.length ? { customFields } : {}),
      source: "website-form", tags,
    }) });
    if (!up.ok) return res.status(502).json({ error: `ghl upsert ${up.status}: ${(await up.text()).slice(0, 150)}` });
    const contactId = ((await up.json()).contact || {}).id;
    if (!contactId) return res.status(502).json({ error: "no contactId" });

    let workflow = null;
    if (workflowId) {
      const wr = await fetch(`${GHL_V2}/contacts/${contactId}/workflow/${workflowId}`, { method: "POST", headers: H, body: JSON.stringify({}) });
      workflow = wr.ok ? workflowId : `error:${wr.status}`;
    }
    return res.status(200).json({ ok: true, contactId, workflow });
  } catch (e) {
    return res.status(500).json({ error: (e && e.message) || "error" });
  }
}

export default withSentryApiRoute(handler);
