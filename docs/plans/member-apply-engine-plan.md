# After-Submit Member Apply Engine

## Context

BAM San Jose (owner Lij) is being migrated into the portal. The PRICE workbook is done: his 4 plans are owner-confirmed and applied, Elementary archived, prices matched to his Stripe. The next step is the MEMBER workbook: a tokenized page where he confirms his ~20 existing paying members (athlete names/ages, which plan each is on, next payment date, how they pay, who has left), submits, and BAM approves + applies through a Claude skill.

The page is designed (a mockup seeded with his real 20 members, real Stripe dates, and GHL-sourced athlete names exists at `docs/plans/member-workbook-seeded.html`). The APPLY ENGINE - what turns his submitted answers into real member records + action items - does not exist. The shared workbook engine (`api/workbook.js`) today only handles price/academy_setting answers and writes only to `clients` and `offers`; it has no concept of a member. This plan designs that engine.

**Why now:** without the apply engine, his answers would submit into an engine that cannot act on them - the exact "control with nowhere to land" failure this project keeps catching. The engine also has to enforce the hard coverage rule (every member ends on a live or archived price) and create the 3 owner action items, both ruled by Zoran.

## Governing rulings (already made, in `docs/plans/sj-price-match-log.md`)

- Staff approve gate: nothing writes until BAM approves every member and every action item in the Claude skill. Same gate as the price side (review -> approve-card -> apply). The skill IS the staff surface.
- Coverage is a HARD gate: every member ends on a live or archived price; an unmatched amount mints an archived price under the owner-named family; never move a member to fit; the number that must reach zero is "members with no price".
- Match on Stripe price IDENTITY, never amount (Salvador $200 on old Pre Season 1x must not file under Elementary $200).
- Money is read-only on the member surface; apply never changes what a parent pays.
- 3 skill-created action items: TAKEOVER (per foreign sub), MISSING-PHONE (blank phone), STOP-BILLING (marked "not a member"). 2 standing detectors (failed-payment card link, off-card collect) are NOT apply outputs.
- Takeover is per-member; apply creates the item, not the sub (engine already exists in `api/sorter/take-over.js`).
- Off-card at apply: a flagged cash member gets a `member_billing_arrangements` row via the existing `set-off-card` path, anchor = next payment date.

## Decisions locked with Zoran (2026-08-07)

| # | Decision | Ruling |
|---|---|---|
| A | Members pre-seeded or created at apply | **Pre-seed member shells from Stripe** before the workbook opens, so it is a true confirm and every answer targets a real `members.id`. The seeded mockup already demonstrates the shape. |
| B | Where athlete age lands | **`member_field_values`** (existing table `20260709181015_member_field_values.sql`), NOT a new `members` column. It was purpose-built for per-athlete answers (Age included) when siblings share one parent/Stripe customer, which is exactly the two-athletes-on-one-sub case. Age is a `custom_field_defs` row read/written via `api/custom-fields.js ?action=values`. This was Zoran's catch: a new column would have been redundant with the GTA mechanism. |
| C | Two athletes on one sub | Two `members` rows sharing `stripe_subscription_id`, each with its own `member_field_values` age (no overwrite - the reason that table exists). |
| D | Ambiguous plan (Christopher $199, owner did not name a family) | HARD coverage gate: apply refuses until staff supply the family in the skill. Never auto-file by amount. |
| E | One-person archived-price mint | **Staff-confirm via the BAM queue** (`v2_tickets`), same path as the joining fees. The mint is a live Stripe write and inherits the deliberate "no unreviewed live Stripe writes" boundary. |
| F | Price-side ordering | Coverage cannot reach zero until the price side's LIVE mint populates `pricing_catalog` (SJ has 0 rows today). Member DB seed CAN happen during that wait; coverage closes when the mint lands. |

## Verified against live schema/code (read-only)

- `members` has NO `athlete_age`, NO `next_payment` column; HAS `contact_id` and `ghl_contact_id`; NO index on `stripe_subscription_id`.
- `member_field_values` exists and is the per-athlete answer store (age, etc.), overlaying contact-level values.
- `KINDS` in `api/workbook.js:1227` already admits `"member"`; `target_kind` CHECK already includes `member_row` (`20260804T230000_workbooks.sql`). No schema change needed for the workbook spine.
- Apply spine, snapshot(first-wins), per-answer `applied_at` idempotency, approve gate, review sort-order all exist in `api/workbook.js` and are reused, not forked.
- `api/sorter/take-over.js` (preview/create/verify-cancel, grandfathers amount+interval, anchors to next charge, `needs_card` refusal) exists.
- `set-off-card` in `api/members.js` + `api/_off-card.js` (arrangement + collections, anchor = next payment, double-billing guard) exists and its tables are live in prod.
- `createSystemActionItem` + `system_key` unique index exist; item creation is insert-or-noop.

## The build

### 1. Pre-seed (orchestrator step, before the workbook is sent)
Create one `members` shell per active Stripe subscription for the client, carrying `stripe_subscription_id`, `stripe_customer_id`, current `stripe_price_id`, `billing_portal_owned=false`, amount, and prefilled `athlete_name` / age (`member_field_values`) / `parent_phone` from the `contacts` join (17/20 names, 14/20 ages for SJ). The member workbook cards then target these `members.id` shells.

