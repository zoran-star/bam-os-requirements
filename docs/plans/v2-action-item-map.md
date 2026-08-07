# The V2 Portal Action-Item Map

Design prerequisite for the member workbook. Ruling: Zoran, 2026-08-07, `docs/plans/sj-price-match-log.md:355-368`.

---

## 0. The worked example, verified

San Jose's price workbook was applied (dry run) today. Confirmed in `docs/plans/lij-review.html` (written 12:39 today) and reproducible from the code:

| Fact | Where it lives right now |
|---|---|
| 9 prices matched, 3 joining fees to mint, 0 duplicates | `phase3.exists_in_stripe` / `would_mint_new`, `api/workbook.js:2864-2865` |
| The 3 mint requests themselves | `phase3.targets[].stripe.exists === false`, `api/workbook.js:2744-2750` |
| Elementary archived, so its fee is not in the list | offer jsonb, applied |
| A human-written HTML summary | `docs/plans/lij-review.html` |

There is no row in any table, no queue, no owner, no due date and no obligation. Closing the terminal loses all three. `doApplyStaff` refuses `dry_run:false` (`api/workbook.js:2013`), so the mint has not happened and nothing is tracking that it has not.

**That is the shape of the whole problem, and it is not one item. It is at least fifteen.**

---

## 1. Complete inventory of action items

### 1a. Price workbook (all derived from code, all currently live)

| # | Item | Produced by (file:line) | Payload it must carry to be actionable | Blast radius | Urgency |
|---|---|---|---|---|---|
| P1 | **Stripe mint request** | `workbook.js:2744-2750`, counted `:2865` | offering, term, label, `allin_cents`, `billing_rhythm.recurring` + its source sentence, offer_id, price key | New signups cannot be charged for that line. 3 joining fees x $40 per new athlete | High. Blocks go-live |
| P2 | **Withheld joining fee** | `workbook.js:2850` + review `warnings` `:1879-1884` | plan card_key, code name, the one sentence both surfaces share | Fee silently switched off for a whole plan. This was D1, the critical rehearsal defect | Critical if non-empty |
| P3 | **Owner addition** (plan / rung / code the owner asked for) | `review.additions` `:1901`, `skipped.additions` `:2058` | the whole `answered` blob, card_key, `add:` field | Apply never creates these. An unbuilt plan the owner believes he sells | High |
| P4 | **Owner free text** | `review.notes` `:1902`, `skipped.notes` `:2058` | the text, card_key, the academy | Round 3 parked a whole camp product here. Unadjudicated policy | Medium |
| P5 | **Unsellable rung** | `workbook.js:2833-2841`, returned `:2870` | offer_id, offering, length, price, the why sentence | Priced on the parent-facing page today and can never be charged. Parent-visible | High |
| P6 | **Translation refusal** | `translation_error` `:1778,:1791`; persisted to `workbook_answers.apply_error` `:2198-2202` | answer_id, target_field, the refusal sentence | Whole apply refuses. All-or-nothing | High, but self-announcing |
| P7 | **Tax never asked** | `tax_state` `:2858`, computed `:2564-2575` | client_id, which of never_asked / could_not_read | Re-prices every athlete in the academy. This is why `academy_setting` sorts first | High |
| P8 | **Ages stored, nothing reads them** | `age_note` `:2416` | offer_id, which plans got bounds | Owner reasonably believes routing moved. It did not | Low, but it is a promise outstanding |
| P9 | **Diagnostic could-not-tell** | `stripe_error` `:2863`, `could_not_compare` `:2868`, `catalog:"empty"` `:2866`, `could_not_scan_offers` `:2872`, `withheld_note` `:2851`, `refused` `:2525` | which read failed, the do-not-act sentence | Acting on a null count mints duplicates against real cards | Blocking, one run only |
| P10 | **The live apply itself** | `live_apply_not_built` `:2013` | workbook id, the approved card set | Everything above waits behind it | High |
| P11 | **Publish to parents** | `publish_not_built` `:2881` | workbook id, offer id | Applied prices are invisible to parents until someone publishes | Medium |
| P12 | **billing_cadence hand SQL** | open item `sj-price-match-log.md:68`; symptom is `rhythm_fallback` `:2774` | offer_price row, the declared week count | 12 vs 13 charges a year, about 7.7% of revenue | Medium, money |
| P13 | **Coupon adopt-by-id / push-live** | ruling `sj-price-match-log.md:301-308` | code, state on-paper vs live, targets, duration | `club` is $100 off **forever**. A system that starts honouring coupons inherits it silently | Medium |

