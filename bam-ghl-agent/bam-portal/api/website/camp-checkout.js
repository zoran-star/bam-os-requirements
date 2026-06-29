// Public endpoint — one-time payment (PaymentIntent) for camps, clinics, tournaments.
// Unlike /api/website/checkout (subscription-based, requires offer catalog), this
// endpoint accepts a client-supplied amount_cents and creates a PaymentIntent directly.
// Use it for summer camps, clinics, tournaments — any one-time charge where the
// amount is known and hardcoded on the client site.
//
//   POST /api/website/camp-checkout
//   body: {
//     client_id,                    // required
//     amount_cents,                 // required — e.g. 59900 for $599
//     currency,                     // optional, default "usd"
//     program,                      // required — e.g. "Summer Camp 2026 - 1-Week Session"
//     plan_key,                     // optional — e.g. "week-single"
//     parent:  { first, last, email, phone },
//     athlete: { first, last },
//     agreement: { signature, signed_at }  // signature = PNG data URL
//   }
//   → { ok, client_secret, publishable_key, stripe_account, amount_cents, currency }
//
// Reusable for any academy — just change client_id. Amount is server-validated to
// be >= 50 cents; the actual number comes from hardcoded pricing on the client site.

import { withSentryApiRoute } from "../_sentry.js";

const SB_URL = (process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || "").trim();
const SB_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || "").trim();
const STRIPE_API = "https://api.stripe.com/v1";

const DEV_ORIGINS = new Set(["http://localhost:3000", "http://localhost:5173", "http://127.0.0.1:5500"]);
let originsCache = { set: null, at: 0 };
const ORIGINS_TTL_MS = 60_000;

function nowIso() { return new Date().toISOString(); }
function norm(s) { return (s || "").toString().trim().toLowerCase(); }

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

async function getAllowedOrigins() {
  if (originsCache.set && Date.now() - originsCache.at < ORIGINS_TTL_MS) return originsCache.set;
  const set = new Set(DEV_ORIGINS);
  const rows = await sb("clients?select=allowed_domains&allowed_domains=not.is.null");
  for (const row of rows || []) {
    for (const d of row.allowed_domains || []) { set.add(`https://${d}`); set.add(`https://www.${d}`); }
  }
  originsCache = { set, at: Date.now() };
  return set;
}

function stripeKey() {
  return process.env.ONBOARDING_STRIPE_SECRET_KEY || process.env.STRIPE_CONNECT_SECRET_KEY || process.env.STRIPE_SECRET_KEY;
}
function isTestMode() { return String(process.env.ONBOARDING_STRIPE_SECRET_KEY || "").startsWith("sk_test"); }

async function stripeFetch(path, { method = "GET", body, stripeAccount, idempotencyKey } = {}) {
  const headers = { Authorization: `Bearer ${stripeKey()}` };
  if (body) headers["Content-Type"] = "application/x-www-form-urlencoded";
  if (stripeAccount) headers["Stripe-Account"] = stripeAccount;
  if (idempotencyKey) headers["Idempotency-Key"] = idempotencyKey;
  const encoded = body
    ? new URLSearchParams(
        Object.entries(body).reduce((a, [k, v]) => { if (v != null) a[k] = String(v); return a; }, {})
      ).toString()
    : undefined;
  const res = await fetch(`${STRIPE_API}${path}`, { method, headers, body: encoded });
  const text = await res.text();
  const json = text ? JSON.parse(text) : {};
  if (!res.ok) {
    const err = new Error(json?.error?.message || `Stripe ${res.status}`);
    err.stripeStatus = res.status;
    throw err;
  }
  return json;
}

