# Parent App / Offers Runtime Handoff

Owner: Luka
Audience: Zoran's agent and BAM Portal agents
Last updated: 2026-06-29

This doc is the BAM Portal-side handoff for the parent app, typed Offer runtime,
checkout cutover, and future internal free-trial scheduling work. It exists here
because Zoran's agents may not have access to the `fc-mobile` repo.

## Start Here

If you are trying to understand the architecture, operational pricing cutover,
or future free-trial scheduling shape, this is the right doc.

If you are about to change schema, migrations, RLS, functions, or shared table
semantics, read [`parent-app-db-boundary.md`](parent-app-db-boundary.md) first.
That boundary doc is the source of truth for "do not touch without syncing"
tables and conflict checks.

This handoff explains the plan. It does not replace the DB boundary doc.

## Executive Summary

The target architecture is still:

```text
Business Blueprint Offer
  -> typed operational runtime rows
  -> website checkout / parent app / scheduling / credits
```

The important nuance is that `offers.data` should not disappear. The JSON column
can keep flexible Business Blueprint copy, sales/onboarding content, assets, and
fields that are not operationally load-bearing. The cutover is specifically about
moving operational pricing, access, checkout, credits, and booking eligibility out
of `offers.data.pricing.pricing_offerings` and into typed tables.

After that cutover, internal free-trial scheduling can be added on the same
`bookable_programs` + `schedule_slots` spine instead of depending on GHL
calendars.

## Current Production Shape

Shared Business Blueprint tables:

- `offers`: one row per sellable academy offer. Flexible content still lives in
  `data jsonb`.
- `offer_teams`: specific team rows under a Team offer.
- `pricing_catalog`: Stripe / CoachIQ / legacy-price mapping table. This is
  currently the strongest source for confirmed live and legacy price mappings.
- `entry_points`: website forms, GHL forms, calendars, funnels; already has
  `offer_id` and currently organizes sales entry points around Offers.

Luka-owned typed runtime/access tables:

- `bookable_programs`
- `offer_options`
- `offer_prices`
- `entitlement_templates`
- `customer_entitlements`
- `credit_ledger`
- `slot_templates`
- `schedule_slots`
- `reservations`
- `waitlist_entries`
- `customer_profiles`
- `students`
- `academy_memberships`
- `member_links`

RLS rule: Luka-owned parent/runtime tables have RLS enabled with zero policies.
They are service-role API tables, not direct PostgREST tables.

## What Is Already Done

The schema for the typed operational runtime exists in production:

- `20260625011719_parent_0003_offer_runtime_entitlements.sql`
  created `offer_options`, `offer_prices`, `entitlement_templates`,
  `customer_entitlements`, and `credit_ledger`.
- `20260626030258_parent_0004_bookable_programs_access_spine.sql`
  created `bookable_programs` and added `bookable_program_id` to
  `entitlement_templates`, `customer_entitlements`, `slot_templates`, and
  `schedule_slots`.

Read-only production checks on 2026-06-29 showed:

- `bookable_programs`: 1 row
- `offer_options`: 0 rows
- `offer_prices`: 0 rows
- `entitlement_templates`: 0 rows
- `customer_entitlements`: 0 rows
- `credit_ledger`: 0 rows
- `slot_templates` / `schedule_slots` / `reservations` / `waitlist_entries`: 0 rows
- `offers`: 46 rows
- `pricing_catalog`: 41 rows

For BAM GTA Training specifically:

- `pricing_catalog` has 30 confirmed rows with both `offer_id` and
  `offer_price_key`.
- Those 30 confirmed rows all point to the published Training offer
  `52a6285c-7832-44e1-b531-ab7ef9d8fc21`.
- There are 14 distinct confirmed `offer_price_key` values.
- `members` has 42 promoted rows.
- 41 of 42 promoted members can be mapped through
  `members.stripe_price_id -> pricing_catalog`.
- 34 of 35 live members can be mapped that way.

That means BAM GTA Training is close to a reviewed backfill, but production is
not currently using the typed runtime tables yet.

## What Still Uses Offer JSON Today

Several portal and website flows still read operational pricing from
`offers.data.pricing.pricing_offerings`, including:

- website offer rendering
- website checkout
- pricing sorter / match-prices flows
- some member setup and plan-change helper flows
- Business Blueprint pricing UI pills and health checks

This is expected for the current state. Do not delete or rewrite JSON pricing
until the typed runtime cutover has been designed and tested.

## Source Of Truth During Cutover

Do not backfill blindly from `offers.data` alone.

The safer source order is:

1. `pricing_catalog` for confirmed live/legacy Stripe and CoachIQ mappings.
2. `pricing_catalog.offer_id` + `pricing_catalog.offer_price_key` for lineage.
3. `offers.data` for display labels and flexible Business Blueprint context.
4. Explicit coded or reviewed entitlement rules for credits/unlimited access.

