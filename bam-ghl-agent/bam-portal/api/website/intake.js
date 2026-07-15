import { withSentryApiRoute } from "../_sentry.js";
import { resolveOrMintPortalContact } from "../_contacts.js";
import { enrollContact } from "../automations.js";

// GENERIC post-payment INTAKE - the final step of the enroll funnel
// (accepted design 2026-07-15: enroll is ONE funnel, info → plan → pay →
// intake; the standalone intake link is drop-off recovery only). Replaces the
// per-client bespoke onboarding endpoints (miami-onboarding never existed;
// onboarding.js is ADAPT-specific).
//
//   POST /api/website/intake
//     body { client_id, email, phone?, name?, fields: { ...whatever the
//            offer's onboarding questions collect... } }
//     → { ok, contact_id }
//
// Does: resolve/mint the portal contact by email/phone → merge the intake
// answers into contacts.custom_fields.intake (+ tag 'intake-complete') →
// fire the onboarding welcome automation (dormant until the academy approved
// it - enrollContact fails closed). No custom_field_defs are created.
//
// CORS: same allow-list as leads.js - clients.allowed_domains.

const SB_URL = (process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || "").trim();
const SB_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || "").trim();
const enc = encodeURIComponent;

async function sb(path, init = {}) {
  const res = await fetch(`${SB_URL}/rest/v1/${path}`, {
    ...init,
    headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, "Content-Type": "application/json", ...(init.headers || {}) },
  });
  if (!res.ok) throw new Error(`Supabase ${res.status}: ${await res.text()}`);
  const txt = await res.text();
  return txt ? JSON.parse(txt) : null;
}

const DEV_ORIGINS = new Set(["http://localhost:3000", "http://localhost:5173", "http://127.0.0.1:5500"]);
async function setCors(req, res) {
  const origin = req.headers.origin || "";
  let allowed = DEV_ORIGINS.has(origin);
  if (!allowed && origin) {
    try {
      const rows = await sb("clients?select=allowed_domains&allowed_domains=not.is.null");
      for (const row of rows || []) for (const d of row.allowed_domains || []) {
        if (origin === `https://${d}` || origin === `https://www.${d}`) { allowed = true; break; }
      }
    } catch (_) {}
  }
  if (allowed) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  }
  return allowed;
}

async function handler(req, res) {
  const allowed = await setCors(req, res);
  if (req.method === "OPTIONS") return res.status(allowed ? 204 : 403).end();
  if (req.method !== "POST") return res.status(405).json({ error: "POST required" });
  if (!allowed && req.headers.origin) return res.status(403).json({ error: "origin not allowed" });

  try {
    const b = (req.body && typeof req.body === "object") ? req.body : {};
    const { client_id, email, phone, name, fields } = b;
    if (!client_id) return res.status(400).json({ error: "client_id required" });
    if (!email && !phone) return res.status(400).json({ error: "email or phone required" });
    if (!fields || typeof fields !== "object" || !Object.keys(fields).length) return res.status(400).json({ error: "fields required" });

    // 1. Resolve (or mint) the portal contact - same store every surface reads.
    const contactId = await resolveOrMintPortalContact(client_id, { email, phone, name, tags: ["intake-complete"] });
    if (!contactId) return res.status(500).json({ error: "could not resolve a contact" });

    // 2. Merge the intake answers onto the record (NO custom field defs).
    const rows = await sb(`contacts?client_id=eq.${enc(client_id)}&ghl_contact_id=eq.${enc(contactId)}&select=id,tags,custom_fields&limit=1`);
    const c = Array.isArray(rows) && rows[0];
    if (c) {
      const tags = Array.isArray(c.tags) ? c.tags.slice() : [];
      if (!tags.includes("intake-complete")) tags.push("intake-complete");
      await sb(`contacts?id=eq.${enc(c.id)}`, {
        method: "PATCH", headers: { Prefer: "return=minimal" },
        body: JSON.stringify({
          tags,
          custom_fields: { ...(c.custom_fields || {}), intake: { ...fields, submitted_at: new Date().toISOString() } },
          updated_at: new Date().toISOString(),
        }),
      });
    }

    // 3. Welcome drip (the preset's postConversion automation). Fails closed:
    // nothing sends unless the academy enabled + approved it.
    try { await enrollContact({ clientId: client_id, automationKey: "onboarding", contactId }); } catch (_) {}

    return res.status(200).json({ ok: true, contact_id: contactId });
  } catch (e) {
    return res.status(500).json({ error: e.message || String(e) });
  }
}

export default withSentryApiRoute(handler);