`skipped.already_applied` (`:2062`) is bookkeeping, not an action item. `skipped.no_answer` (`:2061`, `:2078`, `:2097`) is mostly deliberate blanks, but it also swallows an optional tax registration number the owner left empty while receipts print one (`api/_member-receipts.js:504`). Call it a reporting line, not a queue item.

### 1b. Member workbook (from the decisions doc and the rulings, not yet built)

| # | Item | Source of truth | Payload | Blast radius | Urgency |
|---|---|---|---|---|---|
| M1 | **Stop billing this parent** | `lij-workbook-decisions.md:38,46,53` | **dollar amount, subscription id, parent name, date marked** (committed, do not shorten). Plus next charge date | Every cycle it waits is another charge. "A queue nobody is obliged to clear is how a parent gets charged for four months after their kid quit" | Highest. Sorts first, above academy settings |
| M2 | **Off-card / alternate payer** | ruling `sj-price-match-log.md:352-353` | member, athlete, amount, cadence, method (cash / e-transfer / other), who collects | **Recurring, not one-time.** Member is excluded from auto-charging, so somebody has to actually collect money every cycle, forever | High and permanent |
| M3 | **Non-Stripe member to create** | decisions #11, mockup v2:270 | parent, athlete(s) + ages, plan, amount, how they pay | Member exists in the owner's head and nowhere in the system | Medium |
| M4 | **Add-from-search member to import** | decisions #2, #8 | stripe customer id, subscription, athletes, plan attachment | Same | Medium |
| M5 | **Don't-import / flagged row** | decisions #10, Zoran: "c has to be flagged cuz we might have to cancel their sub in the next workbook" | member, sub id, reason, live-sub yes/no | Feeds workbook 2's cleanup list. If it evaporates, workbook 2 starts blind | Medium |
| M6 | **Unmatched / ambiguous plan attachment** | `sj-price-match-log.md:67` (Christopher $199) | member, amount, candidate plans, why ambiguous | Wrong plan means wrong renewal price later | Medium |
| M7 | **Next-payment-date change** | decisions #3 (`user story 3`) | member, sub id, was/now date | Every SJ sub is foreign, so this is a manual Stripe edit | Medium |
| M8 | **Name corrections (parent / athlete)** | decisions #5 | member id, ghl_contact_id, stripe_customer_id, was/now | Lands in three systems. Partial application is a data split | Low |
| M9 | **Second athlete on one subscription** | decisions Q4 | sub id, both athletes + ages | A new athlete record with no billing of its own | Low |
| M10 | **Conflict: owner answer vs what the portal asserts** | round 1 finding, `sj-price-match-log.md:288,367` | the assertion, its source, the owner's answer | The portal tells parents "cancel any time" and Lij was never asked. `clients.stripe_portal_url` is null while policy promises cancel online | High, it is a public claim |
| M11 | **Foreign subscription, portal cannot act** | `members.billing_portal_owned`, migration `20260630184802` | member, sub id, origin | **All 20 SJ subs are foreign.** Every M1 / M7 above resolves to "a human in the Stripe dashboard", never a button | Standing condition, not clearable |

M11 is why M1 cannot be automated away and why it must reach a person who has Stripe access.

---

## 2. Proposed home for each

### Surfaces that already exist (verified, do not reinvent)

