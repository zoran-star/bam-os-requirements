# Off-Stripe Payments: Design

## Headline finding, before anything else

**The flag already exists and it is already decorative.** `members.billing_mode` was added by `supabase/migrations/20260611234439_sorter_dismissals_and_billing_mode.sql:2`, and `'alternate'` already means exactly "pays outside Stripe (cash/e-transfer)" (`api/members.js:2095-2097`). It is already settable from two surfaces: the member drawer toggle (`public/client-portal.html:51778-51780`) and the Sorter (`api/sorter/cleanup.js:436-450`).

Everything it does today:

| Consequence | Where |
|---|---|
| Drawer says "Alternate payment method - not billed via Stripe." | `public/client-portal.html:51565-51568` |
| Next-payment column reads "pays another way", date `null` | `api/sorter/cleanup.js:121-123` |
| Sorter stops complaining about no Stripe link / no offer | `api/sorter/cleanup.js:1454-1460`, `:1499`, `:1413` |
| Copied to the member row at promote | `api/sorter/cleanup.js:857`, `:869` |

No due date. No reminder. No ledger. Nothing else in the codebase reads it (grep over `api`, `src`, `public`, `supabase`). **The v2-action-item map's claim that no off-card flag exists is wrong** (`docs/plans/v2-action-item-map.md`, "lands nowhere" table, M2 row) - it searched for the strings `off_card` / `pays_cash` / `manual_payment`. The dead-tax-chip failure Zoran is trying to prevent has already shipped once, in this exact place.

So this design is not "add a flag". It is "give the flag that exists a consequence".

---

## 1. The model

| Question | Answer |
|---|---|
| What is an off-card member? | A `members` row with `billing_mode='alternate'` **and** an active arrangement row. The flag alone is a claim; the arrangement is the obligation |
| Where does the flag live | Reuse `members.billing_mode='alternate'`. Do not mint a second column - two flags for one question is the whitespace-applies_to defect class (`sj-price-match-log.md`, loop cycle 3, "any emptiness question must have exactly one answerer") |
| Distinguish from `member_status='payment_method_required'` | **Verified opposite.** It means "a real member with no card on file - collecting card" (`api/members-agent.js:110`), set by the card-collection path (`api/members.js:1958-1982`) and by website checkout before payment (`api/website/checkout.js:804-810`). An off-card member must NEVER be parked there |
| Distinguish from `billing_portal_owned=false` | That means "foreign Stripe sub, portal cannot act" (`supabase/migrations/20260630184802`). Off-card means "no Stripe sub at all". A member can be neither, either, or both |
| Still counted active? | Yes. Status stays `live`. The roster filter only hides `payment_method_required` shells (`api/members.js:545-547`), so an off-card member appears everywhere |
| In class rosters? | Yes, unchanged |
| Excluded from auto-charge? | Honest version: **the portal has no charge loop.** Stripe subscriptions charge. So "excluded" concretely means no subscription is created for them, and any existing one must be explicitly cancelled |
| Receipts? | Not in v1. See section 4 |

### The guard that matters most

**Flagging a member off-card while `stripe_subscription_id` is non-null is a double-billing setup.** The parent pays cash AND Stripe keeps charging. For San Jose every sub is foreign (`billing_portal_owned=false`), so the portal cannot cancel it - this must raise the stop-billing action item (M1) automatically, not be left to the owner noticing. Today's toggle at `client-portal.html:51778-51780` writes the field with zero checks.

### Proposed tables

| Table | One row per | Why separate |
|---|---|---|
| `member_billing_arrangements` | active arrangement per member | The rhythm and the terms. `method`, `amount_cents`, `cadence`, `anchor_date`, `grace_days`, `collector_client_user_id`, `commitment_end_date`, `status` (active/paused/ended), `cadence_source`, `source` (workbook/staff), `ended_at` |
| `member_collections` | expected collection period | The thing that is DUE and the thing that gets CLOSED. `due_date`, `amount_expected_cents`, `status` (due/overdue/paid/partial/waived/void/disputed), `amount_collected_cents`, `collected_on`, `method`, `marked_by`, `reference`, `action_item_id`, `note` |

`member_collections` carries **no FK to `members`**, for the reason `member_receipts` gives verbatim: member rows are deleted on cancellation, and a record of money a parent actually paid must outlive the membership (`supabase/migrations/20260731T190000_member_receipts.sql`, the `member_id` comment).

---

## 2. The due-date model

Zoran named this as the hard part. Four candidates:

