# Parent Runtime API Wiring Plan

Owner: Luka
Audience: BAM Portal agents, Zoran's agents
Last updated: 2026-07-02
Status: Phases 1-4 + 7 implemented locally (uncommitted, not in production);
Phase 5 and Phase 6 cutovers not started

## Implementation Status (2026-07-02)

| Phase | Status | What's left |
|---|---|---|
| 0 Preconditions | Partially done | Prod preflights + backfill re-verification; Stripe interval check for real grant amounts |
| 1 Shared helpers | DONE locally | Nothing (all review rules below implemented) |
| 2 Read-only APIs | DONE locally | Nothing |
| 3 Scheduling APIs | DONE locally | Nothing |
| 4 Credit engine | DONE locally, dormant | Activate via cron/webhook only at Phase 6; set real `invoice_grant_credits` after interval check |
| 5 Webhook access sync | NOT STARTED | Whole phase |
| 6 Production cutovers | NOT STARTED | Whole phase (blocked on 5 + open decisions) |
| 7 Trial bookings | DONE locally | `entry_points.bookable_program_id` linkage (needs Zoran sync); trial conversion flow (CONVERTED + lineage) is deliberately not wired - it belongs with checkout cutover |

Everything "DONE locally" is verified by full local `db reset` replay, 35 vitest
tests, tsc/lint, and live iOS-simulator E2Es, and sits UNCOMMITTED on
`parent/refactor` awaiting Luka's diff review. NO overnight migration has been
applied to production (verified via `supabase migration list` 2026-07-02).

Migration drift RESOLVED (2026-07-02): the four remote-only migrations that
shipped concurrently overnight (`20260701210626` members start_date,
`20260701223936`/`20260701223951` kpi_events, `20260702014912` twilio voice)
were pulled into local, and the five overnight parent migrations were
renumbered to `20260702115744`-`20260702115748` (after the latest remote
version). Full local `db reset` replay over the merged sequence + 35 vitest
tests verified green. Prod preflight for the identity guards (duplicate
case-insensitive profile emails, duplicate EXPIRE refs) ran clean read-only
against production: zero blockers.

This doc is the API wiring plan for moving operational offer pricing, checkout,
member access, credits, and scheduling onto the typed runtime tables.

Related docs:

- `parent-app-architecture-handoff.md` - architecture overview and handoff.
- `parent-app-db-boundary.md` - ownership and "do not touch without syncing"
  table boundaries.
- `offer-runtime-backfill-report.md` - production data mapping and backfill
  decisions.
- `trial-calendars-confirmed-decisions.md` - confirmed free-trial scheduling
  model.

## Recommendation

Build additive APIs and helpers first. Do not cut over existing production flows
during active work hours unless the change is read-only or hidden behind a
compatibility path.

The safer order is:

1. Add server-side helper modules and diagnostics.
2. Add read-only typed runtime APIs.
3. Add additive staff scheduling APIs that do not change public checkout,
   webhook, or member behavior.
4. Add the credit engine before or alongside any checkout cutover that sells
   weekly-credit plans.
5. Cut over public checkout, website pricing, webhook, members, and sorter
   behavior in controlled low-traffic windows.
6. Add free-trial schema/APIs as one vertical slice: `trial_bookings`, trial
   booking writes, and slot capacity accounting in the same deploy.

Reason: the risky work is not creating new endpoints. The risky work is changing
existing production paths that currently create members, take payments, move GHL
pipeline cards, trigger CoachIQ, and run onboarding automations. With multiple
people adding migrations and API changes concurrently, cutovers should be small,
observable, and easy to roll back.

## Current Source Of Truth

Keep this separation:

| Area | Source |
|---|---|
| Flexible offer copy, media, intake fields, workflow ids, signup links | `offers.data` |
| Stripe / CoachIQ / legacy provider mapping | `pricing_catalog` |
| Runtime sellable options and prices | `offer_options`, `offer_prices` |
| What a price grants | `entitlement_templates` |
| Actual member access | `customer_entitlements` |
| Credit balance movement | `credit_ledger` |
| Parent/customer identity | `customer_profiles`, `students`, `academy_memberships`, `member_links` |
| Bookable access target | `bookable_programs` |
| Dated sessions and bookings | `slot_templates`, `schedule_slots`, `reservations`, `waitlist_entries` |
| Free-trial lead bookings | `trial_bookings` (exists locally via `20260702115748`; not in production yet) |

RLS on parent/runtime tables is deny-all. These tables must be read/written
through service-role API functions, not direct browser Supabase writes.

## Already Done

- Parent identity tables exist: `customer_profiles`, `students`,
  `academy_memberships`, `member_links`.
- Typed runtime tables exist: `bookable_programs`, `offer_options`,
  `offer_prices`, `entitlement_templates`, `customer_entitlements`,
  `credit_ledger`.
- Schedule tables and parent booking RPCs exist: `slot_templates`,
  `schedule_slots`, `reservations`, `waitlist_entries`,
  `parent_book_slot`, `parent_join_waitlist`, `parent_cancel_reservation`,
  `parent_leave_waitlist`.
