import { withSentryApiRoute } from "../_sentry.js";
// Vercel Serverless Function — Parent payment funnel, step 3 (PUBLIC)
//
// Creates a PORTAL-OWNED Stripe subscription (so the academy's billing buttons —
// pause/cancel/refund — work) on the academy's CONNECTED account, and returns a
// PaymentIntent client_secret for the front end to confirm with the Stripe.js
// Payment Element. See memories/project_parent_payment_funnel.md for the full flow.
//
// PUBLIC (the parent is not a logged-in user). Hardened by:
//   • the PRICE is looked up server-side from pricing_catalog — the client NEVER
//     sends an amount/price, so it can't be tampered with.
//   • client_id is validated against a real, Stripe-connected academy.
//   • idempotent on (client_id, parent_email, athlete_name): a refresh/retry
//     returns the SAME incomplete sub's client_secret instead of duplicating.
//
// What happens next: the parent confirms the card client-side → Stripe fires
// invoice.paid → api/stripe/webhook.js flips the member to `live` and fires
// fireOnboardingActivations() (GHL webhook + CoachIQ). This endpoint only sets
// things up; it never marks anyone live.

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
const STRIPE_API = "https://api.stripe.com/v1";

// Accept canonical plan keys directly, plus a few friendly aliases the funnel UI
// might send. Canonical values must match pricing_catalog.canonical_plan.
const PLAN_ALIASES = {
  "1/wk": "1/wk", "1x": "1/wk", "1xwk": "1/wk", "steady": "1/wk",
  "2/wk": "2/wk", "2x": "2/wk", "2xwk": "2/wk", "accelerated": "2/wk",
  "3/wk": "3/wk", "3x": "3/wk", "3xwk": "3/wk", "elevate": "3/wk",
  "unlmtd": "unlmtd", "unlimited": "unlmtd", "dominate": "unlmtd",
};
// pricing_catalog.interval values
const TERM_ALIASES = {
  "4_weeks": "4_weeks", "monthly": "4_weeks", "month": "4_weeks", "1_month": "4_weeks",
  "3_months": "3_months", "3mo": "3_months", "3_month": "3_months",
  "6_months": "6_months", "6mo": "6_months", "6_month": "6_months",
};

function nowIso() { return new Date().toISOString(); }
function norm(s) { return (s || "").toString().trim().toLowerCase(); }

async function sb(path, init = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: SUPABASE_SERVICE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
  });
  if (!res.ok) throw new Error(`Supabase ${res.status}: ${await res.text()}`);
  const txt = await res.text();
  return txt ? JSON.parse(txt) : null;
}

// TEST SANDBOX: if ONBOARDING_STRIPE_SECRET_KEY is set to a test key (sk_test_…),
// onboarding runs in Stripe TEST mode WITHOUT disturbing the rest of the portal
// (which keeps using the live STRIPE_CONNECT_SECRET_KEY). In test mode we charge on
// the platform test account (no Stripe-Account header) and build the price INLINE
// from the catalog amount — so no test products/prices/connected-account are needed.
function stripeKey() {
  return process.env.ONBOARDING_STRIPE_SECRET_KEY || process.env.STRIPE_CONNECT_SECRET_KEY || process.env.STRIPE_SECRET_KEY;
}
function isTestMode() {
  return String(process.env.ONBOARDING_STRIPE_SECRET_KEY || "").indexOf("sk_test") === 0;
}
// Stripe recurring interval for an inline (test) price, derived from our term.
function intervalFor(term) {
  if (term === "3_months") return { interval: "month", interval_count: 3 };
  if (term === "6_months") return { interval: "month", interval_count: 6 };
  return { interval: "week", interval_count: 4 }; // 4_weeks (monthly billing)
}

