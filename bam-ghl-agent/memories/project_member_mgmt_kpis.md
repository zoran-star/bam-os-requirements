# Member-management KPI page (planned) + MRR calculation gotchas

**Status 2026-07-16:** KPI list agreed with Zoran; MRR math fixed (#1466); page not built yet.

## The plan

A second "left page" in the Shield members focus (the roster ↔ contact column shipped in #1464): a **Roster ↔ KPIs toggle** in the same left column. All KPIs scoped to the **training offer** (via `members.offer_id`), adjustable time window, default **MTD**. These academies have no parent app, so everything comes from the billing/roster spine - no attendance/engagement data.

Agreed KPI list:

| KPI | Source / note |
|---|---|
| Cancellations (windowed) | `cancellations` table (type=cancel, `cancel_date`) |
| Churn rate | **last full month only** (Zoran's call): cancels ÷ month-start live count |
| New members | `joined_date` in window |
| Avg revenue / member (ARPM) | `_ccMonthly` per live member (fixed, see below) |
| MRR | **status='live' ONLY** (Zoran 2026-07-16: cancelling members are leaving, don't count them); paused excluded; cancelling surfaces as `pendingCancel` in `_ccMemberKpis` |
| Live / paused counts | roster statuses |
| Members per pricing + live vs archived price counts | roster × `pricing_catalog` (tier, `offer_price_key`) |
| Pending cancels | `status='cancelling'` - churn still savable |
| Net growth | new − cancelled |
| MRR movement | +new MRR / −churned MRR in window |
| $ at risk | payment_failed / payment_method_required count + monthly value |
| Paused MRR | parked revenue |
| Avg tenure (months) | best retention proxy without app data |

## Gotchas (learned the hard way)

1. **`pricing_catalog.interval` speaks TERM vocabulary**, not raw Stripe intervals: `4_weeks`, `3_months`, `6_months`, `week`, `month`, `year`, `one_time` (see `api/offers/create-price.js` `termToInterval`). Stripe's `interval_count` is baked into the term string and is NOT in the roster payload.
2. **`_ccMonthly` (client-portal.html) is the SINGLE MRR engine** - Shield KPIs, Home dashboard MRR, Hawkeye Mission Control, growth sparklines, ARPU all run through it. Before #1466 it ignored terms: 3-month prices counted 3x over, 6-month 6x over, 4_weeks ~8% under, one_time counted as recurring. Now decodes any `N_unit` term generically (day/week/month/year units, e.g. `2_weeks`, `9_months` work with no code change) + zeroes out one_time/onetime/once. If you add a weirder term shape to `termToInterval`, make sure `_ccMonthly`'s regex still decodes it.
3. **Cancelled members are DELETED from `members`** (immediately, or at period end via the `customer.subscription.deleted` webhook). Churn/cancellation KPIs MUST read the append-only `cancellations` table, never the roster.
4. **`cancellations` rows don't carry `offer_id`** - scoping churn to the training offer needs a join back through `stripe_subscription_id` / `pricing_catalog`.
5. Catalog `hst_mode` mixes `all_in` and `pre_tax`, so MRR/ARPU are tax-inconsistent approximations - keep the "approx" label in the UI.

Related: [[project_offer_price_mapping]], [[project_offer_tie_in]]
