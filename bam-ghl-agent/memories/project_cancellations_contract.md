# cancellations table - the shared write contract (churn source of truth)

**Why this note exists:** multiple efforts write cancel/churn data. This is the
one contract they must all honor so the Shield KPI churn numbers stay correct.
Read this before touching cancel writes in ANY chat. Related:
[[project_member_mgmt_kpis]] (readers), [[project_v2_onboarding_model]] (import step).

## The rule

`cancellations` (type='cancel') is the ONLY source of truth for churn, because
cancelled members are hard-deleted from `members`. Every KPI churned cohort
(count, churn rate, avg tenure/monthly/spend comparison) reads this table via
`GET /api/members?action=cancellations`. **If a cancel is not a row here, it did
not happen as far as the KPIs are concerned.**

## Who writes it today (2026-07-18)

| Writer | File | source= | Has member_id? | Has sub_id? |
|---|---|---|---|---|
| Portal cancel | `api/members.js` actionCancel | `staff_portal` / `parent_app` | yes | yes |
| Stripe/dunning | `api/stripe/webhook.js` handleSubDeleted | `stripe` | yes | yes |
| Historical backfill | `scripts/backfill-cancellations.mjs` | (leaves source) | yes | yes |
| Onboarding cancelled import | `api/members/import-cancelled.js` POST | `import` | null (pre-platform) | yes |

## The GAP — CLOSED 2026-07-18 (Plan 5 / WS5)

`api/members/import-cancelled.js` now writes BOTH contacts (tag + custom_fields
jsonb for win-back, unchanged) AND `cancellations` rows per the contract below.
Extras the rebuild added on top of the contract:
- **Chains**: a sub ending within 14 days of the same customer's next sub
  starting = plan switch, folded (one churn row per chain-terminal end only).
- **Came-backs**: customers with a LIVE Stripe sub are excluded (not churn),
  even if they aren't portal members yet.
- **Guardrail flags** (bulk-cleanup day 10+, cancel-before-join, $0 plan,
  unreachable): flagged rows default `exclude_churn` in the UI - a human must
  count them in (editable cancel date rides as `cancel_date_override`).
- Enrichment happens at POST: paid invoices per chain sub → total_spent_cents /
  payments_count / earliest-paid joined_date; monthly cents decoded from the
  RAW Stripe price (interval/interval_count); plan_name/offer_id via
  pricing_catalog. 409 on the sub-id unique index = already imported, skipped.

## Contract for the import (or any new writer)

Insert one `cancellations` row per cancelled subscription with:

- `type='cancel'`, `source='import'`, `involuntary=false` (true only if known dunning)
- `cancel_date` = Stripe `canceled_at`/`ended_at` (the real end, not import day)
- Enrich from Stripe exactly like `scripts/backfill-cancellations.mjs`:
  - sub `start_date` (or earliest paid invoice) -> `joined_date`
  - price -> `stripe_price_id` + `monthly_amount_cents` (CENTS, decode term via
    `interval_count`; the import's `custom_fields.last_monthly_amount` is DOLLARS - do not reuse raw)
  - paid invoices -> `total_spent_cents` + `payments_count`
  - `pricing_catalog` -> `plan_name` + `offer_id`
- `member_id = null` (pre-platform cancels have no member row)
- **KEEP `stripe_subscription_id`** (do not collapse-by-customer and discard it) -
  the unique index `cancellations_one_cancel_per_sub` is what makes re-import
  idempotent. On 409 duplicate, treat as already-imported, skip.
- Idempotency backstop: partial UNIQUE indexes are one-cancel-per-sub and, when no
  sub, one-cancel-per-member. Imports have neither collapsible key if you drop the
  sub id -> re-import WILL duplicate. Keep the sub id.

The contacts tag write stays (win-back nurture). This is ADDITIVE: import writes
BOTH contacts (nurture) AND cancellations (KPIs).

## Open product decision (Zoran)

Should imported historical cancels count in the monthly CHURN RATE, or only in
the churned-cohort comparison (avg tenure/monthly/spend)? They have no matching
"live at that time" denominator from before the academy was on the platform.
Recommendation: comparison YES, monthly churn-rate NO - filter on
`source != 'import'` for rate math, include all for the cohort averages. The
`source` column already exists to make this filter possible.

## Migration coordination

This chat added on 2026-07-16 (already applied to prod):
`20260716213000_cancellation_snapshots.sql` (snapshot cols) +
`20260716224500_cancellation_dedup_and_reason_category.sql` (reason_category +
unique indexes). All `IF NOT EXISTS`. Another chat adding columns: new migration
AFTER these, additive only, do not re-add/rename these columns or drop the
indexes.
