# Change-membership flow (member drawer → "Change plan")

2026-06-30. How the client-portal member drawer's **Change plan** action works after the
June rebuild (PRs #896-#899, all merged + live). Scope: V2 / BAM GTA. V1 untouched.

## Where it lives
- UI: `bam-portal/public/client-portal.html` → `mChange(memberId, currentPlan)` (the modal)
  + `_mmFieldHtml(f)` select branch (supports grouped `<optgroup>` options).
- Backend: `bam-portal/api/members.js` → `actionChange()`.
- Reads `/api/pricing?client_id=` (catalog) + `/api/members` (current sub) in parallel.

## What it does now
1. **Dropdown sources LIVE prices from `pricing_catalog`** (not a hardcoded plan list).
   Only `is_routable = true` canonical rows for the academy.
2. **Live vs Legacy split is offer-aware** (`statusOf(row)`): it matches each catalog row
   against `offers.data.pricing.pricing_offerings[]` by title; if the matched offering has
   `archived = true` → **Legacy** optgroup, else **Live**. Falls back to `is_routable` only
   when no offering matches. This is why archived offerings (old Accelerate/Elevate/Dominate)
   land under Legacy, not Live. Source: `_bbState.offer` or `offers.select('data').eq('id',…)`.
3. **HST split display**: each option shows all-in + `(base + HST)` via `_withHst`.
   Stripe prices are stored TAX-INCLUSIVE (e.g. Steady 6mo = $1130 = $1000 + $130 HST);
   the offer JSON shows the pre-tax number ($1000). Keep the tax-inclusive catalog row.
4. **Next payment date**: modal has a date field → backend sets Stripe `trial_end`
   (`isoToUnix`, capped to `STRIPE_TRIAL_MAX_SECS`) to push the next charge.
5. **Cross-interval = cancel + recreate** (not an item swap). If old and new prices share
   the same billing interval → swap item price in place (`POST /subscriptions/{id}`,
   `items[0][price]`). If intervals differ → **create a new sub** (trial_end = chosen date,
   default to previous period end; carries `default_payment_method` +
   `metadata.origin=fullcontrol-portal`) then `DELETE` the old sub (rolls back the new one on
   failure), and repoints the `members` row (`stripe_subscription_id`, `stripe_price_id`,
   `plan`). Response `mode` = `swap` | `recreate`.

## Key constants (members.js)
- `PLAN_TO_PRICE` (legacy `body.new_plan` path): `1/wk→plan_ToNwa96lQ5I1Bs`,
  `2/wk→plan_ThYK86w2Zd8fp3`, `3/wk→plan_U3CUUJkzgyTjel`, `unlmtd→plan_U3CFSoR1LdyGlb`.
  New path validates `body.new_price_id` against `pricing_catalog.is_routable`.
- `PORTAL_OWNED_ORIGINS = {fullcontrol-portal, fullcontrol-website-enrollment}`.

## Gotchas
- Stripe Connect rejects changes on subs NOT app-created → the recreate path is also how we
  bring legacy/CoachIQ-owned subs under portal ownership. See [[project_stripe_app_created_subs]].
- Catalog can hold duplicate term rows (a pre-tax orphan + a tax-inclusive confirmed row).
  Keep the offer-linked (`offer_price_key` set, `match_status='confirmed'`) one routable;
  set `is_routable=false` on the orphan. Did this for Steady 6mo on 2026-06-30
  (derouted the $1000 pre-tax `price_1SD3NCRxInSEtAh8z5eiQZhT`; kept $1130
  `price_1TgaMPRxInSEtAh8Hpa5wyTN`).
- After editing client-portal.html UI: run `node bam-portal/scripts/verify-client-portal-ui.mjs`.

## Related
[[project_offer_price_mapping]] · [[project_pricing_sorter_wizard]] ·
[[project_member_management_portal]] · [[project_stripe_app_created_subs]] ·
[[project_offer_architecture]]
