---
domain: member-lifecycle-economics
review_state: ready-for-review
prototype_status: live
core_parity: not-reviewed
last_reviewed: "2026-07-18"
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
- Suggested core owner: memberships/billing domain.
- NOTE: core repo `Full-Control/fc-core-srvc` was NOT reachable from this
  machine's GitHub auth on 2026-07-16 (repository not found). Parity below is
  therefore proposed, not verified against core. Verify on next core review.

## References

- **Prototype:** `bam-ghl-agent/bam-portal/supabase/migrations/20260716213000_cancellation_snapshots.sql`,
  `bam-ghl-agent/bam-portal/api/_runtime/cancellation-snapshot.js`,
  `bam-ghl-agent/bam-portal/api/members.js` (actionCancel, `action=spend-sync`, `action=cancellations`),
  `bam-ghl-agent/bam-portal/api/stripe/webhook.js` (handleSubDeleted),
  `bam-ghl-agent/bam-portal/scripts/backfill-cancellations.mjs`
- **Core reviewed:** none (repo unreachable; see NOTE above)

## Intended Model

| Concept | Purpose | Relationships and scope |
|---|---|---|
| Cancellation event (append-only) | Immutable record that a membership ended or paused, with frozen economics | `client_id` tenant scope; `member_id` (SET NULL after member delete); provider IDs `stripe_subscription_id`, `stripe_customer_id`, `stripe_price_id`; `offer_id` scope |
| Economics snapshot | `joined_date`, `plan_name` (label only), `monthly_amount_cents`, `total_spent_cents`, `payments_count` frozen at cancel | Written best-effort by both cancel paths; backfillable from Stripe |
| Churn attribution | `source` (staff_portal, parent_app, stripe) + `involuntary` (Stripe `cancellation_details.reason = payment_failed` = dunning) | Voluntary vs involuntary churn split |
| Member lifetime spend | `members.total_spent_cents`, `payments_count`, `spend_synced_at` | Refreshed by one paginated paid-invoice sweep per connected account |
| Membership birth boundary (2026-07-18) | A membership exists only once the first payment lands. Pre-payment enroll-form checkouts live in `members` as shells (`status='payment_method_required'` + `signup_origin`) purely for retry idempotency + webhook activation; every roster read hides them and the person stays a LEAD in the pipeline | `members.signup_origin` text CHECK: `website_enroll` (public enroll/onboarding form or GHL intake webhook), `convert` (staff pipeline-convert), `wizard` (historical returning-client shells; no longer created), `collecting` (a REAL member whose card is being re-collected - visible on the roster), NULL = legacy/visible. Migration `20260718150000_members_signup_origin.sql` backfills from `member_audit_log` action types |

## Parity

| Prototype concept or behavior | Core mapping | Status | Next action |
|---|---|---|---|
| Hard-delete of cancelled members + snapshot on event row | Core membership record with lifecycle statuses (no delete) | `decision-needed` | Core should keep membership rows; snapshots then become derivable views |
| `cancellations` append-only event | Core membership-event / audit stream | `missing` | Map columns 1:1 when the core event model exists |
| `monthly_amount_cents` term decode (4_weeks, 3_months, one_time) | Core price normalization service | `missing` | Single shared monthly-equivalent function in core; prototype has twins in `cancellation-snapshot.js` + `client-portal.html _ccMonthly` |
| Lifetime spend from Stripe paid invoices | Core payments ledger | `missing` | Core ledger makes the Stripe sweep unnecessary |
| `involuntary` flag from Stripe cancellation_details | Core churn-reason enum | `missing` | Promote to enum (voluntary, dunning, migrated, other) |
| Pre-payment checkout shells inside `members` (`signup_origin`) | Core should model in-flight checkout as LEAD-side state (a checkout/enrollment-intent record on the sales side), creating the membership only on first payment | `decision-needed` | When core owns checkout, drop the shells; the enroll-form-filled event maps to a lead-timeline event (provider IDs preserved: `stripe_customer_id`, `stripe_subscription_id`, `ghl_opportunity_id`, `ghl_contact_id`, `parent_email`) |

## Decisions And Shortcuts

| Item | Reason | Core impact or replacement |
|---|---|---|
| Snapshot is best-effort (never blocks a cancel) | Cancel must succeed even if Stripe/catalog lookups fail | Core should compute from its own ledger, not at event time |
| `plan_name` stored as label | Display only; durable identity is `stripe_price_id` + `offer_id` | Do not treat plan_name as an identifier |
| Historical join dates = earliest PAID invoice | June-2026 Stripe migration recreated subs with fake start dates | Same correction needed for live `members.joined_date` (pending Zoran sign-off) |
| Duplicate cancel rows exist (same member 2-3x) | No idempotency guard on portal cancel insert | KPI reads dedupe by `stripe_customer_id`; add partial unique index later |
| `offer_id` plain UUID, no FK | `offers` table is created outside the migrations chain; FK breaks local replay | Core gets a real FK |