- `bookable_program_id` access spine exists across templates, entitlements,
  slot templates, and schedule slots.
- Local seed/backfill data exists for runtime testing.
- Production runtime backfill has been performed for BAM GTA Training runtime
  rows, identity spine, and entitlements; re-verify against
  `offer-runtime-backfill-report.md` before production cutover.
- Runtime uniqueness guards (`20260701161000_parent_runtime_uniqueness_guards.sql`)
  are applied to production per remote migration history (verified 2026-07-02).
  The identity-spine guards (`20260702115744`) are local-only and still need a
  prod preflight + apply.
- 2026-07-02 (local only, not applied to production; verified via local db
  reset + vitest + live iOS simulator E2E):
  - Identity-spine uniqueness guards:
    `20260702115744_parent_identity_uniqueness_guards.sql` (case-insensitive
    profile email, EXPIRE ledger refs; membership/link uniqueness already
    existed in parent_0001).
  - Phase 1 helper hardening in `api/_runtime/`: insert-catch-refetch
    convergence under concurrency, member_links as the canonical spine anchor,
    customer_id no longer wiped on resync, terminal CANCELLED status mapping,
    ambiguous offer_price_key resolution throws.
  - Phase 2 read APIs: `api/runtime/offers.ts` (public, CORS-gated like
    website offer.js) and `api/runtime/diagnostics.ts` (staff, 8 checks), with
    staff auth in `api/runtime/_staff-context.ts`.
  - Phase 3: shared capacity function `slot_spots_taken` +
    rewired booking/waitlist/cancel RPCs
    (`20260702115745_parent_shared_slot_capacity.sql`, includes the
    slot-generation uniqueness index), staff template CRUD + idempotent
    `generate-slots` (recurrence format `WEEKLY:MO,...`, client time_zone
    aware), staff `calendar` read, and `staff_cancel_slot` RPC + API
    (`20260702115746_parent_staff_cancel_slot_rpc.sql`).
  - Test suite: 22 vitest tests across `api/_runtime` + `api/runtime`
    (`npm run test:runtime`), including Promise.all concurrency convergence
    and calendar-equals-booking-truth capacity checks.
  - Local dev lane: `scripts/local-api-dev.mjs` replaces `vercel dev`
    (function-count cap); fc-mobile E2E verified booking + staff cancel +
    credit refund round-trip on the iOS simulator.
- 2026-07-02 second pass (local only, dormant, not applied to production):
  - Phase 4 credit engine: `20260702115747_parent_credit_engine_rpcs.sql`
    (`apply_stripe_credit_grant` with expiry-at-grant + idempotent EXPIRE/GRANT
    refs, `expire_lapsed_credit_entitlements` sweeper) +
    `api/_runtime/credit-engine.ts` (invoice -> runtime price -> member spine
    -> entitlement; amount from template config `invoice_grant_credits`,
    rollover from `credit_rollover` EXPIRE|CARRY_OVER - the future owner-facing
    carry-over setting reads this flag) + dormant
    `POST /api/runtime/credits/reconcile-invoice` (CRON_SECRET/staff gated; NOT
    cron-registered, webhook untouched). Confirmed decisions: grants only on
    paid invoices; expiry default with per-offer carry-over flag; no per-week
    booking cap; no refund clawback in v1.
  - Phase 7 trials: `20260702115748_parent_trial_bookings.sql`
    (`trial_bookings` with conversion lineage + double-submit guard,
    `slot_spots_taken` now counts BOOKED trials so member booking RPCs respect
    trial capacity automatically, book/cancel/reschedule/outcome RPCs,
    `staff_cancel_slot` extended with `trials_cancelled`), public
    `api/website/trial-slots.ts` + `trial-booking.ts` (origin-gated,
    email-verified cancel/reschedule; entry_points linkage deferred pending
    shared-table sync with Zoran), staff `api/runtime/trial-bookings.ts`,
    and parent/staff/trial availability all aligned on the shared capacity
    calculation. Verified live on the iOS simulator: a trial lead + a member
    booking fill a capacity-2 slot, app shows "0 spots left", further trial
    booking returns 409.
  - Test suite now 35 vitest tests across `api/_runtime` + `api/runtime`.

## Cutover Rule

Every production path that creates or mutates a paying member must end with
consistent state across:

```text
members
customer_profiles
students
academy_memberships
member_links
customer_entitlements
credit_ledger, when credits are granted/debited/refunded
```

No public checkout, sorter import, billing action, or Stripe webhook should be
allowed to create a live/bookable member without an active membership and a
matching entitlement.

## Phase 0 - Preconditions

Before wiring APIs:

1. Confirm migration history is clean:
   - `supabase migration list`
   - repair any migration that is applied to schema but missing from history.
2. Run duplicate preflight checks for runtime rows, entitlements, and Stripe
   grant ledger refs.
   - Also preflight the identity spine: duplicate `customer_profiles` emails,
     duplicate `academy_memberships` per `(academy_id, student_id)`, duplicate
     `member_links` per `member_id`.
3. Apply uniqueness guards to production only after preflight returns zero
   blockers. For large/live tables, prefer concurrent indexes or a low-traffic
   window because uniqueness creation can lock/fail if new duplicates appear.
