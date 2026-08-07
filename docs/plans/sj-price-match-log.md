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

### Ruling: Elementary keeps the $40 sign-up fee (Zoran, 2026-08-04, MEMBER MANAGEMENT III)
Asked directly rather than left as a default nobody ever confirmed. "Keep the $40" - Elementary matches the other three plans: charged on the every-4-weeks option only, waived on prepay. **No DB change needed**, this ratifies what was already applied on 2026-08-01; the point was to convert a silent default into a ruling. The Elementary card in the price workbook therefore ships with the fee prefilled and does NOT ask Lij about it.

### Build requirement found 2026-08-04 (MEMBER MANAGEMENT III): the prefilled plan TITLES do not match the stored ones
Verified live, both sides, rather than assumed. The portal draft offer (4d15a274) stores **"1 Training/Week" / "2 Trainings/Week" / "Unlimited" / "Elementary Academy"**. The workbook mockup prefills **"Academy 1x/week" / "Academy 2x/week" / "Academy Unlimited" / "Elementary Academy"**, which are Lij's own Stripe product names (his roster reads "Academy (2x/week) - 3 Months" etc). **Three of four differ.**

The mockup is RIGHT to use his names - he has to recognise the plan to confirm it - and the portal offer is still `status=draft`, never published, so nothing live is at stake. But it creates a concrete requirement for the confirm-wiring, and it is the no-partial-submit ruling's problem in a second costume:

- **An untouched card that Lij simply confirms would rewrite the portal's plan title.** Under the capture schema that must serialise as `state=confirmed` with a real `was`/`now` pair (was "2 Trainings/Week", now "Academy 2x/week"), NOT as an unchanged row. A card he never edited must never produce a silent data change that staff review renders as "no change".
- Staff review must therefore show these three renames explicitly on the first pass, or they land unseen.
- Exact-match nit: his Stripe uses parentheses, "Academy (2x/week)"; the mockup drops them. Either match his spelling exactly or record the normalisation deliberately. Do not let it happen by accident.

### Ruling: special deals move to the MEMBER workbook (Zoran, 2026-08-04)
*"i think for special deals we have to set that up with the member import workbook"*

The Special deals card is REMOVED from the price workbook (9 cards -> 8). Christopher's $199 and Keanu's $100 are arrangements with a PERSON, not plans the academy sells, so they belong where Lij confirms his members. The price workbook is now purely about what he sells going forward.

**Why this does not break "editing money: only plan and date", and the guardrail that keeps it that way.** A special deal is a dollar amount, so at first glance this moves money onto the member surface. It does not, PROVIDED the member workbook is built so it cannot: both members already pay those amounts in Stripe. The member workbook shows the amount **read-only** and asks only which plan the discount attaches to. **It must never render a box to type a dollar figure.** The moment it does, money is being edited off the price surface and the ruling is broken. This is a build constraint on the member workbook, recorded here because that is where the ruling was made.

**The coverage gate is unaffected.** Both prices are tiered LEGACY already, so skill 1's mandatory check (every in-use price classified live or legacy) still closes. Only the plan attachment is open, and that is a member-level fact.

**Consequence for the Lij send:** the Christopher question no longer rides the price workbook. It rides the member workbook, which is the second of his two links. Nothing extra reaches him.