async function stripeFetch(path, { method = "GET", body, stripeAccount, idempotencyKey } = {}) {
  const headers = { Authorization: `Bearer ${stripeKey()}` };
  if (body) headers["Content-Type"] = "application/x-www-form-urlencoded";
  if (stripeAccount) headers["Stripe-Account"] = stripeAccount;
  if (idempotencyKey) headers["Idempotency-Key"] = idempotencyKey;
  const encoded = body
    ? new URLSearchParams(
        Object.entries(body).reduce((acc, [k, v]) => {
          if (v !== undefined && v !== null) acc[k] = String(v);
          return acc;
        }, {})
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

function piSecretFromSub(sub) {
  const pi = sub && sub.latest_invoice && sub.latest_invoice.payment_intent;
  return pi && typeof pi === "object" ? pi.client_secret : null;
}

async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST required" });

  try {
    if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) throw new Error("Supabase env not configured");
    if (!stripeKey()) throw new Error("Stripe secret key not configured");

    const body = (req.body && typeof req.body === "object") ? req.body : {};
    const parent = body.parent || {};
    const athlete = body.athlete || {};

    const clientId = body.client_id || body.clientId;
    const plan = PLAN_ALIASES[norm(body.plan)];
    const term = TERM_ALIASES[norm(body.term)];
    const parentEmail = norm(parent.email || body.parent_email);
    const parentFirst = (parent.first || parent.firstName || "").toString().trim();
    const parentLast  = (parent.last  || parent.lastName  || "").toString().trim();
    const parentName  = (parent.name || `${parentFirst} ${parentLast}`).trim() || null;
    const parentPhone = (parent.phone || body.parent_phone || "").toString().trim() || null;
    const athleteFirst = (athlete.first || athlete.firstName || "").toString().trim();
    const athleteLast  = (athlete.last  || athlete.lastName  || "").toString().trim();
    const athleteName  = (athlete.name || `${athleteFirst} ${athleteLast}`).trim() || null;
    const athleteDob   = athlete.dob || athlete.date_of_birth || body.athlete_dob || null;

    // ── Validate ──
    if (!clientId)     return res.status(400).json({ error: "client_id required" });
    if (!plan)         return res.status(400).json({ error: "plan invalid", allowed: ["Steady/1x", "Accelerated/2x", "Elevate/3x", "Dominate/unlimited"] });
    if (!term)         return res.status(400).json({ error: "term invalid", allowed: ["monthly", "3_months", "6_months"] });
    if (!parentEmail)  return res.status(400).json({ error: "parent email required" });
    if (!athleteName)  return res.status(400).json({ error: "athlete name required" });

    const testMode = isTestMode();

    // ── Academy must exist + be Stripe-connected (connected account skipped in test) ──
    const clientRows = await sb(`clients?id=eq.${encodeURIComponent(clientId)}&select=id,business_name,stripe_connect_account_id,stripe_connect_status&limit=1`);
    const client = Array.isArray(clientRows) && clientRows[0];
    if (!client) return res.status(404).json({ error: "academy not found" });
    const stripeAccount = testMode ? null : client.stripe_connect_account_id;
    if (!testMode && !stripeAccount) return res.status(409).json({ error: "academy is not connected to Stripe" });

    // ── Price (server-side only — never trust a client-sent price) ──
    const priceRows = await sb(
      `pricing_catalog?client_id=eq.${encodeURIComponent(clientId)}` +
      `&canonical_plan=eq.${encodeURIComponent(plan)}` +
      `&interval=eq.${encodeURIComponent(term)}` +
      `&tier=eq.canonical&is_routable=eq.true` +
      `&select=stripe_price_id,amount_cents,currency&limit=1`
    );
    const price = Array.isArray(priceRows) && priceRows[0];
    if (!price || (!testMode && !price.stripe_price_id)) {
      return res.status(409).json({ error: "no routable price for that plan + term", plan, term });
    }
    if (testMode && (price.amount_cents == null)) {
      return res.status(409).json({ error: "no catalog amount for that plan + term (needed for inline test price)", plan, term });
    }

    // ── Idempotency: reuse an existing member + in-flight sub ──
    const existingRows = await sb(
      `members?client_id=eq.${encodeURIComponent(clientId)}` +
      `&parent_email=eq.${encodeURIComponent(parentEmail)}` +
      `&athlete_name=eq.${encodeURIComponent(athleteName)}` +
      `&select=id,status,stripe_customer_id,stripe_subscription_id&limit=1`
    );
    let member = Array.isArray(existingRows) && existingRows[0] ? existingRows[0] : null;

    if (member && member.stripe_subscription_id) {
      let sub = null;
      try {
        sub = await stripeFetch(
          `/subscriptions/${member.stripe_subscription_id}?expand[]=latest_invoice.payment_intent`,
          { stripeAccount }
        );
      } catch (_) { sub = null; }
      if (sub) {
        if (sub.status === "incomplete") {
          const secret = piSecretFromSub(sub);
          if (secret) {
            return res.status(200).json({
              ok: true, reused: true, member_id: member.id,
              subscription_id: sub.id, customer_id: sub.customer,
              client_secret: secret, stripe_account: stripeAccount,
              publishable_key: process.env.STRIPE_PUBLISHABLE_KEY || null,
              amount_cents: price.amount_cents, currency: price.currency || "cad",
            });
          }
        } else if (sub.status === "active" || sub.status === "trialing") {
          return res.status(200).json({ ok: true, already_active: true, member_id: member.id, subscription_id: sub.id });
        }
        // canceled / incomplete_expired → fall through and make a fresh sub
      }
    }

    // ── Find or create the customer on the connected account ──
    let customerId = member && member.stripe_customer_id;
    if (!customerId) {
      const found = await stripeFetch(`/customers?email=${encodeURIComponent(parentEmail)}&limit=1`, { stripeAccount });
      customerId = found && found.data && found.data[0] && found.data[0].id;
    }
    if (!customerId) {
      const cust = await stripeFetch(`/customers`, {
        method: "POST", stripeAccount,
        body: {
          email: parentEmail,
          name: parentName || undefined,
          phone: parentPhone || undefined,
          "metadata[athlete_name]": athleteName,
          "metadata[source]": "fullcontrol-onboarding",
        },
      });
      customerId = cust.id;
    }

    // ── Resolve the price to charge ──
    // LIVE: the catalog's real price on the connected account.
    // TEST: create a price (with an inline product) from the catalog amount on the
    //       platform test account — subscription price_data needs a real product, so
    //       we mint one via POST /prices (idempotent per plan+term+amount).
    let priceIdToUse = price.stripe_price_id;
    if (testMode) {
      const iv = intervalFor(term);
      const testPrice = await stripeFetch(`/prices`, {
        method: "POST", stripeAccount,
        idempotencyKey: `onb-price-${plan}-${term}-${price.amount_cents}`.slice(0, 200),
        body: {
          currency: price.currency || "cad",
          unit_amount: price.amount_cents,
          "recurring[interval]": iv.interval,
          "recurring[interval_count]": iv.interval_count,
          "product_data[name]": `${plan} · ${term} (FC onboarding test)`,
        },
      });
      priceIdToUse = testPrice.id;
    }

    // ── Create the PORTAL-OWNED subscription (default_incomplete → client_secret) ──
    const subBody = {
      customer: customerId,
      "items[0][price]": priceIdToUse,
      payment_behavior: "default_incomplete",
      "payment_settings[save_default_payment_method]": "on_subscription",
      "expand[0]": "latest_invoice.payment_intent",
      "metadata[origin]": "fullcontrol-portal",
      "metadata[plan]": plan,
      "metadata[term]": term,
      "metadata[client_id]": clientId,
      "metadata[parent_email]": parentEmail,
      "metadata[athlete_name]": athleteName,
    };
    const sub = await stripeFetch(`/subscriptions`, {
      method: "POST", stripeAccount,
      idempotencyKey: `onb-sub-${testMode ? "test-" : ""}${clientId}-${parentEmail}-${athleteName}-${plan}-${term}`.slice(0, 200),
      body: subBody,
    });
    const clientSecret = piSecretFromSub(sub);

    // ── Upsert the member row (status stays payment_method_required until paid) ──
    const memberFields = {
      client_id:              clientId,
      athlete_name:           athleteName,
      parent_name:            parentName,
      parent_email:           parentEmail,
      parent_phone:           parentPhone,
      plan,
      status:                 "payment_method_required",
      stripe_customer_id:     customerId,
      stripe_subscription_id: sub.id,
      stripe_price_id:        price.stripe_price_id,
      updated_at:             nowIso(),
    };
    // NOTE: athleteDob is collected by the funnel but `members` has no athlete_dob
    // column yet — add a migration if we want to persist it. Captured here so the
    // field name is obvious when that column lands.
    void athleteDob;

    if (member) {
      await sb(`members?id=eq.${member.id}`, {
        method: "PATCH", headers: { Prefer: "return=minimal" },
        body: JSON.stringify(memberFields),
      });
    } else {
      memberFields.joined_date = new Date().toISOString().slice(0, 10);
      memberFields.created_at = nowIso();
      const inserted = await sb(`members?select=id`, {
        method: "POST", headers: { Prefer: "return=representation" },
        body: JSON.stringify([memberFields]),
      });
      member = Array.isArray(inserted) && inserted[0] ? inserted[0] : null;
    }

    // Audit (non-fatal)
    try {
      await sb(`member_audit_log`, {
        method: "POST", headers: { Prefer: "return=minimal" },
        body: JSON.stringify([{
          client_id: clientId, member_id: member && member.id,
          action_type: "onboarding-checkout-created",
          args: { plan, term, price_id: price.stripe_price_id, sub_id: sub.id, customer_id: customerId },
          performed_by_name: "Parent funnel (public)",
        }]),
      });
    } catch (_) { /* non-fatal */ }

    return res.status(200).json({
      ok: true,
      member_id: member && member.id,
      subscription_id: sub.id,
      customer_id: customerId,
      client_secret: clientSecret,
      stripe_account: stripeAccount,
      publishable_key: process.env.STRIPE_PUBLISHABLE_KEY || null,
      amount_cents: price.amount_cents,
      currency: price.currency || "cad",
    });
  } catch (e) {
    return res.status(e.stripeStatus || e.status || 500).json({ error: e.message || String(e) });
  }
}

export default withSentryApiRoute(handler);