4. Verify current production backfill:
   - active runtime prices exist for the five BAM GTA Training prices.
   - every active template points to BAM GTA Training.
   - imported live members have identity rows and entitlements.
   - paused/payment-required imported members do not have active booking access.
5. Weekly credit policy is decided:
   - every successful payment grants the credits for that paid period.
   - `Steady` / `1/Wk` monthly grants 4 credits every 4-week payment cycle.
   - 3-month and 6-month prepaid terms grant the equivalent paid-period credit
     block from the successful payment.
   - no infinite rollover; credits are tied to the paid entitlement period.
     Confirmed 2026-07-02: expiry is the default, and per-offer carry-over is a
     future owner-facing setting - the engine already reads
     `credit_rollover: EXPIRE | CARRY_OVER` from template/entitlement config,
     so that setting only needs to write this flag.
   - booking debits credits, cancellation refunds credits while the entitlement
     is still valid.
   - no per-week booking cap (confirmed 2026-07-02); prepaid terms grant the
     full block upfront, so a 1/Wk parent can burn credits faster than weekly.
   - no refund clawback in v1; refund-implies-cancel handling belongs to 6.5.

6. Verify the actual Stripe billing interval for weekly-credit prices before
   hardcoding grant amounts. If Steady is billed per calendar `month` (~4.35
   weeks) rather than a literal 4-week interval, granting 4 credits per invoice
   delivers 48 credits/year against a "1/Wk" promise of 52. Confirm the real
   Stripe price intervals and set grant amounts from them.
7. A second uniqueness-guards migration is needed for the identity spine before
   webhook access sync goes live. The existing guards cover only the commerce
   tables. Without identity guards, two concurrent webhook deliveries (or
   webhook + sorter promote racing) for the same new member create duplicate
   profiles/students/memberships, which makes entitlement and booking lookups
   nondeterministic. Guard at minimum:
   - `customer_profiles` unique email (normalized)
   - `academy_memberships` unique `(academy_id, student_id)`
   - `member_links` unique `member_id`
   - `credit_ledger` EXPIRE rows unique on `source_ref` (see Phase 4)

Weekly credits are a hard prerequisite for long-term Steady booking correctness.
The current booking RPC sums `credit_ledger`; without payment-triggered grants
and period-aware expiry handling, credit plans will not behave correctly over
time.

## Phase 1 - Shared Server Helpers

Create shared service-role helpers before modifying endpoint behavior.

Suggested module shape:

```text
api/_runtime/offer-runtime.ts
api/_runtime/member-access.ts
api/_runtime/credits.ts
api/_runtime/identity.ts
```

Required helper capabilities:

- `resolveRuntimeOfferPrice({ clientId, offerPriceId, offerPriceKey, plan, term })`
- `resolvePricingCatalogForOfferPrice(offerPrice)`
- `getActiveEntitlementTemplateForPrice(offerPriceId)`
- `ensureCustomerProfileFromMember(member)`
- `ensureStudentFromMember(member, profile)`
- `ensureAcademyMembershipFromMember(member, profile, student)`
- `ensureMemberLink(member, student)`
- `grantOrSyncEntitlementFromOfferPrice({ member, membership, offerPrice, template, source, sourceRef })`
- `syncAccessStatusFromMemberStatus(member)`
- `grantCredits({ entitlement, source, sourceRef, amount, effectiveAt })`

Rules:

- Helpers must be idempotent.
- Helpers must use database unique indexes/upserts, not only app-level
  "check then insert".
  - Current state: the implemented `api/_runtime` helpers (identity spine,
    entitlement sync, credit grant) are find-then-insert. Once uniqueness
    guards exist, convert to `upsert(..., { onConflict })` or catch unique
    violation (`23505`) and re-read; otherwise the losing side of a concurrent
    race throws instead of returning the existing row.
- Update paths must never null out fields set by later flows. Known instance:
  `ensureAcademyMembershipFromMember` includes `customer_id: null` in its
  update payload, which wipes the claimed-profile link on every webhook resync.
  Only set `customer_id` on insert or when currently null.
- Cancel/delete paths must map to terminal statuses (`CANCELLED` / `EXPIRED`),
  not `SUSPENDED`. Current helpers map everything non-live to `SUSPENDED`,
  which makes a cancelled member read as a recoverable payment problem in
  diagnostics.
- `offer_price_key` resolution must fail loudly on ambiguity. Nothing enforces
  uniqueness on `source_offer_price_key` (deliberate, for current+legacy
  pairs). If a key resolves to more than one active routable price, throw
  instead of silently picking by sort order; the checkout compat path must not
  guess.
- Existing production routes are mostly `.js`; keep them unchanged until their
  cutover, then either convert the route to TypeScript or add a thin JS adapter.
  Do not keep separate TS and JS copies of the same runtime logic.
- Stripe grant `source_ref` should use invoice or invoice-line identity, not only
  subscription id.
