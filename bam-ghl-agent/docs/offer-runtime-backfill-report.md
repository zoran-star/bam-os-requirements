# Offer Runtime Backfill Report

Owner: Luka
Last updated: 2026-07-01
Scope: BAM GTA production read-only data review for moving operational pricing,
checkout, and entitlement rules out of `offers.data` and into typed runtime
tables.

## Summary

This report is read-only. No production data was changed.

The typed runtime schema is ready, but production data is not backfilled yet:

| Table | BAM GTA rows | Notes |
|---|---:|---|
| `offers` | 3 | One published `Training` offer and two archived untitled team offers. |
| `offer_teams` | 2 | Both attached to BAM GTA offers. |
| `pricing_catalog` | 41 | Strongest source for live/legacy Stripe and CoachIQ mappings. |
| `bookable_programs` | 1 | Existing BAM GTA Training access spine. |
| `offer_options` | 0 | Needs backfill. |
| `offer_prices` | 0 | Needs backfill. |
| `entitlement_templates` | 0 | Needs backfill. |
| `customer_entitlements` | 0 | Needs later member/customer backfill. |
| `credit_ledger` | 0 | Needs later opening-balance/debit history strategy. |

For BAM GTA Training, production has:

- 30 `pricing_catalog` rows already confirmed and mapped to the Training offer.
- 14 distinct confirmed `offer_price_key` values.
- 11 confirmed keys with at least one routable catalog row.
- 3 confirmed keys with no routable row, so they should be review/legacy-only
  unless Zoran wants to sell them again.
- 11 catalog rows with no `offer_id` / `offer_price_key`; 9 of those are
  routable today and need manual mapping or explicit exclusion before a full
  checkout cutover.

The data is close enough for a reviewed BAM GTA Training typed-runtime backfill.
It is not safe to do a blind JSON-only migration.

2026-06-30 refresh note: Zoran appears to have cleaned up the active Training
JSON data. `Steady` is now active again and `1/Wk` is archived, so the previous
active `1/Wk|monthly` alias mismatch is no longer a public checkout blocker.
Catalog row counts and typed runtime table counts are otherwise unchanged. The
Training offer row was updated in production on 2026-06-30 at 09:27 Toronto
time.

2026-07-01 refresh note: Zoran moved the member base much closer to the intended
active plan set. The runtime backfill should now target only the current Training
prices we intend to support:

- `Summer Unlimited|monthly`
- `Summer Unlimited|3_months`
- `Steady|monthly` as the 1/wk monthly plan
- `Steady|3_months` as active/direct checkout, not shown on onboarding
- `Steady|6_months` as active/direct checkout, not shown on onboarding

The typed runtime tables are still empty in production. Do not push production
writes until the local backfill and API behavior are reviewed.

## Source Rules

Use sources in this order:

1. `pricing_catalog` for real Stripe/CoachIQ mappings and actual amounts.
2. `pricing_catalog.offer_id` + `pricing_catalog.offer_price_key` for lineage.
3. `offers.data.pricing.pricing_offerings` for display copy and commitment
   behavior such as "Goes back to monthly".
4. Reviewed entitlement rules for what a purchase grants.

Do not derive money or availability from JSON alone. Some JSON prices are base
prices, some catalog amounts are all-in/HST-adjusted, and a few catalog amounts
are rounded or legacy.

Design note: `pricing_catalog` and `offer_prices` intentionally overlap but do
not represent the same concept. `pricing_catalog` is payment/provider truth
about Stripe/CoachIQ rows. `offer_prices` is app/runtime business truth about
what an offer can sell or recognize and what entitlement it grants. This
separation matters because not every future offer price has to be a Stripe
price: cash/offline payment, comped/free trial access, internal grants, invoices,
legacy member entitlements, and future non-Stripe providers should all be able
to create runtime entitlements without inventing fake Stripe catalog data.

## Training Offer JSON Findings

Production Training offer:

```text
offer_id: 52a6285c-7832-44e1-b531-ab7ef9d8fc21
title: Training
status: published
json pricing_offerings: 7
```

JSON rows:

| JSON plan | Archived | Commitments | Cutover note |
|---|---:|---:|---|
| `Steady` | no | 2 | Active JSON row with matching catalog keys for monthly and 6-month checkout. 3-month remains non-routable. |
| `Accelerate` | yes | 2 | Catalog still has confirmed/routable keys. Catalog should win. |
| `Elevate` | yes | 2 | Catalog still has confirmed/routable keys. Catalog should win. |
| `Dominate` | yes | 2 | Catalog still has confirmed/routable keys. Catalog should win. |
| `test` | yes | 1 | Non-operational test row; exclude. |
| `Summer Unlimited` | no | 1 | Active JSON row with matching catalog keys. |
| `1/Wk` | yes | 0 | Archived alias row; exclude from runtime rendering. |

Current website offer rendering builds `offer_price_key` from the JSON title.
After the cleanup, active JSON now generates routable targets for
`Steady|monthly`, `Steady|6_months`, `Summer Unlimited|monthly`, and
`Summer Unlimited|3_months`. It still generates `Steady|3_months`, but that key
currently has no mapped routable catalog row. Zoran now wants 1/wk 3-month and
6-month active for direct checkout but hidden from onboarding; typed runtime
visibility should handle that instead of relying on JSON commitments.

## Historical Confirmed Training Price Keys

This table is retained as catalog/history context. It is no longer the active V1
runtime backfill target after the July 1 cleanup. The authoritative V1 backfill
target is the five-price plan in **Backfill Recommendation**.

Recommended status for typed `offer_prices` backfill:

| `offer_price_key` | Candidate status | Catalog rows | Routable rows | Selected amount | Entitlement rule |
|---|---|---:|---:|---:|---|
| `Steady|monthly` | ready | 7 | 1 | 22600 | weekly credits: 1 per week |
| `Steady|3_months` | review legacy | 2 | 0 | 54000 | weekly credits: 1 per week |
| `Steady|6_months` | ready | 1 | 1 | 113000 | weekly credits: 1 per week |
| `Accelerate|monthly` | ready | 6 | 1 | 31600 | weekly credits: 2 per week |
| `Accelerate|3_months` | review legacy | 2 | 0 | 77000 | weekly credits: 2 per week |
| `Accelerate|6_months` | ready | 2 | 1 | 158200 | weekly credits: 2 per week |
| `Elevate|monthly` | review legacy | 1 | 0 | 35677 | weekly credits: 3 per week |
| `Elevate|3_months` | ready | 1 | 1 | 102208 | weekly credits: 3 per week |
| `Elevate|6_months` | ready | 1 | 1 | 189275 | weekly credits: 3 per week |
| `Dominate|monthly` | ready | 3 | 2 | 63800 | unlimited training booking |
| `Dominate|3_months` | ready | 1 | 1 | 172381 | unlimited training booking |
| `Dominate|6_months` | ready | 1 | 1 | 319225 | unlimited training booking |
| `Summer Unlimited|monthly` | ready | 1 | 1 | 31527 | unlimited training booking |
| `Summer Unlimited|3_months` | ready | 1 | 1 | 85089 | unlimited training booking |

`review legacy` means the key is confirmed and historically meaningful, but there
is no currently routable catalog row. It can still be useful for existing member
entitlement imports, but should not be exposed for new checkout without a product
decision.

## Historical Selected Catalog Rows

This table is retained as pre-July-1 catalog/history context only. It is
superseded by the July 1 five-price plan in **Backfill Recommendation**. In
particular, do not use the `Steady|3_months` row from this table for new direct
checkout; it points at the old non-routable Stripe price.

The selected catalog row per key should be chosen by:

1. confirmed mapping
2. routable row preferred
3. canonical tier preferred
4. amount only as a tiebreaker

Use the selected `pricing_catalog.id` as `offer_prices.source_pricing_catalog_id`.

