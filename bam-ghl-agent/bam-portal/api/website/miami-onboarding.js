// POST /api/website/miami-onboarding
// DETAIL Miami member onboarding form (post-enrollment).
//
// Receives: { client_id, contactId?,
//   parentFirst, parentLast, email, phone,   ← main GHL contact
//   athleteFirst, athleteLast, grade, dob, position, shirtSize, school,
//   ecName, ecPhone, ecRelationship,
//   goals, hearAbout,
//   signature_b64, legal_meta }
//
// Does:
//   1. CORS
//   2. Validate required fields
//   3. Save submission to website_leads table
//   4. Upsert GHL contact (parent as primary) + add note with all data
//   5. Enroll contact in GHL workflow bf84953a ("1. Onboarding Form Submitted")
//
// Returns: { ok: true, id: submissionId } or { ok: false, error: "..." }

import { withSentryApiRoute } from "../_sentry.js";

const SB_URL = (process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || "").trim();
const SB_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || "").trim();

const GHL_V2     = "https://services.leadconnectorhq.com";
const V2_VERSION = "2021-07-28";

const DETAIL_LOCATION_NAME = "DETAIL Miami";
// GHL automation "1. Onboarding Form Submitted" — verify full ID in GHL > Automations > URL
const ONBOARDING_WORKFLOW_ID = "bf84953a";

const ALLOWED_ORIGINS = new Set([
  "https://detail-mia.com",
  "https://www.detail-mia.com",
  "http://localhost:3000",
  "http://localhost:5173",
  "http://127.0.0.1:5500",
  "null", // local file:// opens with origin "null"
]);

/* ─── CORS ──────────────────────────────────────────────────── */
function setCors(req, res) {
  const origin = req.headers.origin || "";
  if (ALLOWED_ORIGINS.has(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
  } else {
    res.setHeader("Access-Control-Allow-Origin", "*");
  }
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

/* ─── SUPABASE ───────────────────────────────────────────────── */
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

/* ─── GHL LOCATION ───────────────────────────────────────────── */
function loadGhlLocation(name) {
  try {
    const locs = process.env.GHL_LOCATIONS_JSON ? JSON.parse(process.env.GHL_LOCATIONS_JSON) : [];
    return locs.find((l) => l.name === name) || null;
  } catch {
    return null;
  }
}

/* ─── GHL UPSERT CONTACT ─────────────────────────────────────── */
async function upsertContact(loc, body) {
  const { parentFirst, parentLast, email, phone, contactId } = body;
  const apiKey = loc.apiKeyV2 || loc.apiKey;
  if (!apiKey) throw new Error("GHL location has no API key");

  const headers = {
    Authorization:  `Bearer ${apiKey}`,
    Version:         V2_VERSION,
    "Content-Type": "application/json",
    Accept:         "application/json",
  };

  // If contactId was passed (from GHL automation link), skip upsert
  if (contactId) return { contactId, headers, locationId: loc.locationId };

  const r = await fetch(`${GHL_V2}/contacts/upsert`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      locationId: loc.locationId,
      firstName:  parentFirst || "",
      lastName:   parentLast  || "",
      email:      email ? email.toLowerCase() : undefined,
      phone:      phone || undefined,
      source:     "DETAIL Miami Onboarding",
      tags:       ["detail-miami", "onboarding-submitted"],
    }),
  });
  if (!r.ok) throw new Error(`GHL upsert ${r.status}: ${(await r.text()).slice(0, 120)}`);
  const data = await r.json();
  const resolvedId = (data.contact || data).id || null;
  return { contactId: resolvedId, headers, locationId: loc.locationId };
}

/* ─── GHL NOTE ───────────────────────────────────────────────── */
async function postNote(headers, ghlContactId, body) {
  const {
    parentFirst, parentLast,
    athleteFirst, athleteLast, grade, dob, position, shirtSize, school,
    ecName, ecPhone, ecRelationship,
    goals, hearAbout,
  } = body;

  const lines = [
    `DETAIL Miami Onboarding Submitted`,
    ``,
    `Parent / Guardian: ${parentFirst} ${parentLast}`,
    ``,
    `Athlete: ${athleteFirst} ${athleteLast}`,
    grade      ? `Grade: ${grade}`                       : null,
    dob        ? `DOB: ${dob}`                           : null,
    position   ? `Position: ${position}`                 : null,
    shirtSize  ? `Shirt size: ${shirtSize}`              : null,
    school     ? `School: ${school}`                     : null,
    ``,
    `Emergency contact`,
    ecName     ? `  Name: ${ecName}`                     : null,
    ecPhone    ? `  Phone: ${ecPhone}`                   : null,
    ecRelationship ? `  Relationship: ${ecRelationship}` : null,
    ``,
    goals      ? `Goals: ${goals}`                       : null,
    hearAbout  ? `Heard about us: ${hearAbout}`          : null,
  ].filter((l) => l !== null).join("\n");

  try {
    const r = await fetch(`${GHL_V2}/contacts/${ghlContactId}/notes`, {
      method:  "POST",
      headers,
      body:    JSON.stringify({ body: lines }),
    });
    if (!r.ok) console.error("GHL note failed:", r.status, (await r.text()).slice(0, 200));
  } catch (e) {
    console.error("GHL note post (non-fatal):", e.message);
  }
}

