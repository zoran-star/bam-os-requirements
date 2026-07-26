---
domain: member-lifecycle-economics
review_state: ready-for-review
prototype_status: live
core_parity: not-reviewed
last_reviewed: "2026-07-25"
prototype_commit: working-tree
core_commit_reviewed: unknown
---

# Member Lifecycle Economics: Prototype-to-Core Handoff

## Summary

- What the prototype implements: append-only `cancellations` event table now
  snapshots a member's economics at cancel time (join date, plan, price,
  monthly value, lifetime spend, cancel source, voluntary vs involuntary),
  because cancelled members are hard-deleted from `members`. `members` gained
  running lifetime-spend columns refreshed from Stripe paid invoices. Powers
  churned-vs-active KPI comparisons (avg tenure, avg monthly revenue, avg
  total spend) in the Shield member-manager focus.
- Intended production direction: core should model membership lifecycle as
  status transitions on a durable membership record (no row deletion), making
  most of these snapshots derivable instead of copied. Until then the
  snapshot columns are the recoverable record.
- **2026-07-25 (Build T, money model):** SALES TAX became an academy-level
  TEMPLATE. New additive column `clients.tax_config jsonb` ({label, pct};
  NULL = no tax). Each price/commitment carries `taxable` yes/no inside
  `offers.data.pricing`, replacing free-text `added_fees` strings that were
  regex-parsed at charge time. `bam-portal/api/_fees.js resolveFee()` is THE
  precedence rule (template + per-row taxable, legacy free text only when an
  academy has no template), so unmigrated academies are byte-identical.
- Suggested core owner: memberships/billing domain (tax belongs in a pricing
  or tax-config domain once core has one).
- NOTE: core repo `Full-Control/fc-core-srvc` was NOT reachable from this
  machine's GitHub auth on 2026-07-16 (repository not found). Parity below is
  therefore proposed, not verified against core. Verify on next core review.

## References

- **Prototype:** `bam-ghl-agent/bam-portal/supabase/migrations/20260716213000_cancellation_snapshots.sql`,
  `bam-ghl-agent/bam-portal/api/_runtime/cancellation-snapshot.js`,
  `bam-ghl-agent/bam-portal/api/members.js` (actionCancel, `action=spend-sync`, `action=cancellations`),
  `bam-ghl-agent/bam-portal/api/stripe/webhook.js` (handleSubDeleted),
  `bam-ghl-agent/bam-portal/scripts/backfill-cancellations.mjs`
- **Prototype (Build T, 2026-07-25):**
  `bam-ghl-agent/bam-portal/supabase/migrations/20260725032941_clients_tax_config.sql`,
  `.../20260725033015_restore_update_client_basics_full_whitelist.sql`,
  `bam-ghl-agent/bam-portal/api/_fees.js` (`taxFee`, `resolveFee`),
  `bam-ghl-agent/bam-portal/api/offers/match-prices.js` (target building),
  `bam-ghl-agent/bam-portal/public/client-portal.html` (Blueprint General
  sales-tax card + wizard `taxable` fields), plan `bam-ghl-agent/docs/money-model-plan.md`
