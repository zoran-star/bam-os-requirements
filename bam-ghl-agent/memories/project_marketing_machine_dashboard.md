---
name: Marketing Machine dashboard (design locked, build pending)
description: SHIPPED 2026-07-03 (V2 client portal, GTA first) - simple flow card + detailed machine modal, one aggregate endpoint (marketing.js resource=meta-machine). Full specs, locked health recipes, data-source map + what is still open inside.
type: project
---

# Marketing Machine dashboard - SHIPPED 2026-07-03 (V2, GTA first)

## Shipped implementation (2026-07-03)
- Backend: `bam-portal/api/marketing.js` `?resource=meta-machine&client_id=`
  `[&since=YYYY-MM-DD&until=YYYY-MM-DD]` (handleMetaMachine). ONE payload for
  card + modal; ALL health bands computed server-side. Default range = MTD.
  Graph calls: campaign insights (prev+current, one call, split at since),
  NEW level=ad insights (hook rate via video_3_sec_watched_actions), per
  campaign: /ads (creative + created_time), /adsets (learning_stage_info +
  ABO daily_budget fallback), campaign budget fields. Supabase: funnel_events
  (free-trial), kpi_events (lead + trial_booked, prev+current), opportunities
  join for the agent-booked split. Planned spend = clients.meta_monthly_budget
  || campaign daily_budget || sum(active ad sets daily_budget), x days in month.
- Frontend: `bam-portal/public/client-portal.html` - card container
  `#marketing-machine-card` (top of Marketing content), gated
  `V2_ACCESS` only, loaded from `_marketingEnter()` via `_mmLoad()`.
  Modal `#marketingMachineModal` (`openMarketingMachine()`), date range
  picker defaults to MTD, Apply refetches. All `mm-*` CSS classes.
- Bar fill length = health (CPL inverted on $0-70 scale; pct vs target),
  fill color = server band. Colored numbers + dots in modal, rollup dot per
  section (worst child wins).

## Campaign health rework (Zoran decisions, shipped 2026-07-03 evening)
CPL is THE marketing health metric. Display = lifetime anchor + trend:
- LIFETIME CPL (big, banded $40/$55) = the anchor. Starts at the FIRST week
  that ever recorded a lead - pre-tracking spend is trimmed (GTA: 11 months
  of pre-funnel spend would have made the anchor $440 instead of $30.63).
- Weekly CPL LINE GRAPH (last 8 weeks, one Meta call: date_preset=maximum +
  time_increment=7): clean SVG polyline (no dots), stroke = campaign band
  color, up = pricier, start date alone bottom-left (Zoran 2026-07-03).
  Anchor "since" = start of the WEEK of the first tracked lead (weekly
  buckets). mmCountLeads is STRICT action_type=lead only - the legacy
  fallback let fb_pixel_custom count as leads and polluted the anchor. Lives ON THE SIMPLE CARD (campaign
  column = lifetime $ + delta + line graph; Zoran 2026-07-03 evening) and
  bigger in the modal. Helper: _mmLineHtml() in client-portal.html.
- WINDOW DELTA = last 14 days vs lifetime: <=0 green, +20% gold, >20% red
  (the Andromeda drift rule on screen).
- WINDOW SPLIT: lead-based metrics (CPL, cost/booked trial, page %, result)
  judge on 14 days - 7d is coin-flip noise at sub-$1k/mo spend (~6 leads/wk
  at $40 CPL). Impression-based (freq, CTR, hook) use the last 7 days.
- MIN-SAMPLE GUARD: window CPL stays grey "gathering data" until 8+ leads
  OR $250+ spend in the window. Bar falls back to the lifetime band.
- click->visit pill counts ONLY ad-tagged sessions (utm fbclid / fb|ig|meta
  source) - organic visitors were flattering it (GTA: 84% -> honest 59%,
  which is a real page-speed flag; healthy 70-85%).
- Default range = last 14 days (was MTD); month pacing + spend live in the
  MODAL ONLY (Zoran 2026-07-03 evening: removed the month bar + spend from
  the simple card - card is lifetime anchor + line + health bars + result,
  result column labeled "last 14 days"). The this_month spend call stays for
  the modal header.