| `offer_price_key` | Selected `pricing_catalog.id` | Stripe price | Routable | Interval |
|---|---|---|---:|---|
| `Steady|monthly` | `19515c88-2c61-46b1-b9a9-9da7bc849ca8` | `plan_ToNwa96lQ5I1Bs` | yes | `4_weeks` |
| `Steady|3_months` | `8b5790fb-6e0a-42e9-85d8-914f49fca2b7` | `price_1Rr8OjRxInSEtAh8GESeALQG` | no | `3_months` |
| `Steady|6_months` | `20152e0a-9032-4306-b3b8-a0148d467c33` | `price_1TgaMPRxInSEtAh8Hpa5wyTN` | yes | `6_months` |
| `Accelerate|monthly` | `e67f4504-43b9-46ff-932c-8f4967af678d` | `plan_ThYK86w2Zd8fp3` | yes | `4_weeks` |
| `Accelerate|3_months` | `dc431a43-ac5d-43fc-868c-4d9be0397dbb` | `price_1QakpTRxInSEtAh8MZiKMHvH` | no | `3_months` |
| `Accelerate|6_months` | `fc39ff77-4dc2-41bf-8a9a-56650fae2634` | `price_1Tgb4cRxInSEtAh8f08wcmmM` | yes | `6_months` |
| `Elevate|monthly` | `ccf7afb6-b785-4825-917c-eeacc0d7c29e` | `plan_UHqrMRNhacWTuE` | no | `4_weeks` |
| `Elevate|3_months` | `d5215a78-96b7-4841-907f-1cb01ec63486` | `price_1ThXzcRxInSEtAh8H716YxJ5` | yes | `3_months` |
| `Elevate|6_months` | `4981598b-2c3e-4b92-9982-6132e411aeeb` | `price_1ThXzmRxInSEtAh85kfZwdkR` | yes | `6_months` |
| `Dominate|monthly` | `a3a3c745-79f5-488e-8279-a785082c34d7` | `plan_U3CFSoR1LdyGlb` | yes | `4_weeks` |
| `Dominate|3_months` | `4660120a-e817-44c9-b4ad-823509b49571` | `price_1TglnfRxInSEtAh8XwOojrct` | yes | `3_months` |
| `Dominate|6_months` | `b93ed49b-9583-447f-a58d-97dc39ac0db9` | `price_1TglnrRxInSEtAh8Me4GNWO9` | yes | `6_months` |
| `Summer Unlimited|monthly` | `ed4fec70-2e13-448a-8ad1-744841be7ad9` | `price_1Ti6PCRxInSEtAh89gUsOSFj` | yes | `4_weeks` |
| `Summer Unlimited|3_months` | `a0bf4dd4-29c6-4cfd-b816-ff49b3a485ec` | `price_1Ti6PLRxInSEtAh8OprQcH9Q` | yes | `3_months` |

## Existing Member Mapping

Existing BAM GTA members should be imported to `customer_entitlements` by joining:

```text
members.stripe_price_id -> pricing_catalog.stripe_price_id -> offer_price_key
```

Production aggregate:

- 39 BAM GTA member rows.
- 30 live, 2 paused, 7 payment-method-required.
- 38 of 39 rows map to a Training `pricing_catalog` row by Stripe price id.
- 1 live row does not map because it has no `stripe_price_id`, no
  `stripe_subscription_id`, and no `offer_id`; handle as manual/offline payment.

Mapped member rows by offer key:

| `offer_price_key` | Live | Paused | Payment issue |
|---|---:|---:|---:|
| `Summer Unlimited|monthly` | 17 | 2 | 6 |
| `Summer Unlimited|3_months` | 3 | 0 | 0 |
| `Steady|monthly` | 8 | 0 | 0 |
| `Steady|3_months` | 1 | 0 | 0 |
| `Accelerate|monthly` | 0 | 0 | 1 |
| `__UNMAPPED__` | 1 | 0 | 0 |

No live member rows currently map to `Accelerate`, `Elevate`, or `Dominate`
runtime prices after Zoran's cleanup.

There are two `billing_mode = 'alternate'` rows:

- Andrew is live on `Summer Unlimited|monthly` and still has a Stripe
  price/subscription, so he can follow normal catalog mapping.
- Stefan Djeric is live on plan `Summer Unlimited` but has no Stripe
  price/subscription/offer mapping. For V1, do not force this through Stripe.
  Import him as a manual/offline Summer Unlimited entitlement.

The current `customer_entitlements.source` constraint supports `manual` but not
`paid_cash`. If we need to represent cash/offline payment now, use
`source = 'manual'`, `source_ref = 'paid_cash:<member_id>'`, and structured
`config` metadata such as `{"payment_method":"cash","source_member_id":"..."}`.
Only add a first-class `paid_cash` enum/source if this becomes a recurring
operational workflow that needs filtering/reporting.

Luka decision: give the one live unmapped manual/offline member a
`Summer Unlimited` Training entitlement for V1.

## Unmapped Catalog Rows

There are 11 BAM GTA catalog rows without `offer_id` / `offer_price_key`.

Treat these as blockers for a full catalog cleanup, but not blockers for a
reviewed Training MVP if Luka/Zoran explicitly choose to ignore them for V1.

