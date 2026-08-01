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

### Link-up chat delivery (skill step 1 source, COMPLETE)
147/147 resolved (142 linked, 5 conscious dup-customer skips). Raw material on branch claude/keen-banach-69618e: docs/plans/sj-contact-linkup-learnings.md (recipe: refresh contact store FIRST because v2 academies have no contact cron and last_synced_at lies; classify read-only; execute in sweep order; 7 real edge cases; offline-prelink pattern; DB-verify every phase; claim-then-review sequencing; refused link = dup signal) + sj-contact-linkup-result.md (counts, skip ids, transport-day checklist: expect already_linked=142, review_existing=5). Tooling caveat: refresh script + PGRST102 mixed-batch fix ride in PR #1704, unmerged.
