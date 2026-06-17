// POST /api/website/onboarding
// Handles ADAPT Global AAU onboarding submissions from adapt-funnel-waiver.html.
//
// Receives: { client_id, form_type, parent_name, parent_email, parent_phone,
//             athlete_first, athlete_last, athlete_country, athlete_dob,
//             sms_consent, passport_front_b64, passport_back_b64, athlete_photo_b64,
//             signature_b64, agreed, legal_meta: { ip, timestamp, timezone, user_agent, geo } }
//
// Does:
//   1. CORS
//   2. Validate required fields
//   3. Upload files to Supabase storage (member-files bucket)
//   4. Upsert contact to GHL (BAM Basketball location)
//   5. Create GHL note + conversation with onboarding summary
//   6. Save submission record to website_leads table
//
// Returns: { ok: true, id: submissionId } or { ok: false, error: "..." }

import { withSentryApiRoute } from "../_sentry.js";

// Vercel body size override — base64 images are large
export const config = {
  api: {
    bodyParser: {
      sizeLimit: '10mb',
    },
  },
};

const SB_URL = (process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || "").trim();
const SB_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || "").trim();

const GHL_V2      = "https://services.leadconnectorhq.com";
const V2_VERSION  = "2021-07-28";
const GHL_LOC_NAME = "By Any Means Basketball";

const ALLOWED_ORIGINS = new Set([
  "https://byanymeansbball.com",
  "https://www.byanymeansbball.com",
  "http://localhost:3000",
  "http://localhost:5173",
  "http://127.0.0.1:5500",
]);

/* ============================================
   CORS
   ============================================ */