Why: the BAM GTA Training Offer JSON still contains normal plans such as Steady,
Accelerate, Elevate, and Dominate, but many are marked `archived` in the JSON
while confirmed live/legacy mappings still exist in `pricing_catalog`. A JSON-only
migration would incorrectly drop useful operational plans.

## Operational Pricing Cutover Plan

The next major implementation step should be the operational-pricing cutover.
Recommended sequence:

1. Build a read-only backfill report.

   Current report: [`offer-runtime-backfill-report.md`](offer-runtime-backfill-report.md).

   The report should list every candidate operational price:

   - `client_id`
   - `offer_id`
   - `offer_price_key`
   - plan title
   - term / interval
   - `pricing_catalog.id`
   - Stripe price/product ids
   - canonical vs legacy tier
   - routable or not
   - inferred entitlement rule
   - migration status / issue

2. Review the BAM GTA Training mapping with Luka/Zoran.

   Current expected entitlement rules:

   - Steady -> weekly credits, 1 per week
   - Accelerate -> weekly credits, 2 per week
   - Elevate -> weekly credits, 3 per week
   - Dominate -> unlimited booking
   - Summer Unlimited -> unlimited booking

3. Backfill typed runtime tables.

   - `offer_options`: one operational purchase option per plan/package/event.
   - `offer_prices`: one row per confirmed operational price, linked back to
     `pricing_catalog` through `source_pricing_catalog_id`.
   - `entitlement_templates`: what buying each price grants.
   - `bookable_programs`: existing Training program remains the access target
     for BAM GTA Training.

4. Cut read APIs and checkout code over.

   Preferred endpoint behavior:

   - Website offer page reads typed `offer_options` / `offer_prices`.
   - Checkout accepts a stable typed price id, preferably `offer_price_id`.
   - Compatibility can temporarily support `offer_price_key`, but the server
     should resolve it to `offer_prices`.
   - Client-provided amount is never trusted.

5. Keep `pricing_catalog` as the Stripe/CoachIQ mapping layer.

   It can continue to mirror Stripe and distinguish canonical vs legacy prices.
   The key change is that runtime checkout should resolve through `offer_prices`
   and use `pricing_catalog` for external payment/automation mapping.

6. Only after the typed reads are live, de-emphasize JSON pricing.

   `offers.data.pricing.pricing_offerings` can remain visible/editable as
   Blueprint content during transition, but operational checkout should not depend
   on it long term.

## Parent App Work Still Left

The parent-app backend/mobile work is separate from the portal checkout cutover,
but it uses the same runtime tables.

Still outstanding before production parent booking:

- registration endpoint and parent JWT canary
- production identity/member linking
- production schedule import or staff-published schedule rows
- production entitlement/customer entitlement import
- production credit opening balances where needed
- review/push of booking-write RPC slice
- mobile polish for leave-waitlist and no-credit booking states

Local-only parent booking work exists, but do not apply or reshape it in
production without Luka review.

## Free Trials After GHL

Zoran wants to move free-trial booking off GHL. That should happen after the
operational pricing/runtime cutover, not before.

Target shape:

```text
Offer
  -> entry_points
  -> bookable_programs
  -> schedule_slots
  -> trial_bookings
  -> staff calendar / reminders / post-trial / checkout
```

Free trials are not member reservations. A free-trial lead does not have an
`academy_membership_id`, does not consume credits, and does not need an active
entitlement. Therefore free trials should not be forced into `reservations`.

Recommended additions:

- Add `entry_points.bookable_program_id`.
- Add a clear way to identify trial availability on slots. Prefer a new
  `schedule_slots.booking_kind` / `slot_templates.booking_kind` value such as
  `FREE_TRIAL`, or standardize an existing `slot_type` value if that is enough.
- Add `trial_bookings`.

Suggested `trial_bookings` shape:

```text
trial_bookings
  id
  tenant_id
  bookable_program_id
  schedule_slot_id
  website_lead_id
  offer_id
  entry_point_id
  parent_name
  athlete_name
  email
  phone
  status        -- BOOKED / CANCELLED / SHOWED / NO_SHOW / CONVERTED
  booked_at
  cancelled_at
  source        -- website / staff / import / admin
  metadata jsonb
  created_at
  updated_at
```

Free-trial flow without GHL:

1. Website asks our API for availability.
2. API reads internal `schedule_slots` for the relevant `bookable_program_id` and
   trial booking kind.
3. Parent chooses a slot.
4. API saves `website_leads`, locks the slot, checks capacity, and inserts
   `trial_bookings`.
5. Portal calendar reads `schedule_slots` plus `trial_bookings`.
6. Post-trial form updates `trial_bookings.status`.
7. Checkout/conversion creates or updates `members`, `customer_entitlements`, and
   downstream payment state.

The staff calendar should eventually show both:

- member bookings: `schedule_slots + reservations`
- trial bookings: `schedule_slots + trial_bookings`