| Surface | Table | API | Client side | Staff side |
|---|---|---|---|---|
| **Action Items** | `action_items` (`supabase/migrations/20260601172209_create_action_items.sql`) | `api/action-items.js` | Real nav item + view + Home tile (`public/client-portal.html:25326`, `:25397`, `:25773`). Slack + push + owner SMS on create. Due-soon cron | **Only `onboarding_key` rows** (`src/views/ClientsCombinedView.jsx:765-767). Ad-hoc rows are invisible to staff |
| **V2 ticket rail** | `v2_tickets` / `v2_ticket_messages` (`20260720194025_v2_tickets_rail.sql`) | `api/v2-tickets.js` | Orb badge, Home Support card, focus mode (`client-portal.html:58297+`). `waiting_client` renders as "Needs you" | `BacklogV2View`, `MarketingV2View`, `ContentV2View`, `WebsiteV2View` |
| **Workbook answers** | `workbook_answers.apply_error` | `api/workbook.js` review | none | JSON read by the skill in Claude |
| **Agent member cards** | `agent_member_cards` (`20260718100000_agent_member_cards.sql`) | `api/agent-member-care.js` | Member drawer, per-part approve / dismiss | none |
| **The review skill in Claude** | n/a | `?action=review` | n/a | This IS the staff surface (ruling `sj-price-match-log.md:298-299`) |

**Precedent that matters most:** the member import already does exactly what M1 needs. `client-portal.html:49325` creates an action item titled `Cancel old Stripe sub - <email>` with the body "Marked 'not a member' during import but still has a live sub. Cancel it in Stripe to avoid charging them", and `api/members.js:711` counts them into a banner. So the pattern is proven. It is also fragile: it is tagged by **title string** with `title=ilike.*Cancel%20old%20Stripe%20sub*`, carries no subscription id and no dollar amount as data, and has no dedupe key.

### The assignment

| Item | Home | New? |
|---|---|---|
| M1 stop billing | `action_items`, one row per member, `due_date` = next charge date, with a **typed key** instead of a title prefix | Existing table, **new**: a `kind`/`ref` column pair or a reusable `system_key` so the row is queryable and idempotent |
| M2 off-card payer | A **persistent flag on the member record** plus whatever recurring surface Zoran picks in Q2 | **New column** on `members`. Nothing today models cash payment. Note `member_status='payment_method_required'` exists but means the opposite (needs a card) and must not be reused |
| M3, M4, M5, M6, M9 | `v2_tickets`, `type='data_fix'`, `source='import'`, structured payload in `intake` | Existing table, **new**: the systems lane page must render these types (see gap below) |
| M7, M8 | `v2_tickets`, `type='data_fix'`, one ticket per member, or folded into M1's row when the member is also stopping | Existing |
| M10 conflicts | `v2_tickets`, `type='general'`, and it must also block the policy workbook. Zoran already ruled a **third workbook** for cancellation / commitment / first-charge terms (`sj-price-match-log.md:295`) | Existing |
| M11 foreign sub | Not an item. A **condition rendered on** M1 / M7 so nobody looks for a button that cannot exist | Existing column |
| P1 mint requests | `v2_tickets`, `type='billing_fix'`, `source='offer-flow'`, one ticket per apply carrying the full target list in `intake` | Existing table, **new**: staff visibility (see gap) |
| P2 withheld fees | Same ticket as P1, as a blocking section. It is a money-off condition on the same run | Existing |
| P3 additions | `v2_tickets`, `type='build_ask'`, `source='offer-flow'`, one per addition | Existing |
| P4 notes | `v2_tickets`, `type='general'`, one per note | Existing |
| P5 unsellable rungs | `v2_tickets`, `type='billing_fix'`. Parent-visible and priced, so it is not a backlog item | Existing |
| P6 apply errors | Already persisted on `workbook_answers.apply_error`. Needs no new table, needs a **reader** | Existing, unread |
| P7 tax never asked | The academy-settings block of the review, plus a `v2_tickets` `general` if it survives an apply | Existing |
| P8 age note, P12 billing_cadence, P13 coupons | `v2_tickets`, `type='data_fix'`, backlog urgency | Existing |
| P9 diagnostics | **Never a queue item.** They are "do not act on this run" and must block the run itself, not create work | n/a |
| P10 live apply, P11 publish | Sequencing steps of skill 3, not queue rows | n/a |

### The two gaps that break the reuse

1. **`billing_fix`, `data_fix`, `build_ask` and `general` all route to `assignee_role='systems'`** (`api/v2-tickets.js:39-50`) **but the only systems staff page filters `type in ("website_change","fix")`** (`src/views/WebsiteV2View.jsx:18,50`). `SystemsView.jsx` reads the legacy `tickets` table, not this rail. So a `billing_fix` ticket created today renders on **no staff page at all**. Routing P1 there without fixing this recreates the exact failure this document exists to prevent.
2. **`action_items` assignees are academy teammates only** (`api/action-items.js:114-123, 712-718`) and creating one Slacks the academy channel, pushes the academy app and SMSes the owner (`:740-747`). That is correct for M1 (Lij must cancel a foreign sub in his own Stripe). It is wrong for P1 (minting joining fees is BAM work and Lij should not be paged about it). One queue cannot serve both without a staff-assignee concept.

---

## 3. Lifecycle: what closes each item, and who is obliged

| Item | Created by | Assigned to | Closed by | If nobody touches it |
|---|---|---|---|---|
| M1 stop billing | Member workbook submit (not apply, it must not wait on apply) | The academy owner, because the sub is foreign and only he can cancel it | `completed_at` set, plus a read-back that the sub is `canceled` in Stripe | **The parent keeps being charged.** This is the recorded four-month failure |
| M2 off-card | Member workbook submit | Undecided, see Q2 | Depends on Q2: never (standing flag) or per cycle | Either the member is silently unbilled, or a recurring item accumulates unpaid periods |
| M3, M4 additions | Workbook submit | BAM systems | The member row exists and is linked | Owner believes a member is enrolled who is not |
| M5 flagged skip | Workbook submit | Workbook 2 (the cleanup workbook) | Consumed by workbook 2 | Workbook 2 starts blind, subs stay live |
| M6 ambiguous plan | Workbook submit | BAM systems, resolved by asking the owner | Plan attached | Wrong renewal price at the next commitment boundary |
| M7, M8, M9 | Workbook submit | BAM systems | Written to Stripe / members / GHL | Owner's corrections silently dropped |
| M10 conflict | Review | **Nobody today.** Needs the third workbook or a Zoran ruling | The portal's assertion and the owner's answer agree | The portal keeps telling parents something the owner never agreed to |
| P1 mint | Apply (dry run) | BAM systems | The prices exist in the academy's Stripe and a rerun shows `exists:true` | New families are never charged the joining fee. Already true since today |
| P2 withheld fee | Review + apply | BAM systems | Codes carry targets, rerun shows `withheld_signup_fees: []` | Fee off for a whole plan, invisibly |
| P3 additions | Apply | BAM systems | The plan/rung/code exists in the offer | Owner sells something the system does not know about |
| P4 notes | Apply | **Nobody today** | A human decides and records the decision | Unadjudicated. Round 3 left a camp product here |
| P5 unsellable rung | Apply preview | BAM systems | Length fixed, rerun shows `unsellable_rungs: []` | A parent-facing price that can never be charged |
| P6 apply error | Apply | BAM systems | Answer re-translated, apply passes | Apply refuses forever, which at least fails loud |
| P7 tax | Apply preview | BAM systems | `tax_state` reads `configured` or `confirmed_no` | Every price ships untaxed with nobody having decided that |
| P8, P12, P13 | Apply | BAM systems, backlog | Feature shipped / SQL run / coupon state chosen | Quiet drift. P12 is money |
| P9 diagnostics | Apply preview | The run itself | Rerun with the read working | Somebody mints duplicates off a null count |

**Items whose closure is currently nobody's job: M2, M10, P4, and every one of P1 to P13 in the sense that no row exists to be closed.** M1 has an owner in the ruling and no mechanism.

---

## 4. The lands-nowhere audit

| Item | Has a home today? | Evidence |
|---|---|---|
| M1 stop billing (from the **workbook**) | **No** | The workbook has no action-item writer. `doApplyStaff` returns JSON only |
| M1 stop billing (from the **import sorter**) | **Yes, partially** | `client-portal.html:49325`, counted at `api/members.js:711`. Title-string tagged, no amount, no sub id as data |
| M2 off-card payer | **No.** No column, no concept | No `off_card` / `pays_cash` / `manual_payment` anywhere in `supabase/migrations` or `api/` |
| M3 non-Stripe member | **No** | Mockup button only (`lij-workbook-mockup-v2.html:270`) |
| M4 add-from-search | **No** | Same |
| M5 flagged skip | **No** | Ruled to be "flagged not dropped"; nothing flags it |
| M6 ambiguous plan | **No** | Tracked in a markdown checkbox, `sj-price-match-log.md:67` |
| M7 date change | **No** | |
| M8 name corrections | **No** | |
| M9 second athlete | **No** | |
| M10 conflicts | **No** | `sj-price-match-log.md:367` calls it unresolved |
| M11 foreign sub | **Yes** (as data) | `members.billing_portal_owned` |
| P1 mint requests | **No** | The live example. JSON response plus a hand-written HTML page |
| P2 withheld fees | **No** | `review.warnings` and `phase3.withheld_signup_fees`, both ephemeral |
| P3 additions | **No** | `skipped.additions` |
| P4 notes | **No** | `skipped.notes` |
| P5 unsellable rungs | **No** | `phase3.unsellable_rungs` |
| P6 apply errors | **Half.** Stored, never rendered outside the review JSON | `workbook_answers.apply_error` |
| P7 tax state | **No** | |
| P8 age note | **No** | |
| P9 diagnostics | n/a by design | |
| P10 live apply, P11 publish | **No** | Both routes deliberately refuse |
| P12 billing_cadence | **No** | Markdown checkbox |
| P13 coupons | **No** | Proposal HTML |

**Count: 19 item types produce work. 2 have a real home (M11 as data, M1 on the import path only). 1 is half-homed (P6). 16 land nowhere.**

---

## 5. Recommendation on scope

Being honest about the minimum. The member workbook can be **built** without any of this, and the sequencing ruling already says it builds during the price wait (`sj-price-match-log.md:327`). What it cannot do is **ship to Lij** without the items it produces having somewhere to land, because the moment he presses Send the queue exists whether we modelled it or not.

### Must exist before the member workbook is SENT

| # | What | Why it is the minimum |
|---|---|---|
| 1 | **M1 writes a real `action_items` row at submit**, carrying amount, subscription id, parent name, marked date, and `due_date` = next charge date | Zoran's committed requirement, verbatim, `lij-workbook-decisions.md:53`. The recorded failure. Everything else can wait; a parent being charged cannot |
| 2 | **A typed key on that row instead of a title prefix** | The existing precedent matches on `title=ilike`. Reapplying a workbook would duplicate rows and a renamed title would orphan the banner |
| 3 | **A store for the M2 off-card flag before the page renders the control** | A control with nowhere to land is the dead tax chip in a second costume (`sj-price-match-log.md:122-124`). The rule was written for exactly this |
| 4 | **Skill 3 refuses to close while any stop-billing row is open** | Ruled: "working the queue is a REQUIRED step in skill 3, not optional cleanup" |
| 5 | **A decision on Q1 and Q2 below** | They change which table M1 and M2 live in. Building first means migrating later |

### Should exist before the first LIVE apply (price or member)

6. Widen the systems staff lane, or add one, so `billing_fix` / `data_fix` / `build_ask` render somewhere. Without it, P1 to P5 route into a table nobody looks at.
7. One `v2_tickets` writer at apply time for P1, P2, P3, P5. One ticket per apply with the payload in `intake` is enough; per-item tickets can come later.
8. Render `workbook_answers.apply_error` wherever staff read the review.

### Can wait

9. P8 age wiring, P11 publish, P12 billing_cadence SQL, P13 coupon push-live, M8 name propagation, M9 second athlete.
10. Any owner-facing dashboard of these items beyond the Action Items view that already exists.

---

## 6. Open questions for Zoran

**Q1. Who owns a stop-billing row?**
Every San Jose subscription is foreign (`members.billing_portal_owned=false`), so the portal cannot cancel it. Somebody with Stripe access has to.
- **A.** The academy owner. Lands in `action_items`, which already Slacks his channel, pushes his app and SMSes him, and already shows in his Action Items tab. Fastest to build, uses the proven precedent, and he is the person who can actually do it.
- **B.** BAM staff. Needs a staff-assignee concept that `action_items` does not have today, plus a staff surface that does not exist.
- **C.** Both: the item is the owner's, and BAM gets a parallel ticket that closes when his does.
*Recommendation: A for v1, because it is the only option that reaches a person who can act, today.*

**Q2. What does the off-card flag actually do?**
It is recurring, not a one-time import decision.
- **A.** Flag only. The member is excluded from auto-charge and appears on one standing "paid outside Stripe" list. Nothing generates work per cycle.
- **B.** Flag plus a recurring collect item every cycle, with a due date and an amount, that somebody ticks off.
- **C.** Flag plus a Stripe invoice with send-invoice collection, so Stripe chases them. This is a Stripe write per cycle and was not part of the v1 ruling.
*B is the only one that answers "somebody must actually collect money". A is the only one that ships without a new scheduler.*

**Q3. One queue or two?**
- **A.** One: everything goes to `action_items`, and the academy sees BAM's internal work (minting fees, fixing rungs) alongside their own.
- **B.** Two, split by who acts: `action_items` for owner work, `v2_tickets` for BAM work. This matches what the two surfaces already are, but the owner never sees that BAM has 3 unminted joining fees.
- **C.** Two, with a rollup count on the owner's Home tile so he can see BAM has open work without seeing the internals.

**Q4. Does the mint request need a home before live apply exists?**
It has been sitting unowned since today with no row anywhere.
- **A.** Yes, now. A ticket per apply run, so the count is visible and ages.
- **B.** No. The review skill in Claude holds it, and it becomes real when live apply ships.
*A costs one writer. B is a bet that live apply ships before anyone forgets.*

**Q5. M10, the conflicts.** The portal currently tells parents "cancel any time" and Lij was never asked (`sj-price-match-log.md:288, 367`). `clients.stripe_portal_url` is null while the policy promises cancel-online yes.
- **A.** Block: the third (policy) workbook ships before any conflicting assertion stays public.
- **B.** Flag: raise it as a ticket and let the assertion stand until answered.
- **C.** Retract: stop asserting anything we have not asked, until the policy workbook exists.

---

## Critical Files for Implementation

- `/Users/zoransavic/bam-os-requirements/.claude/worktrees/mike-sandu-scheduled-messages-3862a6/bam-ghl-agent/bam-portal/api/workbook.js`
- `/Users/zoransavic/bam-os-requirements/.claude/worktrees/mike-sandu-scheduled-messages-3862a6/bam-ghl-agent/bam-portal/api/action-items.js`
- `/Users/zoransavic/bam-os-requirements/.claude/worktrees/mike-sandu-scheduled-messages-3862a6/bam-ghl-agent/bam-portal/api/v2-tickets.js`
- `/Users/zoransavic/bam-os-requirements/.claude/worktrees/mike-sandu-scheduled-messages-3862a6/bam-ghl-agent/bam-portal/public/client-portal.html` (Action Items view + the `Cancel old Stripe sub` precedent at :49108-49325, the V2 support rail at :58297+)
- `/Users/zoransavic/bam-os-requirements/.claude/worktrees/mike-sandu-scheduled-messages-3862a6/bam-ghl-agent/bam-portal/src/views/WebsiteV2View.jsx` (the systems lane type filter that hides `billing_fix` / `data_fix`)
- `/Users/zoransavic/bam-os-requirements/.claude/worktrees/mike-sandu-scheduled-messages-3862a6/bam-ghl-agent/bam-portal/supabase/migrations/20260601172209_create_action_items.sql`