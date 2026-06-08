---
name: Ad Performance Dashboard (auto KPI report)
description: Automates Ximena's by-hand Meta→spreadsheet KPI reporting. Per-campaign, per-month Meta metrics rendered in the client portal Marketing tab with a Simple/Advanced toggle, conversion funnel, auto health colours, and plain-English insights.
type: project
---

## GHL KPI discovery spike (2026-06-06) — bottom-of-funnel groundwork

Goal: pull funnel KPIs from each academy's GoHighLevel. Problem: every academy's
GHL pipeline differs (stage names, some have no trial), so KPIs can't be
hardcoded. Plan (Zoran): AI best-guesses the mapping → staff edit → agent learns.

## GTA KPI definitions — FINAL 3-KPI model (Zoran 2026-06-07)

Simplified to 3 KPIs. Sources + definitions:

| KPI | Definition | Source |
|---|---|---|
| **Leads in** | count of submissions of the selected lead forms | GHL **form submissions** (picked forms) |
| **Trials booked** | **one per person** (dedupe by contact, all statuses) with an appt in the selected trial calendar(s) | **GHL calendar(s)** (new calendar picker) |
| **New clients** | new Stripe **subscription** or **one-time product purchase**, counted **all**, by purchase date, with a **New vs Existing** toggle | **Stripe Connect** (client's `stripe_connect_account_id`) |
| **CAC** | Meta spend ÷ new clients | Meta + Stripe |

- **New vs existing client (Zoran 2026-06-07):** "new" = the buyer is **not already a member** of this academy — refreshFunnel loads `members` for the client, builds email→earliest-membership-start, and a purchase is `client_existing` if a membership for that email began before the purchase (60s tolerance so the purchase's own member row reads as new), else `client_new`. Panel toggle New / All ("N new · M existing").
- **Selectable range (2026-06-07):** panel has 7d / 30d / 90d / This month buttons → `ghl-kpis?days=`. refreshFunnel pulls a **95-day** window to cover them (each GHL/Stripe call capped at 100 rows — paginate later if a client exceeds that in 90d).
- Dropped from the earlier model: response rate, show rate, the lead→member email-tie (now counts all purchases).
- Event types in `ghl_funnel_events`: `lead`, `trial`, `client_new`, `client_existing` (no schema change — event_type is free text).
- `ghl_kpi_config` now also stores `booking_calendar_ids` / `booking_calendar_names` (the trial calendars).
- `?action=calendars` lists a location's calendars (V1+V2, diagnostics) for the picker.
- refreshFunnel pulls: forms→lead, selected calendars→trial, Stripe Connect subs+standalone charges→client_new/client_existing (customer.created proxy). Stripe via `STRIPE_CONNECT_SECRET_KEY` + `Stripe-Account` header.
- ⚠️ Untested vs live GHL/Stripe — forms solid; calendars + Stripe-connect pulls best-effort, may need param tweaks once real data flows.
- **Debug (2026-06-07):** panel has a **"Refresh now"** button + diagnostic line showing the refresh result (`pulled — leads/trials/new/existing` or `skipped:`/`error:` + per-source `issues:` from `result.errors`). Use it when KPIs read 0 to see which source (forms/calendars/stripe) is failing.
- **Working (2026-06-07):** after fixing (a) non-partial unique index, (b) JS window-filter in ghl-kpis, (c) client_id precedence (staff+`?client_id=` beats `ctx.client` — was reading the wrong client), GTA shows real numbers (e.g. leads 38 / trials 15 / new clients 20 / CAC $41). `insertEvents` uses **merge-duplicates** so re-pulls backfill names/amounts.
- **Dedupe (2026-06-07):** ALL stages now count **one unique person** (was: leads/clients counted every event). Identity = `contact_id` → `contact_email` → `contact_phone`. Applied in both ghl-kpis (counts) and ghl-kpi-detail (lists). Phone now captured in the pulls; merge-duplicates backfills it onto existing rows.
- **Drill-down (2026-06-07):** click any KPI number → `GET ?resource=ghl-kpi-detail&type=lead|trial|client_new|clients_all` lists the records (name · email · date · amount, new/existing tag) for verification, with CSV export. Names captured into `raw.name` (forms/calendar/Stripe customer); Stripe amount into `value`.
- **Drill-down cleanup + names + dates (2026-06-07, kpi-drilldown-cleanup):**
  - **Trial names fixed:** calendar events only carry `contactId` + an appointment
    `title` ("By Any Means Trial") — old code stored the title as the name.
    `refreshFunnel` now `resolveTrialName(ev)` → looks up the contact by `contactId`
    (cached) for the real first/last name. Re-run "Refresh now" to backfill old rows
    (merge-duplicates on stable `ref=appt:<id>`).
  - **Delete from drill-down:** `ghl-kpi-detail` now returns `ids[]` (every event row
    behind a deduped person). New `POST ?resource=ghl-kpi-delete {client_id, ids}`
    (staff/owner, client-scoped) hard-deletes those rows; the ✕ button removes the row
    + re-reads `ghl-kpis` so the headline drops. ⚠️ A later refresh re-adds anything
    still live at the GHL/Stripe source — for junk/test/stale rows (durable exclusion
    list = possible follow-up).
  - **Dates:** drill-down shows `niceDate()` → "Tuesday, May 2nd", larger + name-stacked.
- **Month-by-month view (2026-06-07, kpi-drilldown-cleanup):** replaced the 7/30/90/month
  range picker with a monthly layout — a **"{Month} · so far"** hero (current month-to-date:
  Leads/Trials/New/CAC) + a **month-by-month** list below (each prior month's KPIs, newest
  first). Each month's number is clickable → drill-down/delete scoped to that month.
  - New `GET ?resource=ghl-kpis-monthly&client_id=&months=6` — buckets events by calendar
    month (UTC), dedupes to one person PER month, per-month CAC from ONE monthly-increment
    Meta insights call (`time_increment=monthly`).
  - `ghl-kpi-detail` now takes `month=YYYY-MM` (calendar-month window, exclusive end);
    `days=` still works as the rolling fallback.
  - **Pull window extended 95d → ~200d (6mo) + pagination** so older months have data:
    forms page-loop (newest-first, stops when a full page is older than the window),
    Stripe `starting_after` loop (subs + charges). Calendars stay range-based.
    Month buckets are **UTC** — near month boundaries a client tz could shift a row;
    revisit with `clients.time_zone` if it matters.
- **Effective-dated forms/calendars per month (2026-06-07):** forms/calendars that feed
  Leads/Trials can change over time. `ghl_kpi_config.effective_configs[]` = `{from:'YYYY-MM',
  lead_form_ids/names, booking_calendar_ids/names}`. A month uses the latest override with
  `from<=month`, else the top-level **default** (string compare on YYYY-MM = chronological).
  - `ghl-kpis-monthly` resolves per-month forms/cals, filters `lead` events by `raw.formId`
    and `trial` events by `raw.calendarId` (empty set = no filter / count all). Stripe
    (new/existing) events are unaffected. Returns per-month `forms/calendars/override_from`
    + a `config{default, effective_configs}` block.
  - `refreshFunnel` pulls the **union** of all forms/calendars across default + every
    override (so an old period's sources still have data).
  - UI: a **⚙ Nf·Mc** button on the hero + each month row (accent when an override is
    active) → modal with form/calendar checkboxes → saves an `effective_configs` entry
    "from {month} onward" via clients `update-fields`. Clearing all = removes the override
    (reverts to default).
  - ⚠️ A form/calendar must be pulled at least once to have data — can't retro-count a
    form that was never selected.
- **Journey board per month (2026-06-07):** a ▦ button on the hero + each month row opens a
  3-column **Leads → Trials → Sales** board for that month (modal). Each person = a card
  (name + date/amount). Built entirely from `ghl-kpi-detail` (fetched 3× per month:
  lead / trial / clients_all) — no new endpoint; just added `key` (identity =
  contact_id||email||phone) to detail items for cross-column matching.
  - **Filled** card = the person also has a card in the column to the LEFT (came from the
    prior stage); **outline** = they joined at this stage (no prior card — walk-in / mid-funnel).
  - **✕** deletes that person's record for that stage via `ghl-kpi-delete`, then re-reads
    monthly counts. SALES column = **All purchases** (client_new + client_existing), Zoran's call.
  - **Independent top-packed columns + SVG arrows (2026-06-07 FINAL):** the rigid shared-row
    grid was wrong — sorting put sale-only walk-ins on top, leaving empty Lead/Trial cells =
    whitespace ABOVE. Now each column **top-packs its own cards** (whitespace only at the
    bottom). People still matched into logical rows by **union-find over any shared identifier**
    (email/phone/contact_id, normalized; detail items return `contact_id`+`phone`). Each column
    renders the rows it has, in row order; connectors are **measured SVG lines** (getBoundingClientRect
    via `boardBodyRef`+`cardRefs`, recomputed in a useEffect on `board` change + ResizeObserver +
    window resize) → `arrows[]` state → `<line markerEnd>` (solid = continued, dashed = skipped).
    Rows sorted furthest-stage desc then completeness, so continuers sit near the top of each
    column. Same-stage dups merge (×N amber badge). `deleteBoardCard` re-fetches + re-aligns.
  - **Board ⇄ Timeline toggle (2026-06-07):** `boardView` state toggles the journey modal between
    the column **Board** and a **Timeline**. First timeline attempt (stage-lanes + time-down) was
    spaghetti — connectors crossed everywhere. **FIXED → per-person rows (Gantt-style):** ONE ROW
    per person, time left→right; date columns = only the dates that have events. Each person's
    events are stage pills (Lead muted / Trial accent-outline / Sale filled-accent) in their date
    column, and the measured-SVG connector is a short HORIZONTAL line within that row → **lines can
    never cross**. Rows sorted most-complete-journey first (filledCount, furthest, first date).
    Reuses `cardRefs[`${stage}:${i}`]` + the arrows effect (deps include `boardView`). Horizontal
    scroll if many date columns; modal widens to 1240px; undated events skipped.
  - **Smooth delete + trash/undo (2026-06-07):** ✕ no longer reloads the board (`openBoard` flashed
    "Loading…" and lost scroll). Now **optimistic**: removes the matching items from `board.leads/
    trials/sales` locally (instant), then deletes in the background. `ghl-kpi-delete` returns the
    deleted rows; they go into a `trash[]` (cleared on `openBoard`). A **bottom-right trash panel**
    (fixed, z1200) lists deleted names with per-item **↩** restore + an **Undo** (last). Undo →
    new `ghl-kpi-restore` endpoint re-inserts the exact rows (strips id, forces client_id, upsert
    on `event_type,ref`) then `refetchBoardSilent()` (no loading flag) re-syncs. Monthly counts
    refresh in the background on both.
  - **Soft-delete + persistent trash (2026-06-07):** delete used to HARD-delete, so a re-pull
    resurrected the rows and a page refresh wiped the in-memory trash → lost cleaning progress.
    Fixed with a soft-delete column **`ghl_funnel_events.excluded`** (migration
    `supabase/ghl_funnel_excluded.sql`, in the /apply-sql list). `ghl-kpi-delete` now PATCHes
    `excluded=true` (not DELETE); `ghl-kpi-restore` PATCHes `excluded=false` by **ids**; all reads
    (`ghl-kpis`, `-monthly`, `-detail`) filter `excluded=is.false`. **refreshFunnel's merge-duplicates
    upsert omits `excluded`, so a re-pull RETAINS excluded=true** → deletions survive refresh. New
    `ghl-kpi-trash?client_id=&month=` returns the excluded rows grouped by person+stage; `openBoard`
    loads it into the trash bin, so the **trash persists across refresh**. Undo = un-exclude by ids.
  - **Click a card → Stripe history (2026-06-07):** clicking a board cell / timeline pill opens
    a modal (`stripeView`) with that person's Stripe history so staff can judge if they're a live
    member. New `GET ?resource=ghl-kpi-stripe&client_id=&email=` looks the customer up **by email**
    on the client's `stripe_connect_account_id` (key `STRIPE_CONNECT_SECRET_KEY`), returns
    subscriptions + last 25 charges + a **verdict** (live = active/trialing sub · at_risk = past_due/
    unpaid · former = paid before, no active sub · none) + lifetime paid + a multi-customer warning.
    The ✕ delete buttons `stopPropagation` so they don't trigger the lookup. No email / no customer /
    no connected Stripe are handled gracefully.
- **GOTCHA (2026-06-07):** "pulled — leads 41 …" but KPIs read 0 → inserts were FAILING silently. Two causes fixed: (1) `ghl_funnel_events` unique index was **partial** (`where ref is not null`) — PostgREST `on_conflict=event_type,ref` can't use a partial index → every insert 42P10'd. Made it **non-partial** (re-run `/apply-sql`). (2) `insertEvents` swallowed the error and returned `rows.length` (the attempted count), so the diagnostic looked healthy. It now lets errors propagate into `result.errors`. **Lesson: a "pulled N" count is attempts unless inserts are verified.**

⚠️ **Hourly snapshot cron (PR #111) is NOT the approach** — Zoran rejected it.
Replace with **GHL webhooks** (form submit / inbound message / appointment
booked, fire instantly) + **Stripe** for conversion. The stage-transition tracker
is parked; these four signals are event-based, not stage-based. (Cron still
deployed but superseded — disable/remove when webhooks land.)

**Forms endpoint v1 + diagnostics (2026-06-06):** GTA's forms weren't showing
(showed for other clients). Fix: `?action=forms` now handles **V1** GHL
(`rest.gohighlevel.com/v1/forms/`) as well as V2, adds a V2 locationId-discover
retry, and always 200s with diagnostics `{version, location, status, reason,
count}`. The panel shows that diagnostic when 0 forms come back, so we can see why
(v1 vs locationId vs HTTP error) instead of a blank "no forms". Likely cause for
GTA: it's a V1 location (was previously gated to V2-only).

**Forms picker (shipped):** `clients.ghl_kpi_config` jsonb (migration
`supabase/ghl_kpi_config.sql`, **must be run**) holds the wiring. `GET
/api/ghl?action=forms&location=` lists a location's forms; the GHL KPIs (beta)
panel lets staff tick which forms = "leads in" and saves
`{ghl_location, lead_form_ids, lead_form_names}` via clients `update-fields`.
Next: webhook ingest + Stripe-tie + the KPI read endpoint off this config.

**Confirmed GTA stage semantics (Zoran 2026-06-06) — pattern recurs across academies:**
`Interested`=lead submitted info (form) → **Lead**; `Responded`=lead replied →
**Contacted**; `Scheduled Trial`=booked a trial → **Booked**; `Done Trial`=showed
up + finished → **Showed**; then **Won** (member) / **Lost** (ghost/no-show/etc).
GHL automations move leads between these on response/ghosting/no-show.

**Spike shipped (read-only, no schema):**
- `api/_ghl_funnel.js` — **deterministic** stage-name→canonical matcher (keyword
  rules, GTA semantics baked in) + `buildKpis(present)` (KPIs only for steps that
  exist; explains skipped ones). This replaced the pure-AI guess so GTA + lookalikes
  map correctly every time; truly unusual stages come back `(unmapped)` for staff.
- `POST /api/marketing?resource=ghl-kpi-suggest` (staff only) — runs the matcher,
  returns `{summary, mapping, missing, unmapped, kpis, hidden_kpis, canonical}`.
  No AI call anymore (rules are the encoded knowledge); AI returns later for
  unmapped-stage guessing + the learning loop.
- `src/components/GhlKpiDiscovery.jsx` — staff panel: GHL location dropdown
  (`/api/ghl?action=locations`) → "Analyze" → fetches `?action=pipelines` →
  computes stage counts → calls ghl-kpi-suggest → renders mapping + KPIs. Lives in
  the client profile Marketing tab, sub-tab **"GHL KPIs (beta)"**.
- Nothing saved yet — this is the discovery step to SEE real data before designing.

**What GHL already exposes (api/ghl.js, per location via `GHL_LOCATIONS_JSON`):**
`pipelines`+opportunities (the funnel, stage names + counts), `contacts`,
`conversations`. Show rate needs the calendar/appointments endpoint (not wired).
api/ghl.js has **no auth gate** (keyed by location name) — pre-existing footgun.

**Event-based wiring (2026-06-06) — replaces the snapshot cron (removed).** The
KPIs are sourced from live events, not stage occupancy:
- Table `ghl_funnel_events` (`supabase/ghl_funnel_events.sql`, **must be run**):
  one row per event, type ∈ lead/response/booking/conversion, with client_id,
  contact_id/email, ref (idempotency via partial unique on (event_type, ref)),
  value, occurred_at, raw. RLS on / service-role only.
- **PULL model (chosen 2026-06-06) — stale-while-revalidate, no GHL setup, no cron.**
  - **Refresh** `POST /api/ghl?action=refresh-funnel&client_id=` (any logged-in user)
    pulls for that client's `ghl_kpi_config.ghl_location`: form submissions for the
    configured `lead_form_ids` → `lead`; calendar events → `booking` (best-effort,
    may need `ghl_kpi_config.booking_calendar_id`); conversations w/ inbound →
    `response` (best-effort). Upserts events (ignore-dupes on event_type+ref),
    stamps `clients.ghl_synced_at`. 35-day window. Each source try/catch'd.
  - **Conversions** still arrive via the EXISTING platform Stripe webhook
    (`api/stripe/webhook.js handleSubCreated`) → `conversion` event tied to lead by
    email. No new Stripe setup.
  - **Read** `GET /api/marketing?resource=ghl-kpis&client_id=&days=30` reads the DB
    (instant): leads, responded/booked/converted (distinct contacts), rates,
    revenue, CAC vs Meta spend, + `synced_at`. `ready:false` if table missing.
  - **Panel** loads the read (instant), and if `synced_at` is null/>10 min old,
    fires `refresh-funnel` in the background then re-reads ("refreshing…").
- **GHL webhook** `POST /api/ghl?action=webhook` still exists as an OPTIONAL
  real-time booster (push) but is NOT required — the pull covers everything.
- **Zoran's only setup:** run `/apply-sql` + pick the lead forms. No GHL workflows,
  no cron. Pull also backfills (not forward-only).
- ⚠️ Untested against live GHL — forms pull is solid; calendar/conversations pulls
  are best-effort and may need endpoint/param tweaks once real data is seen.

**SQL self-serve:** `/apply-sql` skill (`.claude/commands/apply-sql.md`) +
`scripts/migration/apply-pending-sql.mjs` — runs marketing_goals.sql +
ghl_kpi_config.sql + ghl_funnel_events.sql via the Supabase Management API given
an `sbp_` PAT. Idempotent. (Replaces the manual "run these SQL files" asks.)

**Next steps:** `clients.ghl_kpi_config` jsonb to persist
the mapping + KPI on/off + goals; a staff editor; a corrections log fed back as
few-shot examples so guesses improve. Then compute KPIs → feeds true
cost-per-customer / ROAS (Meta spend→leads + GHL leads→members + Stripe revenue).
Run `align-core-data-model` before the schema change.

## Design polish (2026-06-06) — de-coloured + no sample data

Zoran feedback: the red/amber/green cards looked "vibe-coded"; real connected
clients were seeing hardcoded sample campaigns ("Spring Free Trial", UDP/PGP/MS).

- **Removed traffic-light colours** on client + staff dashboards. Now monochrome
  with **gold as the only accent** (per Full Control brand). Health reads from the
  **wording** (verdict + "over/under target" text), not card colours. CPL gauge,
  deltas, verdict banner, win/fix, bench notes all neutralised.
- **Killed sample/demo data in the live portal.** Connected (or any real) clients
  never see fake campaigns/numbers — they get a clean "appears once your ad
  account is connected" state instead. Demo builders (`_buildDemoReport`,
  `_buildDemoLast7`, `_buildDemoCampaignsHTML`) are no longer called (dead code;
  `_DEMO_CAMPAIGNS` still referenced elsewhere so kept).
- Toolbar (time/Simple-Advanced controls) hides when there's no data.

## Staff side (2026-06-06, same day) — staff marketing portal

Built the staff-facing side: cross-client overview + per-client dashboard +
goal setting. Reuses the same `meta-report`/`meta-insight` endpoints (they
already accept `?client_id=` for staff).

**Backend (api/marketing.js + api/clients.js):**
- `GET ?resource=meta-overview` (staff only) — cross-client roster: this-month
  vs last-month totals per marketing-included client (one Meta call each,
  parallel `Promise.all`), with goal, verdict (`verdictFor`), trend, and budget
  pacing. Returns `{ rollup, clients[], month_label, month_pct, benchmarks }`.
  Roll-up = blended spend/leads/CPL + vs-last-month + attention count.
- `POST ?resource=meta-overview` — posts a "needs attention" digest to Slack.
  Needs `SLACK_BOT_TOKEN` + **`MARKETING_ALERTS_SLACK_CHANNEL`** (env, not set
  yet → returns `slack_not_configured`).
- `api/clients.js` `update-fields` now accepts **`meta_cpl_goal` +
  `meta_monthly_budget`** (numeric or null) → the goal editor writes here.

**Frontend (React, staff portal):**
- `src/components/MarketingDashboard.jsx` — shared React port of the client
  dashboard (verdict, win/fix, per-campaign cards w/ CPL gauge + deltas, funnel,
  advanced tap-to-explain, Last 7 / This month / History, Simple/Advanced,
  Claude insight). Pass `key={clientId}` (remounts per client). Exports
  `GoalEditor` too.
- `src/views/MarketingOverview.jsx` — the cross-client portal: roll-up strip +
  sortable roster (needs-attention floats up, amber row tint) + CSV export +
  Print/PDF + "Send digest to Slack" + drill-in modal (GoalEditor +
  MarketingDashboard per client).
- `MarketingView.jsx` — added a **Performance | Tickets** switcher; Performance
  is the default landing (the "single marketing portal"). Tickets = the old
  queue.
- `ClientsCombinedView.jsx` → per-client Marketing tab: new **Performance**
  sub-tab (default) = GoalEditor + MarketingDashboard for that client.

**Extras shipped:** needs-attention queue, CSV + Print/PDF export, budget
pacing (spent% vs month%), Slack digest button.

**Meta read/write:** still `ads_read` (READ-ONLY). Write (auto-upload videos /
create ads) needs `ads_management` + Business Verification — Zoran doing the
Meta-side prereqs in the background; code build is a later follow-up. Logged as
a future item (Open Loop).

## v2 enhancements (2026-06-06, same day)

UX pass per Zoran. **No emojis anywhere.** Constructive verdict wording (never
"bad"): strong→"Performing well", steady→"On track", attention→"Worth revisiting".

- **Time windows** — segmented control: Last 7 days / This month (default) / History.
  `?window=last7` returns last 7 complete days vs previous 7 (one Meta call,
  `time_increment=1` over 14 days, bucketed). Monthly default unchanged. Data is
  **live on every open** — "monthly" is the grouping, not the refresh cadence.
- **Verdict banner** + **Biggest win / What to look at** cards (constructive wording).
- **Claude-written coaching** — `POST ?resource=meta-insight` (model
  `claude-haiku-4-5-20251001`, `ANTHROPIC_API_KEY`). Returns verdict, headline,
  win, fix, per-campaign notes. Renders rule-based **instantly**, then upgrades to
  AI when it returns (cached per period). `ruleInsight()` is the server+client
  fallback if no key/error — UI never breaks. "AI summary" pill shows when AI.
- **CPL goal gauge** (SVG ring), **month-over-month deltas** (▲/▼, no emoji),
  **sparklines** (monthly views), **tap-to-explain** on every advanced metric
  (plain "what it is + what it means", via `METRIC_INFO`), **human-first labels**
  ("New leads" big, "Leads" small), **subtle celebratory** glow + "Lowest cost
  yet"/"Most leads yet" record badge (monthly, respects prefers-reduced-motion).
- **Response shape changed:** `months` → `periods`, added `view`. Each period has
  `campaigns` + `totals`; last7 also `compareTotals`/`compareCampaigns`.

Implemented ideas from the 15-idea list: #1 verdict, #2 win/fix, #4 human names,
#5 tap-to-explain, #8 sparklines, #10 time toggle, #11 gauge, #14 celebratory,
plus #6/#9 (money framing, benchmark notes) and #7 (Claude coaching).

## TL;DR (2026-06-06)

Ximena used to copy Meta KPIs into a Google Sheet by hand every month (one row
per campaign per month: leads, CPL, spend, reach, impressions, link clicks,
landing-page views, CTR, frequency). This builds that sheet automatically from
the Meta API and presents it in the **client portal Marketing tab**.

**v1 = Meta-only** (matches her sheet exactly). GHL/Stripe bottom-of-funnel
(booked → closed → revenue → ROAS) is **v2** (Zoran's call).

## Backend

`api/marketing.js` → `handleMetaReport` — route `GET /api/marketing?resource=meta-report&client_id=<id>&months=<n>` (default 8, max 24).

- ONE Meta call: ad-account `insights?level=campaign&time_increment=monthly`,
  fields `campaign_id,campaign_name,spend,impressions,reach,frequency,inline_link_clicks,actions`.
- CTR computed = link_clicks / impressions (link CTR, matches her sheet's low %).
- Leads via existing `countLeads()`; landing-page views via new `countAction(actions,"landing_page_view")`.
- Respects `clients.meta_campaign_ids` filter (clients don't see staff experiments).
- Returns `{ ad_account, months:[{key,label,campaigns:[...],totals}], goals, benchmarks }`.
  Months sorted newest-first. `reason:"no_ad_account"|"no_staff_token"` (still
  returns goals+benchmarks) → frontend shows sample data.

## Benchmarks + goals (the green/red colouring)

"Both" model (Zoran): industry defaults always on; per-client goal overrides when set.

- **Industry defaults** = `MKT_BENCHMARKS` in `api/marketing.js` (Ximena's noted
  standards): CPL ~$25, link CTR 1.5–2.5%, frequency 2–4× (sports/coaching niche).
- **Per-client goals** = `clients.meta_cpl_goal` + `clients.meta_monthly_budget`
  (both nullable; NULL = use industry default). Migration:
  `bam-portal/supabase/marketing_goals.sql` — **MUST be run in Supabase**
  (project ref jnojmfmpnsfmtqmwhopz). The endpoint is resilient to the columns
  not existing yet (try/catch fallback), so it works before AND after migration.
- ⚠️ Also belongs in the **Onboarding Data Points DB** (CPL goal + monthly budget
  are owner-set config) and a Marketing **MKT-** Notion requirement — Notion side
  still TODO (see Open Loops / next session).

## Frontend (`bam-portal/public/client-portal.html`)

Marketing tab, above "Active Campaigns". Plain HTML/JS (no build step).

- Controls: month `<select>` + Simple/Advanced toggle pill (`setReportMode`).
- **Simple (default):** month headline (auto insight) + per-campaign cards with
  3 big stats (Leads / Cost-per-lead vs target / Spent vs budget), health colour
  on the left border, one plain-English recommendation per card.
- **Advanced:** adds a **conversion funnel** (Impressions → Link clicks → Page
  views → Leads with drop-off % between each) + full metric grid (reach,
  impressions, link clicks, page views, CTR vs industry, frequency vs industry).
- **Insight engine** = `_reportInsight()` (rule-based, instant — no Claude call in
  v1). Picks the single biggest leak: low CTR → "refresh creative"; high
  frequency → "audience fatigue"; CPL over target → "tighten targeting"; else
  "on track 🎉".
- Sample-data fallback `_buildDemoReport()` (modelled on real academy numbers:
  UDP/PGP/Mental Skills) so the tab is alive before an ad account is wired.
- Loaded by `_loadAdReport()`, called alongside `_renderMarketingCampaigns()`.
- Mobile-optimized CSS (`@media max-width:768px`). Desktop-first per Zoran (app
  already submitted → ships next app iteration).

## Key functions

| Function | Role |
|---|---|
| `handleMetaReport` (api/marketing.js) | the endpoint |
| `countAction(actions,type)` (api/marketing.js) | sum one Meta action type |
| `_loadAdReport` / `_renderAdReport` | fetch + render |
| `_reportInsight` | rule-based headline + recommendation |
| `_funnelHTML` / `_advGridHTML` | advanced views |
| `_reportCardHTML` | per-campaign card |
| `_buildDemoReport` | sample fallback |

## Caveats / next

- **Landing-page views need the Meta pixel** firing on the client's landing page.
  No pixel → that one metric is `—`; everything else still works. Audit which
  clients have pixels live.
- **Staff side (MarketingView.jsx):** not yet wired — Ximena currently reviews via
  the client portal. Same endpoint; add a report panel to the staff MarketingView
  as the next increment.
- **v2:** tie ad leads → GHL booked/showed → Stripe closed/revenue for true
  cost-per-customer + ROAS.
- **Notion sync (TODO):** MKT- requirement + Onboarding Data Points (CPL goal,
  monthly budget). Keep prototype↔Notion in sync.

## Related

- [[project_meta_api_integration]] — the Meta token + existing campaign endpoints
- [[project_marketing_content_flow]] — the ticket flow in the same Marketing tab
- [[project_channel_dashboard]] — funnel-diagnosis pattern reused here (rule-based)
