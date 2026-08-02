# Commission & BAM Payment Calculator

2026-07-25 BUILT (Mike's spec, off the Scaling System Partner Agreement growth-share clause). Cole/Claude session; PR pending Zoran review.

## The model

Payment terms live ON the client record (set by admin in the new **Commissions** staff-portal tab; SM = existing `clients.scaling_manager_id`):

- `payment_model` = `flat_retainer` | `growth_percentage`
- Flat: `flat_amount` only. No growth math, no SM commission, excluded from reports.
- Growth: `base_retainer` (default $599) · `baseline_revenue` (**locked 9 months** via `baseline_locked_until` - per Mike, supersedes the template's 6-month min; re-enter on agreement renewal with explicit confirm, re-locks 9 months) · `growth_share_pct` · `subscription_renewal_date` (anchors the cycle) · `revenue_integration_connection` (`stripe_connect` live, `ghl` reserved/not wired)

Per cycle (anchored to EACH client's own renewal date, Jul 25 -> Aug 25 -> ..., day clamped for short months, no proration):

```
growth  = max(0, gross - baseline)        gross = RAW (no refund netting, per spec)
fee     = growth_share_pct% x growth      ("BAM commission")
total   = base_retainer + fee             (no-growth month: just the $599 base)
sm_comm = $250 + 25% x fee                (ONLY when growth > 0)
```

## The plumbing

- Migration `20260725121000_commission_calculator.sql`: clients columns + `commission_cycles` snapshot table (unique client+cycle_date; RLS staff-read scoped admin-all/SM-own via my_client_ids, clients NEVER see it).
- `api/commissions.js`: overview/cycles (admin all, SM own) · save-settings (admin, baseline lock) · run-cycle (admin manual/preview/`gross_override` for failed pulls) · `cron-cycles` (daily 12:00 UTC - closes cycles whose renewal anniversary is today-ET, pulls gross from the academy's connected Stripe account, snapshots, creates the Stripe invoice) · `cron-reports` (daily 12:30 UTC).
- **Invoice**: platform `STRIPE_SECRET_KEY` + `clients.stripe_customer_id`, invoiceitems + finalized `send_invoice` invoice, due = 5 business days (Agreement §2), footer references the $50/day late fee after 3-day grace (NOT automated - manual). `auto_advance:false`; Anna+Cole collect manually.
- **Reports** (growth clients only, decoupled from invoicing): 2 windows/month = 3 business days (Mon-Fri ET) before the 1st and before the 15th. Batch rule: renewal 1st-15th -> "fifteenth" batch; 16th-EOM -> "first" (of next month). PDF (`api/_lib/commission-pdf.js`, pdf-lib) emailed via Resend to `COMMISSION_REPORT_EMAILS` (default Anna acallon@gmail.com + Cole cole@byanymeansbball.com); `report_sent_at` stamped. SM payout is manual - the report is the calc record.
- **Pull failure** = never silent: cycle stored `revenue_pull_status='failed'`, NO invoice, email alert to `COMMISSION_ALERT_EMAILS` (default mike@byanymeansbusiness.com + cole@byanymeansbball.com since 2026-07-25). Admin fixes + re-runs with `gross_override`.
- `api/_email.js` `sendEmail()` gained optional `attachments` (base64 passthrough to Resend).
- Frontend: `src/views/CommissionsView.jsx`, nav key `commissions`, `canSeeCommissions` = admin | scaling_manager.

## Gotchas / open

- GHL revenue source is a stub - selecting it fails the pull (alert path) until a GHL payments integration is wired.
- Client needs `stripe_customer_id` (platform) or invoicing errors -> stored as `invoice_status='error'` + alert.
- `STRIPE_SECRET_KEY` needs WRITE scope for invoiceitems/invoices (env README said read-only restricted key).
- Env vars (optional overrides only, defaults are correct per spec): `COMMISSION_ALERT_EMAILS`, `COMMISSION_REPORT_EMAILS`.

## Gross revenue by month (2026-08-02) - the Commissions page's headline number

The page opens on **last calendar month's gross revenue per academy**, plus a
total tile. Click any row for **month-by-month gross, 12 months back**, with a
bar per month and a MoM % delta.

**Calendar months, NOT cycle windows.** A cycle runs renewal-date to
renewal-date (Jul 25 -> Aug 25); "last month" means Jul 1 -> Aug 1, which is
what the academy owner sees in their own Stripe. Never collapse the two - the
column would print a number that disagrees with the client's own screen.
`api/_commission-monthly-revenue.test.mjs` pins this (mutation-checked).

- `api/commissions.js` `?action=monthly-revenue` - no `client_id` = last
  completed month for every visible client (parallel fan-out); with `client_id`
  = that client's last N months (max 24, sequential to avoid rate-limiting one
  academy's account). Loaded SEPARATELY from `?action=overview` so the table
  paints off Supabase while Stripe fills in behind it.
- Reads live from the academy's Stripe through the transport seam, so
  direct-key academies work too. Same RAW gross as the cycle engine (no refund
  or chargeback netting, Agreement §4). Independent of `payment_model`, so
  flat-retainer academies get a revenue number too (the cycle engine never
  pulls for them).
- `grossForMonth()` **never throws** - every month returns `ok` /
  `not_connected` / `failed`. One academy with a broken Stripe must not blank
  the column for the others. `not_connected` renders as the words "not
  connected", never as a dash: **a dash reads as $0**, and a real $0 month must
  not look like an unlinked Stripe.
- Cache: 6h per lambda instance, keyed client+month. Safe ONLY because completed
  months are immutable. **Failures are deliberately not cached** so a transient
  Stripe outage retries on the next load instead of sticking for six hours.

**Fixed in the same change:** `stripeGetAll` guarded on `STRIPE_SECRET_KEY`
alone, but the transport seam it calls uses `STRIPE_CONNECT_SECRET_KEY ||
STRIPE_SECRET_KEY`. A prod holding only the Connect key would have failed every
revenue read while every other Stripe feature kept working. Now accepts either.

### Why an academy shows "not connected" (this is data, not a bug)

Stripe Connect OAuth is a **client-portal** action - the academy owner clicks
Connect Stripe in their own portal (`public/client-portal.html` `connectStripe()`
-> `api/stripe/connect.js`). Staff cannot do it for them. Platform-locked
academies (CoachIQ-style) instead need a staff-pasted restricted `rk_live_` key
via `StripeContactLinkView` -> `client_stripe_direct` (table applied 2026-08-01,
**zero rows**). Until one of those two happens there is genuinely no revenue to
read. To see who is connected:

```sql
select business_name, payment_model, subscription_renewal_date,
       revenue_integration_connection, stripe_connect_account_id
from clients where archived_at is null order by business_name;
```