function setCors(req, res) {
  const origin = req.headers.origin || "";
  if (ALLOWED_ORIGINS.has(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
  } else {
    // Public upload page — allow all origins so athletes on any domain can submit
    res.setHeader("Access-Control-Allow-Origin", "*");
  }
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

/* ============================================
   SUPABASE HELPER
   ============================================ */
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

/* ============================================
   GHL LOCATION LOOKUP
   ============================================ */
function loadGhlLocation(name) {
  try {
    const locs = process.env.GHL_LOCATIONS_JSON ? JSON.parse(process.env.GHL_LOCATIONS_JSON) : [];
    return locs.find(l => l.name === name) || null;
  } catch {
    return null;
  }
}

/* ============================================
   STORAGE UPLOAD
   ============================================ */
async function uploadFile(bucket, path, base64DataUrl, contentType) {
  if (!base64DataUrl) return null;
  const comma = base64DataUrl.indexOf(',');
  const b64 = comma >= 0 ? base64DataUrl.slice(comma + 1) : base64DataUrl;
  if (!b64) return null;

  // atob is available in Node 18+ (Vercel runtime)
  const binary = atob(b64);
  const bytes  = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);

  const uploadUrl = `${SB_URL}/storage/v1/object/${bucket}/${path}`;
  const r = await fetch(uploadUrl, {
    method: "POST",
    headers: {
      apikey:          SB_KEY,
      Authorization:  `Bearer ${SB_KEY}`,
      "Content-Type": contentType || "image/jpeg",
      "x-upsert":     "true",
    },
    body: bytes,
  });
  if (!r.ok) {
    const err = await r.text();
    throw new Error(`Storage upload failed (${path}): ${err.slice(0, 200)}`);
  }
  return `${SB_URL}/storage/v1/object/public/${bucket}/${path}`;
}

/* ============================================
   GHL CONTACT UPSERT
   ============================================ */
async function upsertGhlContact(loc, body) {
  const { parent_email, parent_phone, parent_name, athlete_first, athlete_last, athlete_dob } = body;

  const apiKey = loc.apiKeyV2 || loc.apiKey;
  if (!apiKey) throw new Error("GHL location has no API key");

  const ghlLocationId = loc.locationId;
  const headers = {
    Authorization:  `Bearer ${apiKey}`,
    Version:         V2_VERSION,
    "Content-Type": "application/json",
    Accept:         "application/json",
  };

  const contactPayload = {
    locationId: ghlLocationId,
    firstName:  athlete_first || "",
    lastName:   athlete_last  || "",
    email:      parent_email  ? parent_email.toLowerCase() : undefined,
    phone:      parent_phone  || undefined,
    source:     "ADAPT Onboarding",
    tags:       ["adapt-onboarding", "aau-experience"],
    customFields: [
      // contact.athlete_full_name
      { id: "TzTpy1o8xh1DLd1iqaoY", field_value: `${athlete_first || ""} ${athlete_last || ""}`.trim() },
      // contact.birth_date
      { id: "Ly08zDPgvmgxPeAWrjnD", field_value: athlete_dob || "" },
      // contact.parent_email
      { id: "w69JMWzRtsQxqmAmTS6D", field_value: parent_email || "" },
    ].filter(f => f.field_value),
  };

  const upsertRes = await fetch(`${GHL_V2}/contacts/upsert`, {
    method:  "POST",
    headers,
    body:    JSON.stringify(contactPayload),
  });
  if (!upsertRes.ok) {
    throw new Error(`GHL upsert ${upsertRes.status}: ${(await upsertRes.text()).slice(0, 120)}`);
  }
  const upserted  = await upsertRes.json();
  const contactId = (upserted.contact || upserted).id || null;
  return { contactId, headers, ghlLocationId };
}

/* ============================================
   GHL NOTE + CONVERSATION
   ============================================ */
async function postGhlSummary(headers, ghlLocationId, contactId, body, urls) {
  const {
    athlete_first, athlete_last, athlete_dob, athlete_country,
    parent_name, parent_email, parent_phone, legal_meta,
  } = body;
  const { passportFrontUrl, passportBackUrl, athletePhotoUrl, signatureUrl } = urls;

  const noteBody = [
    `ADAPT Global AAU Onboarding Submitted`,
    ``,
    `Athlete:  ${athlete_first} ${athlete_last}`,
    `DOB:      ${athlete_dob}`,
    `Country:  ${athlete_country}`,
    `Guardian: ${parent_name}`,
    `Email:    ${parent_email}`,
    `Phone:    ${parent_phone}`,
    ``,
    `Signed:   ${legal_meta?.timestamp}`,
    `IP:       ${legal_meta?.ip}`,
    `Timezone: ${legal_meta?.timezone}`,
    ``,
    `Passport (front): ${passportFrontUrl || 'not uploaded'}`,
    `Passport (back):  ${passportBackUrl  || 'not uploaded'}`,
    `Athlete photo:    ${athletePhotoUrl  || 'not uploaded'}`,
    `Signature:        ${signatureUrl     || 'not uploaded'}`,
  ].join('\n');

  // Note on contact (always works, holds full text)
  try {
    const noteRes = await fetch(`${GHL_V2}/contacts/${contactId}/notes`, {
      method:  "POST",
      headers,
      body:    JSON.stringify({ body: noteBody }),
    });
    if (!noteRes.ok) {
      console.error("GHL note failed:", noteRes.status, (await noteRes.text()).slice(0, 200));
    }
  } catch (e) {
    console.error("GHL note post failed (non-fatal):", e.message);
  }

  // Create conversation to surface the contact in the team inbox
  try {
    await fetch(`${GHL_V2}/conversations/`, {
      method:  "POST",
      headers,
      body:    JSON.stringify({ locationId: ghlLocationId, contactId }),
    });
  } catch (e) {
    console.error("GHL conversation create failed (non-fatal):", e.message);
  }
}

/* ============================================
   WORKFLOW ENROLLMENT
   ============================================ */
const ONBOARDING_WORKFLOWS = {
  adapt_onboarding: "e2bf555a-8c10-4f1f-b87b-edc8cbb8e408",
  summer_academy:   "eea7c2ba-56bf-4b86-89d3-ae653abbd314",
};

async function enrollInWorkflow(apiKey, contactId, workflowId) {
  if (!contactId || !workflowId || !apiKey) return;
  try {
    const r = await fetch(`${GHL_V2}/contacts/${contactId}/workflow/${workflowId}`, {
      method: "POST",
      headers: {
        Authorization:  `Bearer ${apiKey}`,
        Version:        V2_VERSION,
        "Content-Type": "application/json",
        Accept:         "application/json",
      },
      body: JSON.stringify({ eventStartTime: new Date().toISOString().replace(/\.\d{3}Z$/, "+00:00") }),
    });
    if (!r.ok) console.error("GHL workflow enroll failed:", r.status, (await r.text()).slice(0, 150));
  } catch (e) {
    console.error("GHL workflow enroll failed (non-fatal):", e.message);
  }
}

/* ============================================
   MAIN HANDLER
   ============================================ */
async function handler(req, res) {
  if (!SB_URL || !SB_KEY) {
    return res.status(500).json({ ok: false, error: "Supabase not configured" });
  }

  setCors(req, res);

  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "POST required" });

  const b = req.body || {};
  const {
    client_id,
    form_type    = "adapt_onboarding",
    parent_name,
    parent_email,
    parent_phone,
    athlete_first,
    athlete_last,
    athlete_country,
    athlete_dob,
    sms_consent,
    passport_front_b64,
    passport_back_b64,
    athlete_photo_b64,
    signature_b64,
    agreed,
    legal_meta   = {},
  } = b;

  /* ------------------------------------------
     Validate required fields
  ------------------------------------------ */
  if (!client_id)    return res.status(400).json({ ok: false, error: "client_id required" });
  if (!parent_email) return res.status(400).json({ ok: false, error: "parent_email required" });
  if (!athlete_first || !athlete_last) {
    return res.status(400).json({ ok: false, error: "athlete_first and athlete_last required" });
  }
  if (!agreed || !signature_b64) {
    return res.status(400).json({ ok: false, error: "signature and agreement required" });
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(parent_email)) {
    return res.status(400).json({ ok: false, error: "invalid email" });
  }

  /* ------------------------------------------
     Upload files to Supabase storage
     Bucket: member-files (must exist + be public)
     Path:   adapt/{athlete_last}_{athlete_first}_{timestamp}/...
  ------------------------------------------ */
  const slug = `${(athlete_last || '').toLowerCase()}_${(athlete_first || '').toLowerCase()}_${Date.now()}`;
  const fileBase = `adapt/${slug}`;

  let passportFrontUrl = null;
  let passportBackUrl  = null;
  let athletePhotoUrl  = null;
  let signatureUrl     = null;

  try {
    [passportFrontUrl, passportBackUrl, athletePhotoUrl, signatureUrl] = await Promise.all([
      passport_front_b64
        ? uploadFile("member-files", `${fileBase}/passport_front.jpg`, passport_front_b64, "image/jpeg")
        : Promise.resolve(null),
      passport_back_b64
        ? uploadFile("member-files", `${fileBase}/passport_back.jpg`, passport_back_b64, "image/jpeg")
        : Promise.resolve(null),
      athlete_photo_b64
        ? uploadFile("member-files", `${fileBase}/athlete_photo.jpg`, athlete_photo_b64, "image/jpeg")
        : Promise.resolve(null),
      signature_b64
        ? uploadFile("member-files", `${fileBase}/signature.png`, signature_b64, "image/png")
        : Promise.resolve(null),
    ]);
  } catch (e) {
    console.error("File upload failed:", e.message);
    return res.status(500).json({ ok: false, error: `File upload failed: ${e.message}` });
  }

  /* ------------------------------------------
     Save to website_leads (source of truth)
  ------------------------------------------ */
  let leadId;
  try {
    const rows = await sbReq("website_leads", {
      method:  "POST",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify({
        client_id,
        form_type,
        name:       `${athlete_first} ${athlete_last}`.trim(),
        email:       parent_email.toLowerCase(),
        phone:       parent_phone || null,
        fields: {
          parent_name,
          athlete_country,
          athlete_dob,
          sms_consent: sms_consent || false,
          passport_front_url: passportFrontUrl,
          passport_back_url:  passportBackUrl,
          athlete_photo_url:  athletePhotoUrl,
          signature_url:      signatureUrl,
          legal_meta,
          agreed: true,
        },
        source_url: legal_meta.referrer || null,
      }),
    });
    leadId = rows?.[0]?.id;
  } catch (e) {
    return res.status(500).json({ ok: false, error: `submission failed: ${e.message}` });
  }

  /* ------------------------------------------
     Push to GHL (non-fatal on failure)
  ------------------------------------------ */
  let ghlContactId = null;
  let ghlStatus    = "not-configured";

  const loc = loadGhlLocation(GHL_LOC_NAME);
  if (loc) {
    try {
      const { contactId, headers, ghlLocationId } = await upsertGhlContact(loc, b);
      ghlContactId = contactId;
      ghlStatus    = "synced";

      if (contactId) {
        await postGhlSummary(
          headers,
          ghlLocationId,
          contactId,
          b,
          { passportFrontUrl, passportBackUrl, athletePhotoUrl, signatureUrl }
        );
        const workflowId = ONBOARDING_WORKFLOWS[form_type];
        const apiKey = loc.apiKeyV2 || loc.apiKey;
        await enrollInWorkflow(apiKey, contactId, workflowId);
      }

      // Stamp lead with GHL receipt
      try {
        await sbReq(`website_leads?id=eq.${leadId}`, {
          method: "PATCH",
          body: JSON.stringify({
            ghl_contact_id: ghlContactId,
            ghl_synced_at:  new Date().toISOString(),
            ghl_error:      null,
          }),
        });
      } catch (e) {
        console.error("Failed to stamp GHL receipt on lead", leadId, e.message);
      }
    } catch (e) {
      console.error("GHL sync failed — lead is saved, stamping error:", e.message);
      ghlStatus = "failed";
      try {
        await sbReq(`website_leads?id=eq.${leadId}`, {
          method: "PATCH",
          body: JSON.stringify({ ghl_error: e.message.slice(0, 500) }),
        });
      } catch (stampErr) {
        console.error("Failed to stamp GHL error on lead", leadId, stampErr.message);
      }
    }
  }

  return res.status(200).json({ ok: true, id: leadId, ghl: ghlStatus });
}

export default withSentryApiRoute(handler);