## Scheduling Ownership Split (Luka / Zoran)

The dividing line is read vs write on `schedule_slots`. Zoran owns the sales,
marketing, onboarding, and coach-facing surfaces. Luka owns every write path that
consumes a slot's capacity, because paid reservations and free-trial bookings share
one capacity pool (see `trial-calendars-confirmed-decisions.md`, decisions 4 and 5:
`spots_left = capacity - (confirmed reservations + active trial_bookings)`).

Rule for Zoran's surfaces: read availability and call Luka-owned RPCs. Never
`INSERT`/`UPDATE` `schedule_slots`, `reservations`, or `trial_bookings` directly.
If two code paths write occupancy independently, they overbook. One capacity gate,
one owner.

On Luka's plate first, before Zoran builds on top:

1. Slot generation RPC (`slot_templates` -> `schedule_slots`). The coach template UI
   calls it; it does not insert slots.
2. Shared capacity accounting in ONE place. The existing member booking RPC
   (`0005`) counts only `reservations` today; its capacity check must also count
   active `trial_bookings` once trials go live, or members will overbook past
   trials.
3. `trial_bookings` table + conversion lineage (`converted_member_id`,
   `converted_membership_id`, `converted_at`). Not in prod yet. Luka defines the
   slot-consuming shape; Zoran's sales columns (`website_lead_id`, `status`,
   `source`, etc.) ride along.
4. Transaction-safe trial booking RPC that locks the slot row, counts
   `reservations` + `trial_bookings`, and inserts only if capacity remains. Zoran's
   trial funnel calls it.
5. Availability read endpoint returning `spots_left` computed from both tables, so
   the parent app and Zoran's website/staff calendar report the same number.

Zoran can build in parallel without waiting (does not touch slot capacity):

- Trial lead funnel + website form, post-trial `SHOWED`/`NO_SHOW` status form,
  reminders.
- Coach template authoring UI (calls the generation RPC).
- Trial-to-paid conversion orchestration: run checkout, create/find `members` +
  `academy_membership` + `customer_entitlement`, then set
  `trial_bookings.status = CONVERTED` and fill conversion lineage.

Handoff point: hand Zoran the coach-write and trial-funnel work once (a) identity +
entitlements are backfilled, (b) a real BAM GTA schedule is readable in
`schedule_slots`, (c) member booking/waitlist/cancel RPCs are in prod and proven,
and (d) the trial booking RPC + shared capacity accounting exist. Then his UIs plug
into stable, capacity-safe RPCs instead of a moving target.

## Why This Architecture Holds

The key object is `bookable_programs`.

It lets these all point to the same underlying program without forcing every
product type into one giant table:

- checkout prices
- entitlement grants
- recurring class slots
- future camps/tournaments
- website forms/calendars
- trial appointments

For the Training example:

```text
Offer: Training
Bookable Program: BAM GTA Training
Offer Options: Steady / Accelerate / Elevate / Dominate / Summer Unlimited
Entitlement Templates: 1x weekly / 2x weekly / 3x weekly / unlimited
Member Slots: schedule_slots with booking_kind MEMBER_CLASS
Trial Slots: schedule_slots with booking_kind FREE_TRIAL
Member Bookings: reservations
Trial Bookings: trial_bookings
```

This keeps operational scheduling unified while keeping lead/sales state separate
from member/credit booking state.

## Do Not Do These

- Do not treat `offers.data` JSON as the only migration source for live pricing.
- Do not delete or stop maintaining JSON content fields; keep them for Blueprint
  copy/content/flexible sections.
- Do not stuff free-trial leads into `reservations`.
- Do not make free trials require `academy_memberships` or entitlements.
- Do not add RLS policies to Luka-owned parent/runtime tables.
- Do not modify shared tables (`offers`, `offer_teams`, `pricing_catalog`,
  `entry_points`, `members`) in a way that breaks the lineage described here
  without syncing with Luka.

## Open Questions Before Building Free Trials

- Are trial calendars always tied to one `bookable_program`, or can one trial
  calendar route into multiple programs?
- Should age/group routing live on `entry_points`, `bookable_programs.config`, or
  a dedicated routing table?
- Which reminders replace GHL workflow reminders first: SMS only, email too, or
  owner notification only?

Resolved (see `trial-calendars-confirmed-decisions.md`):

- Trial and member bookings share the same slot and the same capacity pool; no
  separate trial slots, no `booking_kind`, no separate trial cap.
- Conversion lineage lives on `trial_bookings` (`converted_member_id` /
  `converted_membership_id` / `converted_at`), not `trial_booking_id` on `members`.

## Related Docs

- `bam-ghl-agent/docs/parent-app-db-boundary.md`
- `bam-ghl-agent/memories/project_offer_architecture.md`
- `bam-ghl-agent/memories/project_website_leads.md`
- `bam-ghl-agent/memories/project_website_enrollment_funnel.md`