Before a full cutover:

- Decide whether each unmapped row is an old Training price, a duplicate, a
  deprecated product, or a future product.
- Map legitimate Training rows to a real `offer_price_key`.
- Mark rows that should never be sold as non-routable/deprecated in the catalog.
- Avoid exposing any unmapped routable rows in typed checkout APIs.

## Code Cutover Surface

Operational JSON/pricing usages still exist in BAM Portal.

Primary cutover targets:

- `api/website/offer.js`
  - Builds public pricing from active `offers.data.pricing.pricing_offerings`.
  - Then joins to `pricing_catalog` by generated `offer_price_key`.
  - Should move to typed `offer_options` / `offer_prices` /
    `entitlement_templates`, with JSON used only for offer copy/intake/media.
- `api/website/checkout.js`
  - Accepts `offer_price_key`, resolves a routable `pricing_catalog` row, and
    reads JSON commitments for revert-to-monthly behavior.
  - Should accept typed `offer_price_id` and resolve Stripe/catalog/revert
    metadata server-side.
- `api/members.js`
  - Uses JSON pricing to calculate price-match health.
  - Should read typed runtime coverage after backfill.
- Sorter/member tools under `api/sorter/*`
  - Still use `offer_price_key` and `pricing_catalog` heavily.
  - These can keep compatibility longer, but should not define the runtime
    checkout contract.
- `api/offers/match-prices.js`
  - Owns Business Blueprint -> catalog matching.
  - Keep this as a reconciliation tool; do not make it the runtime checkout API.

Non-pricing JSON usages such as GHL workflow ids, signup links, comms config,
assets, copy, and onboarding form content can stay in `offers.data`.

## Backfill Recommendation

The July 1 decision is to backfill the current active Training runtime only. Do
not create active runtime rows for old `Accelerate`, `Elevate`, `Dominate`, test,
discount, or deprecated prices. Those can remain in `pricing_catalog` for Stripe
history/reconciliation, but they should not define parent booking access.

### 1. Build The Identity Spine First

This is the real gate before importing `customer_entitlements`. Production has
0 rows in the parent identity tables today:

- `customer_profiles`: 0
- `students`: 0
- `academy_memberships`: 0
- `member_links`: 0

`customer_entitlements.academy_membership_id` and
`customer_entitlements.bookable_program_id` are both `NOT NULL`, so entitlement
import cannot run for any live member until the identity spine exists. This is
not only a Stefan/manual-payment issue.

Runtime meaning of the identity tables:

| Table | Meaning |
|---|---|
| `customer_profiles` | Parent/customer identity. Usually one row per normalized parent email. |
| `students` | Child/athlete identity, linked to `customer_profiles.parent_id`. |
| `academy_memberships` | The parent/child membership at BAM GTA. Required parent object for entitlements. |
| `member_links` | Bridge from legacy `members.id` to the new `students.id`. |

Identity backfill plan:

1. Select import candidates from `members`:
   - Include live members that map to the five active runtime prices.
   - Include Stefan as the manual/offline Summer Unlimited member.
   - Exclude paused and payment-method-required rows from active entitlement
     creation, but consider whether identity rows should still be created for
     account continuity. Recommendation for V1: create identity only for active
     entitlement import candidates unless product wants paused/problem accounts
     visible in the parent app.
2. Normalize parent emails to dedupe `customer_profiles`.
3. Create one `customer_profiles` row per parent email using existing
   `members.parent_name`, `members.parent_email`, and `members.parent_phone`.
4. Create one `students` row per athlete under that parent. Use the best
   available split of `members.athlete_name` into first/last name, preserving the
   full legacy name in notes/config if needed.
5. Create one `academy_memberships` row per imported student/customer pair:
   - `academy_id = BAM GTA client id`
   - `customer_id = customer_profiles.id`
   - `student_id = students.id`
   - `status` mirrors whether the account should be bookable; for V1 active
     import candidates should be active/live-equivalent.
   - Stripe fields are copied when available.
6. Create one `member_links` row per imported legacy member:
   - `member_id = members.id`
   - `student_id = students.id`
   - `matched_by = 'backfill'`
   - `confirmed_at = now()`
7. Only after these rows exist, insert `customer_entitlements`.

Local verification before entitlement insert:

- Every active import candidate has exactly one `member_links` row.
- Every linked student has a parent `customer_profiles` row.
- Every linked student has an `academy_memberships` row for BAM GTA.
- No two active import candidates with the same parent/athlete pair create
  duplicate students unless they are genuinely different children.

### 2. Add Price Visibility Before Price Inserts

`offer_prices` currently has `is_active` and `is_routable`, but it does not have
a way to express "active/direct checkout, but hidden from onboarding." Add one
explicit visibility field before inserting the five prices.

Recommended minimal column:

```sql
ALTER TABLE public.offer_prices
ADD COLUMN IF NOT EXISTS show_on_onboarding boolean NOT NULL DEFAULT true;
```

Runtime meaning:

- `is_active = true`: recognized by app/runtime and can grant entitlements.
- `is_routable = true`: allowed to resolve to a checkout/payment route.
- `show_on_onboarding = true`: included in public onboarding/offer pricing.

Checkout should allow `is_active = true AND is_routable = true` even when
`show_on_onboarding = false`. Public onboarding should additionally require
`show_on_onboarding = true`.

This is a real schema migration, not seed data. It must land in the migration
chain before any `offer_prices` insert depends on it.

### 3. Prepare Pricing Catalog Mappings

Use these five operational price keys for V1:

| Runtime price | Catalog action | Selected catalog row | Stripe price | Amount | Onboarding |
|---|---|---|---|---:|---:|
| `Summer Unlimited|monthly` | Already mapped/routable | `ed4fec70-2e13-448a-8ad1-744841be7ad9` | `price_1Ti6PCRxInSEtAh89gUsOSFj` | 31527 | yes |
| `Summer Unlimited|3_months` | Already mapped/routable | `a0bf4dd4-29c6-4cfd-b816-ff49b3a485ec` | `price_1Ti6PLRxInSEtAh8OprQcH9Q` | 85089 | yes |
| `Steady|monthly` | Already mapped/routable; display as 1/wk | `19515c88-2c61-46b1-b9a9-9da7bc849ca8` | `plan_ToNwa96lQ5I1Bs` | 22600 | yes |
| `Steady|3_months` | Map the unmapped routable 3-month row to this key | `e9ad2a0c-6653-4707-a1af-201d45c8364e` | `price_1SD3L5RxInSEtAh8FejEhM6T` | 54000 | no |
| `Steady|6_months` | Already mapped/routable; ignore the unmapped 100000 row unless Zoran says otherwise | `20152e0a-9032-4306-b3b8-a0148d467c33` | `price_1TgaMPRxInSEtAh8Hpa5wyTN` | 113000 | no |

Catalog cleanup required before/with the backfill:

- Set `pricing_catalog.offer_id` and `pricing_catalog.offer_price_key` on
  `e9ad2a0c-6653-4707-a1af-201d45c8364e` to the Training offer and
  `Steady|3_months`; mark it confirmed/routable if not already.
- No member is currently on `e9ad2a0c`. Aarnav is live, but he is on the older
  non-routable `8b5790fb-6e0a-42e9-85d8-914f49fca2b7` Stripe price.
- Keep older `Steady|3_months` rows non-routable/deprecated. Aarnav currently
  still points at an older non-routable Stripe price, but his runtime entitlement
  should resolve to the typed `Steady|3_months` price.
- Keep the unmapped `Steady - 6 Months` 100000 row excluded unless Zoran confirms
  that it should replace the currently mapped/routable 113000 row.
- Leave non-target routable catalog rows for `Accelerate`, `Elevate`, and
  `Dominate` unmapped or non-runtime. They should not appear once offer/checkout
  APIs cut over to typed `offer_prices`.

### 4. Insert Offer Options

Create exactly two active `offer_options` rows for BAM GTA Training:

| Option title | Source JSON key | Runtime meaning |
|---|---|---|
| `1/Wk` | `Steady` | One training credit per week. |
| `Summer Unlimited` | `Summer Unlimited` | Unlimited Training booking. |

Do not create active options for `Accelerate`, `Elevate`, or `Dominate` for the
V1 parent app runtime. If historical rows are ever needed, create them as
archived/non-runtime rows later.

### 5. Insert Offer Prices

Create exactly five `offer_prices` rows:

| `source_offer_price_key` | Title | Option | `is_active` | `is_routable` | `show_on_onboarding` |
|---|---|---|---:|---:|---:|
| `Steady|monthly` | `1/Wk - Monthly` | `1/Wk` | true | true | true |
| `Steady|3_months` | `1/Wk - 3 months` | `1/Wk` | true | true | false |
| `Steady|6_months` | `1/Wk - 6 months` | `1/Wk` | true | true | false |
| `Summer Unlimited|monthly` | `Summer Unlimited - Monthly` | `Summer Unlimited` | true | true | true |
| `Summer Unlimited|3_months` | `Summer Unlimited - 3 months` | `Summer Unlimited` | true | true | true |

Use `pricing_catalog` as the source of amount/currency/interval/Stripe ids. Use
`offers.data` only for copy and non-operational display content.

### 6. Insert Entitlement Templates

Create one `entitlement_templates` row per `offer_prices` row, all pointing to
the existing BAM GTA Training `bookable_programs` row.

| Runtime price | Entitlement |
|---|---|
| `Steady|monthly` | `WEEKLY_CREDITS`, `credits_per_period = 1`, `credit_period = 'WEEK'`, one credit per booking. |
| `Steady|3_months` | Same as `Steady|monthly`. |
| `Steady|6_months` | Same as `Steady|monthly`. |
| `Summer Unlimited|monthly` | `UNLIMITED_BOOKING`, `is_unlimited = true`. |
| `Summer Unlimited|3_months` | `UNLIMITED_BOOKING`, `is_unlimited = true`. |

### 7. Import Customer Entitlements

After the price/template backfill is reviewed, import active booking
entitlements from the current member state.

This step is blocked until **Build The Identity Spine First** is complete.

Current July 1 live import targets:

| Source member state | Count | Runtime entitlement |
|---|---:|---|
| `Summer Unlimited|monthly` live | 17 | Unlimited Training. |
| `Summer Unlimited|3_months` live | 3 | Unlimited Training. |
| `Steady|monthly` live | 8 | One Training credit per week. |
| `Steady|3_months` live | 1 | One Training credit per week. |
| Manual/offline Stefan row | 1 | Summer Unlimited manual entitlement. |

Manual/offline member handling:

- Create or link the missing parent-facing identity rows for Stefan/Sladjana:
  `customer_profiles`, `students`, `academy_memberships`, and `member_links` as
  needed.
- Insert a `customer_entitlements` row with `source = 'manual'`,
  `source_ref = 'paid_cash:<legacy_member_id>'`, the Summer Unlimited
  `source_offer_price_id`, the matching entitlement template id, and `config`
  metadata such as `{"payment_method":"cash","source_member_id":"..."}`.
- Do not invent a fake Stripe price or subscription.

Do not create active booking entitlements for paused or payment-method-required
members. Current July 1 excluded counts:

- 2 paused members.
- 7 payment-method-required members.

If any excluded member later becomes live, their membership should first be
mapped to one of the five active runtime prices above, then imported/granted.

### 8. Cut Over APIs

The current website offer API still builds public pricing from active
`offers.data.pricing.pricing_offerings`, which means it can expose any active
JSON commitment that has a routable catalog row. After this backfill:

- `api/website/offer.js` should read typed `offer_options` / `offer_prices`.
- Public pricing should filter `show_on_onboarding = true`.
- `api/website/checkout.js` should resolve by typed `offer_price_id`, not by
  client-provided amount or JSON-derived key.
- Checkout should allow direct checkout prices where `show_on_onboarding =
  false`, as long as `is_active = true` and `is_routable = true`.

### 9. Local Verification

Prepare the migration/seed locally, run `supabase db reset`, and verify:

- The identity spine exists for all active import candidates:
  `customer_profiles`, `students`, `academy_memberships`, and `member_links`.
- `offer_options` has exactly two active Training options.
- `offer_prices` has exactly five active/routable Training prices.
- Only three prices have `show_on_onboarding = true`.
- `entitlement_templates` has exactly five Training templates and each points to
  the Training `bookable_programs` row.
- Active customer entitlement import produces 30 active booking entitlements:
  29 mapped live members plus 1 manual/offline Summer Unlimited entitlement.
- Paused/payment-method-required rows produce no active booking entitlements.
- The offer API returns only Summer monthly, Summer 3-month, and 1/wk monthly
  for onboarding.
- Direct checkout can still resolve 1/wk 3-month and 1/wk 6-month.

Do not push production writes until Luka reviews the local backfill and API
cutover behavior.
