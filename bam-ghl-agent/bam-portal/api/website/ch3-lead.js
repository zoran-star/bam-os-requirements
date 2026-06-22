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

const SB_URL  = (process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || "").trim();
const SB_KEY  = (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || "").trim();
const GHL_V2  = "https://services.leadconnectorhq.com";
const GHL_V1  = "https://rest.gohighlevel.com";
const V2_VER  = "2021-07-28";
const CH3_LOC = "lUqgMMX0RRf1FSG7Odg9";

function getCh3Entry() {
  if (process.env.GHL_LOCATIONS_JSON) {
    try {
      const locs = JSON.parse(process.env.GHL_LOCATIONS_JSON);
      return locs.find(l => l.locationId === CH3_LOC || l.name === "CH3 Training") || null;
    } catch (_) {}
  }
  return null;
}
function getCh3Key() {
  const entry = getCh3Entry();
  if (entry && (entry.apiKeyV2 || entry.apiKey)) return entry.apiKeyV2 || entry.apiKey;
  return process.env.GHLKEY || "";
}
function getCh3KeyV1() {
  const entry = getCh3Entry();
  return (entry && entry.apiKey) || null;
}
const GHLKEY = getCh3Key();

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

  if (GHLKEY) {
    const ghlHeaders = {
      Authorization: `Bearer ${GHLKEY}`,
      Version: V2_VER,
      "Content-Type": "application/json",
      Accept: "application/json",
    };

    const contactPayload = {
      locationId: CH3_LOC,
      firstName:  firstName.trim(),
      lastName:   lastName?.trim() || undefined,
      email:      email.toLowerCase().trim(),
      phone:      phone?.trim() || undefined,
      source:     "CH3 Free Trial Form",
      tags:       ["ch3-lead", "ch3-free-trial", "sms-opted-in"],
    };

    // Try GHL V2 Private Integration upsert first.
    try {
      const upsertRes = await fetch(`${GHL_V2}/contacts/upsert`, {
        method: "POST",
        headers: ghlHeaders,
        body: JSON.stringify(contactPayload),
      });
      if (upsertRes.ok) {
        const data = await upsertRes.json();
        contactId = (data.contact || data).id || null;
      } else {
        const errText = (await upsertRes.text()).slice(0, 200);
        console.error("GHL V2 upsert failed:", upsertRes.status, errText);
      }
    } catch (e) {
      console.error("GHL V2 upsert error (non-fatal):", e.message);
    }

    // V2 failed (likely missing contacts scope on key) — fall back to GHL V1 location API.
    if (!contactId) {
      const v1Key = getCh3KeyV1();
      if (v1Key) {
        try {
          const v1Headers = { Authorization: `Bearer ${v1Key}`, "Content-Type": "application/json" };
          const v1Body = {
            locationId: CH3_LOC,
            firstName:  firstName.trim(),
            lastName:   lastName?.trim() || undefined,
            email:      email.toLowerCase().trim(),
            phone:      phone?.trim() || undefined,
            source:     "CH3 Free Trial Form",
            tags:       ["ch3-lead", "ch3-free-trial", "sms-opted-in"],
          };
          const v1Res = await fetch(`${GHL_V1}/v1/contacts/`, {
            method: "POST",
            headers: v1Headers,
            body: JSON.stringify(v1Body),
          });
          if (v1Res.ok) {
            const v1Data = await v1Res.json();
            contactId = v1Data.contact?.id || v1Data.id || null;
          } else {
            // V1 create failed — try lookup by email.
            try {
              const v1LookupRes = await fetch(
                `${GHL_V1}/v1/contacts/?locationId=${encodeURIComponent(CH3_LOC)}&query=${encodeURIComponent(email.toLowerCase().trim())}`,
                { headers: { Authorization: `Bearer ${v1Key}` } }
              );
              if (v1LookupRes.ok) {
                const v1Lookup = await v1LookupRes.json();
                const match = (v1Lookup.contacts || []).find(c => c.email === email.toLowerCase().trim());
                if (match) contactId = match.id;
              }
            } catch (_) {}
          }
        } catch (e) {
          console.error("GHL V1 upsert error (non-fatal):", e.message);
        }
      }
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