### Open items
- [ ] Ask Lij via the MEMBER workbook: which plan is Christopher's $199 deal on (tier=legacy either way, only the plan attachment is open)
- [ ] billing_cadence: nothing writes offer_prices.billing_cadence yet - SJ rows may need hand SQL after offers-sync (queue item from PR #1675)
- [ ] BLOCKED: live run waits on direct-key transport deploy + Lij write key saved

### Coverage check status (the skill's gate)
13 of 14 in-use prices tiered, 19 of 20 members covered. Only Christopher's $199 awaits Lij's answer on which plan it discounts.

## Scope change (Zoran via MEMBER MANAGEMENT II, confirmed in-chat 2026-08-01)
Room now also: (1) BUILDS + SHIPS the price workbook to Lij, from the LIJ MEMBER WORKBOOK design chat's near-done page (transfer incoming; do not reinvent); all Lij sends clear through MEMBER MANAGEMENT II, one voice; Christopher question rides the workbook send. (2) WRITES SKILL 1 - all 5 steps: contacts sync (link-up chat run log incoming, 142/147 linked, DONE), price pull (GHL screenshot / Stripe history), first draft, match to Stripe, price workbook - from real SJ logs, mockup-confirmed with Zoran before final. (3) After Lij returns the workbook: finalize prices, hand off to members workbook. Live match-prices apply still waits on transport; workbook + skill draft do not.
Needs list sent to orchestrator: workbook home + auth, response-capture data path, link-up log handle, send channel + from-address, transport ETA.

## Inputs landed 2026-08-01 (post-scope-change)

### Zoran rulings for skill 1
- THREE SEPARATE SKILLS, not one resuming skill. Mine is its own command and must REFUSE to run until its trigger is true (stripe connected), checked against real DB state, never a checklist. (Assurance-without-connection rule made executable.)
- Skill lives in bam-client-sites/.claude/commands next to /branding-deck, /site-build, /sales-system, /ghl-migration, /agreement; name in that family's style.

### Orchestrator answers to the needs list
- Workbook auth RULED (no re-litigating): private tokenized link, NO login; staff confirms before anything applies. Portal-hosted page + api route (bam-client-sites is static); inherit the design chat's anatomy, propose in mockup review if silent.
- Response capture: no existing pattern; coordinate with design chat; if new table -> align-core-data-model + PENDING_SQL, never solo schema. Requirement: STRUCTURED DECISIONS per row (proposed, changed-to, timestamp), no free-text blob.
- SJ pilot send: ZORAN FORWARDS THE LINK PERSONALLY in his Lij thread. No automated channel for the pilot; skill can formalize later; from-address estate stays untangled. Christopher question rides the same message.
- Transport ETA: gated on Zoran running /pending-sql + merging #1703 (+#1704). ~11 min deploy after merge; orchestrator sends GO when SJ key saved + stripe_connect_status=connected.

### Scope amendment (Zoran via MM II, 2026-08-01): skill authorship centralized
This room NO LONGER writes skill 1 - MM II writes all three skills from the run logs. This log is now the PRIMARY SOURCE for skill 1, so it must stay complete and honest: every step, every Zoran ruling in his wording, every surprise. At run close, send MM II: final log path, mapping result file, rulings verbatim, surprises. Skill-1 mockup gate moves to MM II's chat; the WORKBOOK mockup gate stays here. Rest of scope unchanged (workbook build + ship, live apply after GO, finalize after Lij returns).

### Steering plan (MM II, 2026-08-01): hold lifted, workbook build sequenced
- Design transfer incoming from workbook chat: mockup v2 + decisions file + _bbStdPricing source pointer (verified: client-portal.html:32985, the Blueprint pricing block anatomy incl signup fee + commitments).
- RULING: workbook builds LIGHT-themed - both workbooks are one light product family to Lij; portal-dark ignored for this surface. Build from their page, deep-link the real pricing embed where they did, no forking.
- RULING (program-wide, from workbook chat design): "confirmed" is a DELIBERATE act distinct from "untouched" - an unread row must never look approved. Goes into the response schema.
- Q1-Q6 staged SECOND (workbook chat asks Zoran one sequencing question first). When signaled: ask in this chat, one at a time, max 2-3 per sitting, keep the simple-words register.
- Flow: mockup -> Zoran approves here -> MM II clears the Lij send. Live apply still waits deploy GO. billing_cadence hand SQL moved OFF this room (MM II owns it transport day).
- Comms rules: report completions/decisions to MM II not narration; out-of-scope decisions stop and go to MM II; nothing reaches Lij except through Zoran, cleared by MM II.

### Workbook mockup v1 built (2026-08-01)
Design transfer received (lij-workbook-mockup-v2.html + decisions file). Built docs/plans/sj-price-workbook-mockup-v1.html: standalone light page from their Adjust-prices overlay anatomy. Reconciliations applied: Unlimited monthly PREFILLED $300 (their amber "needs monthly price" resolved by the Pre Season=Unlimited ruling; card explains one member already pays it); Pre Season family removed (4 plans not 5); Christopher + Keanu = "Special deals" card with a which-plan picker (Keanu prefilled Elementary); 1x $425/$875 rungs marked NEW (proposed, not in Stripe). Confirmed-vs-untouched mechanic: per-card pills Not reviewed / Confirmed by you / Changed press confirm; Confirm is a deliberate click; Send disabled until all 5 confirmed. Fee question prefilled from the fee ruling with the Stripe history explained. Ladder mechanics preserved from design chat (months parsed from free text, recalc-only on keystroke - verified in browser: focus kept, savings live, send gating works). Blueprint match panel adapted from a staff button into an informational "already matched" strip (workbook is Lij-facing; flagged as an adaptation, not a fork).

### Ruling: sales tax becomes a real question (Zoran, 2026-08-01)
Zoran asked "what happens when add a sales tax is clicked? is this the same as the pricing selector in the onboarding flow?" - a caught defect. Findings: (a) in mockup v1 the chip did NOTHING downstream, a dead control; (b) my wording differed from the real Blueprint field: real is "Taxable?" Yes/No meaning "is this row taxable UNDER the academy tax template" (clients.tax_config), NOT "add a tax here"; my "No, price includes it" invented a third meaning (tax-inclusive, which is how GTA's catalog works) that the field does not have; (c) VERIFIED IN DB: GTA tax_config = {pct:13,label:"HST"}, BAM San Jose tax_config = NULL, so under _fees.js resolveFee every tax answer for SJ is inert.
Options put to Zoran: hide when no tax setting / show with fixed wording / make it real. RULING: "Make it real: ask his tax rate."
BUILT: academy-level tax card at the TOP of the workbook (tax is one setting for the whole academy, not per plan). Asks "Do you charge sales tax on training?" No/Yes; Yes reveals rate + label and echoes the math ("a $250 plan would show as $271"). Per-plan and per-rung tax questions now EXIST ONLY when the academy answers Yes, and default to taxed (mirrors the real precedence rule: with a template set, unanswered counts as Yes; exempt is the deliberate exception). Preview card states the all-in amount. Confirm blocked until Yes+rate or No. Answer count 5 -> 6. Response feeds a proposed clients.tax_config change, staff-confirmed like every other workbook answer.
NOTE FOR MM II (cross-surface): this makes the workbook write an academy-level Blueprint General setting, not just pricing rows. Flagged as out-of-scope-adjacent per the comms rule; Zoran ruled it directly.
Verified in browser: hidden-before-answer, No path, Yes path, default-taxed, confirm gating, preview math. All pass.

### Ruling: shared response-capture schema (MM II, 2026-08-01)
Triggered by the tax escalation. Academy-level answers are a DISTINCT KIND, never flattened into price rows. Envelope every captured decision carries:
- `target_kind`: "academy_setting" | "price_row" | "member_row"
- the concrete target (clients.tax_config / offer_price id / member id)
- the was/now pair (what we proposed, what the owner changed it to) + timestamp
Reasons given: blast radius differs by an order of magnitude (a wrong price row costs one plan, a wrong tax_config re-prices every athlete, so staff review must sort on it); the member workbook needs member_row anyway and inventing the third kind later means migrating the first two; skills 1 and 2 both consume this table and must not each invent a convention.
STAFF REVIEW CONSEQUENCE (build it in): academy-level changes surface FIRST, visually separated, never mixed into a long list of price rows where a tax change reads like a typo fix.
MY ADDITION, sent to the member workbook chat for the shared spec: a state field (untouched / confirmed / changed). The "confirmed is a deliberate act" rule fails if it lives only in the page - in the data, a card the owner never opened would otherwise be indistinguishable from one he read and approved.
STATUS: envelope sent to the member workbook chat (local_f9f034e9) to confirm their member rows fit. If incompatible, MM II's instruction is to STOP and report rather than fork. Table itself still to be spec'd through align-core-data-model + PENDING_SQL once they reply.

### Recorded for skill 1 (MM II, from this room's work)
- "A workbook question that cannot change anything is the assurance-without-connection failure in owner-facing form." The tax card is the skill's worked example.
- Technique that caught it: RENDER THE CONTROL AND ASK WHAT IT ACTUALLY DOES.
- MM II's correction to my framing, carried: I wrote that SJ's tax answers were inert "by construction" because tax_config is NULL. True today, but that is precisely why the dead chip was invisible. The skill's check must be "render it AND confirm the value reaches an output", never "confirm the field exists".

## FIELD MAP: workbook mockup vs the wizard's `_bbStdPricing` (scan run 2026-08-01)
Zoran ruled "make it the same put everything in", so the page was REBUILT at full parity. Content parity is COMPLETE: no field exists on one side and not the other. What differs is encoding, wording, and additions. This is the map the confirm-wiring must implement.

**1. Renames (same field, different key).** mine -> offer:
`desc`->`whats_included`, `cad`/`cadOther`->`billing_cycle`/`billing_cycle_other`, `tax`->`taxable`, `fee`+`feeAmt`->`signup_fee` (ONE currency field; empty = no fee), `feeTax`->`signup_fee_taxable`, `feeOnBase`->`signup_fee_on_base`, `sessions`->`sessions_included`, `expires`->`expires_after`, `otherDesc`->`other_description`, `notes`->`description`.
Rung: `len`->`length`, `gets`->`whats_included`, `fee`->`signup_fee_charge`, `notes`->`discount_notes`, `other`->`after_other`.
Code: `dur`->`duration`, `durMonths`->`duration_months`, `applies`->`applies_to`, `expires`->`expires_at`, `max`->`max_redemptions`, `once`->`once_per_customer`. Add-on: `desc`->`description`.

**2. Value encoding.** The mockup stores CHIP POSITIONS (0,1,2) and friendly lowercase labels; the offer stores exact strings. Mine -> offer:
type: "Single session"->"Single Session", "Something else"->"Other".
billing_cycle: "every week"->"Weekly", "every 2 weeks"->"Biweekly", "every month"->"Monthly", "every 4 weeks"->"Every 4 weeks", "every 3 months"->"Quarterly", "every year"->"Annually", "something else"->"Other".
taxable: "Yes, taxed like everything else"/"No, this one is exempt" -> "Yes"/"No" (rung: "No, exempt"->"No").
signup_fee_on_base + rung signup_fee_charge: "Charge it"/"Waive it" -> "Charge"/"Waive".
after: "Renews for the same length"->"Renews same length", "Just ends"->"Ends", "Something else"->"Other".
ALREADY EXACT: discount code kind, duration, once_per_customer.

**3. The one real format mismatch.** discount `applies_to`: mockup stores DISPLAY LABELS ("Academy 2x/week · every 4 weeks"); the offer stores KEYS from `_BB_DYNAMIC_OPTIONS.offer_price_keys`: `<title>|monthly`, `<title>|3_months`, `<title>|6_months`, `<title>|signup_fee`. Note the generator only emits keys for Membership-type, non-archived plans with a price, and only for commitments whose length maps to 3/6 months.

**4. In the mockup, no home in the offer yet:** rung-level archive; the academy tax rate (lives on clients.tax_config, not in pricing); the Special deals card; the confirmed/untouched/changed state.

**5. Required marks.** The offer marks required: title, type, price, billing_cycle, billing_cycle_other, commitment length, commitment price, commitment after, after_other, and code/kind/value/duration(+duration_months). The mockup stars only some.

### Two LATENT schema gaps found (MM II verified against production: real, but not biting today)
- **Commitments are not archivable.** `pricing_offerings` has `archivable:true`; `commitments` does not, so the real wizard offers Remove on a rung. Removing a rung members are paying on is destructive; the mockup added Archive, which has nowhere to land in the offer data. Worth fixing in the wizard.
- **Closed term vocabulary.** Only monthly / 3_months / 6_months / signup_fee exist. `_bbTermFromLength` collapses 12 months to `6_months`, and "1 year" yields NO key. MM II checked prod: every live price key across every academy is monthly/3_months/6_months, zero 12-month, no populated commitment arrays. So phrase it as "WOULD silently mis-key a 12-month commitment if an academy ever asked for one", not "is mis-keying prices".
- MY OWN BUG, unfixed at wind-down: the mockup's "+ Add another length" defaults a new rung to `"12 months"`, the exact value the system cannot represent. Default should be a supported length.

### Fix list, agreed but NOT applied at wind-down
1. Send button is disabled with no stated reason. Agreed wording: "Confirm the remaining N rows to send", on hover and on click. MM II: same family as the dead tax chip, just quieter.
2. New-rung default "12 months" -> a supported length.
3. Emit the offer's exact values and key names (sections 1-3 above) so confirm is a straight copy, templatized, with no per-field translation table.

### Ruling: no partial submit (Zoran, program-wide, 2026-08-01)
"Every row has to be confirmed, so put guardrails in the UI." Binds both workbooks: one product, one rule. Concretes: visible remaining count, button disabled WITH A REASON, per-row untouched/confirmed/changed state. Mockup already satisfies 1 and 3; 2 is fix-list item 1.
CONFIRMED BY MM II: confirmation is CARD-level, not rung-level. A rung is part of one plan's answer, not a separate decision. 9 cards for SJ (tax, 4 plans, special deals, add-ons, discount codes, anything-else).
Related rulings carried, no action taken: money changes ONLY through this price surface (the member workbook forbids inline money edits and its Adjust-prices button points here); the private no-login link is an accepted risk WITH A DATE, not permanent, and no expiry was built unasked.

### Ownership (Zoran via MM II, 2026-08-01)
This room owns the adjust-prices page outright; the member workbook chat stopped its parallel build. Whatever ships here is THE prices surface for both workbooks, so it is built to be linked into (?from= back link, #plan-<id> deep link) as well as visited standalone.

### Link-up chat delivery (skill step 1 source, COMPLETE)
147/147 resolved (142 linked, 5 conscious dup-customer skips). Raw material on branch claude/keen-banach-69618e: docs/plans/sj-contact-linkup-learnings.md (recipe: refresh contact store FIRST because v2 academies have no contact cron and last_synced_at lies; classify read-only; execute in sweep order; 7 real edge cases; offline-prelink pattern; DB-verify every phase; claim-then-review sequencing; refused link = dup signal) + sj-contact-linkup-result.md (counts, skip ids, transport-day checklist: expect already_linked=142, review_existing=5). Tooling caveat: refresh script + PGRST102 mixed-batch fix ride in PR #1704, unmerged.

### Ruling: the Add-ons card is CUT (Zoran, 2026-08-04)
Zoran asked *"do we need add ons?"* rather than accepting the card. Checked against his real Stripe before answering: **he sells zero add-ons.** All 20 members sit on Academy / Elementary / Pre Season subscriptions with nothing on top, and the only one-time products he does sell, Summer Bundle Camp and Adapt Academy Tryouts, were already ruled OUT of scope on 2026-08-01.

So the card could only ever come back empty. Under the no-partial-submit ruling every card is a REQUIRED confirm, which made this a mandatory click that yields no information. Adding an add-on later is the portal wizard's job, not a migration workbook's.

**Discount codes survived the identical test** and that contrast is the reusable rule: he has a real code, NOSETUP, used 3 times to waive the $40 fee, so that card earns its click. **A workbook card must be justified by data in the academy's own account, not by the shape of the wizard it was copied from.** This belongs in skill 1: build the card list from what the academy actually has, then drop every card whose only possible answer is "none".

**Card count now 7:** sales tax, 4 plans, discount codes, anything else. Down from 9 (special deals to the member workbook, add-ons cut).
Verified in the rendered page: 7 cards, no console errors, ADDONS and addonCardHTML gone, tax and codes cards intact, send gating correct at 7 and at 0 remaining.


## Seeding facts verified live 2026-08-04 (MEMBER MANAGEMENT III), before building the workbook

Queried rather than assumed, because the seed writes what these say.

| Fact | Value | Consequence |
|---|---|---|
| `offer_prices` rows for SJ | **0** | Plans do NOT live in `offer_prices`. They are inside `offers.data.pricing.pricing_offerings` jsonb on offer `4d15a274`. So a plan card's target is `target_table='offers'`, `target_id=4d15a274`, `target_field='pricing.pricing_offerings[<i>]'` - NOT an `offer_prices` row. The schema comment guessed `offer_prices`; the seed must not. |
| `offer_options` rows for SJ | 0 | Same |
| `clients.tax_config` | **NULL** | The tax card's `current_value` is null, so ANY answer Lij gives is a change. Correct, and it is why the card exists. |
| `clients.time_zone` | `America/Los_Angeles` | Confirmations render from this |

### ⚠️ OPEN, and Lij sees it first: which name goes at the top of the page

The approved mockup header reads **"3D BASKETBALL PREP"**. The database holds three names and **none of them is that**:

| Column | Value |
|---|---|
| `business_name` | BAM San Jose |
| `public_name` | By Any Means San Jose |
| `legal_name` | 3D Prep LLC |
| `owner_name` | Elijah De Guzman |

The handoff records his business as "3D Basketball Prep", which is where the mockup got it. `public_name` = "By Any Means San Jose" is plausibly one of the **35 of 41 academies wrongly showing "BY ANY MEANS"** recorded in the wordmark note - the wordmark is supposed to be decided in the BRANDING DECK, which San Jose has not been through.

This is not cosmetic. It is the first thing Lij reads on a page asking him to confirm his own prices, and a wrong business name there costs confidence before he answers anything. **Needs Zoran's call**; until then the page renders the mockup's approved wording and the API returns it explicitly rather than deriving it from whichever column happens to be populated.


### Ruling: the workbook header reads "By Any Means San Jose" (Zoran, 2026-08-04)
Chosen over the mockup's "3D Basketball Prep" and over the legal "3D Prep LLC", **with the wordmark warning stated in the question and chosen anyway**, so it is a decision and not an oversight.

The reading that makes it coherent: **the workbook is a BAM-sent artifact.** It arrives from us, it asks him to confirm what our system will sell on his behalf, and it is one of exactly two links he ever receives from us. BAM branding on a BAM page is right even though his own business trades as 3D.

Consequences for the build:
- The page takes the name from the API as `academy_name`, sourced from `clients.public_name`. **It is not hardcoded**, so when the branding deck settles San Jose's wordmark the page follows automatically with no code change.
- The mockup's hardcoded "3D BASKETBALL PREP" string is therefore removed rather than re-pointed.
- This does NOT resolve the wider wordmark question for the other 34 academies. It is one page's header, decided once.


### Correction 2026-08-05: Elementary DOES have prepay options, and our rule was applied inconsistently
Zoran asked why we said Elementary Academy is $200. **The $200 is right** - Jenny Chung and Ted Miranda each pay exactly that every 4 weeks, against live Stripe prices. But answering the question exposed a gap.

His Stripe holds a complete Elementary ladder that the 2026-08-01 ruling recorded as "no commitments":

| Rung | Price | Interval | Subscribers |
|---|---|---|---|
| Month to month | $200 | 4 week | 2 |
| **3 Months** | **$499** | 12 week | **0** |
| **6 Months** | **$999** | 24 week | **0** |

It was missed because the match only adopted prices with LIVE SUBSCRIBERS. **But we did not apply that rule consistently:** Academy 1x/week's $425 and $875 also have zero subscribers and we DID include them. Same situation, two different answers, and the difference was invisible because nobody compared the two decisions.

**Ruling (Zoran, 2026-08-05): add both.** Not selling something he deliberately set up is a quiet loss. They enter as `proposed` with `current_value` NULL, so adopting them is a real change he has to confirm.

**Rule for skill 1, and this is the transferable part:** the coverage gate asks whether every IN-USE price is classified. That is necessary and not sufficient - it is blind to a price the academy built and has never sold. A second sweep must ask the opposite question: *which coherent product ladders exist in their account that our plans do not offer?* His account holds 119 prices, most of them old one-offs, so the signal is a ladder whose intervals and discount shape MATCH the academy's other plans, not merely an unused price.

### Correction: the "new" badge made a false claim about his own Stripe
The badge read *"Options marked new are proposed by BAM and are not in your Stripe yet."* That is untrue of every rung it was applied to: Elementary $499/$999 and 1x/week $425/$875 all EXIST in his Stripe and have simply never sold. The flag is derived from `current_value` being null, which means *the portal has never stored this* - a different and narrower fact than the sentence claimed. Copy corrected to "ones we are proposing to sell for you", which is true whatever his Stripe holds. Same shape as the tax chip and the dead Send button: a claim wider than the thing that produced it.


### Correction 2026-08-05: NOSETUP never existed. We invented it.
Zoran asked what the NOSETUP discount code does. Read his live Stripe through the direct-key transport to answer:

| Read from his account | Result |
|---|---|
| Coupons | **1** - `club`, $100 off, duration **forever**, created 2025-06-27, **times_redeemed 0** |
| Promotion codes (the thing a customer types) | **0** |
| Anything named NOSETUP | **none** |
| Active subscriptions carrying any discount | **0 of 20** |

The string "NOSETUP" appears in **no source file** - not the catalog, roster or customer list. It appears exactly once in our entire record, as part of a field name **we wrote**: `waived_via_NOSETUP_coupon_or_credit` in the fee scan. The scan hedged honestly between coupon and credit; we took the coupon half, gave it a name, and then put that name in front of the client as a fact.

**What is actually true:** the $40 fee was waived 3 times, and **we do not know how**. That is now an open question for Lij rather than an answer we assert.

**Ruling (Zoran, 2026-08-05): put `club` in.** The codes card now carries his one real coupon - `club`, Dollar off, $100, Every payment - with `current_value` NULL because our side has never stored it.

Two things to carry:
- **`club` is $100 off FOREVER, not once.** On a $250 plan that is $150/month for the life of the membership. It has never been used and there is no promotion code, so nobody can self-apply it - but a new system that starts honouring coupons automatically would inherit it silently.
- **The failure shape, for skill 1:** a field NAME we chose became evidence. Nothing lied; nobody checked. The rule is that a value shown to a client must trace to THEIR data, not to a label in our own notes. Grep the client's own export for any identifier before putting it on a page they will read.


### Ruling: what the wizard's retirement means (Zoran, 2026-08-06, MEMBER MANAGEMENT IV)
Asked directly, per the handoff's "do not guess". Two answers:
1. **Which wizard**: the onboarding wizard's *training offer setup section with the prices* - the part where an owner types plan titles, prices, prepay rungs and the joining fee. That section is what future clients skip.
2. **What replaces it**: **workbooks plus staff setup.** The owner answers workbooks; BAM staff do the rest inside the portal on their behalf.

Consequences for the skills:
- The review-and-apply skill CAN assume a staff member is present and portal-capable at every step. It CANNOT assume the owner ever saw the wizard's pricing screens, so any fact the wizard used to collect (plan titles, prices, rungs, fee, tax) must come from the workbook or from the academy's own Stripe - never "already in the offer because the wizard put it there".
- San Jose's draft offer got its 4 plans typed through that wizard section. For academy #2 there may be NO typed plans at all - the workbook seed builds from their Stripe + staff research. This makes the seed-building tool (the biggest template gap, per the 2026-08-06 handoff) load-bearing rather than nice-to-have.

## Rehearsal run 1 (2026-08-06, MEMBER MANAGEMENT IV)
First contact with real Postgres. Lane: real page in a browser + real API + prod DB, staff half authed with a real staff session, `apply` dry-run at the Stripe boundary per ruling. External snapshot/restore tool proven live (3 planted changes caught, restore verified clean by read-back); production restored clean at the end.

**PASSED, do not re-test:** untouched-confirm renames recorded and applied as real was/now changes (all 3); tax surfaced separately in review.academy_settings; add buttons produce requests (review.additions -> skipped.additions), never writes; send gating honest (typed-not-confirmed does not count, reason shown); page fully read-only after submit (0/59 inputs); apply takes a snapshot; sales agent FAILS CLOSED with offer_prices empty ("do not quote any price"). Header from clients.public_name.

**Defects (fix loop launched):**
- D1 CRITICAL: a discount code with nothing ticked under "applies to" silently suppresses ALL four `<plan>|signup_fee` mint targets (hasUnrestrictedDiscountCodes, api/offers/match-prices.js:295-303,366-375). Only trace = server stdout. Page copy INVITES the state ("nothing ticked means it comes off everything"). $40/athlete switched off invisibly. Ruling needed on the mechanic (require targets vs warn vs fee-protected-default).
- D2 HIGH: parent preview prints "Plus a one-time $40 joining fee" directly under prepay rungs where the fee is WAIVED (workbook.html:1274 keys only off feeOnBase). The agent's renderer gets this right; the preview contradicts it.
- D3: codes card copy hardcodes "on the first bill" regardless of duration=Every payment.
- D4: stale discount_notes prose in the offer (says $240/mo after price moved to $320-> $250/mo); never shown to Lij, not editable in workbook, inconsistent across plans (Elementary rungs have none). Agent never quotes it (ruled+tested) so exposure is staff/wizard only.
- D5: tax answer No is stored as clients.tax_config=NULL, indistinguishable from never-asked. The deliberate act survives only in workbook_answers. Breaks any readiness check reading tax_config (data-mandatory arming rule).
- D6: card denominator GROWS mid-session (7->8 when the catch-all gains content) and confirm-empty on "Something missing?" is not required, so "we will know you were asked" is not enforced. Assurance-without-connection in owner-facing form.
- D7: dry run cannot answer match-vs-mint: matcher compares against pricing_catalog which is EMPTY for SJ, so matched:0 is ambiguous (nothing-to-compare vs will-duplicate). Also cannot state the minted billing rhythm (monthly vs every-4-weeks = 12 vs 13 charges/yr, ~7.7% of revenue). Fix direction: read his live Stripe through the direct-key transport (read-only) inside the dry run.
- D8 LOW: approve-card takes card_key not card_id (error message correct, brief-writers beware).
- D9 UNRESOLVED: smooth scrollIntoView did not move the page in the automation browser; plain scrollIntoView did. Needs one human look. Native alert() visibility also unverifiable in automation: NOT a pass, NOT a defect.

**Forgot-to-ask yield (the round's whole point).** Raised 9; triage:
- Already covered, no ask needed: free-trial terms (offers.data.sales.trial_duration_price = "1 hour for free"); one-time camps (ruled OUT of scope 2026-08-01).
- Bugs, not questions: "something else" cadence has NO follow-up box (an entry came out as literally "$85 other."); tax registration number never asked on the Yes branch though receipts print it (api/_member-receipts.js:504).
- Need Zoran ruling (popup sent): confirm-cancellation/commitment/first-charge policy card (portal asserts "cancel any time"; Lij was never asked); per-plan age band + most-popular marker (age routing is live, plans carry no ages).
- Staff-setup items, not Lij questions: clients.stripe_portal_url null while policy promises cancel_online Yes.
- CAUTION for the skill: the rehearsal agent role-playing Lij INVENTED facts (30-day cancellation, sibling discount, $85 private training) to probe the form. The finding is how the form handles such facts (they land unstructured in skipped.notes for staff adjudication), NOT that Lij has these policies. Never let a role-play invention harden into client data - same failure shape as NOSETUP.
- Data observation for staff review: 1x/week 6-month rung ($875 = $145.83/4wk) is a WORSE per-period deal than its 3-month ($425 = $141.67/4wk); proposed Elementary ladder has the same shape. Visible to Lij, flagged nowhere.

### Rulings from rehearsal round 1 (Zoran, 2026-08-06)
1. **Discount codes must always state their targets.** "The client has to always say what the discount code applies to." The codes card refuses to confirm until every code has an applies-to list; an explicit "Everything, including the joining fee" choice exists so nothing is lost, it just has to be deliberate. (Fix-loop Variant A. Kills the D1 silent fee deletion at the source; the loud withhold report ships as backstop regardless.)
2. **No policy card in the price workbook.** Cancellation / commitment / first-charge confirmation will be a SEPARATE workbook, built later. The price workbook stays price-only. (Third workbook now on the roadmap; the two-links rule presumably becomes three - flag when sequencing the Lij sends.)
3. **Ages only.** Each plan card asks who the plan is for (age band), prefilled from his classes. NO most-popular question - staff pick the lead plan.

### Premise correction (Zoran, 2026-08-06): staff work in Claude, not in portal screens
Caught on the coupons proposal: the mockup showed a new staff portal list view for discount codes, and Zoran asked "what are staff supposed to see? i thought staff only work in claude." That is the standing model for member management: the staff surface IS the skill running in Claude. No new staff portal UI gets built for this workflow. The coupons proposal shrank to: storage on the offer record (exists), adopt-by-id for imported coupons (only new code), push-live as a skill step with a staff yes (July re-issue path). Carry this into every future proposal: if a mockup shows a staff screen for member-management work, the premise is wrong.

### Ruling: coupons settled (Zoran, 2026-08-06)
"Yes link to his coupon." An academy's pre-existing Stripe coupon is ADOPTED BY ID, never re-minted as a copy. Full coupon picture now closed:
- Storage: the offer record's discount_codes list (exists; workbook writes it).
- Staff surface: the review skill in Claude, which prints each code + state and asks per code before pushing live. NO portal screen.
- Push-live: the July re-issue path (Build C + 2SIBLING fix), gated on targets ticked + duration confirmed (per the codes-always-state-targets ruling).
- Imported coupons (club): adopt-by-id, state "on paper" until the owner wants it live.
- Person-level deals: never on this list (2026-08-04 ruling, member workbook).
Build cost: adopt-by-id is the only new code. Proposal doc: docs/plans/coupons-proposal.html.

## Rehearsal round 2 (2026-08-06, after the full fix loop)
Loop ran exactly as ruled: rehearsal 1 (9 defects, 9 gaps) -> planner -> builder (12 steps) -> tester FAIL (2 under-pinned fixes, 1 broken control, 0 behavioural bugs) -> planner -> builder (5 remediation steps) -> tester PASS (all bypasses dead, 556 checks, 87 controls fire) -> rehearsal 2 from the top. Age rows seeded to the live draft workbook first (8 rows, Elementary prefilled 9/12 from its class twin, others deliberately blank); restore baseline re-taken to include them.

**HEADLINE: the question set is COMPLETE.** Round 2 found nothing new we would have to ask Lij after the workbook comes back. All 10 round-1 fixes verified on the real page (fee truth in the preview, loud withholding naming plan+code, tax No stored as {"charges_tax": false} with tax_state confirmed_no, fixed 8-card denominator with confirm-empty enforced, cadence follow-up making "$85 other." impossible, ages with inverted-band refusal and age_note honesty, duration-aware scope sentences).

**First live-Stripe dry run against his real account: 12 of 12 recurring targets EXIST at his real amounts** (match-not-mint confirmed for tax No, as predicted); only mints = the four $40 joining fees as one-time lines. Honesty cross-check passed: editing a price to $180 flipped exactly that target to exists:false. Note for staff at adopt time: his product naming is messy (Unlimited prices under a product called "Black Friday Offer", Elementary prepays under the 1x product).

**BLOCKER FOUND (D1): the codes card cannot persist its own mandatory answers.** Only 5 rows seeded per code; applies_to/duration_months/expires_at/max_redemptions have no rows and mintableOn("codes") is empty, so the save 404s ("that answer does not belong to this card") and the unsaved change blocks confirm forever. The targets ruling made applies_to MANDATORY, which turned a latent seeding gap into a dead end. With the row hand-seeded the whole flow works end to end. Also: D2 refused add wipes typed name/price; D3 the server confirm does not enforce the targets rule (page-only; review warnings + apply withholding do catch it downstream); D4 the save-failure banner blames "brand new items" for a mandatory-question save.

Sequencing lesson for the skill: when a ruling makes a field mandatory, the seed and the mint whitelist must be re-audited in the same pass - the rehearsal caught what the unit gates could not, because the gates seed their own fixtures.

### Loop cycle 3 (2026-08-06): the D1-D4 fixes held functionally; the bypass hunt found the safety pass's first two real items
Tester2 verdict FAIL on two direct-POST findings (the no-login token threat model, i.e. exactly the parked safety pass territory):
1. HIGH: whitespace applies_to ([" "]) reads as "restricted" to looseCodesIn/unrestrictedCodes (.filter(Boolean)) but as "everything" to couponAppliesToKeys (trim-then-filter) - three guards pass, Stripe coupon lands on every first-invoice line INCLUDING the joining fee. Same class: whitespace-only code name drops out of the loose list. Root cause: two normalizers for one emptiness question.
2. MEDIUM: the D1 mint path has no row cap and accepts non-canonical indexes (codes.0/00/000 = 3 rows for one logical code; 205 rows on one card in 5 calls) - the DoS the ADD caps were explicitly written against, reopened by the mint fix.
Lesson for the skill: a fix that OPENS a path (mint) must inherit the caps of the path it mirrors (add) in the same commit, and any emptiness/normalization question must have exactly one answerer.

### Sequencing ruling (Zoran, 2026-08-06): member workbook builds DURING the price wait
"In step 5 we should also have build the member workbook and confirm it together." While Lij has the price workbook (the wait between our send and his submit), the member workbook gets BUILT and mockup-confirmed with Zoran, so link 2 is ready to go the moment his prices come back. The member workbook build is no longer blocked behind step 5; only its SEND stays sequenced after prices land. Carry into the skills: the two workbook builds pipeline, the two sends stay ordered.

### Rehearsal round 3 (2026-08-06): CLEAN. The workbook is send-ready.
Full flow on the real page against real Postgres, codes card as centerpiece, security-fixed code. Lij reached "Sent to BAM", all 8 cards confirmed, count never grew past 8. The codes-card save that 404'd in round 2 now returns 200; untargeted confirm refuses (ruling enforced), targeted confirm saves; club stored with applies_to = 16 explicit targets including all 4 signup_fee entries, so ZERO fees silently withheld. No regression in the other 7 cards (tax No -> confirmed_no academy_setting; renames visible; price edit persisted; Elementary ages 9-12 carried, others blank; "something else" cadence follow-up parked the camp in skipped.additions; empty cards required deliberate confirm). Live-Stripe dry run: 11 exist / 5 mint (4 fees + the one price the agent edited to $260; without the edit it is the predicted 12 exist / 4 fees mint). withheld_signup_fees: []. Sales agent fails closed (offer_prices 0 after dry-run). Restore verified clean by read-back.

TWO NON-BLOCKING NOTES for later polish (Zoran's call, not gating the send):
1. UX: an untargeted-codes-card confirm refuses correctly but the only cue is the standing header pill; no fresh feedback near the button. A non-technical owner with a long card scrolled past the pill could press and see "nothing happen". Low reach (recoverable by ticking a target).
2. Could-not-tell: whether the "Everything, including the joining fee" chip toggles OFF on re-click was not verified (deselected via an individual chip instead). Worth one check if we touch that card again.

MILESTONE: steps 1-6 of the 9-step sequence are DONE and proven end to end. Next: Zoran sends Lij link 1 (price workbook); member workbook builds during the wait.

### LIVE BLOCKER found in Lij's hands (2026-08-07): the plan Archive button cannot save
Lij, mid-review of his sent workbook, messaged Zoran: "the elementary academy packages don't need to be in there anymore. I can't proceed without confirming." Diagnosed live: the plan-card Archive button issues a null-id save of `archived`, but `mintableOn("plan:*")` returns only `["age_min","age_max"]`, and no plan card has a seeded `archived` row, so the save 404s ("that answer does not belong to this card"). Verified by executing the exact save against prod (404, nothing written). This is the SAME bug class as the codes card and ages: a field the page can produce that the mint whitelist does not admit. It affects EVERY academy and every plan/rung archive. Missed because no rehearsal ever REMOVED a plan - all three rounds only accepted/edited/added. Lesson for the skill: the rehearsal script must exercise removal (archive a plan and a rung), not just addition.

IMMEDIATE UNBLOCK (Zoran authorized "archive all the elementary packages"): seeded the archived row directly on Lij's plan:ele (answered=true), the correct end state a working button would have written. Verified confirm-on-archived works (ok, remaining dropped) then rolled the test confirm back so Lij does the deliberate confirm himself. His 47 in-progress answers untouched; Ted/Jenny keep their $200 (archive != cancel). Elementary now shows removed on refresh.

PROPER FIX (in the loop): add `archived` (plan) and the rung archive field to the plan mint path, same one-line shape as ages. Then the Archive button works for Lij and every future academy.

### Member workbook user story added (Zoran, 2026-08-07)
"Add alternate payment method to existing members AND new members in the member workbook." New requirement for skill 2 / the member workbook build: each member row (existing and newly-added) needs a way to set/attach an alternate payment method. Design implication: this touches Stripe payment methods on a subscription/customer - respect the locked ruling that the member workbook never edits dollar amounts, but a payment METHOD is not a price, so it is in scope. Capture as a per-row field; the actual Stripe write happens staff-side at apply, never from the no-login page directly (same staff-confirms rule as everything else). Open question for the build: does "alternate payment method" mean collecting new card details (which the no-login page must NOT do - PCI + the no-credential rule) or flagging "this member pays by cash/e-transfer/other" so billing is handled off-Stripe? Resolve before building.

### Archive-button fix: loop complete, deploying (2026-08-07)
plan+rung Archive mint-gate fix (cf13822) -> tester found phantom-rung leak (commitments.N.archived minted for non-existent rungs) -> tightened to require a sibling row (84069d0) -> fresh tester PASS (phantom dead across all indexes, batch/cross-card/addition spoof all closed, all gates green: workbook 233, apply 213, contract 198, term-vocab 243, billing-cadence 296). The contract test now cuts its fixture to production shape so it would actually reproduce the live 404 - the rehearsal blind spot (never removed a plan; fixture pre-seeded archived) is closed. Merging to main + deploying so the Archive button works for every future academy. Lij's Elementary was already hotfixed directly; this does not touch his workbook.

### Ruling: alternate payment = FLAG HOW THEY PAY (Zoran, 2026-08-07)
Resolves the open question from the alt-payment story. Lij marks a member as paying by cash / e-transfer / other instead of card. **No card details ever touch the workbook page** (PCI + the no-credential rule stays absolute), and no Stripe-hosted card link in v1. Consequence for the build: an off-card member is EXCLUDED from auto-charging, so the flag is not cosmetic - it changes whether billing runs for that person, which makes it a money-adjacent action item that must surface in staff review (see the action-item map below). Applies to existing members AND newly-added ones.

### RULING: the V2 portal action-item map must be fully planned before the member workbook is built (Zoran, 2026-08-07)
"One thing that we have to make sure we have fully planned out is all of the action items that would show up in the v2 of the portal."

The point, and it is the assurance-without-connection rule again: **the workbooks' real output is not data, it is a queue of things a human must then do.** Every one of those needs a named home in the V2 portal or it lands nowhere. A stop-billing row nobody is obliged to clear is how a parent gets charged for four months after their kid quit (already recorded 2026-08-02, still unowned). This is now a BUILD PREREQUISITE for the member workbook, not a follow-up.

Known action-item producers so far (to be mapped, not yet complete):
- **Stop billing this parent** (member marked not-a-member) - carries dollar amount, subscription id, parent name, date marked; surfaces FIRST in staff review on blast-radius precedence; clearing it is a REQUIRED step in skill 3.
- **Off-card payer flag** (this ruling) - member excluded from auto-charge; someone must actually collect cash/e-transfer, so it is a recurring operational item, not a one-time import decision.
- **Additions**: plans/members the owner requested that staff must create by hand (the workbook never writes them).
- **Mint requests**: prices that do not exist in the academy's Stripe and would be created at live apply (San Jose: 3 joining fees, still uncreated because live apply is deliberately unbuilt).
- **Unmatched / ambiguous rows**: a member whose plan attachment could not be resolved (e.g. Christopher's $199 special deal).
- **Owner notes / free text** the workbook parks in skipped.notes for a human to adjudicate.
- **Conflicts between what the owner typed and what the portal already asserts** (e.g. Lij's cancellation terms vs stored policy - round 1 finding, unresolved).

### Rulings on the V2 action-item map (Zoran, 2026-08-07)
Given after reading the map (docs/plans/v2-action-item-map.md, visual: docs/plans/action-items-visual.html). Headline finding that prompted them: 16 of 19 kinds of work the two workbooks produce currently land nowhere.

**Q1 - who cancels a subscription the owner marks as gone: THE ACADEMY OWNER (Lij).** Lands in `action_items`, which already Slacks his channel, pushes his app and SMSes him. Reason it is the only workable answer today: all 20 SJ subs are foreign (`members.billing_portal_owned=false`), so the portal cannot cancel them; only someone with his Stripe access can. Build note: the row needs a TYPED KEY, not the existing title-string match (`title=ilike.*Cancel old Stripe sub*`), or a re-run duplicates rows and a rename orphans the banner.

**Q2 - off-card payers are NOT a flag, they are an unbuilt SUBSYSTEM.** Zoran: "flag and a collect reminder that is adaptable to when the payment is actually supposed to be collected - this might have to be a whole build that we plan out (how we handle payments outside of our stripe portal - how we know when its due, notification to collect, and all the edge cases around it)."
This is a scope correction, not a preference. What it means: the member workbook may capture the flag, but the OFF-STRIPE PAYMENTS system (due-date model per member, collect reminders on their real cadence, notification to whoever collects, and the edge cases: partial payment, late payment, member stops paying, switching back to card, proof of payment, reconciliation against what the portal thinks they owe) needs its own planned build. DO NOT ship a control whose only outcome is a flag nobody acts on - that is the dead-tax-chip failure in a new costume. Sequencing decision still open: whether the member workbook waits on that build or captures the flag and the subsystem follows.

**Q3 - fully separate queues.** Owner work lives in `action_items`; BAM internal work (mint requests, unsellable rungs, additions to build) lives in `v2_tickets` and Lij never sees it. Consequence to build: the systems staff lane must actually render `billing_fix`/`data_fix`/`build_ask` - today `WebsiteV2View.jsx` filters `type in ("website_change","fix")`, so those tickets render on NO staff page. Routing work there without fixing the filter recreates the exact lands-nowhere failure.

**Q4 - the 3 joining fees are NOT a lost item, they are a normal onboarding step.** Zoran: "they should be built and put into the portal after lij submits the prices - he is still in the onboarding phase." So the mint requests do not need an emergency ticket; minting his fees is simply the next step of onboarding now that prices are submitted and applied. Correction to the map's framing: P1 is only "lands nowhere" for an academy already LIVE. During onboarding the sequence itself is the owner. The action-item home still matters for post-onboarding applies.

### Sequencing ruling (Zoran, 2026-08-07): plan off-card FIRST, then build both
"Plan off-card first, then build both." The off-Stripe payments system gets designed before any member workbook code is written, so the cash/e-transfer flag lands somewhere real on day one. No half-wired control. The member workbook build therefore waits on that design (not on its implementation necessarily - both can build together once the design is settled).

### Off-Stripe payments design: findings + rulings (2026-08-07)
Full design: docs/plans/off-stripe-payments-design.md.

**CORRECTION TO AN EARLIER CLAIM IN THIS LOG.** The action-item map recorded "off-card payer: No column, no concept" - that is WRONG. `members.billing_mode='alternate'` has existed since 2026-06-11 (migration 20260611234439) and already means "pays outside Stripe". It is settable from the member drawer (client-portal.html ~51778) and the Sorter (api/sorter/cleanup.js:436-450). The map missed it by grepping for off_card/pays_cash/manual_payment. Verified live in prod: 2 members carry billing_mode='alternate', 46 are null.

**So the flag is already the decorative-control failure Zoran was trying to prevent.** Today it only: renders "Alternate payment method - not billed via Stripe", makes the next-payment column read "pays another way" with a null date, and silences Sorter complaints. It produces no due date, no reminder, no ledger, no collected record. Nothing else in the codebase reads it.

**LIVE ANOMALY worth checking (1 member):** one of the 2 alternate-flagged members still has a non-null stripe_subscription_id, i.e. flagged as paying by cash AND carrying a live sub. That is the double-billing shape. Not yet investigated - could be a legitimate mid-transition state. Whoever picks this up: check that member before assuming it is a bug.

**Rulings (Zoran, 2026-08-07):**
- **D6 commission: NO, Stripe only.** Off-card revenue does NOT count toward BAM's growth-share invoice. Consequence accepted knowingly: BAM under-bills itself on every cash dollar an academy collects (api/commissions.js:252-271 reads raw Stripe charges). UPSIDE for the build: the collections ledger stays a SOFT record, not a billing input, so it does not need financial-grade edit controls. Smaller build, lower stakes.
- **D4 two missed periods: NOTHING, let it age.** No decision item, no auto-cancel. The item sits and accumulates. Accepted risk stated plainly: this is how a member can train free for a long time. Revisit if it bites.

**Still open from the design (not yet ruled):** D1 reuse billing_mode vs new column (recommend reuse), D2 who owns the collect item (recommend named collector + owner fallback), D3 receipts (recommend not in v1), D5 prepay as rung vs paid-through (recommend rung, already priced), D7 workbook parallel build (recommend parallel, capture toggle+method+anchor).
