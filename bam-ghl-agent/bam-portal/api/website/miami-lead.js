// POST /api/website/miami-lead
// Free trial lead capture for DETAIL Miami.
// Body: { firstName, lastName, email, phone, grade, smsConsent, consentTimestamp }
// Returns: { ok: true, group: 'elementary'|'ms-hs', contactId }

import { withSentryApiRoute } from "../_sentry.js";
import { getClientGhlToken } from "./availability.js";
import { createOpp, pipelineFlags } from "../agent/_store.js";

const SB_URL  = (process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || "").trim();
const SB_KEY  = (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || "").trim();
const GHL_V2  = "https://services.leadconnectorhq.com";
const V2_VER  = "2021-07-28";
const MIAMI_LOC         = "RBnlVgmXNMbFpgFGPGcv";
const MIAMI_CLIENT_UUID = "4708a68d-5365-48bf-a404-72a69fadd34d";

async function getMiamiClient() {
  if (!SB_URL || !SB_KEY) return { ghl_location_id: MIAMI_LOC };
  try {
    const r = await fetch(
      `${SB_URL}/rest/v1/clients?id=eq.${MIAMI_CLIENT_UUID}&select=id,ghl_location_id,ghl_kpi_config,ghl_access_token,ghl_refresh_token,ghl_token_expires_at&limit=1`,
      { headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` } }
    );
    if (r.ok) {
      const rows = await r.json();
      return rows?.[0] ?? { ghl_location_id: MIAMI_LOC };
    }
  } catch (_) {}
  return { ghl_location_id: MIAMI_LOC };
}

function getGroup(grade) {
  if (!grade) return "ms-hs";
  const g = grade.toLowerCase();
  if (g.includes("k") || g.includes("kinder") ||
      ["1st","2nd","3rd","4th","5th"].some(n => g.includes(n))) return "elementary";
  return "ms-hs";
}

const VERCEL_PREVIEW = /^https:\/\/bam-portal-[a-z0-9]+-zoran-stars-projects\.vercel\.app$/;
const ALLOWED = new Set([
  "https://detail-mia.com",
  "https://www.detail-mia.com",
  "https://bam-portal.vercel.app",
  "http://localhost:3000",
  "http://localhost:5173",
  "http://127.0.0.1:5500",
]);

function setCors(req, res) {
  const origin = req.headers.origin || "";
  const ok = ALLOWED.has(origin) || VERCEL_PREVIEW.test(origin);
  res.setHeader("Access-Control-Allow-Origin", ok ? origin : "*");
  if (ok) res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

async function handler(req, res) {
  setCors(req, res);
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "Method not allowed" });

  const { firstName, lastName, email, phone, grade, smsConsent, consentTimestamp } = req.body || {};
  if (!firstName?.trim()) return res.status(400).json({ ok: false, error: "firstName is required" });
  if (!email?.trim())     return res.status(400).json({ ok: false, error: "email is required" });
  if (!grade)             return res.status(400).json({ ok: false, error: "grade is required" });

  const group = getGroup(grade);
  let contactId = null;

  let ghlToken = null;
  try {
    const miamiClient = await getMiamiClient();
    ghlToken = await getClientGhlToken(miamiClient);
  } catch (e) {
    console.error("miami-lead: GHL token failed (non-fatal):", e.message);
  }

  if (ghlToken) {
    const ghlHeaders = {
      Authorization: `Bearer ${ghlToken}`,
      Version: V2_VER,
      "Content-Type": "application/json",
      Accept: "application/json",
    };
    try {
      const upsertRes = await fetch(`${GHL_V2}/contacts/upsert`, {
        method: "POST",
        headers: ghlHeaders,
        body: JSON.stringify({
          locationId: MIAMI_LOC,
          firstName:  firstName.trim(),
          lastName:   lastName?.trim() || undefined,
          email:      email.toLowerCase().trim(),
          phone:      phone?.trim() || undefined,
          source:     "DETAIL Miami Free Trial Form",
          tags:       ["miami-lead", "miami-free-trial", "sms-opted-in"],
        }),
      });
      if (upsertRes.ok) {
        const data = await upsertRes.json();
        contactId = (data.contact || data).id || null;
      } else {
        console.error("miami-lead: GHL upsert failed:", upsertRes.status, (await upsertRes.text()).slice(0, 200));
      }
    } catch (e) {
      console.error("miami-lead: GHL upsert error:", e.message);
    }

    if (contactId) {
      const note = [
        "DETAIL Miami — Free Trial Form Submitted",
        "",
        `Grade:        ${grade}`,
        `Training Group: ${group === "elementary" ? "Elementary (K–5th)" : "MS / HS (6th–12th+)"}`,
        "",
        `SMS Consent:  ${smsConsent ? "Yes" : "No"}`,
        `Consent Time: ${consentTimestamp || new Date().toISOString()}`,
      ].join("\n");
      try {
        await fetch(`${GHL_V2}/contacts/${contactId}/notes`, {
          method: "POST",
          headers: ghlHeaders,
          body: JSON.stringify({ body: note }),
        });
      } catch (_) {}

      // Portal-native pipeline: when Detail's pipeline_provider='portal', the
      // portal board reads the store - and Detail's GHL workflow (which creates
      // the GHL opp off the miami-lead tag) is invisible to it. Mint the store
      // card here so every new lead lands on the board (Ghosted; offer_id
      // inherits Training from the seeded stage row). Gated on provider so on
      // 'ghl' we change NOTHING (the workflow keeps sole ownership - calling
      // createOpp there would double-create on the GHL board). Best-effort.
      try {
        const { provider } = await pipelineFlags(MIAMI_CLIENT_UUID);
        if (provider === "portal") {
          await createOpp({
            clientId: MIAMI_CLIENT_UUID,
            contactId,
            role: "ghosted",
            name: `${firstName.trim()} ${lastName?.trim() || ""}`.trim(),
            contactPhone: phone?.trim() || null,
            source: "website",
            entryPoint: "miami-lead",
          });
        }
      } catch (e) {
        console.error("miami-lead: portal opp create failed (non-fatal):", e.message);
      }
    }
  }

  if (SB_URL && SB_KEY) {
    try {
      await fetch(`${SB_URL}/rest/v1/website_leads`, {
        method: "POST",
        headers: {
          apikey: SB_KEY,
          Authorization: `Bearer ${SB_KEY}`,
          "Content-Type": "application/json",
          Prefer: "return=minimal",
        },
        body: JSON.stringify({
          client_id:      "detail-miami",
          form_type:      "miami_free_trial",
          name:           `${firstName.trim()} ${lastName?.trim() || ""}`.trim(),
          email:          email.toLowerCase().trim(),
          phone:          phone?.trim() || null,
          fields:         { grade, group, smsConsent: !!smsConsent, consentTimestamp: consentTimestamp || null },
          ghl_contact_id: contactId,
          ghl_synced_at:  contactId ? new Date().toISOString() : null,
        }),
      });
    } catch (e) {
      console.error("miami-lead: Supabase insert failed (non-fatal):", e.message);
    }
  }

  return res.status(200).json({ ok: true, group, contactId });
}

export default withSentryApiRoute(handler);
