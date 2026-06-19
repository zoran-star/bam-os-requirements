// Public endpoint — step 3 of the website enrollment funnel (PAY + SIGN).
//
//   POST /api/website/checkout
//   body: {
//     client_id, offer_id, offer_price_key,           // what they're buying
//     parent:  { first, last, email, phone },
//     athlete: { first, last, dob? },
//     intake:  { <field_key>: <answer>, ... },         // step-1 answers
//     agreement: { signature, signed_at }              // signature = PNG data URL
//   }
//   → { ok, member_id, subscription_id, customer_id, client_secret,
//       stripe_account, publishable_key, amount_cents, currency, agreement_saved }
//
// Mirrors api/onboarding/checkout.js (portal-owned Stripe subscription on the
// academy's connected account, returns a PaymentIntent client_secret for the
// Stripe.js Payment Element) with three differences for the website funnel:
//   1. CORS-gated by clients.allowed_domains (it runs cross-origin).
//   2. The price is resolved by the offer's Price-Matched offer_price_key, not a
//      canonical plan alias — so we charge exactly what the offer builder shows
//      (still server-side; the client never sends an amount).
//   3. It renders + stores the signed agreement PDF and links it to the member.
//
// Payment completion (member -> "live", GHL convert/tag) is handled later by
// api/stripe/webhook.js on invoice.paid; this endpoint only sets things up.

import { withSentryApiRoute } from "../_sentry.js";
import { renderAgreementPdf, uploadAgreementPdf } from "../_lib/agreement-pdf.js";

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

// ── Stripe (same pattern as onboarding/checkout.js) ──
function stripeKey() {
  return process.env.ONBOARDING_STRIPE_SECRET_KEY || process.env.STRIPE_CONNECT_SECRET_KEY || process.env.STRIPE_SECRET_KEY;
}
function isTestMode() { return String(process.env.ONBOARDING_STRIPE_SECRET_KEY || "").indexOf("sk_test") === 0; }
function intervalFor(term) {
  if (term === "3_months") return { interval: "month", interval_count: 3 };
  if (term === "6_months") return { interval: "month", interval_count: 6 };
  return { interval: "week", interval_count: 4 };
}
async function stripeFetch(path, { method = "GET", body, stripeAccount, idempotencyKey } = {}) {
  const headers = { Authorization: `Bearer ${stripeKey()}` };
  if (body) headers["Content-Type"] = "application/x-www-form-urlencoded";
  if (stripeAccount) headers["Stripe-Account"] = stripeAccount;
  if (idempotencyKey) headers["Idempotency-Key"] = idempotencyKey;
  const encoded = body
    ? new URLSearchParams(Object.entries(body).reduce((a, [k, v]) => { if (v != null) a[k] = String(v); return a; }, {})).toString()
    : undefined;
  const res = await fetch(`${STRIPE_API}${path}`, { method, headers, body: encoded });
  const text = await res.text();
  const json = text ? JSON.parse(text) : {};
  if (!res.ok) { const err = new Error(json?.error?.message || `Stripe ${res.status}`); err.stripeStatus = res.status; throw err; }
  return json;
}
function piSecretFromSub(sub) {
  const inv = sub && sub.latest_invoice;
  if (!inv || typeof inv !== "object") return null;
  // Stripe's newer "flexible" billing mode exposes the first-payment client
  // secret on invoice.confirmation_secret; classic billing used
  // invoice.payment_intent. Prefer the new field, fall back to the old one.
  if (inv.confirmation_secret && inv.confirmation_secret.client_secret) return inv.confirmation_secret.client_secret;
  const pi = inv.payment_intent;
  return pi && typeof pi === "object" ? pi.client_secret : null;
}

function pickRoutable(rows) {
  const routable = (rows || []).filter((r) => r.is_routable);
  if (!routable.length) return null;
  return routable.find((r) => r.tier === "canonical") || routable[0];
}
function money(cents, currency) {
  if (cents == null) return "";
  return `$${(cents / 100).toFixed(2)} ${String(currency || "cad").toUpperCase()}`;
}
const TERM_NOUN = { "4_weeks": "every 4 weeks", "3_months": "every 3 months", "6_months": "every 6 months" };

