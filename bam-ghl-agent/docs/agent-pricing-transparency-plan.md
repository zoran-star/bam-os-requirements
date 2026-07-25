# Agent pricing: live prices + disclosure on the agent template

Agreed with Zoran 2026-07-24. All six builds shipped the same day.

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

| # | Build | Effect | Risk | Status |
|---|---|---|---|---|
| 1 | `renderPricing` reads routable `offer_prices` | Stops the live mis-quote | Low | **shipped** |
| 2 | Neutral master default, GTA's prices deleted | Closes the Shig Hoops leak | Low | **shipped** |
| 3 | `clientId + runtime -> template` resolver | Missing plumbing | Med | **shipped** |
| 4 | `disclosure` on `AGENT_TEMPLATES` + master text | The architecture fix | Low | **shipped** |
| 5 | Render `discount_codes`, commitment `after`, `discount_notes` | Agent stops being told to cite data it never got | Low | **shipped with 1** |
| 6 | Read-only mode in the brain view | Staff and owners can see the policy | Low | **shipped** |

Anything that reaches the master hits BAM GTA, BAM San Jose, and DETAIL Miami at
once, by design.

### What shipped 2026-07-24

**Builds 1 + 2** (commit `a21bdb5`). `renderPricing(data, prices)` takes the
routable + active `offer_prices` rows for the numbers and reads the offer only for
copy, what's included, commitment `after`, `discount_notes` and `discount_codes` -
which is Build 5, so it came along for free. Empty catalog means the agent quotes
nothing and flags the admin; a failed read returns null and falls back. The
hardcoded `pricing` default became the shared `PRICING_NOT_CONFIGURED` constant.

**Builds 3 + 4** (commit below). Build 3 added `templateForRuntime` (presets.js,
pure) plus `resolveAgentTemplate` and `resolveDisclosureOverride`
(preset-master.js, async). Build 4 added `disclosure` to every `AGENT_TEMPLATES`
entry, the three `PRICING_DISCLOSURE` bodies, and a `pricing_disclosure` section
wired into all three agents' instruction order. All six prompt-build call sites now
pass the runtime they already knew. Every `free_trial` template ships `range`, so
no academy changed behaviour. `core_behavior` item 4 no longer hardcodes RANGE: it
points at the disclosure rule and keeps only the never-invent-a-number rule, which
applies in all three modes.

**How to change the policy:** edit `disclosure` on the template in
`api/agent/presets.js`. It goes live for every academy on that template at the next
prompt build. It is applied AFTER stored overrides on purpose, so an academy cannot
widen its own agent's disclosure, and a stale stored row cannot shadow a BAM change.

**Build 6.** `pricing_disclosure` comes back from both brain endpoints with
`scope: "policy"`, `editable: false`, the live resolved body, and a `policy`
object naming the mode and the template. Both portals render it as a locked card:
a gold mode badge (RANGE / EXACT / WITHHOLD), a "set by BAM" badge, and a line
saying which agent template it is set on.

Read-only for EVERYONE, including BAM staff and the global-editor academy. Since
the policy is applied after stored overrides, an edit here would save a row that
is then ignored, so an editable box would be a lie. Change it in `presets.js`.

Fixed in passing: `api/agent-sandbox.js` returned no `scope` at all, so the STAFF
brain editor rendered derived facts as editable textareas. `SandboxApp.jsx` had
the read-only branch already written, but it could never fire. Staff edits to a
derived fact appeared to save and were then ignored at prompt-build time. The
sandbox endpoint now returns the same scope/source/editable shape as agent-train.

**Ambiguity note:** `discovery_trial` runs two `booking`-runtime templates
(`call_booking` then `trial_booking`). `templateForRuntime` returns the earliest by
board position, which is the stage a lead reaches first. A caller that needs a
specific stage's template should pass the template rather than re-derive it.

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
