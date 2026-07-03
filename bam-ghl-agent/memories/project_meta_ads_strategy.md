---
name: Meta Ads Strategy (post-Andromeda rules + KPI shortlist)
description: Zoran's confirmed campaign-structure rules for academy ad accounts (one campaign per goal, 1 broad ad set, multiple ad sets ONLY for retargeting or a second location) + the fact-checked post-Andromeda KPI shortlist for the marketing dashboard.
type: project
---

# Meta Ads Strategy - post-Andromeda (decided 2026-07-03)

Source: deep-research run (97 agents, 15 sources, 25 claims adversarially
verified, 14 survived) + Zoran's confirmation in chat. These rules drive both
how BAM sets up academy ad accounts AND what the marketing KPI dashboard shows.

## Campaign structure rules (Zoran-confirmed)

- **One campaign per GOAL / conversion event**, not per offer. Offer variants
  (Group 1 vs Group 2 trial, promo vs no promo) = different ADS in the same
  campaign, not campaigns.
- Separate campaigns only for a genuinely different ask + funnel (free trial
  vs ADAPT tryout vs summer camp - different conversion event + landing page).
- **1 broad ad set per campaign.** Multiple ad sets ONLY for:
  1. **Retargeting** (warm audience with its own message)
  2. **A second location** (own geo radius)
  Interest/lookalike/demographic ad-set splits are dead - post-Andromeda the
  creative does the targeting.
- Budget floor: **~$30/day per campaign** to exit learning; at $30-100/day an
  academy runs 1, max 2 campaigns at once (or runs seasonal campaigns serially).
- **6+ genuinely DIFFERENT creative angles** per ad set (transformation,
  pain-point, parent testimonial, coach method, team culture, urgency) - not
  near-duplicates. Refresh an angle when frequency ~3x or CPA drifts +20%.

## Post-Andromeda KPI shortlist (for the dashboard)

Campaign level: amount spent · results (leads) · **cost per result** ·
**CPA drift week-over-week (alert >20% rise)** · frequency (rotate ~3x, cold
local ~2.5-3) · CTR (supporting only - "CTR is dead" was refuted) ·
impressions/reach as context.

Creative (per-ad) level - needs ONE new Meta `level=ad` insights call
(thumbnails already fetched in marketing.js meta-creatives): **hook rate**
(3-sec views / impressions, 30%+ strong, 40%+ elite) · cost per lead per
creative · CTR per creative · frequency per creative · creative age ·
count of live distinct concepts (want 6+).

Downstream (already collected outside Meta): landing-page conversion %
(funnel_events beacons - LP conv fell ~17% industry-wide under Andromeda) →
leads → booked trials → **cost per BOOKED TRIAL = the end-of-machine
headline** (judge by this, not raw CPL).

Refuted hype (do NOT encode as rules): "refresh every 2-3 weeks", "run exactly
10-20 creatives", "CTR is a vanity metric". Thresholds above are heuristics.

## Planned dashboard shape (proposed, not built yet)

"Machine" flow for the KPI tab marketing section:
CAMPAIGNS (spend, cost/result, CPA drift) → CREATIVES (hook rate, CPL/creative,
age, tiles) → LANDING PAGE (visitors, form steps, calendar abandonment) →
LEADS (split: booked trials vs other) with conversion pills between stages.
Related: [[project_ad_performance_dashboard]], [[project_kpis_offghl]],
funnel beacons in [[project_offer_visual_flow]].
