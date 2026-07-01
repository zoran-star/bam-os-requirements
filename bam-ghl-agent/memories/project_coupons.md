# Coupons (discount codes)

Percentage or dollar coupons across the whole stack. Shipped 2026-07-01. Read this before touching any discount/coupon code.

## Mental model

- A **coupon belongs to an offer**. It's created + managed in the **offer's Pricing section** (Business Blueprint → Offers → Pricing → "Discount codes" block). That offer scoping is why there's no separate "restrict to plans" toggle - the offer already scopes it.
- Each coupon = **1 Stripe Coupon** (the math: %/$ + how long it lasts) + **1 Stripe Promotion Code** (the customer-facing string + limits). Created on the academy's **connected** Stripe account (platform key + `Stripe-Account`).
- Coupon definitions live in `offers.data.pricing.discount_codes[]`; the live source of truth for state (redemptions/active) is the Stripe promotion code, read live.

## Guardrails - single source of truth: `api/_coupon-guardrails.js`

Imported by every surface. Never bypass it.
- Percent locked **1-99** (0 and 100 rejected).
- Dollar coupon **blocked if it would drop a charge below $1** (`MIN_CHARGE_CENTS = 100`). Validated at APPLY time against the *actual* plan price (a $50 coupon is fine on $638 but breaks a $40 plan).
- CAD only.
- `normalizeCoupon` parses the friendly offer-builder labels ("First payment only" → once, "A set number of months" → repeating, "Every payment" → forever; "Yes"/"No" → once_per_customer bool).
- `stripeCouponBody` / `stripePromoBody` build the Stripe create bodies. Limits (expiry `expires_at`, `max_redemptions`, once-per-customer via `restrictions[first_time_transaction]`) ride on the **promotion code**, not the coupon.

## Coupon shape (offers.data.pricing.discount_codes[])
`{ code, kind:'Percent off'|'Dollar off', value, duration('First payment only'|'A set number of months'|'Every payment'), duration_months, expires_at('YYYY-MM-DD'), max_redemptions, once_per_customer('Yes'/'No'), archived }`

## The 5 surfaces

| # | Surface | Files |
|---|---|---|
| 1 | Offer wizard: create/list/deactivate | `_bbDiscountCodesField` + Price-Match panel (`_sorterLoadDiscounts`/`_sorterRenderDiscounts`/`_sorterCreateDiscounts`/`_sorterDeactivateDiscount`) in `client-portal.html`; `api/offers/create-discount.js` (GET lists live state, POST creates or `{deactivate}` kills) |
| 2 | Change plan: pick/replace/remove during a change | `mChange` modal in `client-portal.html`; `actionChange` in `api/members.js` (accepts `coupon_code`/`remove_coupon`) |
| 3 | Member mgmt: apply/remove/create | drawer buttons + `mApplyCoupon`/`mRemoveCoupon` in `client-portal.html`; `apply-coupon`/`remove-coupon` actions in `api/members.js` |
| 4 | GTA checkout | `clients/bam-gta/gta/enroll.jsx` (bam-client-sites) → `api/website/validate-coupon.js` (live preview, public/CORS) + `api/website/checkout.js` (`coupon_code`) |

## Key behaviors / gotchas

- **Apply replaces** any existing coupon (Stripe allows one discount per sub). Applied via `discounts[0][promotion_code]`; removed via `DELETE /subscriptions/{id}/discount`.
- **Change-plan RECREATE path** (cross-interval change deletes+recreates the sub) **carries the coupon onto the new sub** - re-checked against the new plan's $1 floor, dropped-with-reason if it no longer fits. This was the silent-discount-loss bug; don't regress it.
- The member GET + `actionChange` fetch the sub with `expand[]=discounts.promotion_code` and **fall back to a plain fetch** if the API version rejects that expand (so billing display + plan changes never break). Account is on a modern API version (uses `confirmation_secret`), so the expand path is the real one.
- **once_per_customer** ≈ Stripe `first_time_transaction` (new-customer signups). Not a true per-customer counter; fine for the checkout case, weaker for staff manual apply.
- Coupon discounts the **all-in (HST-inclusive)** amount - Stripe prices here are tax-inclusive, so "$20 off $180" charges $160.
- Editing a live coupon's math isn't supported (Stripe coupons are immutable): deactivate + create a new code. `create-discount` skips codes that already exist live.
- GTA checkout coupon is **skipped in test mode** (inline test price; coupons live on the connected account).

## Related
[[project_change_plan_flow]] · [[project_website_enrollment_funnel]] · [[project_offer_architecture]]
