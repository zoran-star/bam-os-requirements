# Member-management KPI + Actions pages (planned) + MRR calculation gotchas

**Status 2026-07-16:** KPI list + mockup approved by Zoran ("those are all the numbers i need"); THIRD left page added to the plan: **Actions** (client action items). Pages not built yet.

## The plan

Left pages in the Shield members focus (the roster ↔ contact column shipped in #1464): a **Roster | KPIs | Actions toggle** in the same left column (Actions tab carries an open-count badge). All scoped to the **training offer** (via `members.offer_id`), adjustable time window, default **MTD**. These academies have no parent app, so everything comes from the billing/roster spine - no attendance/engagement data.

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

## Actions page - the action-item catalog (agreed 2026-07-16)

Grouped by urgency; every row = member + issue + $/mo value + one-tap action; tapping the member opens their contact card in the same column; tapping the action has Shield draft it in chat. Sales-side cards (post-trial, booking) stay in Hawkeye - this page is member-side only.

**Money (red, act today):** payment failed (retry / payment link) · no card on file / card expiring before next bill (card-update link) · past-due invoice.
**Leaving (amber, savable):** pending cancel with period-end date + reason (save offer / exit call) · pause ending soon (confirm return) · pause scheduled (prep) · paused past pause_end but not resumed (unpause or cancel).
**Milestones (gold, loyalty):** member anniversaries 1/3/6/12 mo (congrats) · commitment term (3mo/6mo) ending soon (renewal conversation) · new member first week (check-in).
**Hygiene (neutral):** member on archived/legacy price (migrate to live pricing) · uncatalogued Stripe price (fix mapping) · missing agreement/waiver (chase signature) · missing phone/email on contact.
**Win-back (future):** recently cancelled 30-60d ago from `cancellations` (re-engage offer).

## Gotchas (learned the hard way)

1. **`pricing_catalog.interval` speaks TERM vocabulary**, not raw Stripe intervals: `4_weeks`, `3_months`, `6_months`, `week`, `month`, `year`, `one_time` (see `api/offers/create-price.js` `termToInterval`). Stripe's `interval_count` is baked into the term string and is NOT in the roster payload.
2. **`_ccMonthly` (client-portal.html) is the SINGLE MRR engine** - Shield KPIs, Home dashboard MRR, Hawkeye Mission Control, growth sparklines, ARPU all run through it. Before #1466 it ignored terms: 3-month prices counted 3x over, 6-month 6x over, 4_weeks ~8% under, one_time counted as recurring. Now decodes any `N_unit` term generically (day/week/month/year units, e.g. `2_weeks`, `9_months` work with no code change) + zeroes out one_time/onetime/once. If you add a weirder term shape to `termToInterval`, make sure `_ccMonthly`'s regex still decodes it.
3. **Cancelled members are DELETED from `members`** (immediately, or at period end via the `customer.subscription.deleted` webhook). Churn/cancellation KPIs MUST read the append-only `cancellations` table, never the roster.
4. **`cancellations` rows don't carry `offer_id`** - scoping churn to the training offer needs a join back through `stripe_subscription_id` / `pricing_catalog`.
5. Catalog `hst_mode` mixes `all_in` and `pre_tax`, so MRR/ARPU are tax-inconsistent approximations - keep the "approx" label in the UI.

Related: [[project_offer_price_mapping]], [[project_offer_tie_in]]
