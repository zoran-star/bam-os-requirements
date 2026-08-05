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