- Entitlement `source_ref` granularity must be decided before Phase 6.0. The
  sync helper upserts by `(tenant, source, source_ref)`; if the ref is the bare
  subscription id, a plan change mutates the existing entitlement in place and
  cannot "suspend old, create new" as 6.5 expects, and plan history is lost.
  Using `sub_id:price_id` or the subscription-item id lets old and new coexist.
  Backfilled refs are painful to change later.
- Booking/cancel ledger rows should not be globally deduped by reservation id;
  the booking flow can legitimately book, cancel, and rebook the same
  reservation row.

## Phase 2 - Read-Only Runtime APIs

These are low-risk because they do not change existing prod writes.

### Public Offer Runtime Read

Purpose: allow website/app surfaces to read typed prices without depending on
JSON pricing as runtime truth.

Possible endpoint:

```text
GET /api/runtime/offers/:offerId/options
```

Returns:

- offer copy from `offers.data`
- active `offer_options`
- active/routable `offer_prices`
- entitlement summary from `entitlement_templates`
- linked `pricing_catalog` details needed for display

Keep `api/website/offer.js` unchanged until this read path is proven.

### Staff Runtime Diagnostics

Possible endpoint:

```text
GET /api/runtime/diagnostics?client_id=...
```

Checks:

- active offer price with no active template.
- active Stripe-backed offer price with no `pricing_catalog` link.
- live member with no active entitlement.
- active entitlement with no `member_links` row.
- duplicate source refs that would block uniqueness guards.
- credit entitlement with no recent/current grant.
- live member whose `stripe_price_id` maps to a `pricing_catalog` row with no
  linked `offer_price` (this is the gating check for 6.3).
- active entitlement whose `config` has drifted from its source template.

This should be available before risky cutover.

## Phase 3 - Scheduling APIs

These are split into two buckets:

- staff template/generation/calendar APIs are additive and can be built early,
  after shared helpers/read APIs.
- any change to public parent booking capacity is a production-sensitive change
  and must stay aligned with the booking RPCs.

Capacity should have one source of truth. Parent booking, staff calendar, and
trial booking must all use the same calculation:

```text
spots_left = schedule_slots.capacity
           - active reservations
           - active trial bookings, after trial_bookings exists
```

Current active reservation status is `CONFIRMED`; cancelled, attended, no-show,
and late-cancelled reservations should not consume future capacity. When
`trial_bookings` is added, active trial status should initially be `BOOKED`.

Implement the calculation as a single SQL function (for example
`slot_spots_taken(slot_id)`), not as a convention repeated across code paths.
The `0005` booking RPCs currently inline the reservation count; rewire them to
call the shared function so adding `trial_bookings` to the count is a
one-function change and "same deploy" consistency is enforced by code rather
than discipline.

### Staff Slot Template APIs

Needed:

```text
GET    /api/runtime/schedule/templates?client_id=...
POST   /api/runtime/schedule/templates
PATCH  /api/runtime/schedule/templates/:id
DELETE /api/runtime/schedule/templates/:id
```

Backed by:

- `slot_templates`
- `bookable_programs`
- optional `locations`

### Slot Generation API

Needed:

```text
POST /api/runtime/schedule/generate-slots
```

Behavior:

- generate dated `schedule_slots` from `slot_templates`.
- be idempotent for the same template/date/time.
- never overwrite manual edits unless explicitly requested.

Add the uniqueness index up front, not later: unique
`(tenant_id, slot_template_id, starts_at)` on `schedule_slots` (partial, for
template-generated rows). An "idempotent" generation API without a DB guard is
app-level check-then-insert, the exact pattern the Phase 1 rules forbid, and
concurrent generation runs will duplicate slots. It is cheap while the tables
are near-empty.

### Staff Calendar Read API

Needed:

```text
GET /api/runtime/schedule/calendar?client_id=...&date_from=...&date_to=...
```

Returns:

- `schedule_slots`
- reservation counts
- waitlist counts
- later: trial booking counts
- shared capacity/spots-left calculation

### Slot Cancellation API

Needed:

```text
POST /api/runtime/schedule/slots/:id/cancel
```

Behavior:

- mark `schedule_slots.is_cancelled = true`.
- cancel all active reservations.
- refund credits.
- remove/cancel waitlist entries.
- later: cancel active trial bookings.
- send notifications when messaging is wired.

This should be a transaction-safe RPC, similar to parent booking RPCs.

### Parent Schedule APIs

Already exists:

```text
GET    /api/parent/schedule/slots
GET    /api/parent/schedule/slot
POST   /api/parent/schedule/slot-action?action=book
POST   /api/parent/schedule/slot-action?action=waitlist
DELETE /api/parent/reservation
DELETE /api/parent/waitlist-entry
GET    /api/parent/reservations/upcoming
GET    /api/parent/appointments/past
```

Later changes:

- when `trial_bookings` go live, parent slot availability must count active
  trial bookings through the shared capacity calculation in the same deploy.
- leave-waitlist UI still needs mobile polish, but API exists.

## Phase 4 - Credit Engine

Required before relying on weekly-credit plans at scale.

Implementation timing: this must ship before or with any production checkout
cutover that sells weekly-credit plans. If it is delayed, weekly-credit prices
should stay hidden/gated even if monthly-unlimited prices are cut over first.

Needed behavior:

