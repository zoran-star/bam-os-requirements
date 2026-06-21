// POST /api/website/ch3-checkout
// First-payment checkout for a CH3 Training plan.
//
// body: {
//   contact:    { first, last, email, phone, grade, experienceLevel, desiredStartDate, proximity },
//   plan:       { id },
//   commitment: 'monthly' | '3m' | '6m',
//   agreement:  { signature, signed_at }
// }
// → { ok, client_secret, publishable_key, amount_cents, lead_id }
//
// Flow:
//   1. Validate + resolve plan and commitment from server-side catalog
//   2. Upsert GHL contact (CH3 sub-account)
//   3. Create Stripe PaymentIntent (USD, resolved amount based on commitment)
//   4. Insert website_leads record (form_type = 'ch3_signup')
//   5. Return { ok, client_secret, publishable_key, amount_cents, lead_id }

import { withSentryApiRoute } from "../_sentry.js";

const SB_URL = (process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || "").trim();
const SB_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || "").trim();
const STRIPE_API = "https://api.stripe.com/v1";
const GHL_V2 = "https://services.leadconnectorhq.com";
const V2_VERSION = "2021-07-28";

const GHL_LOC_ID = process.env.CH3_GHL_LOCATION_ID || process.env.GHL_LOCATION_ID || "";
const GHL_TOKEN  = process.env.GHL_PRIVATE_TOKEN   || process.env.GHL_API_KEY || "";

const ALLOWED_ORIGINS = new Set([
  "https://chrishaynesbasketball.com",
  "https://www.chrishaynesbasketball.com",
  "https://ch3training.vercel.app",
  "http://localhost:3000",
  "http://localhost:5173",
  "http://127.0.0.1:5500",
]);

// Server-side plans catalog — the client sends only plan.id; price is resolved here.
const PLANS = {
  "train1x":   { name: "Train 1x/Week", price_usd: 165, billing: "monthly", frequency: "1x / week" },
  "train2x":   { name: "Train 2x/Week", price_usd: 225, billing: "monthly", frequency: "2x / week" },
  "unlimited": { name: "Unlimited",     price_usd: 349, billing: "monthly", frequency: "Unlimited"  },
};

// Prepay amounts — must match data.js COMMITMENTS
const COMMITMENTS = {
  "train1x":   { "3m": 450,  "6m": 795  },
  "train2x":   { "3m": 605,  "6m": 1080 },
  "unlimited": { "3m": 945,  "6m": 1675 },
};

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

async function sb(path, init = {}) {
  const res = await fetch(`${SB_URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`,
      "Content-Type": "application/json", ...(init.headers || {}),
    },
  });
  if (!res.ok) throw new Error(`Supabase ${res.status}: ${await res.text()}`);
  const txt = await res.text();
  return txt ? JSON.parse(txt) : null;
}

function stripeKey() {
  return process.env.CH3_STRIPE_SECRET_KEY || process.env.ONBOARDING_STRIPE_SECRET_KEY || process.env.STRIPE_SECRET_KEY || "";
}
function stripePublishableKey() {
  return process.env.CH3_STRIPE_PUBLISHABLE_KEY || process.env.ONBOARDING_STRIPE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY || "";
}

async function stripeFetch(path, { method = "GET", body } = {}) {
  const headers = { Authorization: `Bearer ${stripeKey()}` };
  if (body) headers["Content-Type"] = "application/x-www-form-urlencoded";
  const encoded = body
    ? new URLSearchParams(Object.entries(body).reduce((a, [k, v]) => { if (v != null) a[k] = String(v); return a; }, {})).toString()
    : undefined;
  const res = await fetch(`${STRIPE_API}${path}`, { method, headers, body: encoded });
  const text = await res.text();
  const json = text ? JSON.parse(text) : {};
  if (!res.ok) { const err = new Error(json?.error?.message || `Stripe ${res.status}`); err.code = res.status; throw err; }
  return json;
}

function resolveBillingTag(commitment) {
  if (commitment === "3m") return "Prepay 3-Month";
  if (commitment === "6m") return "Prepay 6-Month";
  return "Monthly Member";
}

function resolvePrice(planId, plan, commitment) {
  if (commitment === "3m" && COMMITMENTS[planId]) return COMMITMENTS[planId]["3m"];
  if (commitment === "6m" && COMMITMENTS[planId]) return COMMITMENTS[planId]["6m"];
  return plan.price_usd;
}