- **Core reviewed:** none (repo `Full-Control/fc-core-srvc` unreachable again
  on 2026-07-25: "repository not found" from this machine's GitHub auth)

## Intended Model

| Concept | Purpose | Relationships and scope |
|---|---|---|
| Cancellation event (append-only) | Immutable record that a membership ended or paused, with frozen economics | `client_id` tenant scope; `member_id` (SET NULL after member delete); provider IDs `stripe_subscription_id`, `stripe_customer_id`, `stripe_price_id`; `offer_id` scope |
| Economics snapshot | `joined_date`, `plan_name` (label only), `monthly_amount_cents`, `total_spent_cents`, `payments_count` frozen at cancel | Written best-effort by both cancel paths; backfillable from Stripe |
| Churn attribution | `source` (staff_portal, parent_app, stripe) + `involuntary` (Stripe `cancellation_details.reason = payment_failed` = dunning) | Voluntary vs involuntary churn split |
| Member lifetime spend | `members.total_spent_cents`, `payments_count`, `spend_synced_at` | Refreshed by one paginated paid-invoice sweep per connected account |
| Academy tax template (2026-07-25) | ONE sales-tax config per academy, any name + rate, so tax is never retyped per price | `clients.tax_config jsonb {label, pct}`; NULL = academy charges no tax. Tenant-scoped by living on the tenant row itself. Owner-edited via the `update_client_basics` SECURITY DEFINER RPC (whitelist), not a direct table write |
| Per-price taxability (2026-07-25) | Each price/commitment opts out of the template | `taxable: "Yes"/"No"` inside `offers.data.pricing.pricing_offerings[]` (and `.commitments[]`, which inherits the plan's answer when unset). Setting the template IS the opt-in: unset rows count as taxable |
| One-time sign-up fee (2026-07-25) | A fee charged ONCE per athlete at enrollment, never on renewals | Stored as a real catalog row keyed `<plan>|signup_fee` with `billing_interval='one_time'`, so it carries its own `stripe_price_id` + `stripe_product_id` (targetable by coupons later). Tie to the plan is the key's plan-name half. Per-option charge/waive lives in `offers.data.pricing` (`signup_fee_on_base`, per-commitment `signup_fee_charge`). Billed via Stripe `add_invoice_items` on the first invoice only |
| Membership birth boundary (2026-07-18) | A membership exists only once the first payment lands. Pre-payment enroll-form checkouts live in `members` as shells (`status='payment_method_required'` + `signup_origin`) purely for retry idempotency + webhook activation; every roster read hides them and the person stays a LEAD in the pipeline | `members.signup_origin` text CHECK: `website_enroll` (public enroll/onboarding form or GHL intake webhook), `convert` (staff pipeline-convert), `wizard` (historical returning-client shells; no longer created), `collecting` (a REAL member whose card is being re-collected - visible on the roster), NULL = legacy/visible. Migration `20260718150000_members_signup_origin.sql` backfills from `member_audit_log` action types |

## Parity

| Prototype concept or behavior | Core mapping | Status | Next action |
|---|---|---|---|
| Hard-delete of cancelled members + snapshot on event row | Core membership record with lifecycle statuses (no delete) | `decision-needed` | Core should keep membership rows; snapshots then become derivable views |
| `cancellations` append-only event | Core membership-event / audit stream | `missing` | Map columns 1:1 when the core event model exists |
| `monthly_amount_cents` term decode (4_weeks, 3_months, one_time) | Core price normalization service | `missing` | Single shared monthly-equivalent function in core; prototype has twins in `cancellation-snapshot.js` + `client-portal.html _ccMonthly` |
| Lifetime spend from Stripe paid invoices | Core payments ledger | `missing` | Core ledger makes the Stripe sweep unnecessary |
| `involuntary` flag from Stripe cancellation_details | Core churn-reason enum | `missing` | Promote to enum (voluntary, dunning, migrated, other) |
| Coupon applicability (2026-07-25) | A discount code declares WHICH prices and fees it touches | Owner-set `applies_to[]` of `<plan>|<term>` keys in `offers.data.pricing.discount_codes[]`. Compiled to Stripe `applies_to[products]` for recurring lines and to a per-invoice-item discount for the one-time fee. Empty = applies to everything (legacy behaviour) | `missing` | Core should model discount scope as explicit line-type/product targeting, not an implicit invoice-wide discount |
| Sign-up fee as a one-time catalog row | Core should model non-recurring charges as first-class order lines, not as price rows flagged one_time | `missing` | The prototype reuses the price catalog so the fee inherits Stripe product identity and the existing sync pipeline. Core wants an explicit order/line-item concept; the fee then stops being a "price" |
| Fee rides ENROLLMENT events only | Core membership-creation event | `missing` | Critical invariant: the fee must never attach to plan changes, cancel-and-recreate repairs, commitment reverts, or pause/resume, or a staff rebuild silently re-charges it. Prototype enforces it structurally (only `api/website/checkout.js` attaches it; reuse branches return earlier) |
| Academy tax template + per-price `taxable` | Core tax-configuration on the tenant, with a taxability flag on each price | `missing` | Core should own tax as structured config (ideally supporting multi-rate later); prototype ships single-rate v1 deliberately |
| `resolveFee()` precedence (template, else legacy free text) | Core price normalization / tax service | `missing` | Same shared-function point as the monthly-equivalent decode above: core should expose ONE all-in calculator both catalog build and checkout call |
| Pre-payment checkout shells inside `members` (`signup_origin`) | Core should model in-flight checkout as LEAD-side state (a checkout/enrollment-intent record on the sales side), creating the membership only on first payment | `decision-needed` | When core owns checkout, drop the shells; the enroll-form-filled event maps to a lead-timeline event (provider IDs preserved: `stripe_customer_id`, `stripe_subscription_id`, `ghl_opportunity_id`, `ghl_contact_id`, `parent_email`) |

## Decisions And Shortcuts

| Item | Reason | Core impact or replacement |
|---|---|---|
| Snapshot is best-effort (never blocks a cancel) | Cancel must succeed even if Stripe/catalog lookups fail | Core should compute from its own ledger, not at event time |
| `plan_name` stored as label | Display only; durable identity is `stripe_price_id` + `offer_id` | Do not treat plan_name as an identifier |
| Historical join dates = earliest PAID invoice | June-2026 Stripe migration recreated subs with fake start dates | Same correction needed for live `members.joined_date` (pending Zoran sign-off) |
| Duplicate cancel rows exist (same member 2-3x) | No idempotency guard on portal cancel insert | KPI reads dedupe by `stripe_customer_id`; add partial unique index later |
| Fee charge/waive is explicit per option, never defaulted | Zoran: "not by default, i want to set it". An unanswered option charges nothing, so a legacy or half-configured offer cannot surprise a parent | Core should keep the tri-state (charge / waive / unset = no charge) rather than a boolean defaulting to true |
| Fee is per ATHLETE and charged again on re-enrollment | One checkout = one athlete, so siblings pay per enrollment with no special casing; a returning member is a new enrollment event | Core: bind the fee to the enrollment event, not to the customer or the household |
| Fee is refundable inside the academy's refund window | Zoran 2026-07-25, same treatment as the plan payment | Core refund logic must include one-time lines, not just recurring |
| Coupon edits mint a NEW Stripe coupon | Stripe coupons are immutable, so an applicability change cannot be patched in place; the idempotency fingerprint includes the product set | Core needs a discount-version concept: subscriptions keep the discount they were created with, new checkouts get the new one |
| Ticked keys that resolve to no live price REFUSE creation | Returning "unrestricted" would be the exact opposite of the owner's intent | Core should treat an empty resolved scope as an error, never as a wildcard |
| Fee suppressed for academies with UNRESTRICTED discount codes | Until coupon applicability (Build C) ships, a sub-level Stripe coupon discounts every invoice line including the fee | Remove the gate once per-line coupon targeting exists |
| `taxable` lives in `offers.data` JSON, not a column | The whole pricing wizard is already JSON (`pricing_offerings[]`); a column would fork the shape | Core should normalize pricing options into real rows; `taxable` becomes a boolean column then. Migration caveat: read it as a STRING ("Yes"/"No"), not a boolean |
| Single tax rate per academy (no GST+PST split, no per-item exemptions beyond yes/no) | v1 scope; no live academy needs more (risk 10 of the money-model plan) | Core should model tax as a list of rates with jurisdiction, not one percent |
| Tax-rate edits do NOT re-price existing Stripe prices | Stripe prices are immutable; a silent recompute would recreate the quoted-vs-charged gap this whole project closed | Owner-facing copy says so explicitly; re-pricing goes through the existing Price Match flow. Core needs an explicit re-price workflow, never an implicit one |
| Legacy free-text `added_fees` strings retained in `offers.data` | Academies with no template keep working byte-identically until migrated | Core drops them once every academy has a template; they are read ONLY when `tax_config` is NULL |
| `offer_id` plain UUID, no FK | `offers` table is created outside the migrations chain; FK breaks local replay | Core gets a real FK |
