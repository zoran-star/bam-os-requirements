# SJ price match - decision + run log

Room: SJ PRICE MATCH. Match 2 (portal plans <-> Stripe prices) for BAM San Jose, client_id 5576acf0-acd3-4c05-9f9f-ebfde8618154, Stripe acct_1RDtSMK6ZS1cqefu (Lij, CoachIQ-locked, direct-key transport pending).

Rule of the room: skill gets written AFTER the live run, from this log, never from the plan.

## Prep phase (2026-07-31 -> 2026-08-01)

### Verified facts
- Stripe snapshot (docs/workbook/sj-price-catalog-2026-07-31.json): 119 prices, 27 products, ALL marked active in Stripe. 13 prices had live subscribers in the snapshot.
- Roster (docs/workbook/sj-roster-2026-07-31.json): 20 active members. Reconcile found Aaron Rufin on an unnamed $749/12wk price (price_1TvhbPK6ZS1cqefuSSUzdSmI) that is NOT in the catalog snapshot (minted after it). True totals: 14 in-use prices, 20 members.
- Portal side (Supabase, live query): ONE draft offer "Training" (4d15a274-d7cd-4369-82e6-5ebe2f9056c2) with 9 typed prices (1x $175/425/875, 2x $250/599/1150, Unlimited $300/749/1399). pricing_catalog, offer_options, offer_prices: all EMPTY for SJ. client_stripe_direct table not in prod yet.
- All 20 members are recurring subs; no prepaid one-time members in the roster.

### Draft mapping (proposed, adoption popup still pending - Zoran kept asking side questions)
- 8 clean live matches; legacy dupes: Bernard $250 (dup product), Aaron unnamed $749, Salvador $200 pre-season-on-1x.
- Judgement calls queued: Elementary Academy plan missing from portal (3 members: Ted, Jenny live @200, Keanu family deal @100); Adam Ly $300 "Pre Season" on Unlimited product = recommend live Unlimited monthly; Christy Hang "Academy (Christopher)" @199 = ask Lij which plan.
- Portal prices with no Stripe twin: 1x 3mo $425, 1x 6mo $875. Stay unminted until first buyer.
- DO-NOTs honoured: only in-use prices adopted, other ~105 never touched, no Stripe writes during matching.

### Sign-up fee scan (2026-08-01)
- Zoran asked mid-walkthrough: did members pay a sign-up fee? Snapshots had no charge data; no key in this room.
- Asked orchestrator (WAIT FOR STRIPE ACCESS room). Doctrine established: THIS ROOM NEVER GETS THE KEY - orchestrator runs reads on request, returns data. Key has Charges/Invoices/PaymentIntents READ (verified live).
- VERDICT (docs/workbook/sj-signup-fee-scan-2026-08-01.json in member-mgmt-2 worktree): "Setup Fee - <plan>" $40 charged 11x (Dec 2025 - 2026-06-11), always a first-invoice line item on new Academy subs; waived 3x via NOSETUP -$40 line. Caveat: the file's one_time_invoice_lines list is noisy (GHL bills first cycles as invoiceitem lines); trust the VERDICT block.
- Also found: standalone one-time products outside subscriptions - Summer Bundle Camp $250-350 (actively selling) and Adapt Academy Tryouts $30. Scoping decision queued.

### Ruling: $40 sign-up fee (Zoran, 2026-08-01)
"Yes, set it" - fee goes on the portal pricing rows, charged on the every-4-weeks option only, waived on 3/6-month prepay (mirrors Lij's real Stripe behaviour).
APPLIED via SQL to offers.data.pricing.pricing_offerings (all 3 offerings: signup_fee="40", signup_fee_on_base="charge"; all commitments: signup_fee_charge="waive"). Verified in the returning row. This makes buildOfferTargets mint a `<plan>|signup_fee` one-time target per plan at match time.

### Ruling: one-time products (Zoran, 2026-08-01)
Summer Bundle Camp ($250-350) and Adapt Academy Tryouts ($30) are OUT of the price match. Membership subscriptions only. They stay untouched in Stripe, recorded in the result doc as deliberately out of scope; can become portal camp offers later.

### Zoran's framing of the room (2026-08-01, goes in the skill)
This room does NOT seed members (separate chat). The exercise = every Stripe price with a live subscriber ends up classified live OR legacy in our pricing. That coverage check is a mandatory gate in the skill: in-use prices with no tier = match not done.

### Ruling: Elementary Academy (Zoran, 2026-08-01)
"Add it" - Elementary Academy added as 4th plan, $200 every 4 weeks, no commitments. APPLIED via SQL (plan_count now 4). Default taken and flagged: same $40 signup fee as the other plans (Zoran can veto). Ted's price -> live, Jenny's dup -> legacy, Keanu deal -> legacy.

### Ruling: Pre Season (Zoran, 2026-08-01)
Asked what Pre Season options are; analysis showed Pre Season amounts mirror the Unlimited ladder ($300/749-750/1399ish) and 1x ladder, and the in-use ones sit ON the core products. Zoran: "actually just treat it as the unlimited" -> Pre Season Academy prices = Unlimited plan. Adam Ly $300/4wk = LIVE Unlimited monthly. Pre Season 1x prices remain 1x variants: Salvador $200 = legacy 1x monthly. No Pre Season plan in portal pricing; season stays a schedule/class concept.

### Open items
- [ ] Ask Lij: which plan is Christopher's $199 deal on (last untiered judgement; tier=legacy either way, only the plan attachment is open)
- [ ] Optional veto: Elementary got the $40 signup fee by default
- [ ] billing_cadence: nothing writes offer_prices.billing_cadence yet - SJ rows may need hand SQL after offers-sync (queue item from PR #1675)
- [ ] BLOCKED: live run waits on direct-key transport deploy + Lij write key saved

### Coverage check status (the skill's gate)
13 of 14 in-use prices tiered, 19 of 20 members covered. Only Christopher's $199 awaits Lij's answer on which plan it discounts.