- payment-triggered grant/expiry handling for `WEEKLY_CREDITS`.
- successful Stripe payments grant the paid-period credit block:
  - monthly `Steady` / `1/Wk`: 4 credits per 4-week payment cycle.
  - 3-month `Steady`: 12 credits for the prepaid 12-week term.
  - 6-month `Steady`: 24 credits for the prepaid 24-week term.
- Stripe invoice grant idempotency using invoice or invoice-line source refs.
- credits are tied to the paid entitlement period; unused credits do not roll
  over forever.
- paused/payment-required/cancelled memberships receive no new credit grants and
  cannot book.

Possible endpoint/cron:

```text
POST /api/runtime/credits/reconcile-invoice
```

Possible ledger examples:

```text
GRANT source=stripe source_ref=invoice_line:<id>
EXPIRE source=admin/cron source_ref=entitlement_period:<membership_id>:<date>
DEBIT source=booking source_ref=reservation:<id>
REFUND source=cancel source_ref=reservation:<id>
```

Do not add a broad ledger uniqueness rule that blocks book/cancel/rebook.

### Expiry Design

The plan above says "no infinite rollover" but the mechanics decide whether
Steady works. Confirmed approach:

- Write the previous period's `EXPIRE` row inside the same transaction as the
  next period's `GRANT`. Grant time is the natural period boundary and it is
  already invoice-triggered, so no separate expiry scheduler is needed for the
  happy path.
- Add a small cron sweeper only for entitlements whose subscription ended
  without a next invoice (cancelled/lapsed).
- The `EXPIRE` amount is "remaining balance", which races with in-flight
  booking debits. The booking RPC locks the entitlement row `FOR UPDATE`; the
  expiry writer must lock the same entitlement row first, or it can expire
  credits a parent just spent and drive the balance negative.
- `EXPIRE` rows need their own idempotency. The existing ledger uniqueness
  guard covers only `source='stripe' AND entry_type='GRANT'`; add a partial
  unique index for `EXPIRE` rows on their `source_ref`
  (`entitlement_period:<membership_id>:<date>`) before the engine ships, or a
  rerun cron double-expires and balances go negative.

## Phase 5 - Stripe Webhook Access Sync Design

Design or implement the consumer behind existing behavior before changing
checkout producers. Enabling this in the live Stripe webhook is a production
cutover and belongs in Phase 6.

File:

```text
api/stripe/webhook.js
```

Add access sync to these lifecycle moments:

| Event/path | Required access behavior |
|---|---|
| First paid invoice for portal-owned checkout | Create/sync identity, membership, member link, active entitlement, initial credit grant if needed. |
| Silent import activation | Sync identity/access but skip new-signup notifications and external welcome grants. |
| Payment failed | Suspend membership/entitlement or at minimum entitlement. |
| Payment recovered | Reactivate membership/entitlement if member is live/recovered. |
| Subscription deleted/cancelled | Cancel/expire entitlement before or alongside member deletion/cancellation. |
| Subscription price changed | If price maps to runtime offer price, move entitlement source/template. |
| Stripe price created/updated | Continue mirroring only into `pricing_catalog`; do not create entitlements from raw Stripe price events. |

Do not grant active entitlements in `customer.subscription.created` for
portal-owned incomplete subscriptions. Grant only after payment succeeds.

Reliability requirements for the new access-sync path:

- The current webhook returns `200` on exceptions, so Stripe never retries.
  That is tolerable while the webhook only flips member flags, but the access
  sync is a multi-write sequence (identity spine + membership + entitlement +
  credit grant); a partial failure returned as `200` silently loses the
  entitlement forever. The access-sync path must return `5xx` on failure so
  Stripe retries; the idempotency work above is what makes those retries safe.
  Bound retries per event id if poison events are a concern.
- Stripe does not guarantee event ordering. A delayed `invoice.payment_failed`
  arriving after a recovery event must not suspend a healthy member. Treat
  events as triggers, not truth: on receipt, re-fetch the subscription/invoice
  current state from Stripe and sync to that, or at minimum compare
  `event.created` against a last-synced timestamp before applying downgrades.
- Subscription metadata does not reliably propagate onto invoice objects.
  Resolve authoritatively through `offer_prices.stripe_price_id` (unique per
  tenant via the guards); treat stamped metadata as diagnostic/fallback. If
  reading metadata off an invoice, use `subscription_details.metadata` or
  re-fetch the subscription.

Acceptance:

- replaying the same webhook does not duplicate entitlements or credit grants.
- a failed access sync returns `5xx` and succeeds on Stripe retry.
- out-of-order failure/recovery events converge on the correct final state.
- unpaid/incomplete checkout never becomes bookable.
- member status and parent booking eligibility agree.
- if deployed before cutover, the new path is dormant or read/diagnostic only.

## Phase 6 - Existing Production Cutovers

Cut these in small batches. Prefer low-traffic deploy windows for public
checkout, webhook behavior, member billing actions, and sorter/import behavior.

### 6.0 Stripe Webhook Access Activation

File:

```text
api/stripe/webhook.js
```