async function handler(req, res) {
  // CORS — same gate as /api/website/checkout
  const origin = req.headers.origin || "";
  let allowed = false;
  try { allowed = (await getAllowedOrigins()).has(origin); } catch { /* 403 below */ }
  if (allowed) { res.setHeader("Access-Control-Allow-Origin", origin); res.setHeader("Vary", "Origin"); }
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "POST required" });
  if (!allowed) return res.status(403).json({ error: "Forbidden" });

  try {
    if (!SB_URL || !SB_KEY) throw new Error("Supabase env not configured");
    if (!stripeKey()) throw new Error("Stripe secret key not configured");

    const body = (req.body && typeof req.body === "object") ? req.body : {};
    const parent  = body.parent  || {};
    const athlete = body.athlete || {};
    const agreement = body.agreement || {};

    const clientId    = (body.client_id || body.clientId || "").toString().trim();
    const amountCents = parseInt(body.amount_cents, 10);
    const currency    = (body.currency || "usd").toLowerCase().trim();
    const program     = (body.program  || "Camp Registration").toString().trim().slice(0, 500);
    const planKey     = (body.plan_key || "").toString().trim().slice(0, 100);

    const parentEmail = norm(parent.email || body.parent_email);
    const parentName  = `${parent.first || ""} ${parent.last || ""}`.trim() || null;
    const parentPhone = (parent.phone || "").toString().trim() || null;
    const athleteName = `${athlete.first || ""} ${athlete.last || ""}`.trim() || null;

    if (!clientId)    return res.status(400).json({ error: "client_id required" });
    if (!amountCents || amountCents < 50) return res.status(400).json({ error: "amount_cents required (minimum 50)" });
    if (!parentEmail) return res.status(400).json({ error: "parent email required" });
    if (!athleteName) return res.status(400).json({ error: "athlete name required" });
    if (!agreement.signature) return res.status(400).json({ error: "agreement signature required" });

    const testMode = isTestMode();

    // Academy must exist
    const clientRows = await sb(
      `clients?id=eq.${encodeURIComponent(clientId)}&select=id,business_name,stripe_connect_account_id&limit=1`
    );
    const client = Array.isArray(clientRows) && clientRows[0];
    if (!client) return res.status(404).json({ error: "academy not found" });

    const stripeAccount = testMode ? null : client.stripe_connect_account_id;
    if (!testMode && !stripeAccount) {
      return res.status(409).json({ error: "academy is not connected to Stripe" });
    }

    // Find or create Stripe customer on the academy's connected account
    let customerId = null;
    try {
      const found = await stripeFetch(
        `/customers?email=${encodeURIComponent(parentEmail)}&limit=1`,
        { stripeAccount }
      );
      customerId = found?.data?.[0]?.id || null;
    } catch { /* non-fatal: create a new one */ }

    if (!customerId) {
      const cust = await stripeFetch(`/customers`, {
        method: "POST",
        stripeAccount,
        body: {
          email: parentEmail,
          name: parentName || undefined,
          phone: parentPhone || undefined,
          "metadata[athlete_name]": athleteName,
          "metadata[source]": "fullcontrol-camp-enrollment",
        },
      });
      customerId = cust.id;
    }

    // Idempotency key — safe to retry if network drops after PI creation
    const idempotencyKey = `camp-${clientId}-${parentEmail}-${athleteName}-${planKey || program}`
      .slice(0, 255)
      .replace(/[^a-zA-Z0-9\-_.]/g, "-");

    // Create one-time PaymentIntent (automatic_payment_methods enables cards, Apple Pay, Google Pay, etc.)
    const pi = await stripeFetch(`/payment_intents`, {
      method: "POST",
      stripeAccount,
      idempotencyKey,
      body: {
        amount: amountCents,
        currency,
        customer: customerId,
        "automatic_payment_methods[enabled]": "true",
        "metadata[program]":      program,
        "metadata[plan_key]":     planKey || undefined,
        "metadata[client_id]":    clientId,
        "metadata[parent_email]": parentEmail,
        "metadata[athlete_name]": athleteName,
        "metadata[source]":       "fullcontrol-camp-enrollment",
      },
    });

    // Audit (non-fatal)
    try {
      await sb(`member_audit_log`, {
        method: "POST",
        headers: { Prefer: "return=minimal" },
        body: JSON.stringify([{
          client_id: clientId,
          action_type: "camp-checkout-created",
          args: {
            program, plan_key: planKey, amount_cents: amountCents, currency,
            customer_id: customerId, payment_intent_id: pi.id,
            parent_email: parentEmail, athlete_name: athleteName,
          },
          performed_by_name: "Camp enrollment funnel (public)",
        }]),
      });
    } catch { /* non-fatal */ }

    return res.status(200).json({
      ok: true,
      client_secret:    pi.client_secret,
      publishable_key:  process.env.STRIPE_PUBLISHABLE_KEY || null,
      stripe_account:   stripeAccount,
      amount_cents:     amountCents,
      currency,
    });
  } catch (e) {
    return res.status(e.stripeStatus || e.status || 500).json({ error: e.message || String(e) });
  }
}

export default withSentryApiRoute(handler);