| Option | Gives you the rhythm? | Gives you the phase? | Survives a price edit? | Verdict |
|---|---|---|---|---|
| A. Stored cadence + anchor on the member | Yes | Yes | Yes | **Recommended core** |
| B. Owner sets an explicit per-member schedule | Yes | Yes | Yes | Too much typing for 20 members; and it is the same data as A entered by hand |
| C. Derive purely from the plan | Yes | **No** | No | Fatal. Two members on "every 4 weeks" pay in different weeks. A plan cannot tell you which |
| D. Explicit one-off due dates | No | Yes, once | n/a | Correct only for genuine one-offs. As the model it means someone re-enters a date forever |

### Recommendation

**Cadence is derived from the plan, then STORED on the arrangement. The anchor is the one new fact the owner supplies.**

```
next_due = addInterval(anchor_date, resolveInterval(offer_price_row, term))
```

Both functions exist and are already the single decision point for how money recurs: `resolveInterval` at `api/website/checkout.js:163-171`, `addInterval` at `api/website/checkout.js:201-211`, vocabulary `CADENCES` at `api/website/checkout.js:146-153`, mirrored in `api/offers/create-price.js:195-202` with `api/_billing-cadence.test.mjs` failing on drift. Off-card must join that mirror set, not fork a third copy.

| Why store rather than re-derive every run | |
|---|---|
| Plans get archived | Lij archived Elementary yesterday (`sj-price-match-log.md`, live blocker section). Ted and Jenny kept their $200 - archive is not cancel. A live arrangement whose rhythm evaporates when a plan is archived is a silent stop |
| Prices get edited | Editing a price must not silently re-phase a cash payer |
| The real arrangement can differ from the plan | See below |

### When the plan's cadence and reality disagree

| | |
|---|---|
| Store | `cadence` (what actually happens) + `cadence_source` = `plan` or `override` |
| Which wins for reminders | **The arrangement.** It is what the human actually does |
| Which wins for revenue expectation | **The plan.** It is what was sold |
| What happens to the disagreement | It is never reconciled silently. An `override` raises a `v2_tickets` `data_fix` (BAM work, per the Q3 fully-separate ruling) and shows on the reconciliation report as drift |

Rationale: a plan billing every 4 weeks and a parent who hands over cash on the 1st of the month is 13 vs 12 collections a year, the same 7.7% error P12 already tracks (`v2-action-item-map.md`, P12). Making it visible is the whole point; auto-picking one side hides money.

---

## 3. The collect reminder

**It is both.** The collection row is the record; an `action_items` row is the notification. Justification: `action_items` already Slacks the academy channel, fires a native push and SMSes the owner on create (`api/action-items.js:736-748`), and a due-soon cron re-pings 2 days out (`api/action-items.js:592-629`, scheduled `vercel.json` `/api/action-items?action=cron-due-soon` at `0 13 * * *`). Rebuilding that is inventing. But an action item is a to-do with no amount, no method and no paid-state, so it cannot be the ledger.

| Question | Answer |
|---|---|
| Who gets told | The academy owner always (`notifyOwners` always includes the owner, `api/_notify-owners.js:44-49`), plus the named collector via `action_items.assignee_id` when set |
| Through what | Slack channel + native push + owner SMS on create, then the existing due-soon ping. No new transport |
| When | Item is created at `due_date - lead_days` (default 3), **not** when the collection row is generated. Otherwise the owner gets an item four weeks early and learns to ignore it |
| What it says | Title: `Collect $199 from Christy Hang (Christopher) - due Aug 20`. Description: method, cadence, the collector, and the one link that marks it collected |
| What it must never say | Anything implying we charged them. And nothing goes to the parent in v1 |

### Three build facts that bite

1. **`POST /api/action-items` requires a JWT** (`ctx.user.id`, `canAccess`, `api/action-items.js:706-733`). A cron has no user. The notify block at `:736-748` must be extracted into a shared function the cron can call after a service-role insert.
2. **`action_items` has no typed key.** Only `onboarding_key` with `unique (client_id, onboarding_key)` (`supabase/migrations/20260601213820_action_items_onboarding_key.sql:5-11`). The existing precedent matches by title string (`api/members.js:711`, `title=ilike.*Cancel old Stripe sub*`). A `system_key` column plus a unique index is needed here, and it is the **same column Q1's stop-billing ruling already requires**, so it is not extra cost.
3. **`created_by_role` is `check in ('client','staff')`** with `created_by` a bare uuid. A system-created row needs either NULL role or a widened check.

