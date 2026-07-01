// Shared coupon guardrails - the single place a discount can never go negative,
// hit $0, or hit 0% / 100%. Imported by every surface that creates or applies a
// coupon: api/offers/create-discount.js, api/members.js, api/website/checkout.js,
// api/website/validate-coupon.js. Keep the math here so all four stay in lockstep.
//
// Coupon definition shape (as stored in offer.data.pricing.discount_codes[]):
//   {
//     code:            "SIBLING10"          // customer-facing string
//     kind:            "Percent off" | "Dollar off"
//     value:           10                   // 10 = 10% off, or $10 off
//     duration:        "once" | "repeating" | "forever"   (default "forever")
//     duration_months: 3                    // only when duration === "repeating"
//     expires_at:      "YYYY-MM-DD" | null   // code stops working after this date
//     max_redemptions: 50 | null            // total times the code can be used
//     once_per_customer: true | false        // new-customer-only (Stripe first_time_transaction)
//     archived:        true | false          // soft-removed, ignored everywhere
//   }

const MIN_CHARGE_CENTS = 100; // never let a discounted charge drop below $1.00
const COUPON_CURRENCY = "cad";

const isPercent = (kind) => /percent|%/i.test(String(kind || ""));
const normCode = (s) => String(s || "").trim().toUpperCase();

// Map a duration value that may be a machine token ("once"/"repeating"/"forever")
// OR a friendly offer-builder label ("First payment only" / "A set number of
// months" / "Every payment") to the machine token.
function parseDuration(raw) {
  const s = String(raw || "forever").toLowerCase();
  if (/once|first payment|first invoice|one payment/.test(s)) return "once";
  if (/repeat|month/.test(s)) return "repeating";
  return "forever";
}

// A boolean field that may arrive as true, "Yes", "One per customer", etc.
// Anything not explicitly affirmative is false (so a stray "No" isn't truthy).
function parseBool(raw) {
  return /^(yes|true|1|one|on)\b/i.test(String(raw || "").trim());
}

// Normalize a raw coupon row (from the offer builder) into a clean, typed shape.
function normalizeCoupon(raw = {}) {
  const kind = isPercent(raw.kind) ? "Percent off" : "Dollar off";
  const duration = parseDuration(raw.duration);
  const months = Number(raw.duration_months);
  return {
    code: normCode(raw.code),
    kind,
    value: Number(raw.value),
    duration,
    duration_months: duration === "repeating" && Number.isFinite(months) ? Math.max(1, Math.round(months)) : null,
    expires_at: raw.expires_at ? String(raw.expires_at).slice(0, 10) : null,
    max_redemptions: Number.isFinite(Number(raw.max_redemptions)) && Number(raw.max_redemptions) > 0
      ? Math.round(Number(raw.max_redemptions)) : null,
    once_per_customer: typeof raw.once_per_customer === "boolean" ? raw.once_per_customer : parseBool(raw.once_per_customer),
    archived: !!raw.archived,
  };
}

// Validate a coupon DEFINITION at creation time (independent of any plan price).
// Returns { ok:true, coupon } or { ok:false, error }.
function validateCouponDef(raw = {}) {
  const c = normalizeCoupon(raw);
  if (!c.code) return { ok: false, error: "coupon needs a code" };
  if (!/^[A-Z0-9._-]{2,64}$/i.test(c.code)) {
    return { ok: false, error: "code must be 2-64 letters, numbers, or . _ - only" };
  }
  if (!Number.isFinite(c.value) || c.value <= 0) {
    return { ok: false, error: "amount must be greater than 0" };
  }
  if (isPercent(c.kind)) {
    // Locked band: 1-99%. 0% is pointless, 100% would zero the charge.
    if (c.value < 1 || c.value >= 100) {
      return { ok: false, error: "percent must be between 1 and 99" };
    }
  } else {
    // Dollar coupons are validated against the actual plan at apply time
    // (a $50 coupon is fine on $200 but would break a $40 plan). Here we only
    // sanity-check the raw number.
    if (c.value > 100000) return { ok: false, error: "dollar amount looks too large" };
  }
  if (c.duration === "repeating" && !c.duration_months) {
    return { ok: false, error: "repeating coupons need a number of months" };
  }
  if (c.expires_at && !/^\d{4}-\d{2}-\d{2}$/.test(c.expires_at)) {
    return { ok: false, error: "expiry must be YYYY-MM-DD" };
  }
  return { ok: true, coupon: c };
}

// Apply a coupon to a concrete plan price. THIS is the real safety net - it runs
// at every point money is about to be charged (apply-to-member, checkout).
// Returns { ok:true, discountCents, discountedCents, label } or { ok:false, error }.
function applyDiscountToCents(raw, planCents) {
  const c = normalizeCoupon(raw);
  const price = Number(planCents);
  if (!Number.isFinite(price) || price <= 0) {
    return { ok: false, error: "plan price is missing or invalid" };
  }
  let discountCents;
  let label;
  if (isPercent(c.kind)) {
    if (c.value < 1 || c.value >= 100) return { ok: false, error: "percent must be between 1 and 99" };
    discountCents = Math.round(price * (c.value / 100));
    label = `${c.value}% off`;
  } else {
    discountCents = Math.round(c.value * 100);
    label = `$${c.value} off`;
  }
  const discountedCents = price - discountCents;
  if (discountedCents < MIN_CHARGE_CENTS) {
    return {
      ok: false,
      error: `this coupon would drop the charge below $${(MIN_CHARGE_CENTS / 100).toFixed(2)} - not allowed`,
    };
  }
  return { ok: true, discountCents, discountedCents, label };
}

// Check time-based validity (expiry). Redemption caps + once-per-customer are
// enforced natively by Stripe on the promotion code; this covers the expiry gate
// we also want to show in the UI before Stripe would reject it.
function isExpired(raw, nowMs) {
  const c = normalizeCoupon(raw);
  if (!c.expires_at) return false;
  const end = Date.parse(c.expires_at + "T23:59:59");
  return Number.isFinite(end) && Number.isFinite(nowMs) && nowMs > end;
}

// Build the Stripe Coupon create body from a validated coupon definition.
function stripeCouponBody(raw) {
  const c = normalizeCoupon(raw);
  const body = { duration: c.duration, name: `${c.code} (${isPercent(c.kind) ? c.value + "% off" : "$" + c.value + " off"})` };
  if (isPercent(c.kind)) body.percent_off = c.value;
  else { body.amount_off = Math.round(c.value * 100); body.currency = COUPON_CURRENCY; }
  if (c.duration === "repeating" && c.duration_months) body.duration_in_months = c.duration_months;
  body["metadata[source]"] = "fullcontrol-sorter";
  return body;
}

// Build the Stripe Promotion Code create body (holds the customer-facing limits:
// expiry, max redemptions, new-customer-only).
function stripePromoBody(raw, couponId) {
  const c = normalizeCoupon(raw);
  const body = { coupon: couponId, code: c.code, "metadata[source]": "fullcontrol-sorter" };
  if (c.max_redemptions) body.max_redemptions = c.max_redemptions;
  if (c.expires_at) {
    const unix = Math.floor(Date.parse(c.expires_at + "T23:59:59") / 1000);
    if (Number.isFinite(unix)) body.expires_at = unix;
  }
  if (c.once_per_customer) body["restrictions[first_time_transaction]"] = "true";
  return body;
}

export {
  MIN_CHARGE_CENTS,
  COUPON_CURRENCY,
  isPercent,
  normCode,
  normalizeCoupon,
  validateCouponDef,
  applyDiscountToCents,
  isExpired,
  stripeCouponBody,
  stripePromoBody,
};