Activate the Phase 5 access sync path only after runtime helpers, uniqueness
guards, and backfill verification are in place. This is the consumer that keeps
identity, memberships, entitlements, and credit grants synchronized after Stripe
payment/subscription events.

Acceptance:

- replaying a paid invoice is idempotent.
- incomplete/unpaid subscriptions do not become bookable.
- payment failure/recovery/cancel events update booking access consistently.

### 6.1 Website Offer Page

File:

```text
api/website/offer.js
```

Current behavior:

- reads `offers.data.pricing.pricing_offerings`
- generates `offer_price_key`
- joins to `pricing_catalog`

Target behavior:

- keep offer selection, copy, intake fields, agreement files, and media from
  `offers.data`.
- read pricing from `offer_options`, `offer_prices`, and
  `entitlement_templates`.
- include `offer_price_id` as the preferred checkout id.
- include `source_offer_price_key` only for compatibility/display.
- hide archived/non-routable prices unless staff preview explicitly asks for
  them.

Acceptance:

- website shows only typed active prices.
- archived JSON pricing cannot leak into checkout.
- CORS/domain gating remains unchanged.

### 6.2 Website Checkout

File:

```text
api/website/checkout.js
```

Current behavior:

- accepts `offer_price_key`
- resolves `pricing_catalog`
- creates Stripe subscription
- upserts `members`
- webhook later flips member live

Target behavior:

- prefer `offer_price_id`.
- temporarily accept `offer_price_key` for compatibility and resolve to active
  typed price.
- resolve `offer_price -> source_pricing_catalog_id -> stripe_price_id`.
- stamp Stripe metadata with:
  - `offer_price_id`
  - `offer_option_id`
  - `entitlement_template_id`
  - `bookable_program_id`
  - legacy `offer_id` / `offer_price_key`
- keep `members` creation/update for current portal member management.
- entitlement activation still happens in webhook after payment succeeds.
- do not cut over checkout for weekly-credit prices before the credit engine is
  live; otherwise gate those prices until Phase 4 ships.

Acceptance:

- paid website signup creates live member plus active entitlement.
- incomplete checkout creates no active entitlement.
- agreement PDF behavior remains unchanged.

### 6.3 Legacy Onboarding Checkout

File:

```text
api/onboarding/checkout.js
```

Decision needed:

- if still used, resolve plan/term through typed `offer_prices`.
- if deprecated, gate or redirect it to the typed website checkout.

Acceptance:

- old onboarding can no longer sell a `pricing_catalog` row that has no active
  typed `offer_price`.

### 6.4 Other Public Checkout / Booking Entrypoints

Audit and gate these before declaring the cutover complete:

```text
api/website/camp-checkout.js
api/website/ch3-checkout.js
api/website/ch3-book.js
api/website/miami-book.js
api/members/intake.js
```

Each path must either:

- use the typed runtime access helpers, or
- be confirmed unrelated/not used for BAM GTA Training, or
- be disabled/gated until it is wired.

### 6.5 Members Tab / Billing Actions

File:

```text
api/members.js
```

Keep `members` as the staff/member management roster for now.

Actions to sync:

| Action | Runtime sync |
|---|---|
| `change` | Resolve target through typed `offer_price`; update Stripe as today; swap/suspend old entitlement and create/update new entitlement. |
| `pause` | Future pause keeps access active until activation; active pause suspends membership/entitlement. |
| `unpause` | Reactivate membership/entitlement. |
| `cancel` immediate | Cancel/expire entitlement before deleting member row. |
| `cancel` period-end | Decide whether entitlement remains active until period end or expires immediately. |
| `payment-link` / card setup | No active access grant until webhook recovery/paid event. |
| `refund` | No entitlement change unless refund implies cancel; document current policy. |
| `update-profile` | Sync identity fields where safe, without changing billing/access. |

Important: member actions are athlete-granular. Parent with two athletes means
two member rows, two students, two memberships, and potentially two subscriptions.

Deletion note: verify the `member_links.member_id` FK behavior before wiring
immediate cancel. If it cascades, deleting the member row silently destroys
identity lineage; if it restricts, the delete fails. Decide whether cancel
keeps the member row (status change) or the link is intentionally released,
and document it here.

### 6.6 Sorter / Import / Cleanup

Files:

```text
api/sorter/cleanup.js
api/sorter/import.js
api/sorter/fix-payment.js
api/sorter/link-ghl.js
api/sorter/setup-monthly.js
api/sorter/take-over.js
api/sorter/take-over-ai.js
```

Target behavior:

- promoting a `members_staging` row creates/syncs identity and entitlement when
  the resulting member should be bookable.
- paused/payment-required rows get identity plus suspended access, or no active
  entitlement.
- alternate/manual/cash rows use `source = 'manual'` with explicit
  `source_ref`/metadata.
- changing offer_price_key or pricing_catalog mapping re-evaluates runtime
  offer_price and entitlement.
- setup/take-over Stripe subscriptions stamp runtime metadata where possible.

Acceptance:

- imported live members are bookable without manual SQL.
- diagnostics show no live member missing access.

### 6.7 Price Match / Create Price / Pricing Catalog

Files:

