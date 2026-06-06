// CoachIQ migration / billing-ownership helpers — make the PORTAL the creator
// (owner) of an academy's Stripe subs so the portal's billing buttons work, then
// drive CoachIQ credits via the webhook bridge (see api/coachiq.js).
//
// ⚠️ NOT WIRED INTO ANY LIVE FLOW. These functions create/cancel REAL Stripe
// subscriptions when invoked — nothing calls them yet. Review + test on the
// test_business client (or a single throwaway member) BEFORE wiring into an
// endpoint, and only run a real migration after the credit automation is LIVE
// and CoachIQ's "Subscription Cancelled" automation is disabled (see
// memories/project_coachiq_integration.md, Track B prereqs).
//
// Design rules baked in:
//  • Platform key + Stripe-Account header → the new sub is "created by your
//    application" → portal can pause/cancel/change it afterward.
//  • Anchor new sub trial_end to the OLD sub's current_period_end → no double-
//    charge and no billing gap at cutover.
//  • Reuse the customer's existing default payment method (no re-collect for the
//    ~26/33 who have one; the rest need a payment link first — caller checks).
//  • Stamp metadata.member_id + metadata.coachiq_user_id so future webhooks/credits
//    resolve the member without a lookup.
//  • Idempotency keys so a retried migration can't create duplicate subs.

const STRIPE_API = "https://api.stripe.com/v1";

function stripeKey() {
  return process.env.STRIPE_CONNECT_SECRET_KEY || process.env.STRIPE_SECRET_KEY;
}

async function stripeFetch(path, { method = "GET", body, stripeAccount, idempotencyKey } = {}) {
  const headers = { Authorization: `Bearer ${stripeKey()}` };
  if (body) headers["Content-Type"] = "application/x-www-form-urlencoded";
  if (stripeAccount) headers["Stripe-Account"] = stripeAccount;
  if (idempotencyKey) headers["Idempotency-Key"] = idempotencyKey;
  let encoded;
  if (body) {
    encoded = typeof body === "string" ? body : new URLSearchParams(
      Object.entries(body).reduce((acc, [k, v]) => {
        if (v !== undefined && v !== null) acc[k] = String(v);
        return acc;
      }, {})
    ).toString();
  }
  const res = await fetch(`${STRIPE_API}${path}`, { method, headers, body: encoded });
  const text = await res.text();
  const json = text ? JSON.parse(text) : {};
  if (!res.ok) {
    const err = new Error(json?.error?.message || `Stripe ${res.status}`);
    err.stripeResponse = json; err.stripeStatus = res.status;
    throw err;
  }
  return json;
}

// Find a reusable default payment method for a customer (sub default → customer
// invoice-settings default → first attached card). Returns pm id or null.
export async function findDefaultPaymentMethod(stripeAccount, customerId, sub = null) {
  if (sub?.default_payment_method) return sub.default_payment_method;
  const cust = await stripeFetch(`/customers/${customerId}`, { stripeAccount });
  const cpm = cust?.invoice_settings?.default_payment_method;
  if (cpm) return cpm;
  const pms = await stripeFetch(
    `/payment_methods?customer=${customerId}&type=card&limit=1`, { stripeAccount }
  );
  return pms?.data?.[0]?.id || null;
}

// Create a PORTAL-OWNED subscription on a connected account.
//  opts: { stripeAccount, customerId, priceId, trialEndUnix?, defaultPaymentMethod?,
//          memberId?, coachiqUserId?, idempotencyKey? }
export async function createPortalSub(opts) {
  const { stripeAccount, customerId, priceId, trialEndUnix, defaultPaymentMethod,
          memberId, coachiqUserId, idempotencyKey } = opts;
  if (!stripeAccount) throw new Error("createPortalSub: stripeAccount required");
  if (!customerId)    throw new Error("createPortalSub: customerId required");
  if (!priceId)       throw new Error("createPortalSub: priceId required");

  const body = {
    customer: customerId,
    "items[0][price]": priceId,
    proration_behavior: "none",
    "metadata[origin]": "fullcontrol-portal",
  };
  if (trialEndUnix)          body.trial_end = String(trialEndUnix);
  if (defaultPaymentMethod)  body.default_payment_method = defaultPaymentMethod;
  if (memberId)              body["metadata[member_id]"] = memberId;
  if (coachiqUserId)         body["metadata[coachiq_user_id]"] = coachiqUserId;
  // If no trial and a PM is on file, charge immediately; otherwise let Stripe
  // create the sub and bill at trial_end.
  if (!trialEndUnix && defaultPaymentMethod) body.payment_behavior = "allow_incomplete";

  return stripeFetch(`/subscriptions`, {
    method: "POST", stripeAccount, body,
    idempotencyKey: idempotencyKey || (memberId ? `portal-sub-${memberId}` : undefined),
  });
}

// Migrate ONE member from a CoachIQ-owned sub to a portal-owned sub.
//  args: { stripeAccount, oldSubId, priceId, memberId, coachiqUserId, dryRun? }
// Steps: read old sub → reuse customer + PM → create new portal sub anchored to
// old current_period_end → cancel old sub. Returns a report; does NOT touch the
// DB or fire credits (caller does: update members.stripe_subscription_id +
// addCoachiqCredits on the next invoice).
export async function migrateSubToPortal(args) {
  const { stripeAccount, oldSubId, priceId, memberId, coachiqUserId, dryRun = true } = args;
  if (!stripeAccount || !oldSubId || !priceId) {
    throw new Error("migrateSubToPortal: stripeAccount, oldSubId, priceId required");
  }
  const oldSub = await stripeFetch(
    `/subscriptions/${oldSubId}?expand[]=default_payment_method`, { stripeAccount }
  );
  if (oldSub.status === "canceled") throw new Error(`old sub ${oldSubId} already canceled`);
  const customerId = oldSub.customer;
  const item = oldSub.items?.data?.[0];
  const periodEnd = item?.current_period_end || oldSub.current_period_end; // anchor
  const pm = await findDefaultPaymentMethod(stripeAccount, customerId, oldSub);

  const plan = {
    member_id: memberId, old_sub: oldSubId, customer: customerId,
    new_price: priceId, anchor_trial_end: periodEnd,
    has_reusable_pm: !!pm, needs_card_recollect: !pm,
    coachiq_user_id: coachiqUserId || null,
  };
  if (dryRun) return { dryRun: true, ...plan };
  if (!pm) return { skipped: "no reusable payment method — send a payment link first", ...plan };

  const newSub = await createPortalSub({
    stripeAccount, customerId, priceId,
    trialEndUnix: periodEnd, defaultPaymentMethod: pm,
    memberId, coachiqUserId,
  });
  // Cancel the old CoachIQ sub now that the portal sub covers from periodEnd.
  await stripeFetch(`/subscriptions/${oldSubId}`, {
    method: "DELETE", stripeAccount,
    idempotencyKey: `cancel-old-${oldSubId}`,
  });
  return {
    dryRun: false, ...plan,
    new_sub: newSub.id, new_sub_status: newSub.status,
    old_sub_canceled: true,
    // caller TODO: members.stripe_subscription_id = newSub.id;
    //              on the new sub's first invoice.paid → addCoachiqCredits(coachiqUserId)
  };
}
