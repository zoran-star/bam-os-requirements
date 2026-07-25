# Money model: tax template + sign-up fee + coupon applicability

Planned with Zoran 2026-07-24, straight after the agent-pricing-transparency
builds (see agent-pricing-transparency-plan.md). INFRASTRUCTURE ONLY: no academy
gets a sign-up fee or a new tax setting applied until Zoran says so per academy.
Flow: this plan -> mockups -> Zoran confirms -> build.

## Why this is one plan, not three

The $40 question started it: BAM San Jose charges a one-time $40 sign-up fee on
the 4-weekly option, waived on 3/6-month commitments, per athlete. There is no
field for it. The only lookalike field, the free-text "Added fees" box, is a trap:
it was built for tax, so it repeats on EVERY payment. Typing $40 there means $40
every 4 weeks forever, flowing straight into the Stripe price.

Pulling that thread exposed the structure underneath:

- The sign-up fee needs its own tax treatment (Zoran: "it's going to have its own
  fees associated with it"). Building that as another free-text box would clone
  the trap.
- Tax itself should be TEMPLATIZED at the academy level (Zoran: "a lot of
  academies will charge that"), not retyped as free text on every price and every
  commitment. Today "13% HST" is typed per offering, with per-commitment copies,
  and parseFee() regexes it apart at charge time.
- Coupons need an APPLICABILITY model (Zoran: "when setting the coupon, we will
  have to set how it applies to each price AND their associated fees"). Today a
  coupon is subscription-level, so Stripe silently applies it to every line on
  the invoice, one-time lines included.

One model, three builds, strict order: T (tax) -> S (sign-up fee) -> C (coupons).
T comes first because S references it, and building S first would mint a second
free-text fee box that T would then have to migrate.

## The model

```
ACADEMY level (set once)
  tax template        e.g. { label: "HST", pct: 13 }  or none (US academies)

PER PRICE (offering / commitment)
  price               pre-tax recurring base (exists today)
  taxable?            yes/no against the academy template (replaces free text)

PER OFFERING (one-time)
  sign-up fee         { amount (pre-tax), taxable?: yes/no, per: athlete }
  on options          explicit charge/waive choice per option, owner-set, nothing assumed

PER COUPON
  applies to          checklist: each sellable price + each fee, individually
```

Tier discipline: the FIELDS and the math are master structure, identical for
every academy. The VALUES are the academy's own (tier 3). The agents read all of
it through the pricing fact, which keeps quoting only what checkout charges.

## Build T: templatize tax

- `clients.tax_config` (or equivalent): label + percent, set once in the
  Blueprint, for ANY academy and ANY sales tax (HST, a US state sales tax,
  anything with a name and a rate). Empty = no tax.
- Prices and commitments get `taxable: yes/no` (default yes when a template
  exists) instead of free-text `added_fees` strings.
- `_fees.js` stays THE one place money math lives; it reads the template instead
  of regexing typed strings. match-prices / create-price / checkout keep their
  call sites.
- Migration: GTA's typed "13% HST" strings -> one template + taxable flags.
  Existing `offer_prices` amounts do not change (they are already all-in).
- KILLS THE TRAP as a side effect: with tax structured, the free-text added_fees
  box retires, and there is no longer a box where a flat $40 silently becomes a
  recurring charge.

## Build S: sign-up fee infrastructure

- New offering-level field group in the wizard's Pricing step:
  amount (pre-tax), taxable yes/no (uses the academy template), and per-athlete
  semantics stated in the hint. Per athlete is exact-fit for checkout: one
  enrollment = one athlete, so two siblings = two checkouts = two fees, no
  special casing.
- Charge or waive is an EXPLICIT owner choice on every option (Zoran 2026-07-24:
  "not by default, i want to set it"). Nothing is assumed: an option with no
  choice made charges nothing extra, so a legacy or half-configured offer can
  never surprise a parent. Waiving on commitments (San Jose's model) is the
  classic nudge toward the longer term, but it is the owner's call per option.
- Charged as an `add_invoice_items` one-time line on the FIRST invoice - the
  exact mechanism checkout already uses for future-start billing. Never on
  renewals. Carries its own Stripe product so Build C can target it.
- The all-in fee amount is computed by the same shared function checkout uses,
  so the agent, the enroll card, and the card charge can never disagree.
- Surfaces, all reading the one field:
    enroll funnel card   "plus $45.20 one-time sign-up fee" / "no sign-up fee"
    checkout pay line    itemized, before the parent pays
    agent pricing fact   "One-time sign-up fee: $X per athlete, tax included,
                         waived on 3 and 6 month commitments."
    brain view           part of the live pricing fact, as today
- NOT applied to anyone at ship time. San Jose's $40 gets entered when Zoran
  says go (their offer_prices catalog must be seeded first anyway - the agent
  is silent on their pricing until then).

## Build C: coupon applicability

- Discount codes are the ACADEMY OWNER'S, not BAM's. Each code the owner creates
  gets an applies-to checklist scoped to LIVE prices only (Zoran 2026-07-24):
  rows that are active + routable in the portal AND live in Stripe. Archived,
  inactive, or unroutable prices never appear on the checklist, so a code can
  never be attached to something that cannot be sold.
- Stripe mechanics (docs read 2026-07-24): TWO native enforcement tools.
  (a) `applies_to[products]` on the coupon restricts the discount to matching
  recurring lines. CAVEAT: prices can SHARE a product - DETAIL Miami has 9
  active prices on 6 products - so per-price checkboxes are only enforceable
  where products are distinct; shared-product prices group into one honest
  checklist line, or migration splits products. GTA is 1:1 today.
  (b) `add_invoice_items[i][discounts]` attaches a discount to ONE one-time
  line directly. Checkout therefore never relies on cascade behavior for the
  fee: if the owner's checklist covers the fee, checkout attaches the discount
  to the fee line itself; if not, the fee line simply carries none. This is
  deterministic and removes the only documented-silent interaction (whether
  applies_to reaches invoice-item lines) from the critical path.
- Migration: GTA's 2SIBLING (50% off, every payment) maps to "applies to all
  current prices", which is byte-identical to its behaviour today.
- The agent's discount line then renders what the code actually covers, so
  "50% off" never silently includes or excludes a fee the config says otherwise.

## Mockups to produce before building (Zoran confirms on these)

1. Blueprint: the academy tax template card.
2. Offer wizard Pricing step: taxable toggle replacing the added-fees text
   boxes + the sign-up fee group + the per-commitment waive toggle.
3. Enroll funnel card + checkout line with a fee present and waived.
4. Coupon editor: the applies-to checklist.
5. Agent pricing fact: rendered output for a San Jose-shaped academy with the
   $40 configured.

## Risk register (scanned 2026-07-24)

Zoran reviewed 2026-07-24: mitigations 2-6 approved as written; #1 accepted with
the live-prices-only scoping; #7 and #8 decided (see rows); #9's test matrix
explained and pending his sign-off.

| # | Risk | Level | Answer |
|---|---|---|---|
| 1 | Prices SHARE Stripe products (Miami: 9 prices, 6 products), so per-price coupon checkboxes cannot always be enforced per price | HIGH | ACCEPTED + scoped (Zoran 2026-07-24): the checklist lists LIVE prices only (active + routable + live in Stripe); shared-product prices within that set are grouped into one honest line, or migration splits products. Verify product uniqueness per academy before enabling C there. GTA is 1:1. |
| 2 | Stripe coupons are immutable: editing an applies-to list means a NEW coupon + re-pointing the promotion code, without touching subscriptions already carrying the old coupon (live 2SIBLING families) | HIGH | Build C treats applicability edits as create-new + swap-code; active subscription discounts are attached objects and stay untouched. Test with a live-sub clone first. |
| 3 | Tax rate change mid-life: editing the template does NOT change existing Stripe prices, so renewals keep billing old amounts while the template claims otherwise - the typed-vs-charged gap reborn | HIGH | A template edit for an academy with live prices triggers an explicit re-price flow (new rows, old archived), never a silent recompute. Until re-priced, surfaces keep reading the catalog, which stays the truth. |
| 4 | Fee enabled while owner coupons exist, before Build C ships: sub-level codes silently discount the fee | MED | Hard gate: no fee is enabled for an academy with active discount codes until C is live for them. |
| 5 | Enroll card UI lives in bam-client-sites (separate repo): the API can expose a fee the site does not render, so the parent first meets it at the pay summary | MED | Per-academy enable checklist includes the site deploy. Fee invisible on the card = fee not enabled. |
| 6 | GTA migration mis-flags a price (taxable yes/no wrong) and a computed all-in drifts from the catalog | MED | Migration changes compute paths only; offer_prices amounts do not move. A drift check compares computed vs catalog per price and blocks enabling on mismatch. |
| 7 | Returning member re-enrolls: fee again or not? | DECIDED | Zoran 2026-07-24: YES, the fee is charged again on re-enrollment. Every enrollment event carries the fee where configured; the agent's fact can say so plainly. |
| 8 | Refund-window cancellation: is the fee refundable? | DECIDED | Zoran 2026-07-24: YES, the fee is refundable inside the academy's refund window, same as the plan payment. Rendered into the policies fact so agent and agreement PDF agree. |
| 9 | Fee line + future-start anchored billing + coupon all on one first invoice (three interacting mechanisms) | MED, DOWNGRADED | Stripe docs read 2026-07-24: every piece is documented-supported. A one-time fee on the first invoice is Stripe's own recommended pattern; `add_invoice_items` is an array (fee + prepaid-period lines coexist); per-line discounts (`add_invoice_items[i][discounts]`) make coupon behavior on the fee deterministic instead of cascade-dependent. Our checkout also already verified with test clocks that an unrestricted sub-level coupon DOES hit one-time lines, which is exactly why Build C must scope. The test matrix stays as a confirmation pass before any academy enables a fee, but it is now confirmation, not exploration. |
| 10 | An academy needs TWO tax rates (GST+PST split, tax-exempt programs) | LOW | One-rate template is v1 scope by design. Flag when a real academy needs more; do not pre-build. |
| 11 | Checkout retry double-charges the fee | LOW | Subscription creation is idempotency-keyed and the fee rides that same call. Covered by the #9 matrix. |
| 12 | DETAIL Miami: agent fact reads only the FIRST training offer, so a fee on another offer is invisible to the agent | LOW | Already an open item; becomes part of the multi-offer fact build, not this one. |
| 13 | Wizard complexity creep: explicit per-option choices add clicks for non-technical owners | LOW | Unset = charges nothing, ever. The wizard nags visually but never assumes a charge. |

## Ground rules carried over

- An agent must never state a number that is not what the parent is charged.
- Money math lives in ONE shared function; every surface reads it.
- Structure to the master for everyone; values in the academy's offer. No forks.
- V1 untouched. Persistent-data changes run the align-core-data-model skill.
- No em dash anywhere person-facing.

## Open items folded in from earlier

- DETAIL Miami has 9 training offers; the pricing fact reads only the first.
- Preset portability audit (Zoran's follow-on session) comes after this.