- PARKED idea: adaptive judged window - use 7d when spend gives ~8 leads/wk,
  stretch to 14d when it does not; self-tunes as ad budgets grow.

## Design session v2 (2026-07-03/04 overnight, local-preview iteration)
Final shipped shape - TWO cards on the Marketing page (V2):
1. META ADS card: label-row title, CAMPAIGN section (campaign name from Meta,
   14d CPL hero + delta vs lifetime), CREATIVE section (thumb rows + KEEP/
   EDIT/REPLACE verdict chips + notes). Right half = gold action panel
   (glow/sheen/sway/tease motion) -> "Focus mode".
2. LANDING PAGE card (fed-by arrow between cards): mirrored double-line
   funnel SVG (clicks/loaded/form/calendar/booked, linear heights, thin tail
   collapses to an arrow into a trial icon, worst >50% drop tinted red with
   fix badge), device icons left, calendar-check right. Own Focus mode.
Focus mode = camera-pan page transition: main+sidebar and the focus page move
as one surface (3s heavy ease, 50vw parallax, gold seam bar, edge vignette,
GPU prewarm during a 280ms wind-up). Gotcha: a theme-crossfade rule overrides
.main/.sidebar transitions - pan rules must be scoped under html.mm-prewarm.
Skin = prototype tokens verbatim (Plus Jakarta Sans, DM Mono for values only,
status text #2D8A52/#B08E30/#B5352F, washes). Light theme now portal default.
Backend adds: campaign.name/count/sends_to, page.funnel/fed_by/
clicks_comparable (clicks counted only on days beacons existed - the 164-vs-28
"17% load rate" was a window artifact), result.leads_7d/booked_7d, creative
verdict/verdict_note (keep/edit/replace table).
Open: beacon fires before React renders (sites repo fix #2) + precompile JSX
on bam-client-sites (Babel-in-browser, 524KB) - see audit in chat 2026-07-04.

## Live-fire gotchas (found testing vs real GTA data 2026-07-03)
- Meta v22 REJECTS `video_3_sec_watched_actions` as an insights field. 3-sec
  views = the standard `actions` entry `action_type=video_view`. Fixed.
- Raw campaign lifetime is poisoned for migrated academies: months of spend
  before lead tracking existed. Anchor trims to first-lead week (see above).
- Meta reports ONE lead under several action_types at once (GTA: lead:5 +
  offsite_conversion.fb_pixel_lead:5 = 5 real leads). Shared countLeads()
  SUMS the set -> double counts pixel leads. Machine uses mmCountLeads()
  ("lead" aggregate first, legacy sum as fallback). ⚠ meta-report /
  Ad Performance still uses countLeads() - likely shows inflated leads +
  halved CPL for pixel-lead clients; fix separately (Ximena-validated
  surface, do not change silently).

## Still open after ship
- Phase 4 cache table (meta_insights_cache) NOT built - modal/card hit Graph
  live (4-6 calls per load). Add when it feels slow or clients scale.
- PAGE clicks->leads bands (10%/5%) + abandonment bands (25/40) + CPBT
  trend-coloring are heuristics - tune against live GTA data.
- Verification vs Ads Manager / Ximena budgets still to run (exit criteria
  in build plan below).

# Original design spec (locked 2026-07-03)

Zoran iterated this in chat to a final locked design. Strategy + KPI rationale:
[[project_meta_ads_strategy]] (post-Andromeda rules). Build in a future session.

## Concept
Marketing page gets ONE minimalist card (flow + colored health bars). Tapping it
opens the detailed "Marketing Machine" modal (no bars - each number colored by
health with a small dot). Simple = "is it fine?", modal = "where is it broken?".

## SIMPLE CARD (final v6)

Desktop flows LEFT to RIGHT; mobile stacks the same pieces vertically with
down-arrows. Every element = label text on top, bar DIRECTLY below it; the
BAR FILL ITSELF is the health color (green/gold/red), no status dots.

```
┌─ MARKETING ──────────────────────────────────────────────────────────────────┐
│  JULY                                                                        │
│  ▓▓░░░░░░░░░░░░░░░░░░░░░  day 3 of 31 · spent $41      <- spend muted/small  │
│                                                                              │
│  CAMPAIGN             CREATIVES              PAGE            RESULT          │
│  ████████████░░░      testimonial [best]     █████████████   ┌───────────┐   │
│  (green fill)    ──►  ██████████████    ──►  (green)      ──►│ 14 leads  │   │
│                       pain-point                             │ 6 trials  │   │
│                       ███████████░░░                         └───────────┘   │
│                       coach-method                                           │
│                       ████████░░░░░░ (gold)                                  │
│                       3-spots                                                │
│                       ████░░░░░░░░░░ (red)                                   │
│                                                                              │
│  COST PER LEAD $13.50 (down arrow, green)   ⚠ "3-spots" is worn out   tap ›  │
└──────────────────────────────────────────────────────────────────────────────┘
```

Decisions along the way (do NOT re-add):
- NO "cost per booked trial" on the simple card (modal only)
- NO LEADS health bar - just the raw numbers (leads / trials) in the RESULT box
- Campaign and each creative get SEPARATE bars (one bar per live creative)
- Month progress bar at top (day N of month), ad spend so far shown small/muted
  beside it (pacing read: month % vs spend %)
- The ⚠ line names the single most broken thing; hidden when all green
- Bar health recipes (FINAL, Zoran 2026-07-03): CAMPAIGN = cost per lead
  only; each CREATIVE = hybrid CPL + fatigue demotions (see Bar recipes
  section below); PAGE = clicks->leads % (Meta link clicks -> leads; the
  ratio is also shown as a number in the modal's PAGE section)

## DETAILED MODAL (final v6/v7)

No bars. Every judged number is colored green/gold/red with a small dot;
neutral facts (impressions, reach, age, raw counts) stay uncolored.
Section headers carry a rollup dot (worst child wins) matching the simple
card's bar. Range picker top-right: DEFAULTS TO MTD (month to date, matches
the simple card); custom start + end date picker for any window (Zoran
decision 2026-07-03, replaced the 7d/30d presets).

```
MARKETING MACHINE                       [ Jul 1 - today v ] [ x ]
JULY  progress-bar  day 3 of 31 · spent $41 of ~$810 planned

-- CAMPAIGN (dot) -----------------------------------------------
COST PER LEAD   CPA DRIFT    FREQUENCY    CTR
$13.50 grn      -4% grn      2.4x grn     1.9% grn
impressions 14.2k · reach 6.1k · learning ACTIVE

-- CREATIVES · 4 live (gold dot; want 6+) -----------------------
Tile per live ad (thumbnails already fetched by meta-creatives):
[thumb] name [best-badge on cheapest lead]
  hook 38% · ctr 2.1% · $/lead $9 · freq 1.9x · age 12d   (each colored)
⚠ plain-english instruction line (e.g. kill X, clone the winner angle)

              v  click -> visit 71% (colored pill)

-- LANDING PAGE (dot) -------------------------------------------
412 visitors -> 61 started form -> 44 saw calendar -> 26 booked
      only ONE hop rate shown: visitors->started form 15% (colored)
CALENDAR ABANDONMENT 41% red - "saw the times but walked away"

              v  visit -> lead 9% (colored pill)

-- RESULT -------------------------------------------------------
14 leads -- 43% booked grn --  |- 6 booked trials
                               |- 8 with the booking agent
* COST PER BOOKED TRIAL $38 grn (was $44, arrow) <- the modal's verdict
```

Funnel-step decisions (from live-data verification 2026-07-03):
- form_completed ~= calendar_viewed on our trial page (form flows straight
  into the calendar; verified identical in live funnel_events). DISPLAY the
  step as "saw calendar"; keep collecting both beacons; a silent alert fires
  only if form_completed != calendar_viewed (means the calendar broke).
- "saw calendar -> booked" rate NOT shown - it is just the inverse of
  calendar abandonment. Section shows exactly 2 judged numbers:
  visitors->started form % and calendar abandonment %.
- Conversion pills appear exactly once each: click->visit (between creatives
  and page; measures Meta link clicks vs our own page_view beacons),
  visit->lead (after page), lead->booked (inside RESULT).

## Health thresholds (heuristics from the fact-checked Andromeda research)
- Hook rate: >=30% green, 25-30 gold, <25 red (3-sec views / impressions)
- Frequency: <3x green, 3-3.5 gold, >3.5 red (cold local: flag earlier ~2.5-3)
- CPA drift: within +/-20% of baseline green; >+20% red
- Click->visit: 70-85% healthy; <60% = page-speed problem
- CREATIVES count: 6+ distinct angles = green

## Build notes (for the build session)
1. NEW Meta call: `/insights?level=ad` for per-creative spend, leads, CTR,
   3-sec video views (hook rate), frequency; ad `created_time` for age.
   Thumbnails already come from marketing.js meta-creatives handler.
2. FIX: portal "planned spend" reads campaign daily_budget only - Ximena sets
   budgets at AD-SET level (ABO) for 12 of 13 clients (verified live via Graph
   API 2026-07-03; only D.A. Hoops is CBO). Read campaign budget, fall back to
   summing active ad sets' daily_budget. Every campaign currently has exactly
   1 active ad set.
3. Landing page numbers: kpis-v15 `action=funnel` (funnel_events beacons -
   live and collecting since 2026-07-02; free-trial + enroll funnels).
4. Leads/booked: kpi_events (lead, trial_booked) via kpis-v15 section=marketing
   with since/until; booked-vs-other split + cost per booked trial derived.
5. Ad-set level: show learning-phase status badge; per-ad-set rows only when
   2+ ad sets exist (retargeting / second location - see strategy note).
6. V2-gated (GTA first), no em dashes anywhere in UI copy.

## Data source map (code-verified against origin/main 2026-07-03)

Four sources. Auth: staff token from `staff_meta_tokens` (staff's own first,
newest team token fallback via getAnyStaffMetaToken, marketing.js ~1856).
Client link: `clients.meta_ad_account_id` + `clients.meta_campaign_ids`.

| Dashboard number | Source | Status |
|---|---|---|
| Day N of month | date math | derived |
| Spent MTD | meta-campaigns insights date_preset=this_month spend | EXISTS |
| Planned spend | campaign daily_budget (marketing.js ~1955) | FIX: ad-set fallback |
| Campaign CPL / freq / CTR / reach / impressions | meta-report insights level=campaign (marketing.js ~2148) | EXISTS |
| CPA drift + trend arrows | same insights, current vs prior period | derived |
| Learning status | learning_stage_info on ad sets | NEW adsets call |
| Creative thumbnails | meta-creatives handler (/{campaign}/ads + video poster fetch ~3197-3308) | EXISTS |
| Per-ad hook/CPL/CTR/freq | nothing fetches level=ad today | NEW insights level=ad |
| Ad age | ad created_time | add field to existing /ads call |
| Visitors/form/calendar/booked + abandonment | funnel_events via kpis-v15 action=funnel | EXISTS (days= only) |
| Click->visit pill | Meta inline_link_clicks vs page_view sessions | derived |
| Leads / trials booked | kpi_events via kpis-v15 section=marketing since/until | EXISTS |
| Agent-booked split | no flag in kpi_events; join opportunities.source='agent' | FIX: join |
| Cost per booked trial | spend / trial_booked, two periods | derived |

Gotchas (agent-verified):
- NO Meta caching anywhere in marketing.js - every handler hits Graph live.
  Modal = 3-4 Graph calls per open; needs a cache table (Vercel lambdas make
  in-memory useless). ~10 min TTL.
- kpi_events trial_booked is idempotent per opp per month
  (ref = trialbook:{opp}:{YYYY-MM}) - safe to count directly.
- action=funnel takes days=N only; section=marketing already has since/until
  (ymdSec helper, kpis-v15.js ~259) - reuse it.
- opportunities.source values: website-form | agent | import | manual.
  Join kpi_events (step=trial_booked) to opportunities on client_id +
  ghl_contact_id to get the agent split.

## Build plan (locked 2026-07-03)

### Phase 1 - backend: one aggregate endpoint
New marketing.js action `machine` (params: client_id, since, until;
default = month to date).
Returns ONE payload powering both the simple card and the modal (card is a
rollup of the same health scores - never two sources of truth).

Graph calls (parallel, current + prior period where trends needed):
  a. campaign insights - reuse meta-report field set
  b. NEW /{campaign}/adsets?fields=daily_budget,status,effective_status,
     learning_stage_info  (one call = learning badge + ABO budget fallback)
  c. NEW /{acct}/insights?level=ad&fields=ad_id,ad_name,spend,actions,
     impressions,frequency,ctr,inline_link_clicks,video_3_sec_watched_actions
  d. /{campaign}/ads - existing creatives fetch + ADD created_time
     (thumbnail extraction hierarchy already handles image/carousel/video)

Supabase reads:
  e. funnel_events counts (page_view/form_started/calendar_viewed/confirmed)
  f. kpi_events lead + trial_booked, joined to opportunities for agent split

Server-side health scoring using the thresholds section above - endpoint
returns color per number + the single worst-thing warning line; UI never
re-derives judgments.
Planned spend = campaign daily_budget || sum(ACTIVE ad sets' daily_budget).

### Phase 2 - kpis-v15 tweak
action=funnel accepts since/until (reuse ymdSec) so the modal range picker
(7d/30d/this month) hits one convention everywhere. (Skippable if Phase 1
reads funnel_events directly - decide at build time.)

### Phase 3 - frontend
Simple card on the V2 Marketing page (GTA first) + Marketing Machine modal
per the ASCII specs above. Mobile stacks vertically. No em dashes.

### Phase 4 - cache
`meta_insights_cache` table (client_id, range, payload jsonb, fetched_at),
~10 min TTL, serve-stale-while-refresh. Without it the card makes the
Marketing page feel slow. Run align-core-data-model when adding the table.

### Verification (build session exit criteria)
- GTA numbers match Ads Manager for the same range (spend, CPL, freq, hook)
- Planned spend matches Ximena's ad-set budgets for 3+ ABO clients
- funnel step counts match a raw funnel_events query
- agent split spot-checked against the pipeline board
Build order: 1 -> verify vs live GTA data -> 3 -> 4 (2 folded into 1 if direct).

## Bar recipes FINAL (Zoran decisions 2026-07-03; replaced weighted-avg idea)

One metric = one bar. Color = threshold band; fill length maps the metric
onto its scale (lower CPL = fuller bar, higher ratio = fuller bar). All
scored server-side in the machine endpoint; UI draws what it is told.

CAMPAIGN bar = COST PER LEAD (Zoran-set bands):
  green < $40, gold $40-55, red >= $55

PAGE bar = CLICKS -> LEADS % (Meta inline_link_clicks -> kpi_events leads).
  Also displayed as a NUMBER in the detailed modal's LANDING PAGE section.
  Bands PROPOSED (tune vs GTA real data): green >= 10%, gold 5-10%, red < 5%

CREATIVE bar (hybrid, per live ad - Zoran approved 2026-07-03):
  1. TESTING (grey): age < 3 days OR spend < $20 -> no verdict yet; bar
     renders as a grey "testing" state, never red before it earned a read
  2. Base band = the ad's own CPL, same $40/$55 bands as the campaign
  3. Demote ONE band if frequency > 3.5x OR hook rate < 25%
     (fatigue early warning - fires before CPL degrades)
  4. An ad demoted for 0 leads at meaningful spend counts as red

Refresh / kill guidance (feeds the simple card's single warning line;
worst thing wins, one line only):
  - red CPL with >= $75 spend -> "kill [ad], move budget to [best ad]"
  - demoted by frequency (>3.5x) -> "audience worn out - clone the winner
    with a fresh angle" (REFRESH trigger)
  - demoted by hook (<25%) -> "first 3 seconds not stopping thumbs -
    re-hook it" (REFRESH trigger: new opening, same body often fine)
  - gold CPL + frequency climbing 2 checks in a row -> "start producing
    the replacement now" (pre-emptive refresh)
  - < 6 live creatives (excl. testing) -> "add angles (want 6+)"
  Priority order: red creative > demotions > pre-emptive > creative count.
