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
