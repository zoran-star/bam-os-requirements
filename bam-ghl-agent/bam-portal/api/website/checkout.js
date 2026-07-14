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
//   2. The price is resolved through the TYPED runtime rows (offer_prices) —
//      selected by the stable offer_price_id (preferred) or the legacy
//      offer_price_key. Only active AND routable typed rows are sellable, and
//      routable requires a confirmed entitlement rule, so checkout can never
//      sell access the entitlement/credit engines can't fulfill. Still fully
//      server-side; the client never sends an amount.
//   3. It renders + stores the signed agreement PDF and links it to the member.
//
// Payment completion (member -> "live", GHL convert/tag) is handled later by
// api/stripe/webhook.js on invoice.paid; this endpoint only sets things up.

import { withSentryApiRoute } from "../_sentry.js";
import { renderAgreementPdf, uploadAgreementPdf, buildClauses } from "../_lib/agreement-pdf.js";
import { applyDiscountToCents, normCode, couponFromPromo } from "../_coupon-guardrails.js";
import { resolveOrMintPortalContact, writePortalFieldValues } from "../_contacts.js";

const SB_URL = (process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || "").trim();
const SB_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || "").trim();
const STRIPE_API = "https://api.stripe.com/v1";

const DEV_ORIGINS = new Set(["http://localhost:3000", "http://localhost:5173", "http://127.0.0.1:5500"]);
let originsCache = { set: null, at: 0 };
const ORIGINS_TTL_MS = 60_000;

function nowIso() { return new Date().toISOString(); }
function norm(s) { return (s || "").toString().trim().toLowerCase(); }

