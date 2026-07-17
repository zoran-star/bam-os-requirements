# Parent App DB Boundary

## Start Here

If you are trying to understand the parent app / Offer runtime architecture,
checkout cutover, or future free-trial scheduling shape, read
[`parent-app-architecture-handoff.md`](parent-app-architecture-handoff.md).

If you are about to change schema, migrations, RLS, functions, or shared table
semantics, this is the guardrail doc to read first. If you are doing Phase 5/6
cutover work (checkout/webhook/members/sorter -> typed runtime), also read
[`parent-runtime-cutover-guardrails.md`](parent-runtime-cutover-guardrails.md).

**For agents:** before making schema changes (new tables, columns, RLS, functions, drops/renames),
diff your plan against the lists below. If anything overlaps → **stop and tell Zoran to message Luka.**

Owner: Luka (fc-mobile parent app backend). Last updated: 2026-07-14.
Original planning context lives in `fc-mobile/docs/parent-app-architecture-plan.md`
and `fc-mobile/docs/parent-app-decisions-log.md`, which may not be available to
all BAM Portal agents.

---

## 🔴 Luka's tables — do not create, modify, or build on these yet

**Exist now / arriving via `bam-portal/supabase/migrations/`:**

| Status | Tables |
|---|---|
| Applied (identity) | `customer_profiles` · `students` · `academy_memberships` · `member_links` |
| Applied (schedule read model) | `slot_templates` · `schedule_slots` · `reservations` · `waitlist_entries` |
| Applied (commerce/credits runtime) | `offer_options` · `offer_prices` · `entitlement_templates` · `customer_entitlements` · `credit_ledger` |
| Applied (access spine before booking) | `bookable_programs`; `bookable_program_id` columns on `entitlement_templates`, `customer_entitlements`, `slot_templates`, and `schedule_slots` via `20260626030258_parent_0004_bookable_programs_access_spine.sql` |
| Applied 2026-07-02 (booking writes + shared capacity) | booking/waitlist/cancel/leave-waitlist RPCs (`0005`), rewired through `slot_spots_taken` (`20260702115745`) - the single capacity source of truth |
| Applied 2026-07-02 (trials) | `trial_bookings` table + `book_trial_slot` / `cancel_trial_booking` / `reschedule_trial_booking` / `set_trial_outcome` RPCs (`20260702115748`) |
| Applied 2026-07-02 (staff ops) | `staff_cancel_slot` RPC (`20260702115746`, extended by `115748` to cancel trials) |
| Applied 2026-07-02 (credit engine, live behind gate) | `apply_stripe_credit_grant` / `expire_lapsed_credit_entitlements` (`20260702115747`); offer tie-in activated webhook grants behind `clients.credit_engine_enabled` and registered the expiry sweep cron |
| Applied 2026-07-02 (guards) | identity-spine uniqueness guards (`20260702115744`) on top of the runtime guards (`20260701161000`) |
| Deployed 2026-07-02 (API layer) | `/api/runtime/*` (staff schedule CRUD, generate-slots, calendar, diagnostics, offers read), `/api/website/trial-slots` + `/api/website/trial-booking`, parent availability alignment - merged via PR #1020, live on Vercel |
| Applied 2026-07-03 (parent messaging baseline) | `customer_message_threads` · `customer_thread_messages` · `customer_thread_reads` + `customer_send_thread_message` RPC (`20260703020000`) |
| Implemented locally 2026-07-14 (parent push foundation; deployment pending) | `parent_notification_events` · `parent_notification_preferences` · `parent_notification_deliveries` + parent Expo metadata on shared `device_tokens` (`20260714043304`) |
| Not in v1 unless explicitly revived | `subscriptions` |
| Planned (later) | `membership_change_requests` · additional parent notification event producers · SMS delivery worker |

⚠️ These names are **reserved even before the tables/projections exist** — creating one of
these names is itself a conflict. `offer_purchase_options` is reserved as a possible
parent API/view/projection name, not as the phase-one source table. `membership_plans`
is a superseded reserved name; do not create it unless Luka explicitly revives it.

All table names above: deny-all RLS (no policies, service-role only). Don't add policies to them.
All RPCs above are Luka-owned; coordinate before adding or changing them. As of
2026-07-02 the booking/trial/capacity/credit RPCs ARE applied to production
(migrations `20260702115744`-`20260702115748`).