Push copy needs one new event in the catalog at `api/push/_send.js:161-180` (`collect-due`), or it reuses `action-item-assigned` and reads "New action item", which is weaker but zero-cost.

---

## 4. Marking it paid

| | |
|---|---|
| What closes it | The `member_collections` row moves to `paid` / `partial` / `waived`. The action item mirrors it. **The collection row is the truth; the action item is a copy** |
| Who can close it | Owner or any `client_users` teammate who can see the item, plus BAM staff from the member drawer |
| What is recorded | `amount_collected_cents`, `collected_on` (real date, defaults today, editable - cash arrives late), `method`, `marked_by`, `reference` (e-transfer confirmation string), `note` |
| Where the dollar box lives | The **portal**, logged in. Never the workbook. This is what makes "the workbook never renders a money box" and "we need the real amount" both true |
| Audit | `member_audit_log` already exists (`20260524160000_member_management_schema.sql`) with `action_type` / `args` / `db_changes`. Reuse it |
| Side effect | Roll the arrangement's `next_due_date` forward by one interval and generate the next collection row |

### Receipt: no in v1, and here is why

`api/_member-receipts.js` is Stripe-invoice-shaped throughout:

| Assumption | Where |
|---|---|
| `maybeSendPaymentReceipt` requires an `invoice` object | `api/_member-receipts.js:521-527` |
| Lines come from `invoice.lines.data` and `invoice.amount_paid` | `api/_member-receipts.js:178-206` |
| Send-once guard is `unique (client_id, stripe_invoice_id) where kind='payment' and stripe_invoice_id is not null` | `supabase/migrations/20260731T190000_member_receipts.sql` |
| `kind` is `check in ('payment','refund')` | same file |
| Every academy is OFF by default (`receipt_mode` NULL), and gated on `v2_access` | same file, `api/_member-receipts.js:389` |

**Faking an invoice object to reuse the existing path defeats the send-once index** (a NULL `stripe_invoice_id` is excluded from the partial unique index), which is the one mechanism that stopped a real double-send on 2026-07-12. Do not do it.

v1.1 shape when Zoran wants it: add `kind='offline_payment'`, a `collection_id` column, a second partial unique index on `(client_id, collection_id)`, and a third entry point that builds lines from the plan's typed base via the same `resolveFee`/`applyFee` reconcile rule (`api/_member-receipts.js:176-247`) rather than from invoice lines. Skipping receipts in v1 is not a regression: today zero academies send any.

---

## 5. Edge cases

| Case | Rule | Notes |
|---|---|---|
| **Partial payment** | Status `partial`. `amount_collected_cents < amount_expected_cents`. Item stays OPEN with the remainder in the title. Never auto-close | The shortfall carries as a balance on the arrangement, not as a new collection |
| **Late payment** | Late = `due_date + grace_days` (default 3, per-arrangement). At that boundary status flips `due` -> `overdue`, the item is re-pinged, and the owner gets one SMS | `due_soon_notified_at` is a one-shot column; overdue needs its own stamp or it never re-fires |
| **How late is too late** | 2 consecutive unpaid periods raises a **decision item**: "Keep collecting, pause, or stop the membership?" Never automatic | |
| **Stops paying entirely** | The owner's answer to that decision item. If they also hold a live Stripe sub, it becomes a stop-billing item (M1) with the sub id | Off-card members usually have no sub, so "stop billing" here means end the arrangement + decide the membership |
| **Off-card -> card** | Arrangement `ended_at` set, future `due` collections voided, **past collections never touched**. The toggle must route through an endpoint that does this, not a raw field write | Today `_memberUpdateField('billing_mode','')` (`client-portal.html:51779`) writes the column and nothing else |
| **Card -> off-card** | New arrangement, new anchor. Plus the double-billing guard: if `stripe_subscription_id` is set, refuse or raise stop-billing | |
| **Prepays several periods** | Their 3mo/6mo prepay options are **already priced rungs** with real cadences (`12_weeks`, `24_weeks`, `supabase/migrations/20260730T230000_offer_prices_billing_cadence.sql`). So prepay is a different plan, not a special case. The arrangement takes the rung's cadence | A genuine "paid 3 months ahead on a monthly arrangement" is `paid_through_date` on the close, which skips generation until that date |
| **Proof of payment** | v1: `reference` free text (e-transfer confirmation number). v1.1: file upload reusing `member_files` (`20260609130218_member_files.sql` + bucket migration) | |
| **Disputes** | Status `disputed`. Reopens the item, files a `v2_tickets` `data_fix`. Rows are corrected by a new audit entry, never edited away | |
| **Reconciliation** | Monthly per-member expected vs collected. Be honest about what it is: the portal cannot verify cash, so this is an **owner-attested** report, not a truth claim | This is where cadence drift surfaces |
| **End of commitment** | `commitment_end_date` on the arrangement, plus the rung's existing "what happens after" answer (`lij-workbook-decisions.md`, the after-commitment section). At the boundary: stop generating, raise a decision item. **Never auto-renew an off-card member silently** | |
| **Pause / freeze** | Arrangement `status='paused'` with `resume_on`. Cron skips generation. Collections already due stay due unless explicitly waived | **I could not find a field named "freeze".** The offer policy carries `pause_allowed`, `pause_min_days`, `pause_max_days`, `pause_per_year` (`api/offers/policy.js:81-87`). The arrangement should validate a requested pause against those, and there is an existing pause cron to sit beside (`api/members.js:224-234`) |
| **Nobody ever marks it paid** | The item ages and escalates. Generation **continues** so the debt is visible. The cron must never auto-complete a collection, and never stop generating because one is unpaid | The failure mode this whole build exists to prevent is a queue that quietly empties itself |

