// POST /api/website/ch3-lead
// Free trial lead capture for CH3 Training.
// Called by /public/ch3-funnel/ after the 2-step onboarding form.
//
// Body: { firstName, lastName, email, phone, grade, experienceLevel,
//         desiredStartDate?, proximity?, smsConsent, consentTimestamp }
//
// Does:
//   1. CORS
//   2. Validate required fields
//   3. Upsert GHL contact (CH3 location) + post note with qualifying info
//   4. Insert website_leads row
//
// Returns: { ok: true, group: 'youth'|'hs' } or { ok: false, error }

import { withSentryApiRoute } from "../_sentry.js";
import { getClientGhlToken } from "./availability.js";
import { upsertPortalContact } from "../_contacts.js";

const SB_URL  = (process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || "").trim();
const SB_KEY  = (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || "").trim();
const GHL_V2  = "https://services.leadconnectorhq.com";
const V2_VER  = "2021-07-28";
const CH3_LOC = "lUqgMMX0RRf1FSG7Odg9";
const CH3_CLIENT_UUID = "df59d13e-fefc-4acc-b4cc-5ab8d5edd732";

// Load the CH3 client row from Supabase so we can use getClientGhlToken,
// which auto-selects OAuth token → Private Integration key in that order.
async function getCh3Client() {
  if (!SB_URL || !SB_KEY) return { ghl_location_id: CH3_LOC };
  try {
    const r = await fetch(
      `${SB_URL}/rest/v1/clients?id=eq.${CH3_CLIENT_UUID}&select=id,ghl_location_id,ghl_kpi_config,ghl_access_token,ghl_refresh_token,ghl_token_expires_at&limit=1`,
      { headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` } }
    );
    if (r.ok) {
      const rows = await r.json();
      return rows && rows[0] ? rows[0] : { ghl_location_id: CH3_LOC };
    }
  } catch (_) {}
  return { ghl_location_id: CH3_LOC };
}

// Allow any bam-portal preview URL + production + local dev
const VERCEL_PREVIEW = /^https:\/\/bam-portal-[a-z0-9]+-zoran-stars-projects\.vercel\.app$/;

const ALLOWED = new Set([
  "https://chrishaynesbasketball.com",
  "https://www.chrishaynesbasketball.com",
  "https://ch3training.vercel.app",
  "https://bam-portal.vercel.app",
  "http://localhost:3000",
  "http://localhost:5173",
  "http://127.0.0.1:5500",
]);

function getGroup(grade) {
  if (!grade) return "hs";
  const g = grade.toLowerCase();
  if (g.includes("5th") || g.includes("6th") || g.includes("7th") || g.includes("8th")) return "youth";
  return "hs";
}

function setCors(req, res) {
  const origin = req.headers.origin || "";
  const ok = ALLOWED.has(origin) || VERCEL_PREVIEW.test(origin);
  res.setHeader("Access-Control-Allow-Origin", ok ? origin : "*");
  if (ok) res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

async function sbInsert(row) {
  if (!SB_URL || !SB_KEY) return null;
  const r = await fetch(`${SB_URL}/rest/v1/website_leads`, {
    method: "POST",
    headers: {
      apikey: SB_KEY,
      Authorization: `Bearer ${SB_KEY}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
    },
    body: JSON.stringify(row),
  });
  if (!r.ok) throw new Error(`Supabase insert ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const txt = await r.text();
  return txt ? JSON.parse(txt)[0] : null;
}

async function handler(req, res) {
  setCors(req, res);
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "Method not allowed" });

  const {
    firstName, lastName, email, phone, grade,
    experienceLevel, desiredStartDate, proximity,
    smsConsent, consentTimestamp,
  } = req.body || {};

  if (!firstName?.trim()) return res.status(400).json({ ok: false, error: "firstName is required" });
  if (!email?.trim())     return res.status(400).json({ ok: false, error: "email is required" });
  if (!grade)             return res.status(400).json({ ok: false, error: "grade is required" });

  const group = getGroup(grade);

  let contactId = null;

  // Use getClientGhlToken so we pick up the OAuth token when available
  // (same pattern as BAM GTA), falling back to the Private Integration key.
  let ghlToken = null;
  try {
    const ch3Client = await getCh3Client();
    ghlToken = await getClientGhlToken(ch3Client);
  } catch (e) {
    console.error("GHL token resolve failed (non-fatal):", e.message);
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
          locationId: CH3_LOC,
          firstName:  firstName.trim(),
          lastName:   lastName?.trim() || undefined,
          email:      email.toLowerCase().trim(),
          phone:      phone?.trim() || undefined,
          source:     "CH3 Free Trial Form",
          tags:       ["ch3-lead", "ch3-free-trial", "sms-opted-in"],
        }),
      });
      if (upsertRes.ok) {
        const data = await upsertRes.json();
        contactId = (data.contact || data).id || null;
        // Dual-write the portal-native contact (dormant store). Best-effort.
        if (contactId) {
          await upsertPortalContact(CH3_CLIENT_UUID, contactId, {
            first_name: firstName.trim(),
            last_name:  lastName?.trim() || null,
            name:       `${firstName.trim()} ${lastName?.trim() || ""}`.trim(),
            email:      email.toLowerCase().trim(),
            phone:      phone?.trim() || null,
            tags:       ["ch3-lead", "ch3-free-trial", "sms-opted-in"],
            source:     "ch3-free-trial",
          });
        }
      } else {
        console.error("GHL upsert failed:", upsertRes.status, (await upsertRes.text()).slice(0, 200));
      }
    } catch (e) {
      console.error("GHL upsert error (non-fatal):", e.message);
    }

    if (contactId) {
      const noteBody = [
        "CH3 Training — Free Trial Form Submitted",
        "",
        `Grade:            ${grade}`,
        `Experience Level: ${experienceLevel || "Not provided"}`,
        `Training Group:   ${group === "youth" ? "Youth (Grades 5–8)" : "HS / College (Grades 9–12+)"}`,
        `Desired Start:    ${desiredStartDate || "Not specified"}`,
        `Proximity:        ${proximity || "Not specified"}`,
        "",
        `SMS Consent:      ${smsConsent ? "Yes" : "No"}`,
        `Consent Time:     ${consentTimestamp || new Date().toISOString()}`,
      ].join("\n");

      try {
        await fetch(`${GHL_V2}/contacts/${contactId}/notes`, {
          method: "POST",
          headers: ghlHeaders,
          body: JSON.stringify({ body: noteBody }),
        });
      } catch (e) {
        console.error("GHL note failed (non-fatal):", e.message);
      }
    }
  }

  try {
    await sbInsert({
      client_id:      "ch3-training",
      form_type:      "ch3_free_trial",
      name:           `${firstName.trim()} ${lastName?.trim() || ""}`.trim(),
      email:          email.toLowerCase().trim(),
      phone:          phone?.trim() || null,
      fields: {
        grade,
        experienceLevel:  experienceLevel || null,
        desiredStartDate: desiredStartDate || null,
        proximity:        proximity || null,
        smsConsent:       !!smsConsent,
        consentTimestamp: consentTimestamp || null,
        group,
      },
      ghl_contact_id: contactId,
      ghl_synced_at:  contactId ? new Date().toISOString() : null,
    });
  } catch (e) {
    console.error("Supabase insert failed (non-fatal):", e.message);
  }

  return res.status(200).json({ ok: true, group, contactId });
}

export default withSentryApiRoute(handler);
