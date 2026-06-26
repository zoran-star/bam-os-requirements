# Parent App DB Boundary — Conflict Check Doc

**For agents:** before making schema changes (new tables, columns, RLS, functions, drops/renames),
diff your plan against the lists below. If anything overlaps → **stop and tell Zoran to message Luka.**

Owner: Luka (fc-mobile parent app backend). Last updated: 2026-06-25.
Full context: [`fc-mobile/docs/parent-app-architecture-plan.md`](../../../fc-mobile/docs/parent-app-architecture-plan.md)
and [`fc-mobile/docs/parent-app-decisions-log.md`](../../../fc-mobile/docs/parent-app-decisions-log.md).

---

## 🔴 Luka's tables — do not create, modify, or build on these yet

**Exist now / arriving via `bam-portal/supabase/migrations/`:**

| Status | Tables |
|---|---|
| Applied (identity) | `customer_profiles` · `students` · `academy_memberships` · `member_links` |
| Applied (schedule read model) | `slot_templates` · `schedule_slots` · `reservations` · `waitlist_entries` |
| Applied (commerce/credits runtime) | `offer_options` · `offer_prices` · `entitlement_templates` · `customer_entitlements` · `credit_ledger` |
| Planned (access spine before booking) | `bookable_programs`; `bookable_program_id` columns on `offer_options`, `entitlement_templates`, `slot_templates`, and `schedule_slots` |
| Planned (booking writes) | booking/waitlist/cancel RPCs |
| Not in v1 unless explicitly revived | `subscriptions` |
| Planned (later) | `membership_change_requests` · parent messaging/notification tables (names TBD) |

⚠️ These names are **reserved even before the tables/projections exist** — creating one of
these names is itself a conflict. `offer_purchase_options` is reserved as a possible
parent API/view/projection name, not as the phase-one source table. `membership_plans`
is a superseded reserved name; do not create it unless Luka explicitly revives it.

All table names above: deny-all RLS (no policies, service-role only). Don't add policies to them.
Booking/waitlist/cancel RPCs are also Luka-owned; coordinate before adding or changing them.

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
| `device_tokens` | Reused as-is for parent push | schema change |
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

Next agreed parent schema slice: add `bookable_programs` as the thin access target
for things like BAM GTA Training, Summer Camp 2026, or a future tournament. Offers
and entitlements will point to a program, and schedule templates/slots will point to
the same program. This is the booking eligibility spine; do not build a competing
program/event/access table without syncing with Luka.

MVP simplification rules:
- No `entitlement_template_program_grants` or `customer_entitlement_program_grants`
  bridge tables until one entitlement must grant multiple programs.
- No `training_programs`, `camp_programs`, or `tournament_programs` subtype tables
  until those verticals need real type-specific fields.
- Classes remain `schedule_slots`-first; shop/offers pages can query
  `offer_options` + `bookable_programs` + price summaries.

Long-term ideal: operational pricing should graduate from JSON into typed Offer runtime
tables such as `offer_options`, `offer_prices`, and `entitlement_templates`, while flexible
Blueprint copy/content remains JSON. Parent V1 creates that typed runtime shape now and
links it back to Business Blueprint later.

---

## When in doubt

Message Luka. A 2-minute sync beats a broken parent app or a blocked staff feature.