// Membership start date the parent optionally chose at enrollment. When present it
// ANCHORS billing: the first period is charged today and recurring begins after this
// date - monthly plans at +1 interval; commitment plans charge the committed amount
// today then revert to monthly at start+commitment. Coupons compose (the discount
// carries to both today's charge and the recurring invoices). Accept a YYYY-MM-DD
// within [tomorrow, ~6 months]; today / past / invalid / out-of-range return null.
function clampStartDate(raw) {
  const s = String(raw || "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const picked = Date.parse(s + "T00:00:00Z");
  if (!Number.isFinite(picked)) return null;
  const todayUTC = Date.parse(new Date().toISOString().slice(0, 10) + "T00:00:00Z");
  const maxAhead = todayUTC + 186 * 86400000; // ~6 months out
  if (picked <= todayUTC) return null;  // today or earlier → starts immediately
  if (picked > maxAhead) return null;   // beyond the 6-month window → ignore
  return s;
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
// Add one billing interval to a date (UTC). Used to place the recurring anchor one
// full period AFTER a chosen future start date (they pay the first period today).
function addInterval(date, iv) {
  const d = new Date(date.getTime());
  const n = iv.interval_count || 1;
  if (iv.interval === "week") d.setUTCDate(d.getUTCDate() + 7 * n);
  else if (iv.interval === "month") d.setUTCMonth(d.getUTCMonth() + n);
  else if (iv.interval === "year") d.setUTCFullYear(d.getUTCFullYear() + n);
  else d.setUTCDate(d.getUTCDate() + n); // day
  return d;
}
// Stripe rejects trial_end more than 730 days out — clamp so a far-future anchor can't 400.
const STRIPE_TRIAL_MAX_SECS = 729 * 86400;
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
  // 2) Find the plan's monthly TYPED price to revert to (the routable typed
  //    row is the canonical seller; prefer the 4_weeks interval). Conservative:
  //    no routable typed monthly -> null -> plain sub (today's behavior).
  let monthlyRows = null;
  try {
    monthlyRows = await sb(
      `offer_prices?tenant_id=eq.${encodeURIComponent(clientId)}&source_offer_id=eq.${encodeURIComponent(offerId)}` +
      `&source_offer_price_key=eq.${encodeURIComponent(planText + "|monthly")}&is_routable=eq.true&is_active=eq.true` +
      `&select=stripe_price_id,billing_interval`
    );
  } catch { return null; }
  const monthly = (Array.isArray(monthlyRows) ? monthlyRows : [])
    .filter((r) => r.stripe_price_id)
    .sort((a, b) => (b.billing_interval === "4_weeks" ? 1 : 0) - (a.billing_interval === "4_weeks" ? 1 : 0))[0];
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
    // P2b-plus: the enroll link carries ?opp_id=<GHL opportunity id> (set by the
    // closing agent / enroll page). Thread it through Stripe so the webhook can mark
    // the EXACT opportunity WON on payment, and persist it on the member row. Optional
    // — when absent the webhook falls back to the member's open opp by contact.
    const oppId = (body.opp_id || body.opportunity_id || "").toString().trim() || null;
    // Optional future membership start date. Anchors billing when eligible (see the
    // recurringStart block below); otherwise a display/access label.
    const startDate = clampStartDate(body.start_date);

    // Typed-runtime cutover (offer tie-in step E): the stable offer_price_id
    // is the preferred selector; offer_price_key stays supported for the
    // deployed funnel pages. Either way the server resolves TYPED rows below.
    const offerPriceId = (body.offer_price_id || "").toString().trim();

    // ── Validate ──
    if (!clientId) return res.status(400).json({ error: "client_id required" });
    if (!offerId) return res.status(400).json({ error: "offer_id required" });
    if (!priceKey && !offerPriceId) return res.status(400).json({ error: "offer_price_id or offer_price_key required" });
    if (!parentEmail) return res.status(400).json({ error: "parent email required" });
    if (!athleteName) return res.status(400).json({ error: "athlete name required" });
    if (!agreement.signature) return res.status(400).json({ error: "agreement signature required" });

    const testMode = isTestMode();

    // ── Academy must exist + be Stripe-connected ──
    const clientRows = await sb(`clients?id=eq.${encodeURIComponent(clientId)}&select=id,business_name,email,stripe_connect_account_id&limit=1`);
    const client = Array.isArray(clientRows) && clientRows[0];
    if (!client) return res.status(404).json({ error: "academy not found" });
    const stripeAccount = testMode ? null : client.stripe_connect_account_id;
    if (!testMode && !stripeAccount) return res.status(409).json({ error: "academy is not connected to Stripe" });

    // ── Price: resolve through the TYPED runtime rows (offer_prices).
    // Checkout no longer reads pricing_catalog/Blueprint JSON to decide what
    // is sellable: a typed row must be active AND routable, and routable
    // requires a confirmed entitlement rule (offers-sync invariant) - so
    // nothing can be sold that the access/credit engines can't fulfill.
    const typedSelect = "id,title,amount_cents,currency,billing_interval,stripe_price_id,source_offer_id,source_offer_price_key,is_active,is_routable,sort_order";
    let typedRows;
    if (offerPriceId) {
      typedRows = await sb(
        `offer_prices?tenant_id=eq.${encodeURIComponent(clientId)}&id=eq.${encodeURIComponent(offerPriceId)}` +
        `&source_offer_id=eq.${encodeURIComponent(offerId)}&select=${typedSelect}`
      );
    } else {
      typedRows = await sb(
        `offer_prices?tenant_id=eq.${encodeURIComponent(clientId)}&source_offer_id=eq.${encodeURIComponent(offerId)}` +
        `&source_offer_price_key=eq.${encodeURIComponent(priceKey)}&order=sort_order.asc&select=${typedSelect}`
      );
    }
    const price = (Array.isArray(typedRows) ? typedRows : []).find((row) => row.is_active && row.is_routable) || null;
    if (!price || (!testMode && !price.stripe_price_id)) {
      return res.status(409).json({ error: "no routable price for that selection", offer_price_key: priceKey || offerPriceId });
    }
    if (testMode && price.amount_cents == null) {
      return res.status(409).json({ error: "no price amount for that selection (needed for inline test price)", offer_price_key: priceKey || offerPriceId });
    }
    const resolvedPriceKey = priceKey || price.source_offer_price_key || "";
    const term = price.billing_interval || "4_weeks";
    const planText = resolvedPriceKey.split("|")[0] || price.title;

    // ── Optional coupon: validate the promo code + run the $1-floor / percent
    //    guardrail against the SERVER-SIDE plan price. Never trusts a client
    //    amount. Skipped in test mode (inline price; coupons live on the
    //    connected account). Stripe is the final gate at payment. ──
    const couponCode = normCode(body.coupon_code || body.coupon);
    let promo = null, discountInfo = null, couponError = null;
    if (couponCode && !testMode) {
      try {
        const list = await stripeFetch(`/promotion_codes?code=${encodeURIComponent(couponCode)}&limit=1&expand[]=data.promotion.coupon`, { stripeAccount });
        const pc = (list.data || [])[0];
        const nowSec = Math.floor(Date.now() / 1000);
        if (!pc || pc.active === false) couponError = "Code not found";
        else if (pc.expires_at && nowSec > pc.expires_at) couponError = "This code has expired";
        else if (pc.max_redemptions && (pc.times_redeemed || 0) >= pc.max_redemptions) couponError = "This code is fully redeemed";
        else {
          const cp = couponFromPromo(pc);
          const def = cp.percent_off != null
            ? { kind: "Percent off", value: cp.percent_off }
            : { kind: "Dollar off", value: (cp.amount_off || 0) / 100 };
          const chk = price.amount_cents != null ? applyDiscountToCents(def, price.amount_cents) : { ok: false, error: "no price" };
          if (!chk.ok) couponError = chk.error;
          else { promo = pc; discountInfo = { code: couponCode, label: chk.label, discount_cents: chk.discountCents, discounted_cents: chk.discountedCents }; }
        }
      } catch { couponError = "Could not check that code"; }
    }

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
          // If a coupon was entered on a retry and this in-flight sub has no
          // discount yet, apply it now so the first invoice reflects it.
          if (promo && !(Array.isArray(sub.discounts) && sub.discounts.length) && !sub.discount) {
            try { await stripeFetch(`/subscriptions/${sub.id}`, { method: "POST", stripeAccount, body: { "discounts[0][promotion_code]": promo.id } }); } catch { /* non-fatal */ }
          }
          // Persist a start date entered on a retry (member row + Stripe metadata). Non-fatal.
          if (startDate) {
            try { await sb(`members?id=eq.${member.id}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ start_date: startDate, updated_at: nowIso() }) }); } catch { /* non-fatal */ }
            try { await stripeFetch(`/subscriptions/${sub.id}`, { method: "POST", stripeAccount, body: { "metadata[start_date]": startDate } }); } catch { /* non-fatal */ }
          }
          const secret = piSecretFromSub(sub);
          if (secret) {
            await maybeAttachAgreement({ member, client, parentName, athleteName, planText, price, term, agreement, clientId, offerId });
            return res.status(200).json({
              ok: true, reused: true, member_id: member.id, subscription_id: sub.id, customer_id: sub.customer,
              client_secret: secret, stripe_account: stripeAccount, publishable_key: process.env.STRIPE_PUBLISHABLE_KEY || null,
              amount_cents: price.amount_cents, currency: price.currency || "cad", agreement_saved: !!member.agreement_pdf_path,
              discount: discountInfo, coupon_error: couponError, start_date: startDate || member.start_date || null,
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
        idempotencyKey: `web-price-${resolvedPriceKey}-${price.amount_cents}`.slice(0, 200),
        body: { currency: price.currency || "cad", unit_amount: price.amount_cents,
          "recurring[interval]": iv.interval, "recurring[interval_count]": iv.interval_count,
          "product_data[name]": `${resolvedPriceKey} (FC website enrollment test)` },
      });
      priceIdToUse = testPrice.id;
    }

    // ── Commitment terms that revert to monthly: resolve the monthly price now,
    //    stamp it on the sub; webhook.js attaches the schedule after first payment.
    //    Live only (test mode charges an inline price unrelated to the catalog). ──
    const revert = !testMode ? await resolveCommitmentRevert({ clientId, offerId, planText, term }) : null;

    // ── Future start date → charge the first period TODAY + anchor recurring to it ──
    // billing_cycle_anchor can't reach past the first period, so (Stripe's documented
    // pattern) we set trial_end to the recurring-start timestamp and bill the first
    // period now via a one-time add_invoice_items line. Result: paid today, recurring
    // begins on the anchor, then every cycle after. Two shapes:
    //   • Plain (monthly / non-reverting): recurring base = the selected price; charge
    //     one period today; anchor = start + one interval.
    //   • Commitment → monthly (e.g. Steady 3mo → monthly): charge the COMMITTED amount
    //     today, set the recurring base to the MONTHLY revert price, anchor at start +
    //     commitment length. Same access tier (the revert price is routable), and it
    //     sidesteps the webhook's from_subscription schedule (we do NOT stamp
    //     commitment_reverts when anchored) - so no trial-vs-schedule conflict.
    //   • Coupon: a sub-level discount applies to BOTH the one-time line today and the
    //     recurring invoices (verified with Test Clocks - percent + amount off), so a
    //     coupon + future start anchors normally; the discount just carries through. It
    //     can only reduce the charge, never mischarge.
    let recurringStart = null, renewsIso = null, firstPeriod = null, baseItemPrice = priceIdToUse;
    if (startDate) {
      const iv = intervalFor(term); // commitment term → {month, 3|6}; else 4 weeks
      const anchorSec = Math.floor(addInterval(new Date(`${startDate}T12:00:00Z`), iv).getTime() / 1000);
      const floor = Math.floor(Date.now() / 1000) + 60;
      recurringStart = Math.min(Math.max(anchorSec, floor), Math.floor(Date.now() / 1000) + STRIPE_TRIAL_MAX_SECS);
      renewsIso = new Date(recurringStart * 1000).toISOString().slice(0, 10);
      // Charge the SELECTED price today (committed amount for a commitment, else the
      // plan amount). add_invoice_items price_data needs its product + amount.
      const priceObj = await stripeFetch(`/prices/${priceIdToUse}`, { stripeAccount });
      const amt = priceObj && priceObj.unit_amount != null ? priceObj.unit_amount : price.amount_cents;
      if (priceObj && priceObj.product != null && amt != null) {
        firstPeriod = { product: priceObj.product, amount: amt, currency: (priceObj.currency || price.currency || "cad") };
        if (revert) baseItemPrice = revert.revertToPriceId; // recurring base = monthly revert price
      } else {
        recurringStart = null; renewsIso = null; // can't bill upfront safely → charge now, label only
      }
    }

    // ── Portal-owned subscription (default_incomplete → client_secret) ──
    const sub = await stripeFetch(`/subscriptions`, {
      method: "POST", stripeAccount,
      idempotencyKey: `web-sub-${testMode ? "test-" : ""}${clientId}-${parentEmail}-${athleteName}-${resolvedPriceKey}${recurringStart ? `-s${recurringStart}` : ""}`.slice(0, 200),
      body: {
        customer: customerId, "items[0][price]": baseItemPrice,
        payment_behavior: "default_incomplete",
        "payment_settings[save_default_payment_method]": "on_subscription",
        "expand[0]": "latest_invoice.payment_intent",
        "expand[1]": "latest_invoice.confirmation_secret",
        "metadata[origin]": "fullcontrol-website-enrollment",
        "metadata[offer_id]": offerId, "metadata[offer_price_key]": resolvedPriceKey, "metadata[offer_price_id]": price.id,
        "metadata[plan]": planText, "metadata[term]": term,
        "metadata[client_id]": clientId, "metadata[parent_email]": parentEmail, "metadata[athlete_name]": athleteName,
        ...(oppId ? { "metadata[ghl_opportunity_id]": oppId } : {}),
        // Non-anchored commitment → let the webhook attach the from_subscription
        // schedule after payment. Anchored commitment (recurringStart set) already
        // has the monthly price as its base, so DON'T stamp this (no schedule).
        ...(revert && !recurringStart ? { "metadata[commitment_reverts]": "monthly", "metadata[revert_to_price]": revert.revertToPriceId } : {}),
        ...(promo ? { "discounts[0][promotion_code]": promo.id, "metadata[coupon_code]": couponCode } : {}),
        ...(startDate ? { "metadata[start_date]": startDate } : {}),
        // Future start: bill the first period now (add_invoice_items) + defer recurring
        // to the anchor (trial_end). The first invoice still carries a PaymentIntent the
        // card element confirms today. See the recurringStart block above.
        ...(recurringStart ? {
          trial_end: recurringStart,
          "metadata[first_recurring_date]": renewsIso,
          // Anchored commitment: committed amount paid today, base price is monthly.
          // Record the term they bought so the mismatch is self-explanatory.
          ...(revert ? { "metadata[commitment_prepaid_term]": term } : {}),
          "add_invoice_items[0][price_data][currency]": firstPeriod.currency,
          "add_invoice_items[0][price_data][product]": firstPeriod.product,
          "add_invoice_items[0][price_data][unit_amount]": firstPeriod.amount,
        } : {}),
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
    // Only stamp the opp link when we have one — never null out an existing link on a retry.
    if (oppId) memberFields.ghl_opportunity_id = oppId;
    // Chosen future start date. Drives billing when eligible (recurringStart set →
    // charged today, recurring anchored to start+interval); else a display/access label.
    // Only set when present so a retry without it doesn't wipe a previously-chosen date.
    if (startDate) memberFields.start_date = startDate;
    if (member) {
      await sb(`members?id=eq.${member.id}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify(memberFields) });
    } else {
      memberFields.joined_date = new Date().toISOString().slice(0, 10);
      memberFields.created_at = nowIso();
      const inserted = await sb(`members?select=id,agreement_pdf_path`, { method: "POST", headers: { Prefer: "return=representation" }, body: JSON.stringify([memberFields]) });
      member = Array.isArray(inserted) && inserted[0] ? inserted[0] : null;
    }

    // ── Signed agreement PDF (best-effort: never block the payment setup) ──
    const agreementSaved = await maybeAttachAgreement({ member, client, parentName, athleteName, planText, price, term, agreement, clientId, offerId });

    // Audit (non-fatal) — also stashes the step-1 intake answers.
    try {
      await sb(`member_audit_log`, {
        method: "POST", headers: { Prefer: "return=minimal" },
        body: JSON.stringify([{
          client_id: clientId, member_id: member && member.id,
          action_type: "website-enrollment-checkout-created",
          args: { offer_id: offerId, offer_price_key: resolvedPriceKey, offer_price_id: price.id, plan: planText, term, sub_id: sub.id, customer_id: customerId, intake, agreement_saved: agreementSaved, coupon: discountInfo || (couponError ? { error: couponError } : null), start_date: startDate, first_recurring_date: renewsIso },
          performed_by_name: "Website enrollment funnel (public)",
        }]),
      });
    } catch { /* non-fatal */ }

    // Persist the enroll intake custom-field answers onto the member's portal
    // contact (best-effort, after payment setup - never blocks the charge).
    // Mirrors the lead form's write loop: mint/find the portal contact, then
    // writePortalFieldValues matches each intake key to a custom_field_defs row
    // by its portal key (captures brand-new wizard questions with no ghl id).
    try {
      if (intake && Object.keys(intake).length) {
        const contactId = await resolveOrMintPortalContact(clientId, { email: parentEmail, phone: parentPhone, name: parentName });
        if (contactId) await writePortalFieldValues(clientId, contactId, null, intake);
      }
    } catch { /* non-fatal - the member + payment are already saved */ }

    return res.status(200).json({
      ok: true, member_id: member && member.id, subscription_id: sub.id, customer_id: customerId,
      client_secret: clientSecret, stripe_account: stripeAccount, publishable_key: process.env.STRIPE_PUBLISHABLE_KEY || null,
      amount_cents: price.amount_cents, currency: price.currency || "cad", agreement_saved: agreementSaved,
      discount: discountInfo, coupon_error: couponError, start_date: startDate, first_recurring_date: renewsIso,
    });
  } catch (e) {
    return res.status(e.stripeStatus || e.status || 500).json({ error: e.message || String(e) });
  }
}

