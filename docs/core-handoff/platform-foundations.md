---
domain: platform-foundations
review_state: ready-for-review
prototype_status: partial
core_parity: partial
last_reviewed: "2026-06-22"
prototype_commit: 2ad66575
core_commit_reviewed: "1916564"
---

# Platform Foundations: Prototype-to-Core Handoff

## Summary

- The prototype contains several Supabase-backed surfaces built independently for speed.
- `fc-core-srvc` is the production direction: multi-tenant, modular, and provider-neutral.
- Prototype implementations are not target architecture. Each durable domain needs an owner and parity review.

## References

- **Prototype:** `bam-ghl-agent/bam-portal/supabase/`, `bam-ghl-agent/bam-portal/api/`, `fc-internal-content-engine/`, `prototype/src/`
- **Core reviewed:** `docs/architecture.md`, `app/models/base.py`, `ownership.py`, `academy.py`, `location.py`, `user.py`, `customer.py`, `billing.py`, `schedule.py`, `app/modules/schedule/`
- **Schema tooling:** `bam-ghl-agent/bam-portal/scripts/migration/dump-prod-schema.mjs` snapshots the prod schema (tables, RLS, policies, functions) to `bam-ghl-agent/bam-portal/supabase/snapshots/prod-schema.sql` via the Management API. Read-only. Re-run to diff prod drift.
- **Parent app plan (fc-mobile repo):** `fc-mobile/docs/parent-app-architecture-plan.md` and `fc-mobile/docs/parent-app-decisions-log.md` record the agreed parent-domain architecture: core-shaped tables in `public` where core is already correct, plus a generic Offer entitlement model that core should converge to from its current narrow `MembershipPlan`; deny-all RLS (service-role fns + Postgres RPCs only).
- **Luka-owned parent-domain tables/projections (agents: do not modify or build on these):** `customer_profiles`, `students`, `academy_memberships`, `member_links`, `slot_templates`, `schedule_slots`, `reservations`, `waitlist_entries`, `customer_entitlements`, `credit_ledger`, `membership_change_requests`, plus parent messaging/notification tables TBD. `offer_purchase_options` is a Luka-owned projection/view over Offers + `pricing_catalog`. `membership_plans` is a superseded reserved name; do not create it unless Luka explicitly revives it. `subscriptions` is reserved but not created in v1 unless explicitly revived. `public.locations` will be additively extended toward core `Location` (shared, coordinate changes). Schedule read-model tables were introduced by `parent_0002_schedule_read_model`; booking RPCs and `credit_ledger` remain separate.
- **Offer lineage dependency:** parent `offer_purchase_options` / `slot_templates` read Business Blueprint `offers`, `offer_teams`, and `pricing_catalog` as source lineage. These are soft references (nullable ids/keys, no FK yet) because the Offer tables are still high-churn, but schema or JSON-shape changes to `offers.data.pricing.pricing_offerings` must be coordinated with Luka.

## Intended Model

| Concept | Purpose | Relationships and scope |
|---|---|---|
| Academy | Primary tenant | Owns locations and tenant-scoped data |
| Location | Operating site | Belongs to academy; scopes relevant records |
| Application identity | Real user or customer identity | Maps from auth; may relate to academies |
| Canonical domain record | Permanent product data | Provider-neutral; one domain owner |
| Integration record | Provider IDs, tokens, payloads, sync state | Maps providers to canonical records |

## Parity