function resolveDescription(plan, commitment, fullName) {
  const commitLabel = commitment === "3m" ? "3-month prepay" : commitment === "6m" ? "6-month prepay" : "first month";
  return `CH3 Training — ${plan.name} (${commitLabel}) — ${fullName}`;
}

async function ghlUpsertContact({ first, last, email, phone, planName, billingTag, contact }) {
  if (!GHL_TOKEN || !GHL_LOC_ID) return null;
  const body = {
    locationId: GHL_LOC_ID,
    firstName: first,
    lastName: last,
    email,
    phone,
    tags: ["CH3 Training", billingTag],
    customFields: [
      { key: "contact.inquiry", field_value: `CH3 Training — ${planName} (${billingTag})` }
    ]
  };
  try {
    const res = await fetch(`${GHL_V2}/contacts/upsert`, {
      method: "POST",
      headers: { Authorization: `Bearer ${GHL_TOKEN}`, Version: V2_VERSION, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data?.contact?.id || null;
  } catch {
    return null;
  }
}

async function handler(req, res) {
  setCors(req, res);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "Method not allowed" });

  try {
    const { contact, plan: planInput, commitment: rawCommitment, agreement } = req.body || {};

    if (!contact?.email?.trim()) return res.status(400).json({ ok: false, error: "Email is required" });
    if (!contact?.first?.trim()) return res.status(400).json({ ok: false, error: "First name is required" });
    if (!planInput?.id) return res.status(400).json({ ok: false, error: "Plan is required" });

    const plan = PLANS[planInput.id];
    if (!plan) return res.status(400).json({ ok: false, error: "Invalid plan" });

    const commitment = ["3m", "6m"].includes(rawCommitment) ? rawCommitment : "monthly";
    const price_usd = resolvePrice(planInput.id, plan, commitment);
    const amount_cents = Math.round(price_usd * 100);
    const fullName = `${(contact.first || "").trim()} ${(contact.last || "").trim()}`.trim();
    const billingTag = resolveBillingTag(commitment);

    const ghlContactId = await ghlUpsertContact({
      first: contact.first?.trim(),
      last: contact.last?.trim() || "",
      email: contact.email?.trim(),
      phone: contact.phone?.trim() || "",
      planName: plan.name,
      billingTag,
      contact,
    });

    let clientSecret = null;
    let piId = null;
    if (stripeKey()) {
      const pi = await stripeFetch("/payment_intents", {
        method: "POST",
        body: {
          amount: amount_cents,
          currency: "usd",
          receipt_email: contact.email?.trim(),
          description: resolveDescription(plan, commitment, fullName),
          metadata: {
            plan_id:       planInput.id,
            plan_name:     plan.name,
            commitment,
            billing_tag:   billingTag,
            contact_email: contact.email?.trim(),
            contact_name:  fullName,
          },
          automatic_payment_methods: { enabled: "true" },
        },
      });
      clientSecret = pi.client_secret;
      piId = pi.id;
    }

    const leadId = crypto.randomUUID();
    await sb("website_leads", {
      method: "POST",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify({
        id: leadId,
        form_type: "ch3_signup",
        name: fullName,
        email: contact.email?.trim(),
        phone: contact.phone?.trim() || null,
        fields: {
          plan_id:      planInput.id,
          plan_name:    plan.name,
          commitment,
          billing_tag:  billingTag,
          frequency:    plan.frequency,
          amount_usd:   price_usd,
          amount_cents,
          grade:        contact.grade || null,
          experience_level: contact.experienceLevel || null,
          desired_start_date: contact.desiredStartDate || null,
          proximity:    contact.proximity || null,
          stripe_pi_id:   piId,
          payment_status: piId ? "pending" : "no_stripe",
          agreement_signature: agreement?.signature || null,
          agreement_signed_at: agreement?.signed_at || null,
        },
        source_url: req.headers.referer || null,
        ghl_contact_id: ghlContactId,
        ghl_synced_at: ghlContactId ? new Date().toISOString() : null,
        created_at: new Date().toISOString(),
      }),
    });

    return res.status(200).json({
      ok: true,
      lead_id: leadId,
      client_secret: clientSecret,
      publishable_key: stripePublishableKey(),
      amount_cents,
    });

  } catch (err) {
    console.error("[ch3-checkout] error:", err);
    return res.status(500).json({ ok: false, error: err.message || "Internal error" });
  }
}

export default withSentryApiRoute(handler);
