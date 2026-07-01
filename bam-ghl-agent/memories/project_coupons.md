# Coupons (discount codes)

Percentage or dollar coupons across the whole stack. Shipped 2026-07-01. Read this before touching any discount/coupon code.

## Mental model

- A **coupon belongs to an offer**. It's created + managed in the **offer's Pricing section** (Business Blueprint → Offers → Pricing → "Discount codes" block). That offer scoping is why there's no separate "restrict to plans" toggle - the offer already scopes it.
- Each coupon = **1 Stripe Coupon** (the math: %/$ + how long it lasts) + **1 Stripe Promotion Code** (the customer-facing string + limits). Created on the academy's **connected** Stripe account (platform key + `Stripe-Account`).
- Coupon definitions live in `offers.data.pricing.discount_codes[]`; the live source of truth for state (redemptions/active) is the Stripe promotion code, read live.
- **One-step create (shipped 2026-07-01):** filling in a code (code + type + amount) auto-pushes it to Stripe on autosave (`_bbAutoCreateCoupons`, debounced, idempotent). No separate step needed. Each row also has a Stripe **pill** (LIVE / not created) as status + manual fallback. Adding-only (immutable): to change a live coupon's %/$, make a NEW code + deactivate the old (Stripe coupons can't be edited).

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
- **Commitment "goes back to monthly" revert** (`maybeAttachCommitmentSchedule` in `api/stripe/webhook.js`): the 3/6-month prepay charge is paid WITH the coupon before the schedule attaches, so the upfront term is always discounted. The webhook then rebuilds the sub into a subscription_schedule (phase0 committed ×1 → phase1 monthly → release); phase rebuilds are declarative, so it now **restates the sub's coupon on BOTH phases** (`phases[N][discounts][0][coupon]`) - otherwise a forever/repeating coupon would vanish at the monthly revert. Reads the coupon via `expand[]=discounts.coupon` (non-fatal). GTA live plans with this: Steady 3mo/6mo, Summer Unlimited 3mo (all revert to their `<title>|monthly` canonical price).
- The member GET + `actionChange` fetch the sub with `expand[]=discounts.promotion_code` and **fall back to a plain fetch** if the API version rejects that expand (so billing display + plan changes never break). Account is on a modern API version (uses `confirmation_secret`), so the expand path is the real one.
- **once_per_customer** ≈ Stripe `first_time_transaction` (new-customer signups). Not a true per-customer counter; fine for the checkout case, weaker for staff manual apply.
- Coupon discounts the **all-in (HST-inclusive)** amount - Stripe prices here are tax-inclusive, so "$20 off $180" charges $160.
- Each coupon row in the offer's Discount-codes block shows a **Stripe pill** (`_bbCouponPill`/`_bbApplyCouponPills`/`_bbCouponPillClick`, mirrors `_bbLivePill`): LIVE / not created / deactivated. Click a "not created" pill → confirm modal → creates just that code in Stripe (POST create-discount with the full def) → pill flips to LIVE. This is the inline path; the Price Match panel bulk-create still exists. Adding a code under Pricing does NOT auto-push to Stripe - the pill (or panel) is the push step.
- Editing a live coupon's math isn't supported (Stripe coupons are immutable): deactivate + create a new code. `create-discount` skips codes that already exist live.
- GTA checkout coupon is **skipped in test mode** (inline test price; coupons live on the connected account).
- **HST display:** the enroll pay-step summary (bam-client-sites `enroll.jsx`) shows an "incl. $X HST" subline under both the plan total and the discounted total. Prices are HST-inclusive (`baseCents = amount / 1.13`); a % discount halves the HST proportionally too.

## Live GTA state (as of 2026-07-01)

- GTA offer `52a6285c` (client `39875f07-0a4b-4429-a201-2249bc1f24df`), Stripe connected acct `acct_1P7kUCRxInSEtAh8`.
- **`2SIBLING`** = 50% off forever, LIVE in Stripe (coupon `4qIhQexk` + promo code). Verified end-to-end on `enroll.html?dev=1`: $226 → $113. There is ALSO an older **`SIBLING2`** = 25% off forever (pre-existing, unrelated). Two sibling codes exist; don't confuse them.
- Enroll test mode: `enroll.html?dev=1` unlocks step nav + prefills info + auto-selects a plan → lands on the pay step to test coupons fast. Gated on the param; real parents unaffected.
- All work merged to `main` in both repos (portal PRs #965/#985/#986/#990/#993, client-sites PRs #44/#45/#46). Portal auto-deploys on merge; bam-client-sites needs `vercel deploy --prod --scope zoran-stars-projects` from `clients/bam-gta`.

## ⚠️ Stripe API-version gotcha (learned 2026-07-01)

The platform's Stripe account is on a recent API version where **promotion codes changed shape**:
- **Create:** `/v1/promotion_codes` needs `promotion[type]=coupon` + `promotion[coupon]=<id>` (NOT the old top-level `coupon` param → "Received unknown parameter: coupon").
- **Read:** the coupon math is nested under `promotion.coupon` (expand `data.promotion.coupon`), not `pc.coupon`.
- Coupon **create** (`/v1/coupons`) is unchanged (percent_off/amount_off/duration).
- Subscriptions use the `discounts[]` array (we apply via `discounts[0][promotion_code]`).

`stripePromoBody` emits the new shape; `couponFromPromo(pc)` reads coupon math across both shapes; all promo-code reads expand `...promotion.coupon`. If a future account is on an OLDER version this could flip - `couponFromPromo` already falls back to `pc.coupon`, but `stripePromoBody`/expands would need a version guard.

## Related
[[project_change_plan_flow]] · [[project_website_enrollment_funnel]] · [[project_offer_architecture]]