---

## 6. What the member workbook needs from this

The good news: **the workbook already captures almost all of it.** Q3 locked editable fields to "only plan and date" (`lij-workbook-decisions.md`, Part 4 table). For an off-card member, that next-payment date simply becomes the **anchor** instead of a Stripe date. Same control, different meaning.

| The owner-facing page must capture | Control | Notes |
|---|---|---|
| Pays by card / pays another way | Per-row toggle | Writes `billing_mode` |
| How they pay | Chips: cash / e-transfer / bank transfer / cheque / other | "Other" **requires** a follow-up box. Without it you get `"$85 other."` again (`sj-price-match-log.md`, forgot-to-ask yield) |
| When their next payment is due | The date field the grid already has | This is the anchor. It is the single most valuable thing the owner knows and nobody else does |
| Who collects it | Optional teammate picker | Skippable; defaults to the owner |
| **Amount** | **Never.** No dollar box | Amount comes from the plan they are on, which the grid already shows read-only (`money.editable: false` in the capture schema) |

What staff set up afterwards, at apply:

1. Confirm the plan attachment (M6 - Christopher's $199 is exactly this).
2. Resolve the cadence from the plan, or record an override with a reason.
3. Set `grace_days` and the collector.
4. Check the double-billing guard; raise stop-billing if a live sub exists.
5. Activate the arrangement. **Activation is what generates the first collection.** Nothing generates from the workbook directly, per the staff-confirms rule.

---

## 7. Reporting and consequences

What would be silently wrong if off-card members stayed invisible:

| Surface | What it reads | What breaks |
|---|---|---|
| **BAM's own commission invoice** | Raw gross Stripe charges for the cycle (`api/commissions.js:252-271`) | **BAM under-bills itself.** Growth-share is computed on revenue that excludes every cash dollar the academy collected. This is money out of BAM's pocket, quietly |
| Owner revenue KPI | Stripe charges only (`api/kpis-v15.js:486-519`) | The owner's dashboard shows less revenue than he made and stops trusting the number |
| `members.total_spent_cents` | Summed from Stripe (`api/members.js:325-368`) | An off-card member of two years reads $0 lifetime spend. Feeds any "best customers" view |
| Next-payment column | `computeNextPayment` returns `{state:'none', date:null}` for alt payers (`api/sorter/cleanup.js:121-123`) | "Pays another way" with no date is the current answer. Once arrangements exist it should return the real due date |
| Member drawer billing block | `client-portal.html:51565-51568` | Says "not billed via Stripe" and stops. No amount, no next date, no history |
| Member-care agent | Allowed actions gate on `status` only (`api/agent/member-care.js:74-84`), and `MEMBER_CARE_SELECT` does not include `billing_mode` (`api/agent/member-care.js:27-29`) | The agent can suggest sending a **card-setup link to a cash payer** |
| Members agent | Status vocabulary has no off-card concept (`api/members-agent.js:110-114`) | "Who owes us money?" is unanswerable |
| Active-member counts | Off-card members are `live` | Correct, but an off-card member nobody ever collects from inflates active membership and MRR-style counts indefinitely |

Minimum reporting change for v1: one number on the members surface, "N off-card members, $X expected this period, $Y collected, Z overdue". Everything else can follow.

---

## 8. Scope recommendation

### v1: the smallest thing that still causes money to get collected

| # | Piece | Why it is not optional |
|---|---|---|
| 1 | `member_billing_arrangements` + `member_collections` | The flag needs somewhere to mean something |
| 2 | `action_items.system_key` + unique index | Idempotency. Shared with Q1's stop-billing ruling, so near-zero marginal cost |
| 3 | A generate-and-notify cron | `?action=cron-collect` beside `cron-process-scheduled-pauses` in `api/members.js:224-234`, one `vercel.json` entry. Reuses the existing Slack/push/SMS block |
| 4 | "Mark collected" with amount, date, method, who | **This is the step that makes it real.** Without 3 and 4 the flag is decorative |
| 5 | Workbook capture: toggle + method chips + anchor date | Reuses the date field that already exists |
| 6 | The double-billing guard | Flag + live sub must raise stop-billing |

Cut #3 and you have a spreadsheet. Cut #4 and you have a nag with no end state. Everything else can wait.

### Follows v1

Offline receipts (new `kind`, new unique index). Proof-of-payment upload via `member_files`. Reconciliation report. Off-card revenue in commissions and KPIs. `billing_mode`-aware member-care agent. Parent-facing "your payment is due" reminders. Stripe send-invoice collection (Q2 option C from the map).

---

## 9. Open decisions for Zoran

| # | Decision | Options | Recommendation |
|---|---|---|---|
| **D1** | Reuse `billing_mode='alternate'` or mint a clean column? | A. Reuse, add a CHECK constraint (values seen in code today: `'alternate'`, `'card'`, and NULL). B. New `payment_mode` column and deprecate | **A.** It already exists and is already set on real rows. A second flag for one question is the defect class that produced the whitespace-applies_to bug. Naming caveat: Stripe's own subscription object also has a `billing_mode` field (noted at `api/stripe/webhook.js:507`) - different namespace, worth a comment |
| **D2** | Who owns the collect item? | A. Owner always. B. Named collector, owner as fallback. C. Both notified | **B.** `action_items.assignee_id` already exists and `notifyOwners` texts the owner regardless (`api/_notify-owners.js:44-49`), so B gives C's coverage for free |
| **D3** | Does an off-card payment produce a parent receipt? | A. No in v1. B. Yes, new `kind='offline_payment'` + new unique index. C. Yes, reuse the payment path with a synthetic invoice | **A now, B next.** C defeats the send-once index and is the wrong move. Receipts are off for every academy today, so A costs nothing |
| **D4** | When nobody marks paid for 2 periods, what happens? | A. Automatic stop-billing / cancel. B. A decision item to the owner. C. Nothing, it just ages | **B.** A cancels a member who may have paid in cash and nobody logged it. C is how a member trains for free for a year |
| **D5** | Prepay (their 3mo / 6mo options): a rung or a paid-through flag? | A. Rung. The prepay prices already exist with real cadences. B. Paid-through date on a monthly arrangement | **A.** It is already modelled and priced. B stays available for the ad-hoc "he handed me three months of cash" case |
| **D6** | Does off-card revenue count toward BAM's commission? | A. Yes, from marked-collected rows, flagged owner-attested. B. No, Stripe only, as today. C. Yes, from expected rather than collected | **A**, but flag it: this makes the collections ledger a **billing input**, which raises the bar on who may edit a row and means D4's decision item and the audit trail become financial controls, not convenience. Choosing B keeps the ledger soft and is a smaller build. This one genuinely changes the design |
| **D7** | Does the member workbook ship before this is built? | A. Workbook waits for implementation. B. Workbook builds in parallel, captures toggle + method + anchor, and the flag is inert until the arrangement tables land. C. Workbook ships without the control | **B**, matching yesterday's "plan off-card first, then build both". C is the dead-tax-chip repeat |

---

### Critical Files for Implementation

- `/Users/zoransavic/bam-os-requirements/.claude/worktrees/mike-sandu-scheduled-messages-3862a6/bam-ghl-agent/bam-portal/api/members.js` (the off-card flag's write path at `:2095-2097`, the cron pattern at `:224-234`, the Stripe-only spend sync at `:325-368`, the title-string action-item banner at `:711`)
- `/Users/zoransavic/bam-os-requirements/.claude/worktrees/mike-sandu-scheduled-messages-3862a6/bam-ghl-agent/bam-portal/api/action-items.js` (the notify block at `:736-748` that must be extracted for cron use, the due-soon cron at `:592-629`)
- `/Users/zoransavic/bam-os-requirements/.claude/worktrees/mike-sandu-scheduled-messages-3862a6/bam-ghl-agent/bam-portal/api/website/checkout.js` (`intervalFor` `:109-125`, `CADENCES` `:146-153`, `resolveInterval` `:163-171`, `addInterval` `:201-211` - the due-date arithmetic to reuse, not fork)
- `/Users/zoransavic/bam-os-requirements/.claude/worktrees/mike-sandu-scheduled-messages-3862a6/bam-ghl-agent/bam-portal/api/sorter/cleanup.js` (the existing alt-payment action `:436-450`, `computeNextPayment` `:121-123`, promote carry-through `:857-869`)
- `/Users/zoransavic/bam-os-requirements/.claude/worktrees/mike-sandu-scheduled-messages-3862a6/bam-ghl-agent/bam-portal/api/_member-receipts.js` (the invoice-shaped assumptions at `:176-206` and `:521-527` that rule receipts out of v1)
- `/Users/zoransavic/bam-os-requirements/.claude/worktrees/mike-sandu-scheduled-messages-3862a6/bam-ghl-agent/bam-portal/public/client-portal.html` (the toggle at `:51778-51780` and the drawer billing block at `:51565-51568`, both of which need to route through the new endpoint)
---

## RULINGS (Zoran, 2026-08-07) - these settle D1 to D6

| # | Decision | Ruling |
|---|---|---|
| D1 | The flag | **Reuse `members.billing_mode='alternate'`.** One field, one answer. Add a CHECK constraint; do not mint a second column |
| D2 | Who owns the collect reminder | **Owner by DEFAULT, reassignable to a staff member.** So `action_items.assignee_id` defaults to the owner and the UI must expose a change-owner control. Not "named collector first" - the owner is the default and delegation is the exception |
| D3 | Receipts | **Not in v1.** Add later as `kind='offline_payment'` with its own send-once index. Never fake a Stripe invoice |
| D4 | Two missed periods | **Nothing. Let it age.** No decision item, no auto-cancel |
| D5 | Prepay | **It is the prepay plan** (already priced). See the constraint below |
| D6 | Commission | **Stripe only.** Off-card revenue stays out of BAM's growth-share. Ledger stays a soft record |

### D5 CONSTRAINT, stated by Zoran and load-bearing
*"i just want to make sure its adaptable to any commitment that is created in the pricing stage"*

The due-date engine must resolve its interval from **whatever commitments the academy actually created**, never from a hardcoded 3/6-month list. If an academy prices a 9-month or 8-week or 18-month commitment, off-card arrangements must follow it with no code change.

This is not hypothetical: the term vocabulary was previously CLOSED to monthly/3_months/6_months, `_bbTermFromLength` collapsed 12 months to `6_months`, and "1 year" produced no key at all. That was fixed on 2026-08-06 (adjustable prepay lengths, any 1-24 months, mints honour the declared week rhythm). Off-card must consume that same open vocabulary, i.e. resolve through the shared `resolveInterval`/`addInterval`/`CADENCES` path (api/website/checkout.js:146-211, mirrored in api/offers/create-price.js:195-202, drift-guarded by api/_billing-cadence.test.mjs) and read the commitment's declared length/week count off the offer.

**Test that must exist:** create a commitment with a non-standard length (e.g. 9 months, and one declared in weeks), attach an off-card arrangement, and assert the generated due dates follow it. A hardcoded 3/6 assumption must fail that test loudly.

### D7 sequencing ruling (Zoran, 2026-08-07): OFF-CARD FOUNDATION FIRST, THEN THE WORKBOOK
Build the arrangement + collections tables and the mark-collected step BEFORE the member workbook captures anything. The moment the workbook's "pays cash" toggle exists, it must land somewhere real. Nothing inert, not even temporarily and not even deliberately. Slower to a second link for Lij, and that cost is accepted.

Build order therefore:
1. `member_billing_arrangements` + `member_collections` (+ CHECK on billing_mode, + the double-billing guard).
2. `action_items.system_key` + unique index (shared with the stop-billing ruling, so not extra cost).
3. The generate-and-notify cron, reusing the existing Slack/push/SMS block (must extract the notify function so a cron with no JWT can call it).
4. Mark-collected: amount, date, method, who, reference. Portal-side, logged in. THIS is the step that makes it real.
5. Then the member workbook, whose off-card capture is toggle + method chips (with a required follow-up for "other") + the anchor date, and never a dollar box.