```text
api/offers/match-prices.js
api/offers/create-price.js
api/pricing.js
api/stripe/webhook.js
```

Keep `pricing_catalog` as provider mapping truth.

Target behavior:

- match-price apply updates `pricing_catalog` and, where applicable, links or
  syncs `offer_prices.source_pricing_catalog_id`.
- create-price creates Stripe price and catalog row; optionally creates/links
  runtime price only when the business entitlement is known.
- Stripe price webhook mirrors provider data into `pricing_catalog` only.
- pricing diagnostics show runtime link status.

Do not infer entitlement semantics from raw Stripe price events.

### 6.8 Offer Builder / Business Blueprint

Current UI writes `offers.data` directly from `public/client-portal.html`.

Target behavior:

- keep direct writes for copy/media/intake/workflow fields if needed.
- add a server-side sync/reconciliation action for typed runtime rows.
- do not let browser Supabase client write parent runtime tables directly.
- on publish/sync, derive candidates from JSON pricing plus confirmed
  `pricing_catalog`, then upsert typed rows.
- never delete typed rows with active members; archive/deactivate instead.

Possible endpoint:

```text
POST /api/runtime/offers/sync
```

Acceptance:

- editing copy/intake/workflows remains safe.
- pricing changes require explicit sync/review before checkout sells them.

### 6.9 CoachIQ / Onboarding Activations

Files:

```text
api/onboarding/activations.js
api/coachiq/user-created.js
api/coachiq/link-user.js
api/coachiq/test-onboard.js
```

Keep current CoachIQ provider config on `pricing_catalog` for now.

Requirements:

- checkout/webhook must still set `members.stripe_price_id`.
- CoachIQ automation lookup can continue through
  `members.stripe_price_id -> pricing_catalog.coachiq_automation_url`.
- runtime-only/manual prices should not trigger CoachIQ unless explicit provider
  config exists.

### 6.10 Sales Pipeline / Agents / GHL

Files/areas:

```text
api/agent-closing.js
api/agent-confirm.js
api/agent-approvals.js
api/ghl/post-trial.js
api/ghl/pipelines.js
api/ghl/comms-config.js
api/kpis-v15.js
api/ghl.js
```

Keep these in `offers.data`:

- `signup_url`
- `ghosted_workflow`
- lead/client tags
- sales copy and policies
- intake/form config

Near-term:

- conversion detection can keep using `members.status = live`.
- KPI logic can keep using `members` initially.
- agents can keep using offer copy from JSON.

Later:

- add a typed pricing summary for agents so they do not infer pricing from
  `pricing_catalog`.
- optionally cross-check conversion state against active
  `academy_memberships`/`customer_entitlements`.

## Phase 7 - Free Trial APIs

Confirmed direction: free-trial leads book into the same `schedule_slots` as paid
members, but use `trial_bookings`, not `reservations`.

### Schema

Add `trial_bookings` with:

```text
id
tenant_id
slot_id
bookable_program_id
entry_point_id
offer_id
ghl_contact_id / contact_id
parent_name
parent_email
parent_phone
athlete_name
athlete_dob or age group fields, if needed
status: BOOKED, CANCELLED, SHOWED, NO_SHOW, CONVERTED
converted_member_id
converted_membership_id
converted_at
metadata
created_at
updated_at
```

Schema requirements:

- `slot_id` must FK to `schedule_slots(id, tenant_id)`.
- add an index for capacity counting, for example `(slot_id, status)` or a
  partial index for active trial statuses.
- add a partial unique index on `(slot_id, lower(parent_email))` where
  `status = 'BOOKED'` so a double-submitted form does not consume two spots.
- enable deny-all RLS like the other parent/runtime tables; access should go
  through service-role APIs/RPCs.
- add an `updated_at` trigger.

### Trial Availability API

Needed:

```text
GET /api/website/trial-slots?entry_point_id=...&date_from=...&date_to=...
```

Behavior:

- resolve entry point to `bookable_program_id`.
- list normal training `schedule_slots`.
- calculate availability through the same capacity helper/function used by
  parent booking and staff calendar:

```text
spots_left = capacity - confirmed reservations - active trial_bookings
```

No separate trial-only slots for shared classes.

### Trial Booking API

Needed:

```text
POST /api/website/trial-booking
```

Behavior:

- lock `schedule_slots`.
- count confirmed reservations plus active trial bookings.
- insert `trial_bookings` only if capacity remains.
- create/link contact/lead records as needed.
- optionally move pipeline/contact stage.

This should be an RPC or transaction-safe server function.

### Trial Cancel / Reschedule APIs

Needed:

```text
POST /api/website/trial-booking/:id/cancel
POST /api/website/trial-booking/:id/reschedule
```

Reschedule should cancel or move the existing trial booking without double
consuming capacity. Moving between slots locks two `schedule_slots` rows; lock
them in id order, or two concurrent reschedules in opposite directions
deadlock.

### Trial Outcome API

Needed:

```text
POST /api/runtime/trial-bookings/:id/outcome
```

Used by staff/post-trial flow to set:

- `SHOWED`
- `NO_SHOW`
- eventually `CONVERTED`

### Trial Conversion Link