Offers tie-in exception (2026-07-02): Zoran owns the Phase 6.8 offers sync
write path for `offer_options` / `offer_prices` / `entitlement_templates`,
under the pattern conditions in
[`parent-runtime-cutover-guardrails.md`](parent-runtime-cutover-guardrails.md)
("Offers tie-in" section) and with Luka review of the RPC/migration. All other
Luka-owned tables keep the default rule.

### What Zoran's surfaces may do, starting now

- ✅ CALL the RPCs via service role: `book_trial_slot`, `cancel_trial_booking`,
  `reschedule_trial_booking`, `set_trial_outcome`, `staff_cancel_slot`,
  `parent_book_slot` family. They are transaction-safe and enforce capacity.
- ✅ READ availability - but the number must come from `slot_spots_taken` (or a
  Luka API that uses it). Never compute spots from your own counts.
- ⛔ Never `INSERT`/`UPDATE`/`DELETE` `schedule_slots`, `reservations`,
  `waitlist_entries`, or `trial_bookings` directly. One capacity gate, one owner.
- ⛔ Do not hand-call the credit engine RPCs
  (`apply_stripe_credit_grant`, `expire_lapsed_credit_entitlements`) as an ad
  hoc production fix. Use the Stripe webhook path, scheduled expiry sweep, or
  protected reconcile/repair endpoint.
- ⚠️ Creating slots (templates + generation) is a Luka-owned write path. Use
  the staff endpoints (`POST /api/runtime/schedule/templates` +
  `POST /api/runtime/schedule/generate-slots`, staff Bearer auth) - never
  insert `schedule_slots` rows directly.

### If you ship a stopgap implementation instead

If timing forces a parallel implementation, keep the later migration cheap:

- use non-reserved table names (prefix them, e.g. `zs_`),
- no RLS policies that grant plain `authenticated` (parents hold real JWTs),
- if your stopgap represents the same real-world sessions, still read capacity
  through `slot_spots_taken` where slots exist, and
- keep GHL (or your stopgap store) the clear source of truth for its own data,
  so migrating to the runtime tables later is a one-way backfill, not a merge.

---

## 🟡 Shared tables — Luka reads/references these; changes here need a sync

| Table | How the parent app uses it | Conflict if you… |
|---|---|---|
| `clients` | Every parent table FKs `tenant_id → clients(id)` | change PK, archive/merge rows, rename table |
| `members` | Read-only; `member_links` FKs `members(id)`; matching uses `email_norm` + parent phone/email columns; future profile/billing reads may use `offer_id` / `stripe_price_id` lineage | rename/drop table or those columns, change `email_norm` semantics, re-import with new ids, omit lineage for checkout-created members |
| `members_staging` → promote | Registration matching waits on Sorter Steps 3–4 promote; 56 rows staged and `members` empty as of 2026-06-20 | change what promote writes into `members` |
| `offers` | Long-term lineage target for parent `offer_options` / `offer_prices` and schedule templates. Phase-one parent runtime can leave this unlinked. | reshape `data.pricing.pricing_offerings`, change archive semantics, regenerate ids, remove pricing/schedule sections |
| `offer_teams` | Future Team offers may link schedule/templates or parent runtime options to specific team rows via soft lineage. Phase one can leave this unlinked. | reshape team row identity/data semantics, regenerate ids |
| `pricing_catalog` | Long-term lineage target for parent `offer_prices` through confirmed Stripe/CoachIQ mappings. Phase-one parent runtime can leave this unlinked. | change `match_status` values/semantics, remove `offer_id` / `offer_price_key`, change canonical price tier semantics |
| `locations` | Will be **additively extended** (new nullable columns) toward core `Location` | drop/rename existing columns |
| `device_tokens` | Shared by client-portal APNs and parent Expo push; `app_scope` + `token_provider` isolate the paths | schema change, policy change, or sender query that omits scope/provider |
| **Auth (whole project)** | Parents will register as Supabase auth users; `app_metadata.role='parent'` stamped at registration | logic assuming every auth user is staff/client |

---

## 🛑 RLS rule that protects everything

Parents will hold real JWTs in this project. **Any new table with a policy like
`auth.role() = 'authenticated'` is readable by parents via PostgREST.**

→ New staff-side tables must use `is_staff()` / `my_client_ids()` predicates (or no policies +
service-role API access). Never plain `authenticated`.

(2026-06-12: `staff`, `website_leads`, `portal_feedback`, `sm_*`, `guide_cards` were already
swapped to `is_staff()` — migration `20260612012656`. Staff behavior unchanged.)

