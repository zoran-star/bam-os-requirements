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
import { renderAgreementPdf } from "../_lib/agreement-pdf.js";
import { contactProvider, resolveOrMintPortalContact } from "../_contacts.js";

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
  const { passportFrontUrl, passportBackUrl, athletePhotoUrl, signatureUrl, waiverPdfUrl } = urls;

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
    `Signed waiver PDF: ${waiverPdfUrl    || 'not generated'}`,
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
   ADAPT WAIVER CLAUSES (mirrors adapt-funnel-waiver.html)
   ============================================ */
const ADAPT_CLAUSES = [
  ["Introduction",
   "This Agreement is entered into between By Any Means Basketball LLC (\"BAM\") and the undersigned parent or legal guardian (\"Parent/Guardian\") on behalf of the above-named participant (\"Athlete\"). By providing an electronic signature, Parent/Guardian acknowledges having read, understood, and agreed to all terms set forth herein."],
  ["1. Release of Liability & Assumption of Risk",
   "Parent/Guardian acknowledges that participation in basketball training sessions, drills, scrimmages, competitions, travel, and related activities involves inherent physical risks, including but not limited to physical injury, illness, emotional distress, property loss, and other unforeseen circumstances. To the fullest extent permitted by applicable law, Parent/Guardian voluntarily assumes all such risks on behalf of the Athlete and hereby releases, waives, discharges, and covenants not to sue By Any Means Basketball LLC, its officers, directors, coaches, staff, volunteers, agents, successors, and affiliated entities from any and all claims, demands, damages, losses, liabilities, costs, or causes of action, whether known or unknown, arising out of or in connection with the Athlete's participation in any BAM program, activity, or event."],
  ["2. Medical Authorization",
   "In the event of illness, injury, or emergency during the program, Parent/Guardian authorizes BAM staff to seek and consent to emergency medical, surgical, dental, or other treatment for the Athlete at the nearest appropriate medical facility. Parent/Guardian accepts full financial responsibility for all costs associated with such treatment and agrees to maintain adequate health insurance coverage for the Athlete during the program. Parent/Guardian agrees to disclose all known medical conditions, allergies, dietary restrictions, and current medications to BAM staff prior to the program start date. BAM is not liable for complications arising from undisclosed medical information."],
  ["3. Photo & Video Release",
   "Parent/Guardian grants By Any Means Basketball LLC and its affiliates a worldwide, perpetual, royalty-free, irrevocable license to photograph, record, broadcast, publish, and otherwise use images, video recordings, and audio of the Athlete in connection with BAM's programs, activities, and events. This includes use on social media, websites, marketing materials, news releases, broadcast media, and commercial purposes. No compensation shall be owed for any such use."],
  ["4. Code of Conduct & Program Standards",
   "The Athlete agrees to abide by all BAM program standards and conduct expectations, including: treating all participants, coaches, and staff with respect and dignity; attending all scheduled sessions on time and prepared; refraining from the use of alcohol, tobacco, marijuana, or any illegal substances; complying with all facility rules and regulations; and representing BAM and their home country with integrity, character, and sportsmanship at all times. Violation of these standards may result in the Athlete's immediate removal from the program without refund, at BAM's sole discretion."],
  ["5. Housing & Accommodation",
   "Athletes residing in BAM-arranged housing agree to: comply with all house rules including curfew policies communicated at check-in; maintain cleanliness and respectful use of all common areas; refrain from hosting unauthorized guests; and promptly report any facility issues, safety concerns, or emergencies to designated BAM staff. BAM shall not be held responsible for any lost, stolen, or damaged personal property belonging to the Athlete during the program."],
  ["6. Cancellation & Refund Policy",
   "30 or more days before program start: full refund less a $150 USD administrative processing fee. 15 to 29 days before program start: 50% refund of program fees paid. 14 days or fewer before program start: no refund. No-show: no refund. If BAM cancels or substantially modifies a program due to unforeseen circumstances (including natural disaster, government restrictions, or force majeure), participants will receive a full refund or a credit toward a future session, at BAM's discretion."],
  ["7. Governing Law",
   "This Agreement shall be governed by and construed in accordance with the laws of the State of Florida, United States of America, without regard to its conflict of law provisions. Any disputes arising under this Agreement shall be resolved exclusively in the courts of Miami-Dade County, Florida."],
  ["8. Electronic Signature & Agreement",
   "By providing a signature, I, the undersigned Parent/Guardian, confirm that: (1) I have read and fully understand all terms of this Agreement; (2) I am the parent or legal guardian of the above-named Athlete and have full authority to enter into this Agreement on their behalf; (3) I agree to be legally bound by all terms herein; (4) I understand this electronic signature carries the same legal weight and validity as a handwritten signature under the Electronic Signatures in Global and National Commerce Act (ESIGN, 15 U.S.C. Section 7001 et seq.) and the Uniform Electronic Transactions Act (UETA). This Agreement constitutes the entire understanding between the parties regarding the subject matter herein."],
];