When checkout converts a trial lead:

- member exists or is created.
- identity spine exists.
- entitlement exists.
- `trial_bookings.status = CONVERTED`.
- `converted_member_id`, `converted_membership_id`, and `converted_at` are set.

## Rollout Plan

Recommended order (status as of 2026-07-02):

1. Finish and verify production migration history. ← NEXT: reconcile the four
   remote-only migrations noted in the drift warning above.
2. Run duplicate preflight checks for runtime uniqueness guards. (Runtime
   guards already on prod; preflight still needed for identity guards.)
3. Apply the identity-spine guards migration (`20260702115744`) to prod.
4. Verify backfill and entitlement import.
5. Build shared helpers and diagnostics. ✅ done locally
6. Add read-only runtime offer APIs. ✅ done locally
7. Add additive staff scheduling APIs. ✅ done locally
8. Add credit accrual/expiry engine before selling weekly-credit plans through
   typed checkout. ✅ done locally (dormant)
9. Implement webhook access sync behind existing behavior. ← not started
10. Activate Stripe webhook access sync in a low-traffic cutover.
11. Cut over `api/website/offer.js`.
12. Cut over `api/website/checkout.js`, gating weekly-credit prices if Phase 4
    is not live.
13. Gate/cut over legacy onboarding and other public member-minting endpoints.
14. Sync `api/members.js` billing actions.
15. Sync sorter/import/cleanup paths.
16. Add trial booking schema/APIs. ✅ done locally
17. Update parent/staff/trial availability to include trial bookings in the same
    deploy that trial bookings begin consuming capacity. ✅ done locally (same
    working tree; ship together)

Steps 5-8 and 16-17 ship to production as one reviewed deploy of the
`parent/refactor` diff (code additive + dormant, migrations 20260702115744
through 20260702115748); steps 1-4 gate that deploy, steps 9-15 remain.

## Local API Test Plan

Run against the local stack / prod-schema snapshot (full fetched-migration
replay is not reliable; see `bam-portal/supabase/README.md`). The existing
`api/_runtime/runtime.test.ts` contracts are the foundation. Highest-value
additions, in order:

1. Webhook replay: feed the same `invoice.payment_succeeded` event twice
   through the full handler; assert one entitlement, one grant, identical
   member state. ← still needed (belongs to Phase 5; the credit-engine layer
   of it exists as reconcile-invoice replay tests)
2. True concurrency, not sequential idempotency. ✅ exists
   (`runtime.test.ts` Promise.all spine + grant convergence)
3. Capacity boundary with mixed consumers. ✅ exists (`trials.test.ts`:
   member + trial fill the slot, both consumers refused after)
4. Book/cancel/rebook ledger netting. ✅ exists
5. Out-of-order events: process `payment_failed` after `payment_succeeded` for
   the same invoice/sub; assert the member does not end suspended. ← still
   needed with Phase 5 (will fail until the ordering mitigation exists; that
   is the point).
6. Expiry period boundary. ✅ exists (`credit-engine.test.ts`: grant, partial
   spend, next-invoice grant expires remainder; CARRY_OVER variant too)

## Low-Traffic Cutover Guidance

Good candidates for normal-hours work:

- helper modules.
- diagnostics.
- read-only APIs.
- staff-only preview/sync endpoints not used by public checkout.
- local and staging verification.

Do in a low-traffic window:

- Stripe webhook access activation.
- website checkout cutover.
- legacy checkout/gating changes.
- members billing action behavior changes.
- sorter promotion behavior changes.
- trial booking capacity go-live.

For each risky cutover:

1. Deploy code with backward-compatible inputs.
2. Run read-only production checks.
3. Process one controlled test signup/import/action.
4. Verify `members`, identity spine, entitlements, and ledger.
5. Watch errors/webhook logs.
6. Keep rollback simple: feature flag or route fallback to old behavior.

## Open Decisions

- Change-plan credit policy: immediate grant, next cycle, prorated, or manual.
- Entitlement `source_ref` granularity: bare subscription id (plan changes
  mutate the entitlement in place, history lost) vs `sub_id:price_id` /
  subscription-item id (old and new coexist). Must land before Phase 6.0.
- Immediate-cancel member deletion: keep the member row with a terminal status
  vs delete and release `member_links` (see 6.5 deletion note).
- Period-end cancellation access: active until period end or immediately
  suspended.
- Whether paused/payment-required imported members should get suspended
  entitlements or identity-only. Current recommendation: suspended entitlements
  for existing imported members, no entitlement for abandoned new checkout.
- Which legacy/public checkout endpoints are still live and must be cut over.
- Trial age/group routing: entry point config vs program config vs template config.

## Done Criteria

The cutover is done when:

- public pricing reads typed runtime rows.
- checkout uses typed `offer_prices`.
- Stripe webhook creates/syncs identity and entitlements.
- member billing actions keep runtime access in sync.
- sorter/import paths create identity/access for imported members.
- live members who should be bookable have active entitlements.
- paused/payment-problem/cancelled members cannot book.
- weekly credit plans receive and consume credits according to policy.
- free-trial bookings, when launched, consume the same slot capacity as paid
  reservations.
