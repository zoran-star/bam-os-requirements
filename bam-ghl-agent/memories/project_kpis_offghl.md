# KPIs off GHL - plan (Zoran, 2026-07-01)

Last core migration for BAM GTA (messaging/email/pipeline/contacts already portal-native).
Scope: **Training offer only** for now.

## Zoran's plan (verbatim intent)
Two separate tracks, built in this order:

1. **Accurate tracking NOW (build first)** - figure out how every KPI gets tracked
   accurately going forward from portal-native events, then build that. No GHL.
2. **KPI sandbox (plan + build after #1)** - historical KPIs that were collected in GHL:
   - Full GHL scrape into a staging area (the "KPI sandbox")
   - AI best-guesses every KPI record from the scraped data
   - Human data-cleaning flow: simple review UI, **confidence score per row,
     least-confident rows sorted to the top**
   - On human approval, rows are imported from the sandbox into the REAL KPIs
   - Until approved, sandbox data stays out of the real numbers

## Inventory findings (2026-07-01)
Dashboard = 3 sections (api/kpis-v15.js, monthly, per-offer via kpi_offer_links ties):
- SALES: pipeline count (was GHL /opportunities/search), bookings (was GHL
  /calendars/events), payments (Stripe). Human cleaning via kpi_exclusions.
- REVENUE: pure Stripe (charges/refunds/fees/payouts). Zero GHL.
- MEMBERS: Stripe + kpi_manual_cancellations + members roster. Zero GHL.
Only 2 numbers read GHL - both now portal-sourced for provider='portal' (below).

## Track A - BUILT 2026-07-01
- **`kpi_events` table** (migration 20260701230000, applied): one row per funnel
  moment. Columns: client_id, offer_id, step (lead|trial_booked|trial_attended|
  trial_no_show|joined|cancelled), ghl_contact_id, contact_name, occurred_at,
  source (live|ghl-import|manual), ref (idempotency, UNIQUE (client_id,step,ref) -
  full index, not partial, so PostgREST on_conflict works), meta jsonb.
- **Writer**: `recordKpiEvent()` in `api/_kpi.js` - best-effort, ignore-duplicates.
- **Hooks (all providers, additive)**:
  - lead: leads.js recordKpiLeadEvent (ref weblead:{leadId})
  - trial_booked: _store.js moveStage role='scheduled_trial', BOTH branches -
    single seam covers agent book / manual drag / website booking advance.
    ref trialbook:{oppKey}:{YYYY-MM} = one per card per month (re-book same month
    not double-counted; next month counts again)
  - trial_attended / trial_no_show: post-trial.js after review save (ref trialoutcome:{oppId})
  - joined: stripe/webhook.js member→live (ref joined:{memberId}, occurred_at=sub.created)
  - cancelled: stripe/webhook.js handleSubDeleted (ref cancelled:{memberId}) +
    kpis-v15 manual-cancel action (source='manual', ref manualcancel:{rowId})
- **Read (provider-aware, kpis-v15 sales section)**: pipeline_provider='portal' ->
  sales_pipeline from portal `opportunities` (created_at in range, per ghl_pipeline_id
  tie), sales_bookings from `kpi_events` step=trial_booked; GHL not consulted
  (ghl_error forced false). Portal bookings attach to the offer with calendars tied,
  else first with pipelines (GTA = Training). Other academies byte-identical GHL path.
- **KNOWN GAP (by design)**: kpi_events only accumulates from launch - current-month
  bookings look low until events flow; HISTORY comes from the Track B sandbox import.

## Status
- [x] Inventory current KPI system
- [x] Design portal-native tracking (kpi_events event log) - approved by Zoran
- [x] Build tracking (Track A)
- [ ] Design sandbox (scrape -> AI guess -> confidence-sorted human clean -> approve -> import)
- [ ] Build sandbox (imports into kpi_events with source='ghl-import')

## Notes
- kpis-v15.js + calendars-v15.js are the remaining GHL readers for GTA.
- Calendars themselves are a separate deferred migration (bookings still GHL; the
  booking-contact GHL bridge in leads.js dies when calendars move).
