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
import { renderAgreementPdf, uploadAgreementPdf, uploadSignaturePng, buildClauses } from "../_lib/agreement-pdf.js";
import { requiredConsentKeys } from "../_lib/agreement-version.js";
import { applyDiscountToCents, normCode, couponFromPromo, couponCoversKey } from "../_coupon-guardrails.js";
import { resolveOrMintPortalContact, writePortalFieldValues, ensureStorageOnlyDefs } from "../_contacts.js";
import { stripeFetch as transportStripeFetch, publishableFor } from "../_stripe-transport.js";
import { isOnboardingTestMode, onboardingKeyOverride } from "../_stripe-onboarding-key.js";
import { assertHeaderSafeCredential, safeFetch } from "../_header-safe-credential.js";

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

// The service key is guarded and the fetch is sanitised for the SAME reason the
// Stripe half of this file is: this handler's catch echoes e.message into the
// response body. A service-role key with a leading break makes undici throw a
// TypeError quoting the whole Authorization header, and that key bypasses RLS.
function sbKey() {
  return assertHeaderSafeCredential(SB_KEY, "the Supabase service key (SUPABASE_SERVICE_ROLE_KEY)");
}

async function sb(path, init = {}) {
  const key = sbKey();
  const res = await safeFetch(`${SB_URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: key, Authorization: `Bearer ${key}`,
      "Content-Type": "application/json", ...(init.headers || {}),
    },
  }, "Supabase");
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
// The mode decision and the credential are ONE reading of the env var (see
// api/_stripe-onboarding-key.js). Judging the raw value here while the transport
// authenticated with the trimmed one meant a leading space made this return
// false on an sk_test key: live branches, test money.
function isTestMode() { return isOnboardingTestMode(); }
function intervalFor(term) {
  if (term === "3_months") return { interval: "month", interval_count: 3 };
  if (term === "6_months") return { interval: "month", interval_count: 6 };
  return { interval: "week", interval_count: 4 };
}

// ── Billing CADENCE: how a price actually re-bills ──────────────────────────
//
// The term key (4_weeks / 3_months / 6_months) is the COMMITMENT'S IDENTITY and
// nothing here changes what it means: it is what offer_price_key joins on, what
// the agreement PDF's term noun reads, and what the revert logic gates on.
// Cadence is a second, explicit, NULLABLE field on the offer_prices row that
// says how the money actually recurs, because one 3-month commitment can
// legitimately bill per calendar quarter (BAM GTA, live today) and another can
// bill per 12 weeks (San Jose, ruled 2026-07-30) while both are "3 months" to
// the parent.
//
// WHY IT CANNOT COME FROM THE COMMITMENT TEXT. Prod carries both notations for
// the same thing: GTA's archived tiers say "12 Weeks (3 Months)" and San Jose
// says "3 Months (12 Weeks)". Both match /(\d+)\s*month/ AND /12\s*week/, so
// free text cannot express the distinction at all. termFromLength and
// lengthMatchesTerm are deliberately left alone; the cadence is DATA, not prose.
//
// NULL, absent, or unrecognized cadence resolves to intervalFor(term) - byte for
// byte the behavior every live academy has today.
const CADENCES = {
  "4_weeks": { interval: "week", interval_count: 4 },
  monthly: { interval: "month", interval_count: 1 },
  "12_weeks": { interval: "week", interval_count: 12 },
  "24_weeks": { interval: "week", interval_count: 24 },
  "3_calendar_months": { interval: "month", interval_count: 3 },
  "6_calendar_months": { interval: "month", interval_count: 6 },
};

// The ONE place a billing interval is decided. Every caller goes through here so
// a cadence cannot be honored on one code path and ignored on another.
// Returns the Stripe recurring shape plus:
//   cadence          - the recognized cadence that shaped it, else null (legacy)
//   unknown_cadence  - a value the row carried that this build does not know.
//                      We bill the LEGACY shape and report it, the same non-fatal
//                      posture as the sign-up fee lookup: an enrollment is never
//                      blocked over it, and it never silently invents a cadence.
function resolveInterval(row, term) {
  const raw = row && typeof row === "object" && row.billing_cadence != null
    ? String(row.billing_cadence).trim().toLowerCase()
    : "";
  if (raw && Object.prototype.hasOwnProperty.call(CADENCES, raw)) {
    return { ...CADENCES[raw], cadence: raw, unknown_cadence: null };
  }
  return { ...intervalFor(term), cadence: null, unknown_cadence: raw || null };
}

// The admin-facing note for a cadence this build does not know. Non-fatal by
// construction: it rides the 200 alongside coupon_error rather than turning a
// paid enrollment into an error the parent has to read.
function cadenceWarning(iv) {
  if (!iv || !iv.unknown_cadence) return null;
  return `This price is set to bill "${iv.unknown_cadence}", which this build does not recognize. It was billed on the standard schedule for its term instead. Check the price row in the portal.`;
}

// offer_prices.billing_cadence ships AHEAD of its migration (see
// supabase/migrations/20260730T230000_offer_prices_billing_cadence.sql and the
// PENDING_SQL ledger). PostgREST 400s the WHOLE select over one unknown column,
// and these selects ARE the enrollment path, so ask for the column and, on the
// one error that means "not migrated yet", ask again without it. What comes back
// is a row with no billing_cadence key, which is exactly the legacy state
// resolveInterval already handles. Narrow on purpose: a 5xx or any other 400
// still throws, because degrading past a real outage would bill the wrong shape
// quietly.
const CADENCE_COL = "billing_cadence";
async function sbWithCadence(pathFor) {
  try {
    return await sb(pathFor(true));
  } catch (e) {
    const msg = String((e && e.message) || e || "");
    if (!/42703|does not exist/i.test(msg) || !msg.includes(CADENCE_COL)) throw e;
    console.warn(`[website/checkout] offer_prices.${CADENCE_COL} is not in the schema yet (migration pending) - re-reading without it`);
    return await sb(pathFor(false));
  }
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
  // Delegates to THE seam (api/_stripe-transport.js). ONBOARDING_STRIPE_SECRET_KEY
  // keeps today's precedence exactly - when set (the test sandbox) it overrides
  // transport resolution, which is what stripeKey() always did here. The override
  // is the SAME normalized string isTestMode() judged, so the mode the route
  // believes it is in and the key it authenticates with cannot disagree.
  return transportStripeFetch(path, {
    method, body, stripeAccount, idempotencyKey,
    keyOverride: onboardingKeyOverride(),
  });
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
// Does the option the parent picked actually charge this plan's sign-up fee?
// Charge/waive is an explicit owner choice per option (Zoran: "not by default,
// i want to set it"), so anything unanswered returns false and nothing extra is
// billed. Reads the offer, never the browser.
async function signupFeeAppliesTo({ clientId, offerId, planText, term }) {
  const rows = await sb(
    `offers?id=eq.${encodeURIComponent(offerId)}&client_id=eq.${encodeURIComponent(clientId)}&select=data&limit=1`
  );
  const data = Array.isArray(rows) && rows[0] && rows[0].data;
  const offerings = (data && data.pricing && data.pricing.pricing_offerings) || [];
  const off = offerings.find((o) => o && String(o.title || "").trim() === String(planText || "").trim());
  if (!off) return false;
  const amt = parseFloat(off.signup_fee);
  if (!(amt > 0)) return false;
  const charge = (v) => String(v || "").toLowerCase() === "charge";
  if (term === "4_weeks") return charge(off.signup_fee_on_base);
  const c = (off.commitments || []).find((x) => x && intervalFor(_termKeyFromLength(x.length)) && _termKeyFromLength(x.length) === term);
  return !!c && charge(c.signup_fee_charge);
}

// Free-text commitment length -> the term key used in offer_price_key.
// Mirrors termFromLength in api/website/offer.js and api/agent/fact-render.js.
function _termKeyFromLength(length) {
  const l = String(length || "").toLowerCase();
  const m = l.match(/(\d+)\s*month/);
  if (m) { const n = +m[1]; if (n >= 6) return "6_months"; if (n >= 3) return "3_months"; }
  if (/24\s*week/.test(l)) return "6_months";
  if (/12\s*week/.test(l)) return "3_months";
  return null;
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
    monthlyRows = await sbWithCadence((withCadence) =>
      `offer_prices?tenant_id=eq.${encodeURIComponent(clientId)}&source_offer_id=eq.${encodeURIComponent(offerId)}` +
      `&source_offer_price_key=eq.${encodeURIComponent(planText + "|monthly")}&is_routable=eq.true&is_active=eq.true` +
      `&select=stripe_price_id,billing_interval${withCadence ? `,${CADENCE_COL}` : ""}`
    );
  } catch { return null; }
  const monthly = (Array.isArray(monthlyRows) ? monthlyRows : [])
    .filter((r) => r.stripe_price_id)
    .sort((a, b) => (b.billing_interval === "4_weeks" ? 1 : 0) - (a.billing_interval === "4_weeks" ? 1 : 0))[0];
  if (!monthly || !monthly.stripe_price_id) return null;
  // The revert price's OWN cadence, resolved through the same door as the
  // commitment's. It is reported rather than acted on here: the revert price is
  // charged by Stripe on its own schedule (plain sub) or as the base item of an
  // anchored sub, so what this endpoint owes it is visibility, not arithmetic.
  const revertIv = resolveInterval(monthly, "4_weeks");
  return {
    revertToPriceId: monthly.stripe_price_id,
    revertCadence: revertIv.cadence,
    revertUnknownCadence: revertIv.unknown_cadence,
  };
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
    // The enroll link also carries ?contact_id=<GHL contact id>. Persisting it on
    // the member row lets the pipeline drawer + Hawkeye show "enroll form filled"
    // on the LEAD while they sit unpaid in Done Trial.
    const ghlContactId = (body.contact_id || body.ghl_contact_id || "").toString().trim() || null;
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

    // ── The agreement they signed ──
    // Resolved BEFORE anything is charged, so a document we cannot identify
    // stops the enrollment instead of taking money and filing the wrong terms.
    //
    // agreement.version_id is sent by funnels running the terms-document engine.
    // Older deployed funnels do not send it; those fall through to the legacy
    // clause rendering (see maybeAttachAgreement) so live academies keep working
    // until their site redeploys.
    let signedDoc = null;
    if (agreement.version_id) {
      const docRows = await sb(
        `agreement_documents?client_id=eq.${encodeURIComponent(clientId)}` +
        `&version_id=eq.${encodeURIComponent(agreement.version_id)}` +
        `&select=id,doc_id,version_id,revision,terms&limit=1`
      );
      signedDoc = Array.isArray(docRows) && docRows[0];
      if (!signedDoc) {
        // The site is serving wording that was never published, so we have no
        // trustworthy copy of what this parent just read. Do not charge.
        return res.status(409).json({
          error: "This agreement was updated. Please refresh the page and read it again before signing.",
          code: "agreement_version_not_published",
        });
      }
      // Every opt-in the document marks required has to have an answer.
      const picks = (agreement.consents && typeof agreement.consents === "object") ? agreement.consents : {};
      const missing = requiredConsentKeys(signedDoc.terms).filter((k) => !picks[k]);
      if (missing.length) {
        return res.status(400).json({
          error: "Please answer every choice in the agreement before signing.",
          code: "agreement_consent_missing",
          missing,
        });
      }
    }

    // ── Academy must exist + be Stripe-connected ──
    // Three-outcome money gate (house rule 10): a clients read that THREW is
    // "could not ask", never "not connected" - it gets a retryable 503, and the
    // 409 below stays reserved for a row that actually answered without an account.
    let clientRows;
    try {
      clientRows = await sb(`clients?id=eq.${encodeURIComponent(clientId)}&select=id,business_name,email,stripe_connect_account_id&limit=1`);
    } catch {
      return res.status(503).json({ error: "could not verify billing setup, try again" });
    }
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
    // The plan select asks for billing_cadence too, through the pending-column
    // retry above. The SIGN-UP FEE select below deliberately does not: a fee is a
    // one-time price, cadence means nothing to it, and its lookup lives inside a
    // catch that silently drops the fee - so a column that is not migrated yet
    // must not be able to reach it.
    const typedSelectFor = (withCadence) => (withCadence ? `${typedSelect},${CADENCE_COL}` : typedSelect);
    let typedRows;
    if (offerPriceId) {
      typedRows = await sbWithCadence((withCadence) =>
        `offer_prices?tenant_id=eq.${encodeURIComponent(clientId)}&id=eq.${encodeURIComponent(offerPriceId)}` +
        `&source_offer_id=eq.${encodeURIComponent(offerId)}&select=${typedSelectFor(withCadence)}`
      );
    } else {
      typedRows = await sbWithCadence((withCadence) =>
        `offer_prices?tenant_id=eq.${encodeURIComponent(clientId)}&source_offer_id=eq.${encodeURIComponent(offerId)}` +
        `&source_offer_price_key=eq.${encodeURIComponent(priceKey)}&order=sort_order.asc&select=${typedSelectFor(withCadence)}`
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
    // How this row actually re-bills. Resolved ONCE, here, and reused by every
    // interval decision below (test price, anchor math, metadata) so the Stripe
    // price and the anchor can never disagree with each other.
    const cadenceIv = resolveInterval(price, term);
    if (cadenceIv.unknown_cadence) {
      console.warn(`[website/checkout] offer_prices.${CADENCE_COL} "${cadenceIv.unknown_cadence}" is not a cadence this build knows (price ${price.id}) - billing the ${term} shape instead`);
    }

    // ── One-time SIGN-UP FEE (Build S) ───────────────────────────────────
    // Resolved SERVER-SIDE from the catalog, exactly like the plan price: a
    // `<plan>|signup_fee` row, and only when the chosen option is marked
    // "Charge" in the offer. Never trusts anything the browser sent.
    //
    // Guards, in order of how badly each would hurt:
    //   1. A fee is NEVER sellable alone - refuse a checkout whose selected
    //      price IS the fee row.
    //   2. It rides ENROLLMENT ONLY. This endpoint is the enrollment path; the
    //      reuse branches above return before here, so a retry on an existing
    //      in-flight subscription cannot re-add it, and no admin/plan-change
    //      path touches this code at all (logic scan #2).
    //   3. Explicit per-option choice. Unanswered = not charged.
    if (String(resolvedPriceKey).split("|")[1] === "signup_fee") {
      return res.status(400).json({ error: "a sign-up fee cannot be purchased on its own" });
    }
    let signupFee = null;
    if (!testMode) {
      try {
        const chargesFee = await signupFeeAppliesTo({ clientId, offerId, planText, term });
        if (chargesFee) {
          const feeRows = await sb(
            `offer_prices?tenant_id=eq.${encodeURIComponent(clientId)}&source_offer_id=eq.${encodeURIComponent(offerId)}` +
            `&source_offer_price_key=eq.${encodeURIComponent(planText + "|signup_fee")}` +
            `&is_active=eq.true&is_routable=eq.true&limit=1&select=${typedSelect}`
          );
          const f = Array.isArray(feeRows) && feeRows[0];
          if (f && f.stripe_price_id && f.amount_cents > 0) signupFee = f;
        }
      } catch (_) { signupFee = null; }  // never block an enrollment over the fee lookup
    }

    // ── Optional coupon: validate the promo code + run the $1-floor / percent
    //    guardrail against the SERVER-SIDE plan price. Never trusts a client
    //    amount. Skipped in test mode (inline price; coupons live on the
    //    connected account). Stripe is the final gate at payment. ──
    const couponCode = normCode(body.coupon_code || body.coupon);
    let promo = null, discountInfo = null, couponError = null;
    // Build C: is the LIVE Stripe coupon actually product-restricted? The
    // portal's applies_to list is only a declaration; Stripe enforces nothing
    // until the code is (re)created with applies_to[products]. Read from the
    // live object so we never trust config over what Stripe will really do.
    let liveCouponRestricted = false;
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
          const at = cp && cp.applies_to;
          liveCouponRestricted = !!(at && Array.isArray(at.products) && at.products.length);
          const def = cp.percent_off != null
            ? { kind: "Percent off", value: cp.percent_off }
            : { kind: "Dollar off", value: (cp.amount_off || 0) / 100 };
          const chk = price.amount_cents != null ? applyDiscountToCents(def, price.amount_cents) : { ok: false, error: "no price" };
          if (!chk.ok) couponError = chk.error;
          else { promo = pc; discountInfo = { code: couponCode, label: chk.label, discount_cents: chk.discountCents, discounted_cents: chk.discountedCents }; }
        }
      } catch { couponError = "Could not check that code"; }
    }

    // Build C: does the entered code cover the SIGN-UP FEE line? Placed after
    // the coupon block because it needs the resolved couponCode. An
    // unrestricted code (nothing ticked) covers everything, which is how every
    // code behaved before Build C; an unknown/unreadable definition means we do
    // NOT discount the fee, because over-charging a fee is recoverable and
    // silently under-charging it is not visible to anyone.
    let feeIsDiscountable = false;
    if (signupFee && promo) {
      try {
        const cRows = await sb(`offers?id=eq.${encodeURIComponent(offerId)}&client_id=eq.${encodeURIComponent(clientId)}&select=data&limit=1`);
        const defs = ((Array.isArray(cRows) && cRows[0] && cRows[0].data && cRows[0].data.pricing && cRows[0].data.pricing.discount_codes) || []);
        const def = defs.find(d => d && normCode(d.code) === couponCode);
        feeIsDiscountable = def ? couponCoversKey(def, `${planText}|signup_fee`) : true;
      } catch (_) { feeIsDiscountable = false; }

      // THE ENFORCEMENT GAP. If the config says this code must NOT touch the
      // fee, but the live Stripe coupon carries no product restriction, then
      // Stripe will discount every line on the first invoice, the fee
      // included, and nothing we do at the line level prevents it. Rather than
      // charge a number the config contradicts, drop the fee from this
      // enrollment and say so loudly. Recreating the code in the portal (which
      // mints a restricted coupon) closes it permanently.
      if (!feeIsDiscountable && !liveCouponRestricted) {
        console.warn(`[signup-fee] dropped for ${planText}: code ${couponCode} is unrestricted in Stripe, so it would also discount the fee. Recreate the code with an "applies to" list.`);
        signupFee = null;
      }
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
            await maybeAttachAgreement({ member, client, parentName, athleteName, planText, price, term, agreement, clientId, offerId, signedDoc });
            // What Stripe.js mounts with is a per-transport fact - ask the resolver.
            // Connect academies get the platform publishable key + account id,
            // byte-identical to before; a direct academy gets its own key, no account.
            // A resolver hiccup must not 500 a checkout whose subscription already
            // exists - fall back to the Connect answer this site always returned.
            const pub = await publishableFor(stripeAccount).catch(() => ({ publishable_key: process.env.STRIPE_PUBLISHABLE_KEY || null, stripe_account: stripeAccount || null }));
            return res.status(200).json({
              ok: true, reused: true, member_id: member.id, subscription_id: sub.id, customer_id: sub.customer,
              client_secret: secret, stripe_account: pub.stripe_account, publishable_key: pub.publishable_key,
              amount_cents: price.amount_cents, currency: price.currency || "cad", agreement_saved: !!member.agreement_pdf_path,
              discount: discountInfo, coupon_error: couponError, start_date: startDate || member.start_date || null,
              billing_cadence: cadenceIv.cadence, cadence_warning: cadenceWarning(cadenceIv),
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
      // The row's cadence when it has one, else exactly the legacy term shape.
      const iv = cadenceIv;
      const testPrice = await stripeFetch(`/prices`, {
        method: "POST", stripeAccount,
        // The cadence joins the idempotency key ONLY when the row carries one.
        // Without it, a row whose cadence changed would get Stripe's cached price
        // back at the OLD interval and bill on the wrong clock with no error at
        // all. A row with no cadence keeps byte-identical keys to today.
        idempotencyKey: `web-price-${resolvedPriceKey}-${price.amount_cents}${cadenceIv.cadence ? `-${cadenceIv.cadence}` : ""}`.slice(0, 200),
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
    //
    // The date computed below (renewsIso) is the first recurring charge, and a
    // cadence can move it: a 12-week commitment anchors 84 days out where a
    // 3-calendar-month one lands on the calendar date. The natural next build is
    // an email telling the parent the new date. Deliberately absent - Zoran ruled
    // 2026-07-30: staff handles this personally. Do not add.
    let recurringStart = null, renewsIso = null, firstPeriod = null, baseItemPrice = priceIdToUse;
    if (startDate) {
      // The row's cadence when it has one (a 12_weeks commitment anchors +84 days,
      // not +3 calendar months), else exactly intervalFor(term): commitment term ->
      // {month, 3|6}; else 4 weeks.
      const iv = cadenceIv;
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
        // The cadence that shaped the billing, stamped only when the row named
        // one. Term stays the commitment's identity; this is the clock it runs on,
        // and it belongs in Stripe so a refund or a dispute can be read without
        // the database.
        ...(cadenceIv.cadence ? { "metadata[billing_cadence]": cadenceIv.cadence } : {}),
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
        // Build S: the one-time sign-up fee, as its own first-invoice line.
        // Index 1 when a future start already used index 0, else index 0 - the
        // two coexist by design (Stripe's add_invoice_items is a list, and a
        // one-time charge on the first invoice is Stripe's own documented
        // pattern for signup fees). It rides its OWN Stripe price, so it has a
        // distinct product that Build C's coupon checklist can target or skip.
        // Renewal invoices never include it.
        ...(signupFee ? {
          [`add_invoice_items[${recurringStart ? 1 : 0}][price]`]: signupFee.stripe_price_id,
          "metadata[signup_fee_cents]": signupFee.amount_cents,
          "metadata[signup_fee_price]": signupFee.stripe_price_id,
          // Build C: the fee line's discount is an EXPLICIT decision, never a
          // cascade. Stripe lets a discount ride one invoice item directly
          // (add_invoice_items[i][discounts]), so when the owner's checklist
          // covers the fee we attach the promo to the fee line ourselves; when
          // it does not, the line simply carries none. That removes the only
          // documented-silent interaction (whether a subscription-level coupon
          // reaches invoice-item lines) from the money path entirely.
          ...(promo && feeIsDiscountable ? {
            [`add_invoice_items[${recurringStart ? 1 : 0}][discounts][0][promotion_code]`]: promo.id,
          } : {}),
        } : {}),
      },
    });
    const clientSecret = piSecretFromSub(sub);

    // ── Upsert the member (stays payment_method_required until paid) ──
    const memberFields = {
      client_id: clientId, athlete_name: athleteName, parent_name: parentName,
      parent_email: parentEmail, parent_phone: parentPhone, plan: planText,
      // signup_origin keeps this pre-payment shell OFF the members roster - the
      // person stays a lead in the pipeline until the webhook flips them live.
      status: "payment_method_required", signup_origin: "website_enroll", stripe_customer_id: customerId,
      stripe_subscription_id: sub.id, stripe_price_id: price.stripe_price_id, updated_at: nowIso(),
    };
    // Only stamp the opp/contact links when we have them — never null out an existing link on a retry.
    if (oppId) memberFields.ghl_opportunity_id = oppId;
    if (ghlContactId) memberFields.ghl_contact_id = ghlContactId;
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
    const agreementSaved = await maybeAttachAgreement({ member, client, parentName, athleteName, planText, price, term, agreement, clientId, offerId, signedDoc });

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
      // The form asks for the athlete's name in its own core block, so the
      // academy's athlete_first_name / athlete_last_name fields are hidden
      // there. Fill them from the core answer instead, or an enroll-only
      // parent would have those contact fields blank (the free-trial form
      // fills them; a parent who skips the trial never hits it). No-ops for an
      // academy without those defs. intake wins if it did send them.
      const fieldValues = { athlete_first_name: athlete.first, athlete_last_name: athlete.last, ...intake };
      if (Object.values(fieldValues).some((v) => String(v || "").trim())) {
        // The emergency contact is a CODE block on the enroll form, not a def,
        // so no academy had a row for it and every answer this form REQUIRED
        // was written to nothing. Mint the storage-only defs before the write so
        // the answer has somewhere to land - idempotent, so on every enrollment
        // after the first (and after the backfill migration) this is a no-op
        // insert that changes nothing. It runs BEFORE writePortalFieldValues on
        // purpose: that function resolves keys against the defs that exist at
        // the moment it reads them, so minting after it would store nothing
        // until the NEXT enrollment.
        await ensureStorageOnlyDefs(clientId);
        // athlete_name is what lets the phone (household) match tell "the other
        // parent of the same kid" from "a sibling on the same number".
        const contactId = await resolveOrMintPortalContact(clientId, { email: parentEmail, phone: parentPhone, name: parentName, athlete_name: athleteName });
        if (contactId) await writePortalFieldValues(clientId, contactId, null, fieldValues);
      }
    } catch { /* non-fatal - the member + payment are already saved */ }

    // Per-transport fact, from the resolver (see the reuse-branch note above),
    // with the same no-500-after-the-sub-exists fallback.
    const pub = await publishableFor(stripeAccount).catch(() => ({ publishable_key: process.env.STRIPE_PUBLISHABLE_KEY || null, stripe_account: stripeAccount || null }));
    return res.status(200).json({
      ok: true, member_id: member && member.id, subscription_id: sub.id, customer_id: customerId,
      client_secret: clientSecret, stripe_account: pub.stripe_account, publishable_key: pub.publishable_key,
      amount_cents: price.amount_cents, currency: price.currency || "cad", agreement_saved: agreementSaved,
      discount: discountInfo, coupon_error: couponError, start_date: startDate, first_recurring_date: renewsIso,
      // Build S: what the parent is charged TODAY vs every cycle after, so the
      // funnel can itemize it before they confirm instead of after.
      signup_fee_cents: signupFee ? signupFee.amount_cents : null,
      due_today_cents: (price.amount_cents || 0) + (signupFee ? signupFee.amount_cents : 0),
      // The cadence this enrollment was billed on (null = the legacy term shape),
      // plus a non-fatal admin note when the row named a cadence this build does
      // not know. The enrollment still went through on the legacy shape; the note
      // is how that becomes visible instead of invisible.
      billing_cadence: cadenceIv.cadence, cadence_warning: cadenceWarning(cadenceIv),
    });
  } catch (e) {
    return res.status(e.stripeStatus || e.status || 500).json({ error: e.message || String(e) });
  }
}

// Render + store the signed PDF and link it on the member. Returns true on
// success; never throws (the payment flow must not depend on it).
// Assemble and file the signed agreement: the terms the parent actually read,
// their filled-in data, their opt-in choices, the signature, the date and the
// version id - as one PDF plus a member_agreements row.
//
// `signedDoc` is the published terms document matching the version the browser
// displayed (resolved in the handler, before any charge). When it is null the
// funnel is an older deployment that does not send a version; we fall back to
// the legacy clause rendering so live academies keep working, and the record is
// marked so those enrollments are identifiable.
async function maybeAttachAgreement({ member, client, parentName, athleteName, planText, price, term, agreement, clientId, offerId, signedDoc }) {
  if (!member || !member.id) return false;
  if (member.agreement_pdf_path) return true; // already signed/stored
  try {
    const signedAt = agreement.signed_at || nowIso();
    const consents = (agreement.consents && typeof agreement.consents === "object") ? agreement.consents : {};
    const filled = (agreement.filled && typeof agreement.filled === "object") ? agreement.filled : {};

    // LEGACY ONLY: no published terms means an old funnel. Build the clauses the
    // way we used to, from the offer's Policy section when it has one.
    let clauses = null;
    if (!signedDoc && offerId) {
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
      signedAtIso: signedAt,
      terms: signedDoc ? signedDoc.terms : null,
      filled: signedDoc ? filled : null,
      consents: signedDoc ? consents : null,
      versionId: signedDoc ? signedDoc.version_id : null,
      clauses,
    });
    const { path, size } = await uploadAgreementPdf({ sbUrl: SB_URL, sbKey: SB_KEY, clientId, memberId: member.id, bytes });

    // Keep the drawn signature as its own file too, so it survives independently
    // of the rendered document.
    let signaturePath = null;
    try {
      signaturePath = await uploadSignaturePng({ sbUrl: SB_URL, sbKey: SB_KEY, clientId, memberId: member.id, dataUrl: agreement.signature });
    } catch { /* non-fatal - the signature is embedded in the PDF as well */ }

    // Record it as a member document (kind 'waiver') so it lists in the staff
    // member popup alongside any manual uploads, with a signed date.
    await sb(`member_files`, {
      method: "POST", headers: { Prefer: "return=minimal" },
      body: JSON.stringify([{
        member_id: member.id, client_id: clientId, kind: "waiver",
        filename: "enrollment-agreement.pdf", storage_path: path,
        mime_type: "application/pdf", size_bytes: size,
        signed_at: signedAt,
        metadata: {
          source: "website-enrollment",
          agreement_version_id: signedDoc ? signedDoc.version_id : null,
          consents,
        },
      }]),
    });

    // The signed record itself: which version, the choices, the filled data.
    try {
      await sb(`member_agreements`, {
        method: "POST", headers: { Prefer: "return=minimal" },
        body: JSON.stringify([{
          member_id: member.id,
          client_id: clientId,
          agreement_document_id: signedDoc ? signedDoc.id : null,
          doc_id: signedDoc ? signedDoc.doc_id : null,
          // Legacy funnels have no version; mark them so they are findable.
          version_id: signedDoc ? signedDoc.version_id : "legacy-unversioned",
          signed_at: signedAt,
          signature_path: signaturePath,
          pdf_path: path,
          consents,
          filled,
          client_version_id: agreement.version_id || null,
          version_matched: signedDoc ? true : null,
          source: "website-enrollment",
        }]),
      });
    } catch { /* non-fatal - the PDF + member_files row are already stored */ }

    // Denormalized flag on the member (also gates re-generation on retries).
    await sb(`members?id=eq.${member.id}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ agreement_pdf_path: path, updated_at: nowIso() }) });
    member.agreement_pdf_path = path;
    return true;
  } catch { return false; }
}

export default withSentryApiRoute(handler);