// Render + store the signed PDF and link it on the member. Returns true on
// success; never throws (the payment flow must not depend on it).
async function maybeAttachAgreement({ member, client, parentName, athleteName, planText, price, term, agreement, clientId, offerId }) {
  if (!member || !member.id) return false;
  if (member.agreement_pdf_path) return true; // already signed/stored
  try {
    // If the offer has a Policy section filled in, generate the clauses from
    // its hard rules (pause / cancellation / refund). No policy set -> pass no
    // clauses, so renderAgreementPdf keeps the legacy wording unchanged.
    let clauses = null;
    if (offerId) {
      try {
        const offerRows = await sb(`offers?id=eq.${encodeURIComponent(offerId)}&select=data&limit=1`);
        const policy = Array.isArray(offerRows) && offerRows[0] && offerRows[0].data && offerRows[0].data.policy;
        if (policy && typeof policy === "object" && Object.keys(policy).length) {
          clauses = buildClauses({
            academyName: client.business_name || "By Any Means",
            cancelContact: client.email || "",
            policy,
          });
        }
      } catch { /* non-fatal - fall back to legacy clauses */ }
    }
    const bytes = await renderAgreementPdf({
      academyName: client.business_name || "By Any Means",
      parentName, athleteName, planLabel: planText,
      priceText: `${money(price.amount_cents, price.currency)} ${TERM_NOUN[term] || ""}`.trim(),
      signaturePngDataUrl: agreement.signature,
      signedAtIso: agreement.signed_at || nowIso(),
      clauses,
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
