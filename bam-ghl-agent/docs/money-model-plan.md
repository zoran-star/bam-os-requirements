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
  on commitments      waived by default, per-commitment "charge it too" toggle

PER COUPON
  applies to          checklist: each sellable price + each fee, individually
```

Tier discipline: the FIELDS and the math are master structure, identical for
every academy. The VALUES are the academy's own (tier 3). The agents read all of
it through the pricing fact, which keeps quoting only what checkout charges.

## Build T: templatize tax

- `clients.tax_config` (or equivalent): label + percent, set once in the
  Blueprint. Empty = no tax, which is most US academies.
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
- Commitments: WAIVED BY DEFAULT, per-commitment toggle to charge it too.
  Recommendation (accepted direction): the fee attaches to the enrollment event,
  and commitments are the incentive to skip it - San Jose's exact model, and the
  only real-world example we have.
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

- Each discount code gets an applies-to checklist: every sellable price
  (Steady monthly, Summer Unlimited monthly, SU 3-months, ...) plus each fee
  (sign-up fee), individually checkable.
- Stripe mechanics: coupons target products (`applies_to[products]`); every
  offer_price already has a Stripe product and the fee line gets its own, so
  the checklist maps 1:1 onto what Stripe can enforce. No invoice surgery.
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

## Ground rules carried over

- An agent must never state a number that is not what the parent is charged.
- Money math lives in ONE shared function; every surface reads it.
- Structure to the master for everyone; values in the academy's offer. No forks.
- V1 untouched. Persistent-data changes run the align-core-data-model skill.
- No em dash anywhere person-facing.

## Open items folded in from earlier

- DETAIL Miami has 9 training offers; the pricing fact reads only the first.
- Preset portability audit (Zoran's follow-on session) comes after this.
