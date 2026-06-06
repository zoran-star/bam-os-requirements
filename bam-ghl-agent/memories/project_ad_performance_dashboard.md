---
name: Ad Performance Dashboard (auto KPI report)
description: Automates Ximena's by-hand Meta→spreadsheet KPI reporting. Per-campaign, per-month Meta metrics rendered in the client portal Marketing tab with a Simple/Advanced toggle, conversion funnel, auto health colours, and plain-English insights.
type: project
---

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