/* ============================================
   PDF GENERATION + UPLOAD
   ============================================ */
async function generateAndUploadAdaptPdf({ slug, parentName, athleteName, signatureB64, signedAt }) {
  const pdfBytes = await renderAgreementPdf({
    academyName:        "By Any Means Basketball",
    parentName:         parentName || "",
    athleteName:        athleteName || "",
    planLabel:          "ADAPT Global AAU Experience",
    signaturePngDataUrl: signatureB64 || null,
    signedAtIso:        signedAt || new Date().toISOString(),
    clauses:            ADAPT_CLAUSES,
  });

  const pdfPath = `adapt/${slug}/waiver.pdf`;
  const r = await fetch(`${SB_URL}/storage/v1/object/member-files/${pdfPath}`, {
    method:  "POST",
    headers: {
      apikey:          SB_KEY,
      Authorization:  `Bearer ${SB_KEY}`,
      "Content-Type": "application/pdf",
      "x-upsert":     "true",
    },
    body: Buffer.from(pdfBytes),
  });
  if (!r.ok) throw new Error(`PDF upload ${r.status}: ${(await r.text()).slice(0, 120)}`);
  return `${SB_URL}/storage/v1/object/public/member-files/${pdfPath}`;
}

/* ============================================
   ONBOARDING EMAILS (via Resend)
   ============================================ */
