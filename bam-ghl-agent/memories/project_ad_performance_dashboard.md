---
name: Ad Performance Dashboard (auto KPI report)
description: Automates Ximena's by-hand Meta→spreadsheet KPI reporting. Per-campaign, per-month Meta metrics rendered in the client portal Marketing tab with a Simple/Advanced toggle, conversion funnel, auto health colours, and plain-English insights.
type: project
---

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