---

## ✅ Always fine — no sync needed

- New columns on PM-owned tables not listed above (tickets, marketing, content, training…)
- New tables with non-reserved names + proper staff RLS predicates
- Routine data changes outside Luka's tables that do not alter the shared-table semantics above
- Keep applying changes via MCP `apply_migration` as usual — Luka's tooling picks them up

## Offer runtime fields needed before parent booking

Before parent booking can debit/refund credits, each parent-visible price needs structured
fields that define what the parent can buy and what access it grants. In phase one these
fields live in Luka-owned `offer_options`, `offer_prices`, and `entitlement_templates`.
They do not need to be linked to `offers`, `offer_teams`, or `pricing_catalog` yet.

Examples:
- 1x/week plan → 1 credit per week
- 2x/week plan → 2 credits per week
- Unlimited plan → unlimited bookings
- Session pack → fixed number of credits, with optional expiry
- Camp / clinic → event registration for one student
- Tournament → team or individual registration
- Rental → rental booking window

Marketing copy is not enough. The booking system needs exact values for credits, periods, unlimited access, and eligibility rules.

As of 2026-06-25, migration `20260625011719_parent_0003_offer_runtime_entitlements.sql`
has created these parent-owned runtime tables in prod. Prod verification confirmed
RLS enabled, zero policies, and zero rows. Local development seeds include BAM GTA
`offers`, `offer_teams`, and `pricing_catalog` mirrors plus synthetic parent runtime
rows for API/mobile testing.

Current implementation direction: do not change `offers`, `offer_teams`, or
`pricing_catalog` to get parent V1 running. Actual access is stored in
`customer_entitlements`; credit balances are derived from `credit_ledger`.

Applied parent schema slice: `20260626030258_parent_0004_bookable_programs_access_spine.sql`
adds `bookable_programs` as the thin access target for things like BAM GTA Training,
Summer Camp 2026, or a future tournament. Entitlement templates/customer entitlements
and schedule templates/slots point to the same program. This is the booking
eligibility spine; do not build a competing program/event/access table without
syncing with Luka. `offer_options.bookable_program_id` is deliberately deferred; shop
or listing views can derive the program through `offer_prices -> entitlement_templates`
until there is a concrete need for a direct grouping FK.

Booking-write status update (2026-07-02): the `0005` booking slice IS now applied
to production, rewired so every capacity check goes through `slot_spots_taken`
(which counts CONFIRMED reservations + BOOKED trial bookings). Waitlist promotion,
slot-first locking, sanitized errors, and the review follow-ups described in the
git history all shipped with it. The Vercel/mobile API wiring merged to main and
deployed 2026-07-02 (PR #1020).

SCHEDULING IS LIVE (2026-07-02, later the same day): Zoran created the real BAM
GTA schedule through the staff endpoints (4 slot_templates, 86 schedule_slots
through ~Aug 31, capacity 12) and flipped GTA to `clients.booking_provider =
'portal'`. Website trial bookings, agent booking, the staff Calendars tab, and
post-trial outcomes all run on this spine via the RPCs (see
`memories/project_calendars_offghl.md`). Real trial bookings exist - treat
`trial_bookings` and `schedule_slots` as live production data. The
identity/runtime backfill is also live (rechecked 2026-07-08: 38 profiles, 41
students, 41 memberships, 40 member_links, 31 offer_prices, 71 entitlements, 36
credit_ledger rows). No parent profiles are claimed yet (`supabase_user_id` /
`claimed_at` are 0). Parent-app member booking (`reservations`) is not launched
yet.

MVP simplification rules:
- No `entitlement_template_program_grants` or `customer_entitlement_program_grants`
  bridge tables until one entitlement must grant multiple programs.
- No `training_programs`, `camp_programs`, or `tournament_programs` subtype tables
  until those verticals need real type-specific fields.
- Classes remain `schedule_slots`-first; shop/offers pages can query
  `offer_options` + `offer_prices` + `entitlement_templates` + `bookable_programs`
  when they need program grouping.

Long-term ideal: operational pricing should graduate from JSON into typed Offer runtime
tables such as `offer_options`, `offer_prices`, and `entitlement_templates`, while flexible
Blueprint copy/content remains JSON. Parent V1 creates that typed runtime shape now and
links it back to Business Blueprint later.

---

## When in doubt

Message Luka. A 2-minute sync beats a broken parent app or a blocked staff feature.
