// POST /api/website/onboarding-pdf
// Called by adapt-funnel-waiver.html after the main onboarding submission succeeds.
// Receives the client-generated PDF (base64), uploads it to Supabase, and emails
// the download link to the parent via GHL.
//
// Body: { client_id, lead_id, parent_email, parent_name, athlete_first, athlete_last, waiver_pdf_b64 }

import { withSentryApiRoute } from "../_sentry.js";

export const config = {
  api: {
    bodyParser: {
      sizeLimit: '10mb',
    },
  },
};

const SB_URL = (process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || "").trim();
const SB_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || "").trim();
const GHL_V2 = "https://services.leadconnectorhq.com";
const V2_VERSION = "2021-07-28";
const GHL_LOC_NAME = "By Any Means Basketball";

const ALLOWED_ORIGINS = new Set([
  "https://byanymeansbball.com",
  "https://www.byanymeansbball.com",
  "http://localhost:3000",
  "http://localhost:5173",
  "http://127.0.0.1:5500",
]);

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

function loadGhlLocation(name) {
  try {
    const locs = process.env.GHL_LOCATIONS_JSON ? JSON.parse(process.env.GHL_LOCATIONS_JSON) : [];
    return locs.find(l => l.name === name) || null;
  } catch {
    return null;
  }
}

async function uploadPdf(leadId, base64DataUrl) {
  const comma = base64DataUrl.indexOf(',');
  const b64 = comma >= 0 ? base64DataUrl.slice(comma + 1) : base64DataUrl;
  if (!b64) return null;

  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);

  const path = `adapt/${leadId}/waiver.pdf`;
  const r = await fetch(`${SB_URL}/storage/v1/object/member-files/${path}`, {
    method: "POST",
    headers: {
      apikey:          SB_KEY,
      Authorization:  `Bearer ${SB_KEY}`,
      "Content-Type": "application/pdf",
      "x-upsert":     "true",
    },
    body: bytes,
  });
  if (!r.ok) throw new Error(`PDF upload failed: ${(await r.text()).slice(0, 200)}`);
  return `${SB_URL}/storage/v1/object/public/member-files/${path}`;
}

async function updateLeadPdfUrl(leadId, pdfUrl) {
  // Fetch current fields, merge in PDF URL, write back
  const getRes = await fetch(`${SB_URL}/rest/v1/website_leads?id=eq.${leadId}&select=fields`, {
    headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` },
  });
  const rows = await getRes.json();
  const existing = rows?.[0]?.fields || {};

  await fetch(`${SB_URL}/rest/v1/website_leads?id=eq.${leadId}`, {
    method: "PATCH",
    headers: {
      apikey:          SB_KEY,
      Authorization:  `Bearer ${SB_KEY}`,
      "Content-Type": "application/json",
      Prefer:         "return=minimal",
    },
    body: JSON.stringify({ fields: { ...existing, waiver_pdf_url: pdfUrl } }),
  });
}

async function sendGhlEmail(loc, parentEmail, parentName, athleteFirst, athleteLast, pdfUrl) {
  const apiKey = loc.apiKeyV2 || loc.apiKey;
  if (!apiKey) return;

  const ghlLocationId = loc.locationId;
  const headers = {
    Authorization:  `Bearer ${apiKey}`,
    Version:         V2_VERSION,
    "Content-Type": "application/json",
    Accept:         "application/json",
  };

  // Find contact by email
  const searchRes = await fetch(
    `${GHL_V2}/contacts/?locationId=${ghlLocationId}&email=${encodeURIComponent(parentEmail)}`,
    { headers }
  );
  const searchData = await searchRes.json();
  const contactId = searchData.contacts?.[0]?.id;
  if (!contactId) return;

  const athleteName = `${athleteFirst || ""} ${athleteLast || ""}`.trim();

  const html = `
<div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;color:#111;">
  <p style="margin-bottom:12px;">Hi ${parentName || "there"},</p>
  <p style="margin-bottom:12px;">Your ADAPT Global AAU waiver for <strong>${athleteName}</strong> has been successfully signed and recorded.</p>
  <p style="margin-bottom:24px;">You can download your signed copy using the link below for your records:</p>
  <a href="${pdfUrl}" style="display:inline-block;background:#e2dd9f;color:#000;font-weight:700;text-decoration:none;padding:12px 24px;font-size:15px;">Download Signed Waiver (PDF)</a>
  <p style="margin-top:24px;font-size:13px;color:#555;">We will be in touch shortly with your next steps. Welcome to ADAPT Global.</p>
  <p style="font-size:13px;color:#555;">By Any Means Basketball</p>
</div>`.trim();

  // Find or create conversation, then send email
  let conversationId = null;
  try {
    const convSearch = await fetch(
      `${GHL_V2}/conversations/search?locationId=${ghlLocationId}&contactId=${contactId}&limit=1`,
      { headers }
    );
    const convData = await convSearch.json();
    conversationId = convData.conversations?.[0]?.id;
  } catch (e) { /* proceed without existing conversation */ }

  if (!conversationId) {
    try {
      const convCreate = await fetch(`${GHL_V2}/conversations/`, {
        method: "POST",
        headers,
        body: JSON.stringify({ locationId: ghlLocationId, contactId }),
      });
      const convCreated = await convCreate.json();
      conversationId = convCreated.id || convCreated.conversation?.id;
    } catch (e) { /* proceed */ }
  }

  await fetch(`${GHL_V2}/conversations/messages`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      type:          "Email",
      contactId,
      locationId:    ghlLocationId,
      conversationId: conversationId || undefined,
      subject:       `Your ADAPT Signed Waiver - ${athleteName}`,
      html,
      emailFrom:     "info@byanymeansbball.com",
      emailTo:       parentEmail,
    }),
  });
}

async function handler(req, res) {
  if (!SB_URL || !SB_KEY) return res.status(500).json({ ok: false, error: "Supabase not configured" });

  setCors(req, res);
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "POST required" });

  const {
    lead_id,
    parent_email,
    parent_name,
    athlete_first,
    athlete_last,
    waiver_pdf_b64,
  } = req.body || {};

  if (!lead_id || !waiver_pdf_b64) {
    return res.status(400).json({ ok: false, error: "lead_id and waiver_pdf_b64 required" });
  }

  // Upload to Supabase
  let pdfUrl;
  try {
    pdfUrl = await uploadPdf(lead_id, waiver_pdf_b64);
  } catch (e) {
    console.error("PDF upload failed:", e.message);
    return res.status(500).json({ ok: false, error: e.message });
  }

  // Update lead record (non-fatal)
  try {
    await updateLeadPdfUrl(lead_id, pdfUrl);
  } catch (e) {
    console.error("Lead PDF URL update failed (non-fatal):", e.message);
  }

  // Send GHL email (non-fatal)
  if (parent_email) {
    const loc = loadGhlLocation(GHL_LOC_NAME);
    if (loc) {
      try {
        await sendGhlEmail(loc, parent_email, parent_name, athlete_first, athlete_last, pdfUrl);
      } catch (e) {
        console.error("GHL email send failed (non-fatal):", e.message);
      }
    }
  }

  return res.status(200).json({ ok: true, pdfUrl });
}

export default withSentryApiRoute(handler);