async function sendOnboardingEmails({ parentEmail, parentName, athleteName, athleteCountry, signedAt, pdfUrl }) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return;

  const dateLabel = signedAt
    ? new Date(signedAt).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })
    : "today";

  const btnStyle = 'display:inline-block;background:#E2DD9F;color:#0A0A0A;font-family:sans-serif;font-size:14px;font-weight:700;padding:12px 28px;text-decoration:none;letter-spacing:0.05em';

  // Parent confirmation
  const parentHtml = `
<div style="background:#0A0A0A;padding:40px 20px;font-family:sans-serif">
  <div style="max-width:560px;margin:0 auto;background:#141414;padding:36px">
    <p style="color:#E2DD9F;font-size:11px;font-weight:700;letter-spacing:0.12em;margin:0 0 24px">BY ANY MEANS BASKETBALL &middot; ADAPT GLOBAL</p>
    <h1 style="color:#fff;font-size:24px;margin:0 0 8px">Application Confirmed</h1>
    <p style="color:rgba(255,255,255,0.5);font-size:14px;margin:0 0 32px">Signed ${dateLabel}</p>
    <p style="color:rgba(255,255,255,0.8);font-size:15px;line-height:1.6;margin:0 0 12px">Hi ${parentName || "there"},</p>
    <p style="color:rgba(255,255,255,0.8);font-size:15px;line-height:1.6;margin:0 0 32px">The ADAPT Global AAU Experience application for <strong style="color:#fff">${athleteName}</strong> has been received and your waiver has been signed. Our team will review your application and reach out within 48 hours.</p>
    ${pdfUrl ? `<p style="margin:0 0 32px"><a href="${pdfUrl}" style="${btnStyle}">DOWNLOAD SIGNED WAIVER</a></p>` : ""}
    <p style="color:rgba(255,255,255,0.8);font-size:15px;line-height:1.6;margin:0 0 8px">Questions? Reply to this email or contact us at <a href="mailto:info@byanymeansbball.com" style="color:#E2DD9F">info@byanymeansbball.com</a>.</p>
    <p style="color:rgba(255,255,255,0.3);font-size:12px;margin:32px 0 0">By Any Means Basketball LLC &middot; Miami, FL</p>
  </div>
</div>`;

  const parentText = `ADAPT Global Application Confirmed\n\nHi ${parentName || "there"},\n\nThe application for ${athleteName} has been received and your waiver has been signed on ${dateLabel}. Our team will reach out within 48 hours.\n\n${pdfUrl ? `Download your signed waiver: ${pdfUrl}\n\n` : ""}Questions? Email info@byanymeansbball.com\n\nBy Any Means Basketball LLC`;

  const r1 = await fetch("https://api.resend.com/emails", {
    method:  "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body:    JSON.stringify({
      from:    "ADAPT Academy <portal@byanymeansbball.com>",
      to:      [parentEmail],
      subject: `Application confirmed — ${athleteName} | ADAPT Global`,
      html:    parentHtml,
      text:    parentText,
    }),
  });
  if (!r1.ok) console.error("Parent confirmation email failed:", (await r1.text()).slice(0, 200));

  // Staff notification
  const staffEmail = process.env.ADAPT_STAFF_EMAIL || "admin@byanymeansbusiness.com";
  const staffHtml = `
<div style="background:#0A0A0A;padding:40px 20px;font-family:sans-serif">
  <div style="max-width:560px;margin:0 auto;background:#141414;padding:36px">
    <p style="color:#E2DD9F;font-size:11px;font-weight:700;letter-spacing:0.12em;margin:0 0 24px">ADAPT GLOBAL &middot; NEW ONBOARDING</p>
    <h1 style="color:#fff;font-size:22px;margin:0 0 28px">New Application Received</h1>
    <table style="color:rgba(255,255,255,0.8);font-size:14px;line-height:1.8;border-collapse:collapse;width:100%">
      <tr><td style="color:rgba(255,255,255,0.4);padding-right:16px;white-space:nowrap">Athlete</td><td style="color:#fff;font-weight:600">${athleteName}</td></tr>
      <tr><td style="color:rgba(255,255,255,0.4);padding-right:16px">Country</td><td>${athleteCountry || "n/a"}</td></tr>
      <tr><td style="color:rgba(255,255,255,0.4);padding-right:16px">Guardian</td><td>${parentName || "n/a"}</td></tr>
      <tr><td style="color:rgba(255,255,255,0.4);padding-right:16px">Email</td><td>${parentEmail}</td></tr>
      <tr><td style="color:rgba(255,255,255,0.4);padding-right:16px">Signed</td><td>${dateLabel}</td></tr>
    </table>
    ${pdfUrl ? `<p style="margin:28px 0 0"><a href="${pdfUrl}" style="${btnStyle}">VIEW SIGNED WAIVER</a></p>` : ""}
  </div>
</div>`;

  const r2 = await fetch("https://api.resend.com/emails", {
    method:  "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body:    JSON.stringify({
      from:    "ADAPT Academy <portal@byanymeansbball.com>",
      to:      [staffEmail],
      subject: `New ADAPT Application — ${athleteName}`,
      html:    staffHtml,
    }),
  });
  if (!r2.ok) console.error("Staff notification email failed:", (await r2.text()).slice(0, 200));
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
     Generate + upload signed waiver PDF (non-fatal)
  ------------------------------------------ */
  let waiverPdfUrl = null;
  try {
    waiverPdfUrl = await generateAndUploadAdaptPdf({
      slug,
      parentName:  parent_name || "",
      athleteName: `${athlete_first} ${athlete_last}`,
      signatureB64: signature_b64,
      signedAt:    legal_meta?.timestamp || new Date().toISOString(),
    });
  } catch (e) {
    console.error("PDF generation failed (non-fatal):", e.message);
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
          waiver_pdf_url:     waiverPdfUrl,
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

  // Contact provider gate: a 'portal' academy mints the contact in the portal
  // store (no GHL contact / note / conversation / workflow - the full submission
  // already lives on the website_leads row, files included). Every 'ghl' academy
  // keeps the exact GHL push below.
  const contactProv = await contactProvider(client_id);
  if (contactProv === "portal") {
    try {
      ghlContactId = await resolveOrMintPortalContact(client_id, {
        first_name: athlete_first || null,
        last_name:  athlete_last || null,
        name:       `${athlete_first || ""} ${athlete_last || ""}`.trim() || null,
        email:      parent_email ? parent_email.toLowerCase() : null,
        phone:      parent_phone || null,
        athlete_name: `${athlete_first || ""} ${athlete_last || ""}`.trim() || null,
        tags:       ["adapt-onboarding", "aau-experience"],
        source:     "adapt-onboarding",
      });
      ghlStatus = ghlContactId ? "synced" : "failed";
      if (ghlContactId) {
        try {
          await sbReq(`website_leads?id=eq.${leadId}`, {
            method: "PATCH",
            body: JSON.stringify({ ghl_contact_id: ghlContactId, ghl_synced_at: new Date().toISOString(), ghl_error: null }),
          });
        } catch (e) { console.error("Failed to stamp portal receipt on lead", leadId, e.message); }
      }
    } catch (e) {
      console.error("portal contact mint failed - lead is saved:", e.message);
      ghlStatus = "failed";
    }
  } else {
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
          { passportFrontUrl, passportBackUrl, athletePhotoUrl, signatureUrl, waiverPdfUrl }
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
  }

  /* ------------------------------------------
     Send confirmation + staff notification emails (non-fatal)
  ------------------------------------------ */
  try {
    await sendOnboardingEmails({
      parentEmail:    parent_email,
      parentName:     parent_name || "",
      athleteName:    `${athlete_first} ${athlete_last}`,
      athleteCountry: athlete_country || "",
      signedAt:       legal_meta?.timestamp || null,
      pdfUrl:         waiverPdfUrl,
    });
  } catch (e) {
    console.error("Onboarding emails failed (non-fatal):", e.message);
  }

  return res.status(200).json({ ok: true, id: leadId, ghl: ghlStatus });
}

export default withSentryApiRoute(handler);
