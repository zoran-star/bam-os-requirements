# Sales system ADD-ONS + the Downsell add-on (SPEC PROPOSAL)

Status: PROPOSED 2026-07-23 (out of the /consolidate-lessons run - Zoran: "sales
systems will have add ons, and downsells will be one of those"). Nothing built.

## 1. What an "add-on" is in the plug-and-play model

The control dial today (see `memories/project_sales_systems_plug_and_play.md`):
tier 1 master structure, tier 2 seeded-then-academy sequences, tier 3 live facts.

An **add-on** is a new concept that sits across the tiers:

```
┌─────────────────────────────────────────────────────┐
│  ADD-ON = an optional, MASTER-AUTHORED module        │
│                                                      │
│  Behavior (how it works)  → tier 1, BAM master,      │
│                             one implementation,      │
│                             auto-propagates          │
│  Enablement (on/off)      → per academy toggle       │
│  Values (what it uses)    → tier 3, derived live     │
│                             from the academy's offer │
└─────────────────────────────────────────────────────┘
```

Rules an add-on must obey:
- The BEHAVIOR is written once by BAM and is identical for every academy that
  turns it on. No academy ever forks add-on logic (same guardrail as presets).
- Turning it on requires the academy's own DATA to power it. If the data is
  missing, the add-on stays off and the UI says exactly what is missing.
- An add-on hangs off a preset (first family: `free_trial`), so a preset
  declares which add-ons it supports.

Future add-on candidates beyond downsell: referral ask, upsell-to-more-days,
win-back discount, payment-plan offer.

## 2. The Downsell add-on

**Problem it solves:** when cost, distance, or commitment blocks a close, the
agent gives up or invents an offer. GTA staff manually downsell to the
once-per-week option (taught via Hawkeye; currently a GTA academy lesson).

**What it does when enabled:** the closing agent knows the academy's downsell
ladder and, when it detects a cost/commitment/distance objection from a
good-fit lead, offers exactly ONE step down the ladder before accepting a loss.

### Data model

- `offers.data.pricing.tiers[]` rows gain an optional `downsell: true` flag OR
  an explicit `downsell_rank` (1 = first fallback). The LADDER is derived:
  tiers sorted by rank/price, agent only ever offers the next step down from
  what was discussed.
- Enablement: `offers.data.sales.addons = { downsell: { enabled: true } }`
  (stamped next to `preset_key`, per academy per offer).
- No new tables. The ladder is tier-3 fact data rendered live (same
  `fact-render.js` pattern - a `renderDownsell(data)` block appended to the
  closing agent's facts only when the add-on is enabled).

### Agent wiring (tier 1, shared)

- New shared instructions section `closing_downsell` in `prompt-structure.js`
  (general layer), injected into CLOSING_INSTRUCTIONS_ORDER ONLY when the
  add-on is enabled for the academy (same conditional pattern as rendered
  facts). Content: when to downsell (explicit cost/commitment/distance
  objection, good-fit lead), how (one step, frame as a fit not a discount),
  and when NOT to (never pre-emptively, never two steps in one conversation).
- Hawkeye unchanged: downsell drafts ride the normal closing queue.

### Config UI

- Blueprint > Offer > Pricing: a "Downsell option" marker on a tier.
- Train Agent > the closing agent card shows "Add-ons: Downsell ON/OFF"
  (owner-visible, per academy). Off = today's behavior, byte-identical.

## 3. User stories

| # | As a... | I want... | So that... |
|---|---|---|---|
| 1 | Academy owner | to mark one of my pricing tiers as the downsell option | the agent has a real fallback instead of losing the lead |
| 2 | Academy owner | to switch the downsell add-on on/off per offer | I control whether my agent ever offers a cheaper plan |
| 3 | Closing agent | to know the downsell ladder as a live fact | I offer a real plan with real pricing, never an invented discount |
| 4 | Closing agent | a shared rule for WHEN to downsell | I only downsell on a real cost/commitment/distance objection, one step at a time |
| 5 | BAM (master) | downsell behavior authored once in the shared brain | improving the downsell craft upgrades every academy that has it on |
| 6 | Hawkeye staff | downsell drafts flagged in the card summary ("suggests downsell to 1x/week") | I can veto a bad downsell before it sends |
| 7 | BAM staff | KPI: downsell offers made / accepted (pipeline_outcomes tag) | we can prove the add-on pays for itself |

## 4. Rollout

1. Build behind the enablement flag; GTA first (it already runs the play).
2. On enabling for GTA: retire the interim GTA academy lesson
   (`agent_lessons` 39a86d36, "offer the once-per-week option") - the add-on
   replaces it.
3. Preset #2 (discovery call) can declare the same add-on later - the behavior
   is motion-agnostic, the ladder comes from whatever offer is attached.

## 5. Open questions for Zoran

- Does a downsell ladder ever cross OFFERS (Training -> Camps) or only tiers
  within one offer? (Spec assumes within one offer.)
- Should the agent be allowed to downsell in BOOKING (pre-trial price shock)
  or is this closing-only? (Spec assumes closing-only.)
- KPI home: new `pipeline_outcomes` status values (`downsell_offered`,
  `downsell_won`) or a context tag on existing rows?