/* ─── GHL WORKFLOW ENROLL ────────────────────────────────────── */
async function enrollWorkflow(headers, ghlContactId, workflowId) {
  if (!ghlContactId || !workflowId) return;
  try {
    const r = await fetch(`${GHL_V2}/contacts/${ghlContactId}/workflow/${workflowId}`, {
      method:  "POST",
      headers,
      body:    JSON.stringify({ eventStartTime: new Date().toISOString().replace(/\.\d{3}Z$/, "+00:00") }),
    });
    if (!r.ok) console.error("GHL workflow enroll failed:", r.status, (await r.text()).slice(0, 150));
  } catch (e) {
    console.error("GHL workflow enroll (non-fatal):", e.message);
  }
}

/* ─── HANDLER ────────────────────────────────────────────────── */
async function handler(req, res) {
  setCors(req, res);
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST")   return res.status(405).json({ ok: false, error: "POST required" });

  const b = req.body || {};
  const {
    client_id,
    contactId,
    parentFirst, parentLast,
    email, phone,
    athleteFirst, athleteLast,
    grade, dob, position, shirtSize, school,
    ecName, ecPhone, ecRelationship,
    goals, hearAbout,
  } = b;

  if (!client_id)   return res.status(400).json({ ok: false, error: "client_id required" });
  if (!email)       return res.status(400).json({ ok: false, error: "email required" });
  if (!parentFirst || !parentLast) {
    return res.status(400).json({ ok: false, error: "parentFirst and parentLast required" });
  }
  if (!athleteFirst || !athleteLast) {
    return res.status(400).json({ ok: false, error: "athleteFirst and athleteLast required" });
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ ok: false, error: "invalid email" });
  }

  /* Save to Supabase (non-fatal if not configured) */
  let leadId = null;
  if (SB_URL && SB_KEY) {
    try {
      const rows = await sbReq("website_leads", {
        method:  "POST",
        headers: { Prefer: "return=representation" },
        body: JSON.stringify({
          client_id,
          form_type: "detail_onboarding",
          name:      `${parentFirst} ${parentLast}`.trim(),
          email:     email.toLowerCase(),
          phone:     phone || null,
          fields: {
            contactId,
            parentFirst, parentLast,
            athleteFirst, athleteLast,
            grade, dob, position, shirtSize, school,
            ecName, ecPhone, ecRelationship,
            goals, hearAbout,
          },
        }),
      });
      leadId = rows?.[0]?.id;
    } catch (e) {
      console.error("Supabase save failed (non-fatal):", e.message);
    }
  }

  /* GHL sync (non-fatal) */
  const loc = loadGhlLocation(DETAIL_LOCATION_NAME);
  if (loc) {
    try {
      const { contactId: resolvedId, headers } = await upsertContact(loc, b);
      if (resolvedId) {
        await postNote(headers, resolvedId, b);
        await enrollWorkflow(headers, resolvedId, ONBOARDING_WORKFLOW_ID);

        if (leadId && SB_URL && SB_KEY) {
          try {
            await sbReq(`website_leads?id=eq.${leadId}`, {
              method: "PATCH",
              body: JSON.stringify({
                ghl_contact_id: resolvedId,
                ghl_synced_at:  new Date().toISOString(),
                ghl_error:      null,
              }),
            });
          } catch (_) {}
        }
      }
    } catch (e) {
      console.error("GHL sync failed (lead saved):", e.message);
      if (leadId && SB_URL && SB_KEY) {
        try {
          await sbReq(`website_leads?id=eq.${leadId}`, {
            method: "PATCH",
            body: JSON.stringify({ ghl_error: e.message.slice(0, 500) }),
          });
        } catch (_) {}
      }
    }
  }

  return res.status(200).json({ ok: true, id: leadId });
}

export default withSentryApiRoute(handler);
