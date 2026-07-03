---
name: Marketing Machine dashboard (design locked, build pending)
description: Zoran-approved design (2026-07-03) for the Marketing page card - simple flow view with colored health bars + detailed machine modal with colored numbers. Full ASCII specs inside. Build planned for a future session.
type: project
---

# Marketing Machine dashboard - DESIGN LOCKED 2026-07-03, NOT BUILT

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
- Bar health recipes: CAMPAIGN = CPA drift + learning status + pacing;
  each CREATIVE = its hook rate + CPL + frequency + age blended;
  PAGE = visitors->form rate + calendar abandonment

## DETAILED MODAL (final v6/v7)

No bars. Every judged number is colored green/gold/red with a small dot;
neutral facts (impressions, reach, age, raw counts) stay uncolored.
Section headers carry a rollup dot (worst child wins) matching the simple
card's bar. Range picker top-right (7 days / 30 days / this month).

```
MARKETING MACHINE                              [ 7 days v ] [ x ]
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