### 2. `member_row` target model (no schema change to the workbook spine)
- One card per subscription: `card_key = member:<stripe_subscription_id>` (or `member:<customer_id>` for manual adds).
- `target_kind='member_row'`, `target_table='members'`, `target_id=<members.id shell>`.
- `target_field` per fact: `athlete_name`, `athlete_age` (routed to `member_field_values`, not a members column), `stripe_price_id`/`offer_id`/`plan` (coverage-resolved), `next_payment` (feeds takeover item or off-card anchor, not a members column), `outcome` (confirmed | stop_billing), `billing_mode` (drives off-card path), `parent_name`, `parent_phone`.

### 3. Apply phase order (mirrors the price spine's discipline)
0. Classify + translate ALL answers (pure, refuse-first; a bad plan match or unknown field refuses the whole apply and writes nothing, writing `apply_error` per row).
1. Coverage resolution: identity-match each member's Stripe price id against `pricing_catalog`/`offer_prices`; uncovered -> queue an archived-price mint under the owner-named family; compute `members_with_no_price`. HARD gate.
2. Snapshot (first-apply-wins) of the members/arrangements this workbook touches.
3. Member upsert by `members.id`: name, age (via `member_field_values`), plan (`stripe_price_id`+`offer_id`+`plan`), status. Stamp `applied_at` per answer.
4. Athlete records: second athlete -> sibling `members` row sharing the sub id; each its own `member_field_values` age.
5. Off-card arrangements: for each `billing_mode='alternate'`, call the existing `set-off-card` logic (amount from resolved price, anchor = next date).
6. Three action items via `createSystemActionItem`: `takeover:<member_id>` (foreign subs), `missing-phone:<member_id>` (blank phone), `stop-billing:<member_id>` (not a member).
7. Report: seeded rows, deferred mints, deferred takeovers, arrangements, items created, coverage numbers.

**Dry-run boundary:** member apply is REAL for the portal DB (members, arrangements, action items) and DEFERRED at the Stripe seam (archived-price mints and takeover subs). This differs from the price workbook (whose whole apply is dry); the report must say so plainly so nobody thinks members were not really created.

### 4. Coverage gate (the load-bearing correctness property)
`members_with_no_price` must reach zero. Uncovered + no named family = `409`, write nothing. Review shows a coverage panel (`covered/total`, uncovered list with amount + Stripe price id + chosen family or "family not chosen" blocker), sitting up top on blast-radius precedence.

### 5. Claude skill (staff surface), section order
1. Stop-billing members first (amount, sub id, parent, date). 2. Coverage panel. 3. Member cards (parent, athletes name+age, plan was/now, next payment was/now, money read-only, off-card flag+method+anchor). 4. The 3 action items grouped with their `system_key`. 5. Additions/notes for hand-adjudication. Gate: `ready_to_apply` only when every card approved AND coverage zero-uncovered.

### 6. One page gap to close
The member workbook page must add the off-card method chips (cash/e-transfer/bank/cheque/other) with a REQUIRED follow-up for "other". Everything else apply needs is already captured by the locked design.

## Reuse map

| Apply step | Reuses | New |
|---|---|---|
| Review/approve/apply spine, snapshot, `applied_at` | `api/workbook.js` doReviewStaff/doApproveCard/doApplyStaff | a `member_row` branch in phase 0 + a `members` write path (today `:2086` refuses non-offers) |
| Age storage | `member_field_values` + `api/custom-fields.js ?action=values` | wiring only |
| Takeover items | `api/sorter/take-over.js` unchanged | one item per foreign-sub member (wiring) |
| Off-card arrangements | `set-off-card` (`api/members.js`) + `api/_off-card.js` | calling it from apply per flagged member |
| Stop-billing + double-billing guard | `stopBillingItem` / `raiseStopBillingIfSubscribed` | driving it from the `stop_billing` outcome |
| System items | `createSystemActionItem` + `system_key` | new key shapes `takeover:`, `missing-phone:` (`stop-billing:` exists); extract this fn to a shared module so apply and the off-card cron share one copy |
| Archived-price mint (uncovered) | `api/offers/create-price.js` / `match-prices.js` | routed through a BAM `v2_tickets` step (Decision E) |

## Critical files
- `bam-ghl-agent/bam-portal/api/workbook.js` (the spine; add the member_row branch + members write path)
- `bam-ghl-agent/bam-portal/api/members.js` (set-off-card, createSystemActionItem, member schema)
- `bam-ghl-agent/bam-portal/api/sorter/take-over.js` (takeover engine, unchanged)
- `bam-ghl-agent/bam-portal/api/_off-card.js` (arrangement creation)
- `bam-ghl-agent/bam-portal/api/custom-fields.js` (member_field_values read/write for age)
- `bam-ghl-agent/bam-portal/supabase/migrations/20260804T230000_workbooks.sql` (member_row already legal)

## Build + verification approach
Build behind the same rehearsal loop the price side used (it caught 14 defects): a subagent plays Lij through a seeded member workbook, submits; the staff half runs review -> approve-card per member -> apply against real Postgres with the Stripe seam DEFERRED (no live mint, no sub create); then a restore. Coverage-gate refusal, the two-athletes case, off-card arrangement creation, and all three action items must each be exercised. A DIFFERENT agent tests than builds; failures go back to the planner. Gates to keep green: the existing workbook suites plus a new member-apply suite with per-line MUTATE controls, including one asserting a hardcoded plan/amount match fails loudly (identity-match, never amount).

## Sequence note
This is step 7 of the 9-step San Jose sequence. It can be BUILT now (off-card foundation is live). Its coverage guarantee cannot CLOSE for SJ until the price side's live Stripe mint runs (populating `pricing_catalog`); member DB seed may proceed during that wait.
