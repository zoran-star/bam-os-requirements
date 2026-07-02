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

## Marketing KPI section - SHIPPED 2026-07-02 (PR #1036)
The KPI page's Marketing block (which showed only Meta spend/leads/CPL from
`/api/marketing?resource=meta-report`) now pairs Meta ad spend with OUR funnel
counts: Ad spend, Leads, Cost/lead, Trials booked, Cost/trial, New members,
**Cost per member (true CAC = spend / joins)**. Server: kpis-v15
`section=marketing` returns kpi_events counts for the range. UI: marketing joined
the section loader; `_v15kMarketingHtml` renders the 7-stat grid. Live-verified
KPI page 2026-07-02 (temp-staff smoke test): sales ghl_error=false, portal
sources ✓, revenue + members Stripe ✓.

## SANDBOX (Track B) - designed, probe DONE, awaiting Zoran's 5 answers
**Design**: GHL scrape -> `kpi_sandbox_rows` (proposed event + confidence 0-100 +
evidence text) -> cleaning UI in the KPIs tab (least-confident on TOP, approve/
edit/reject + bulk-approve above a threshold) -> approved rows imported into
kpi_events with source='ghl-import'. Stripe joined/cancelled near-auto (high conf).

**Probe results (2026-07-02, real GTA data)**:
- 425 trial appointments on Group1/Group2 calendars, Dec 2024 -> now, full
  month-by-month. Status: 384 confirmed / 28 noshow / 13 cancelled / **0 "showed"**.
- Attendance was NEVER recorded: "Did the Athlete show up?" field = 11 fills ever;
  post_trial_reviews only 13 (since 6/24). -> attended must be INFERRED:
  joined-after (Stripe, ~95%), opp reached done_trial/won (~80%), noshow mark (95%),
  else UNKNOWN -> human cleaning bucket (est. a few hundred rows, one sitting).
- ghl_funnel_events already holds 349 leads + 187 trials (Nov 2025 -> now).
- 1,700 contacts with dateAdded + source + tags. SMS + email history ALREADY
  imported (messaging migrations) -> speed-to-lead computable later.
- Scrape sources per KPI: leads <- contacts (dateAdded/source/tags) + funnel_events;
  trial_booked <- calendar events (keep slot times!); no_show <- the 28 marks;
  attended <- inference; joined/cancelled <- Stripe (no GHL). PLUS scrape the
  Training pipeline opportunities (created/stage/status) as connective tissue.
  Enrichments to keep on rows: lead SOURCE tags (-> historical CAC by channel) +
  slot times (-> show-rate by slot).

**5 OPEN QUESTIONS for Zoran (asked 2026-07-02, unanswered - he has GHL domain feel)**:
1. How far back should history go? (trial calendar data starts Dec 2024)
2. Pre-Dec'24 trials: older calendar / other system / manual texts?
3. Any tag/field staff consistently used for attendance historically?
4. Which tags/sources = REAL Training leads vs noise (uniform inquiries, IG handles,
   text-blast lists like "june 2025 outdoor training", ADAPT tryouts)?
5. Pre-Stripe (CoachIQ era) joins: import them? source = pricing_catalog legacy rows /
   CoachIQ export?

## Recommended future KPIs (expert pass, Zoran liked; post-sandbox dashboard work)
Top 5: MRR + movement (Stripe math), speed to lead (our msg timestamps), slot fill
rate (our calendar), churn reasons surface (cancellations.reason), attendance-vs-plan
+ absence-streak alerts (UNLOCKS when member class booking on Luka's app goes live -
the #1 retention lever). Also: show-rate by slot, no-show->rebooked %, referral rate
(needs a "who referred you" intake field). `responded` KPI = live-only later (zero history).

## Status
- [x] Inventory current KPI system
- [x] Design portal-native tracking (kpi_events event log) - approved by Zoran
- [x] Build tracking (Track A)
- [x] Marketing KPI section (spend -> CAC)
- [x] Probe GHL history (sandbox design grounded)
- [ ] Zoran answers the 5 scrape questions
- [ ] Build sandbox: tables + scrape + guess pass -> cleaning UI -> import
- [ ] Post-sandbox: Marketing/retention dashboard KPIs (list above)

## Notes
- 2026-07-02: Zoran opened a separate chat to "tie everything to offers" - watch for
  offer-architecture changes that may affect kpi_offer_links / offer attribution.
