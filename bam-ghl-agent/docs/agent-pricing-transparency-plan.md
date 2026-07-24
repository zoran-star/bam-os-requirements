# Agent pricing: live prices + disclosure on the agent template

Agreed with Zoran 2026-07-24. Design doc, not yet built.

## Why

Two separate faults, one symptom: the sales agents talk about money using numbers
nobody is charged.

**Fault 1 - wrong source.** `renderPricing()` in `api/agent/fact-render.js` reads
`offers.data.pricing.pricing_offerings[].price`, which stores **pre-tax** amounts
alongside a free-text `added_fees: "13% HST"`. Checkout
(`api/website/checkout.js`) sells `offer_prices` rows, which store
**tax-included** amounts. Verified live:

| BAM GTA plan | Agent says | Parent is charged | Gap |
|---|---|---|---|
| 1/Wk (Steady) | $200 / mo | **$226.00** | +$26 |
| Summer Unlimited | $279 / mo | **$315.27** | +$36 |
| Summer Unlimited, 3 months | $753 | **$850.89** | +$98 |

**Fault 2 - policy fused into data.** "Transparency mode" exists only as the string
literal `"Transparency mode: RANGE"` inside that same renderer. It is invisible,
unchangeable, cannot vary per sales motion, and the text promises an EXACT mode
that has no mechanism to exist. How openly to discuss price is sales craft
(tier 1, BAM's), not an academy fact (tier 3).

**Live leak.** `assemblePrompt`'s `pick()` falls back to the hardcoded
`prompt-structure.js` body when there is no rendered fact and no stored row. Shig
Hoops (V2 access, 0 training offers, 0 stored pricing rows) therefore carries
**BAM GTA's** `$185 to $565` Steady/Accelerate/Elevate/Dominate ladder today. Not
a dead fallback.

Also: DETAIL Miami has 9 training offers; the renderer reads only the first.

## The split

The rendered `<pricing>` fact is **byte-identical in all three modes**. The agent
always knows the numbers, because it needs them to qualify and to reason. The
mode governs only what it may say. That instruction lives in the master.

```
TIER 1  agent template `trial_booking` { disclosure: "range" }
        -> master behavior text, shared, propagates to every academy

TIER 3  <pricing> fact, rendered live from routable offer_prices
        -> the academy's real numbers, nothing else
```

### Where the mode lives: the agent TEMPLATE

Zoran's call, and it is the right one: on `AGENT_TEMPLATES` in
`api/agent/presets.js`, not on the preset. Reusing `trial_booking` in a second
sales system carries its disclosure policy along, exactly as `lessonKey` and
`mission` already travel with it.

**This needs plumbing that does not exist yet.** `AGENT_TEMPLATES` is a
declaration-only registry today; nothing resolves a client to a template at
prompt-build time. The builder knows only the runtime (`booking` / `confirm` /
`closing`). We need `clientId + runtime -> template`, via
`resolvePresetKey(clientId)` (already in `preset-master.js`) then
`PRESETS[key].stages[].engine.template`. Phase 4 lesson-scoping needs the same
resolver, so this is shared groundwork rather than a cost carried by this build
alone.

### Modes

| Mode | Master instruction |
|---|---|
| `range` | Share the band. Full details covered at the trial. |
| `exact` | Share the actual plan prices when asked. |
| `withhold` | Share no numbers. All pricing is covered at the trial. |

`free_trial`'s templates start at `range`, which is today's behavior. No academy
changes on day one.

### Missing numbers

No routable `offer_prices` row means the agent quotes nothing: it says it will get
them exact numbers and silently flags the admin. This body also **replaces**
GTA's hardcoded prices as the master default, which is what closes the Shig Hoops
leak.

Accepted consequence: an academy mid-onboarding has a pricing-silent agent until
its catalog is seeded. BAM San Jose is in exactly this state today (zero
`offer_prices` rows). Correct, and it makes catalog seeding a real gate.

## Rendered output, from real data

**BAM GTA:**

```
Prices are what a parent is charged today, tax included, in CAD.
Range: $226 to $315 every 4 weeks.

- 1/Wk: $226.00 every 4 weeks. 1 training/wk.
- Summer Unlimited: $315.27 every 4 weeks. Unlimited credits to train.
    3 Months prepaid: $850.89, then goes back to monthly.

Discount codes: 2SIBLING - 50% off, every payment, reusable.
```

**BAM San Jose:**

```
No sellable prices are configured for this academy yet.
Do not quote any price, range, or plan. Say you will get them exact
numbers, and flag it to the admin.
```

## Build order

| # | Build | Effect | Risk |
|---|---|---|---|
| 1 | `renderPricing` reads routable `offer_prices` | Stops the live mis-quote | Low |
| 2 | Neutral master default, GTA's prices deleted | Closes the Shig Hoops leak | Low |
| 3 | `clientId + runtime -> template` resolver | Missing plumbing | Med |
| 4 | `disclosure` on `AGENT_TEMPLATES` + master text | The architecture fix | Low |
| 5 | Render `discount_codes`, commitment `after`, `discount_notes` | Agent stops being told to cite data it never got | Low |
| 6 | Read-only mode in the brain view, GLOBAL badge | Staff and owners can see the policy | Low |

Builds 1 and 2 ship independently and fix the money bug. Anything that reaches
the master hits BAM GTA, BAM San Jose, and DETAIL Miami at once, by design.

## Rules for the build

- The agent must never state a number that is not what the parent is charged.
  An agent that declines to quote is better than one that quotes wrong.
- Never invent pricing. Everything renders from the academy's own records.
- Structure goes to the master for everyone; content stays in the academy's offer.
  No per-academy structural fork.
- V1 academies unaffected.
- Backend and persistent-data changes: run the `align-core-data-model` skill.
- No em dash anywhere, including prompt text the agent will speak.

## Deferred, in order

1. **`signup_fee`.** San Jose's $40 fee has no home in the data model at all, and
   whether it is per athlete or per family is unresolved. Plan and build after
   this lands.
2. **Preset portability audit.** Zoran's own follow-on: walk the whole free-trial
   sales system and ask what else can be copied into another preset (agents,
   entry points, landing pages, calendars).