| Prototype concept or behavior | Core mapping | Status | Next action |
|---|---|---|---|
| Client/business account | `Academy` / `core_tenancy` | `decided` | `clients` IS the academy/tenant; one row per GHL sub-account; `ghl_location_id` is the join key. New parent-domain tables carry `tenant_id REFERENCES clients(id)`. Core `academies` gets seeded from `clients` at cutover. |
| Multi-location data | `Location` / `core_tenancy` | `partial` | A `locations` table exists in prod with no DDL in repo; inspect before parent-domain port |
| Staff, client, member identities | Core users, customers, students, memberships | `decided` | `members` stays staff-only (children/athletes). Parent app adds core-shaped `customer_profiles` (parent, keyed by `supabase_user_id`), `students`, `academy_memberships` in `public` (deny-all RLS), bridged 1:1 to `members` via a `member_links` table (match metadata: email/phone/manual). No `auth_user_id` column on `members`. **Landed as migration `parent_0001_identity_and_member_links`** — DDL pg_dumped from core `customer.py` @ `1916564`, core constraint/index names verbatim. Deviations: TEXT+CHECK for `profile_type`/`status` (core enum spellings), `academy_id → clients(id)` (retargeted to `academies` at cutover), legacy `plan_id` nullable no-FK and should not be used for new access modeling, `invited_by` nullable no-FK (no core `users` here), `DEFAULT gen_random_uuid()` on ids (core generates ids in Python; additive). Purchased access now belongs in many `customer_entitlements` rows per membership/customer/student. |
| Feature-created tables | Domain-owned models | `missing` | Assign each durable concept an owner |
| Direct Supabase access | Owning module service/API | `partial` | Parent domain: all access via service-role Vercel fns + Postgres RPCs; frontend-direct access stays staff-side only |
| Parent schedule read model | Core schedule models | `partial` | `slot_templates`, `schedule_slots`, `reservations`, and `waitlist_entries` landed as parent `0002` in `public` with deny-all RLS. Deviations from core: `tenant_id → clients(id)`, instructor UUIDs have no FK until staff/user mapping is settled, Offer lineage is soft. Time model: template times are academy-local wall-clock rules via `clients.time_zone`; materialized slots are absolute `timestamptz` instants. Read-only parent APIs exist; production tables have 0 rows as of 2026-06-20. Booking RPCs and credit ledger are still pending. |
| Provider-specific product data | Canonical Offer/OfferPrice plus integration mapping | `partial` | Parent-app `offer_purchase_options` become the regenerable Offer-price projection: Business Blueprint `offers.data.pricing.pricing_offerings` + `pricing_catalog` canonical Stripe/CoachIQ mapping. Actual granted access lives in `customer_entitlements`; credit movement lives in `credit_ledger`. `pricing_catalog` now has confirmed rows with `offer_id`, `offer_price_key`, and `stripe_price_id`; Offers still lack structured entitlement-template fields. Lineage columns are soft references for now, but core should eventually adopt them because Offers are the FC product direction. |
| Manual SQL files | Alembic migrations | `partial` | Parent-domain tables use Supabase CLI migrations (`bam-ghl-agent/bam-portal/supabase/migrations/`, handwritten, applied via linked-project flow) that become the core alembic migrations at adoption. After the 2026-06-20 repair, local `supabase db reset` replays. Do not casually run `migration fetch --linked`; fetch only from a clean worktree, preserve local replay guards, and use `migration repair --status applied` for historical backfills that already exist in prod. |
| RLS and authorization | Core tenant and authorization controls | `decided` | Parent-domain tables (in `public`): RLS enabled, zero policies (deny-all, service-role only). Staff tables prod-verified 2026-06-11 via MCP: clients/members/offers/locations/tickets/conversations already use `is_staff()`/`my_client_ids()` predicates. The remaining authenticated-as-staff holes (`staff` + `website_leads` read, `portal_feedback` FOR ALL true, `sm_*`/`guide_cards` read) were swapped to `is_staff()` in migration `rls_staff_predicate_swap` (this PR; verified safe — all staff rows have `user_id` linked, invite flow links at creation, client portal/API paths unaffected). Still open, internet-exposed regardless of parents: anon FOR ALL on board_items + 4 deprecated content_* + 3 playground_* tables, `onboarding_reloaded` anon write, public-read resources trio, 5 listable public buckets, SECURITY DEFINER fns executable by anon (verify internal auth checks). Parents get `app_metadata.role='parent'`; parent-JWT canary must read zero staff rows before first real parent registers. |
| Prod schema drift | Alembic-managed schema | `partial` | `dump-prod-schema.mjs` snapshot committed to repo; re-run regularly to make MCP-driven drift diffable |

## Decisions And Shortcuts

| Item | Reason | Core impact or replacement |
|---|---|---|
| Resources library writable by content team (2026-06-14) | Content team was blocked by admin-only RLS on the resource trio | Additive RLS fn `is_resource_editor()` (admin + marketing roles) for INSERT/UPDATE on resources/resource_files/resource_categories + `resources` storage bucket; DELETE stays admin. Core: model a "content editor" permission on the content-library module. fc-core review deferred (repo not reachable this session). |
| Migration history repair and local replay (2026-06-20) | Fetched remote migration history had drifted from checked-in files and local replay fixes | Reconciled fetched remote timestamps, removed rounded-timestamp duplicates, kept redacted Slack SQL and guarded `entry_points`, marked historical local backfills applied remotely, and verified local reset. Core impact: parent-domain SQL is now locally replayable again, making rehearsal/testing practical. |
| Parent schedule read model applied (2026-06-20 refresh) | Read-only parent Home/Classes needed real API-backed data before booking | Schedule read tables and `/api/parent/schedule/*` reads exist; production data remains empty. Core impact: schedule table shape is now the adoption target, while booking/credit behavior still needs RPC parity with core service semantics. |
| Generic Offer entitlement model (2026-06-22) | Offers include camps, tournaments, leagues, teams, and rentals, not only recurring memberships | Supersedes `membership_plans` as the runtime concept. `offer_purchase_options` is a projection/view, `customer_entitlements` is the base table for granted access, and `credit_ledger` applies only to credit-bearing entitlements. Long-term core should normalize operational Offer pricing into typed tables (`offer_options`, `offer_prices`, `entitlement_templates`) while leaving Blueprint copy/content flexible. |
| Core is direction, not compatibility target | Prototype is intentionally ahead | Adopt clean concepts, not implementation details |
| Keep current prototype stack | Faster product learning | Handoffs describe production boundaries |
| Direct Supabase access and separate SQL files | Fast iteration | Replace with owned services and migrations |

## Open Decisions

- ~~When does prototype `client` mean core `Academy`?~~ Decided 2026-06-11: always; see Parity table.
- ~~How do prototype staff, clients, parents, members, and students map to core identities?~~ Decided 2026-06-11 for the parent side: see Parity table. Staff/users mapping still open.
- ~~Where should production authorization be enforced?~~ Decided 2026-06-11 for the parent domain: service-role fns + deny-all RLS on the parent-domain tables in `public`; staff-side stays RLS with real predicates.
- Which new core modules own marketing, content, training, and support?
- Parent messaging thread shape (three-way collision: portal `conversations`/`messages`, core conversations module, PRD 21 parent thread) is still undecided.
- Sibling Stripe model: `members.stripe_customer_id` is per-child but PRD 16 treats payment method as per-parent; confirm how sibling billing works in Stripe today.
- Production parent data path: `members` is empty while `members_staging` has 56 rows; parent registration/linking needs Sorter promotion or an equivalent controlled import before real parents can see linked children.
- Production schedule seed/import path: parent schedule read tables are empty in prod; define whether staff publishing, timetable import, or Offer schedule projection creates first rows.
- Website checkout lineage: checkout-created `members` should persist `offer_id` / `offer_price_key` to match Sorter-promoted members before parent profile/billing reads depend on lineage.