// ── Commitment → revert-to-monthly (billing schedule) ──────────────────────
// A 3/6-month commitment term whose offer says "Goes back to monthly" should
// bill the committed term once, then drop to the plan's monthly price. We do NOT
// build the Stripe subscription_schedule here — that would complicate the
// default_incomplete payment collection. Instead we resolve the plan's monthly
// canonical price and stamp it on the sub metadata; api/stripe/webhook.js
// attaches the schedule AFTER the first invoice is paid (from_subscription →
// phase1 = committed ×1 iteration → phase2 = monthly, then release). If anything
// here is uncertain we return null → plain sub (today's behavior), never a wrong
// revert. LIVE money: conservative by design.
const COMMITMENT_TERMS = new Set(["3_months", "6_months"]);
function lengthMatchesTerm(length, term) {
  const s = norm(length);
  if (term === "3_months") return /(^|[^0-9])3\s*month/.test(s) || /12\s*week/.test(s);
  if (term === "6_months") return /(^|[^0-9])6\s*month/.test(s) || /24\s*week/.test(s);
  return false;
}
async function resolveCommitmentRevert({ clientId, offerId, planText, term }) {
  if (!COMMITMENT_TERMS.has(term)) return null;
  // 1) Confirm the offer's commitment for this plan+term reverts to monthly.
  let offerRows = null;
  try { offerRows = await sb(`offers?id=eq.${encodeURIComponent(offerId)}&select=data&limit=1`); } catch { return null; }
  const data = Array.isArray(offerRows) && offerRows[0] && offerRows[0].data;
  const offerings = (data && data.pricing && data.pricing.pricing_offerings) || [];
  const offering = offerings.find((o) => norm(o.title) === norm(planText));
  const commitment = offering && Array.isArray(offering.commitments)
    ? offering.commitments.find((c) => lengthMatchesTerm(c.length, term)) : null;
  if (!commitment || norm(commitment.after) !== norm("Goes back to monthly")) return null;
  // 2) Find the plan's canonical monthly price to revert to (prefer the 4_weeks row).
  let monthlyRows = null;
  try {
    monthlyRows = await sb(
      `pricing_catalog?client_id=eq.${encodeURIComponent(clientId)}&offer_id=eq.${encodeURIComponent(offerId)}` +
      `&offer_price_key=eq.${encodeURIComponent(planText + "|monthly")}&tier=eq.canonical` +
      `&select=stripe_price_id,interval`
    );
  } catch { return null; }
  const monthly = (Array.isArray(monthlyRows) ? monthlyRows : [])
    .filter((r) => r.stripe_price_id)
    .sort((a, b) => (b.interval === "4_weeks" ? 1 : 0) - (a.interval === "4_weeks" ? 1 : 0))[0];
  if (!monthly || !monthly.stripe_price_id) return null;
  return { revertToPriceId: monthly.stripe_price_id };
}

async function handler(req, res) {
  // CORS
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
    const parent = body.parent || {};
    const athlete = body.athlete || {};
    const agreement = body.agreement || {};

    const clientId = body.client_id || body.clientId;
    const offerId = body.offer_id || body.offerId;
    const priceKey = (body.offer_price_key || "").toString().trim();
    const parentEmail = norm(parent.email || body.parent_email);
    const parentName = (parent.name || `${parent.first || ""} ${parent.last || ""}`).trim() || null;
    const parentPhone = (parent.phone || body.parent_phone || "").toString().trim() || null;
    const athleteName = (athlete.name || `${athlete.first || ""} ${athlete.last || ""}`).trim() || null;
    const intake = (body.intake && typeof body.intake === "object") ? body.intake : {};

    // ── Validate ──
    if (!clientId) return res.status(400).json({ error: "client_id required" });
    if (!offerId) return res.status(400).json({ error: "offer_id required" });
    if (!priceKey) return res.status(400).json({ error: "offer_price_key required" });
    if (!parentEmail) return res.status(400).json({ error: "parent email required" });
    if (!athleteName) return res.status(400).json({ error: "athlete name required" });
    if (!agreement.signature) return res.status(400).json({ error: "agreement signature required" });

    const testMode = isTestMode();

    // ── Academy must exist + be Stripe-connected ──
    const clientRows = await sb(`clients?id=eq.${encodeURIComponent(clientId)}&select=id,business_name,stripe_connect_account_id&limit=1`);
    const client = Array.isArray(clientRows) && clientRows[0];
    if (!client) return res.status(404).json({ error: "academy not found" });
    const stripeAccount = testMode ? null : client.stripe_connect_account_id;
    if (!testMode && !stripeAccount) return res.status(409).json({ error: "academy is not connected to Stripe" });

    // ── Price: resolve the offer's Price-Matched, routable catalog row ──
    const priceRows = await sb(
      `pricing_catalog?client_id=eq.${encodeURIComponent(clientId)}&offer_id=eq.${encodeURIComponent(offerId)}` +
      `&offer_price_key=eq.${encodeURIComponent(priceKey)}` +
      `&select=stripe_price_id,amount_cents,currency,canonical_plan,interval,tier,is_routable`
    );
    const price = pickRoutable(priceRows);
    if (!price || (!testMode && !price.stripe_price_id)) {
      return res.status(409).json({ error: "no routable price for that selection", offer_price_key: priceKey });
    }
    if (testMode && price.amount_cents == null) {
      return res.status(409).json({ error: "no catalog amount for that selection (needed for inline test price)", offer_price_key: priceKey });
    }
    const term = price.interval || "4_weeks";
    const planText = price.canonical_plan || priceKey.split("|")[0];

    // ── Idempotency: reuse an existing member + in-flight sub ──
    const existingRows = await sb(
      `members?client_id=eq.${encodeURIComponent(clientId)}&parent_email=eq.${encodeURIComponent(parentEmail)}` +
      `&athlete_name=eq.${encodeURIComponent(athleteName)}&select=id,status,stripe_customer_id,stripe_subscription_id,agreement_pdf_path&limit=1`
    );
    let member = Array.isArray(existingRows) && existingRows[0] ? existingRows[0] : null;

    if (member && member.stripe_subscription_id) {
      let sub = null;
      try { sub = await stripeFetch(`/subscriptions/${member.stripe_subscription_id}?expand[]=latest_invoice.payment_intent&expand[]=latest_invoice.confirmation_secret`, { stripeAccount }); } catch { sub = null; }
      if (sub) {
        if (sub.status === "incomplete") {
          const secret = piSecretFromSub(sub);
          if (secret) {
            await maybeAttachAgreement({ member, client, parentName, athleteName, planText, price, term, agreement, clientId });
            return res.status(200).json({
              ok: true, reused: true, member_id: member.id, subscription_id: sub.id, customer_id: sub.customer,
              client_secret: secret, stripe_account: stripeAccount, publishable_key: process.env.STRIPE_PUBLISHABLE_KEY || null,
              amount_cents: price.amount_cents, currency: price.currency || "cad", agreement_saved: !!member.agreement_pdf_path,
            });
          }
        } else if (sub.status === "active" || sub.status === "trialing") {
          return res.status(200).json({ ok: true, already_active: true, member_id: member.id, subscription_id: sub.id });
        }
      }
    }

    // ── Customer on the connected account ──
    let customerId = member && member.stripe_customer_id;
    if (!customerId) {
      const found = await stripeFetch(`/customers?email=${encodeURIComponent(parentEmail)}&limit=1`, { stripeAccount });
      customerId = found && found.data && found.data[0] && found.data[0].id;
    }
    if (!customerId) {
      const cust = await stripeFetch(`/customers`, {
        method: "POST", stripeAccount,
        body: { email: parentEmail, name: parentName || undefined, phone: parentPhone || undefined,
          "metadata[athlete_name]": athleteName, "metadata[source]": "fullcontrol-website-enrollment" },
      });
      customerId = cust.id;
    }

    // ── Resolve the price to charge (LIVE: matched price; TEST: inline) ──
    let priceIdToUse = price.stripe_price_id;
    if (testMode) {
      const iv = intervalFor(term);
      const testPrice = await stripeFetch(`/prices`, {
        method: "POST", stripeAccount,
        idempotencyKey: `web-price-${priceKey}-${price.amount_cents}`.slice(0, 200),
        body: { currency: price.currency || "cad", unit_amount: price.amount_cents,
          "recurring[interval]": iv.interval, "recurring[interval_count]": iv.interval_count,
          "product_data[name]": `${priceKey} (FC website enrollment test)` },
      });
      priceIdToUse = testPrice.id;
    }

    // ── Commitment terms that revert to monthly: resolve the monthly price now,
    //    stamp it on the sub; webhook.js attaches the schedule after first payment.
    //    Live only (test mode charges an inline price unrelated to the catalog). ──
    const revert = !testMode ? await resolveCommitmentRevert({ clientId, offerId, planText, term }) : null;

    // ── Portal-owned subscription (default_incomplete → client_secret) ──
    const sub = await stripeFetch(`/subscriptions`, {
      method: "POST", stripeAccount,
      idempotencyKey: `web-sub-${testMode ? "test-" : ""}${clientId}-${parentEmail}-${athleteName}-${priceKey}`.slice(0, 200),
      body: {
        customer: customerId, "items[0][price]": priceIdToUse,
        payment_behavior: "default_incomplete",
        "payment_settings[save_default_payment_method]": "on_subscription",
        "expand[0]": "latest_invoice.payment_intent",
        "expand[1]": "latest_invoice.confirmation_secret",
        "metadata[origin]": "fullcontrol-website-enrollment",
        "metadata[offer_id]": offerId, "metadata[offer_price_key]": priceKey,
        "metadata[plan]": planText, "metadata[term]": term,
        "metadata[client_id]": clientId, "metadata[parent_email]": parentEmail, "metadata[athlete_name]": athleteName,
        ...(revert ? { "metadata[commitment_reverts]": "monthly", "metadata[revert_to_price]": revert.revertToPriceId } : {}),
      },
    });
    const clientSecret = piSecretFromSub(sub);

    // ── Upsert the member (stays payment_method_required until paid) ──
    const memberFields = {
      client_id: clientId, athlete_name: athleteName, parent_name: parentName,
      parent_email: parentEmail, parent_phone: parentPhone, plan: planText,
      status: "payment_method_required", stripe_customer_id: customerId,
      stripe_subscription_id: sub.id, stripe_price_id: price.stripe_price_id, updated_at: nowIso(),
    };
    if (member) {
      await sb(`members?id=eq.${member.id}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify(memberFields) });
    } else {
      memberFields.joined_date = new Date().toISOString().slice(0, 10);
      memberFields.created_at = nowIso();
      const inserted = await sb(`members?select=id,agreement_pdf_path`, { method: "POST", headers: { Prefer: "return=representation" }, body: JSON.stringify([memberFields]) });
      member = Array.isArray(inserted) && inserted[0] ? inserted[0] : null;
    }

    // ── Signed agreement PDF (best-effort: never block the payment setup) ──
    const agreementSaved = await maybeAttachAgreement({ member, client, parentName, athleteName, planText, price, term, agreement, clientId });

    // Audit (non-fatal) — also stashes the step-1 intake answers.
    try {
      await sb(`member_audit_log`, {
        method: "POST", headers: { Prefer: "return=minimal" },
        body: JSON.stringify([{
          client_id: clientId, member_id: member && member.id,
          action_type: "website-enrollment-checkout-created",
          args: { offer_id: offerId, offer_price_key: priceKey, plan: planText, term, sub_id: sub.id, customer_id: customerId, intake, agreement_saved: agreementSaved },
          performed_by_name: "Website enrollment funnel (public)",
        }]),
      });
    } catch { /* non-fatal */ }

    return res.status(200).json({
      ok: true, member_id: member && member.id, subscription_id: sub.id, customer_id: customerId,
      client_secret: clientSecret, stripe_account: stripeAccount, publishable_key: process.env.STRIPE_PUBLISHABLE_KEY || null,
      amount_cents: price.amount_cents, currency: price.currency || "cad", agreement_saved: agreementSaved,
    });
  } catch (e) {
    return res.status(e.stripeStatus || e.status || 500).json({ error: e.message || String(e) });
  }
}

// Render + store the signed PDF and link it on the member. Returns true on
// success; never throws (the payment flow must not depend on it).
async function maybeAttachAgreement({ member, client, parentName, athleteName, planText, price, term, agreement, clientId }) {
  if (!member || !member.id) return false;
  if (member.agreement_pdf_path) return true; // already signed/stored
  try {
    const bytes = await renderAgreementPdf({
      academyName: client.business_name || "By Any Means",
      parentName, athleteName, planLabel: planText,
      priceText: `${money(price.amount_cents, price.currency)} ${TERM_NOUN[term] || ""}`.trim(),
      signaturePngDataUrl: agreement.signature,
      signedAtIso: agreement.signed_at || nowIso(),
    });
    const { path, size } = await uploadAgreementPdf({ sbUrl: SB_URL, sbKey: SB_KEY, clientId, memberId: member.id, bytes });
    // Record it as a member document (kind 'waiver') so it lists in the staff
    // member popup alongside any manual uploads, with a signed date.
    await sb(`member_files`, {
      method: "POST", headers: { Prefer: "return=minimal" },
      body: JSON.stringify([{
        member_id: member.id, client_id: clientId, kind: "waiver",
        filename: "enrollment-agreement.pdf", storage_path: path,
        mime_type: "application/pdf", size_bytes: size,
        signed_at: agreement.signed_at || nowIso(),
        metadata: { source: "website-enrollment" },
      }]),
    });
    // Denormalized flag on the member (also gates re-generation on retries).
    await sb(`members?id=eq.${member.id}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ agreement_pdf_path: path, updated_at: nowIso() }) });
    member.agreement_pdf_path = path;
    return true;
  } catch { return false; }
}

export default withSentryApiRoute(handler);
