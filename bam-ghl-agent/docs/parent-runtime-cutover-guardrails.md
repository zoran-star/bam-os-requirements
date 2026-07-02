# Parent Runtime Cutover - Guardrails For Agents

Owner: Luka. Audience: Zoran's agents doing Phase 5/6 cutover work (checkout,
offers, webhook, members billing, sorter -> typed runtime tables).
Last updated: 2026-07-02

Read this BEFORE writing any cutover code. The full plan with per-endpoint
target behavior and acceptance criteria is
[`parent-runtime-api-wiring-plan.md`](parent-runtime-api-wiring-plan.md); the
table-ownership rules are
[`parent-app-db-boundary.md`](parent-app-db-boundary.md). This doc is the short
list of invariants that keep your work compatible with the architecture. If a
task seems to require breaking one, stop and ask Luka - every one of these
exists because of a concrete failure mode.

## The invariants

1. **Typed runtime rows are operational truth.** Checkout, access, credits, and
   booking eligibility resolve through `offer_options` / `offer_prices` /
   `entitlement_templates` / `customer_entitlements` / `credit_ledger`.
   `offers.data` JSON stays for copy/media/intake/workflow content only - never
   read pricing from it in a new code path. `pricing_catalog` stays the
   Stripe/CoachIQ provider mapping - never infer what a price GRANTS from it.

2. **Access is granted only after money moves.** Entitlements activate on paid
   invoices (webhook), never on `customer.subscription.created`, never from raw
   Stripe price events, never at checkout-submit time. Unpaid/incomplete
   checkout must never produce a bookable member.

3. **Every member-minting path ends with a consistent spine.** members +
   customer_profiles + students + academy_memberships + member_links +
   customer_entitlements (+ credit_ledger when credits move) - all or nothing.
   Use the `api/_runtime/` helpers (`ensureIdentitySpineFromMember`,
   `grantOrSyncEntitlementFromOfferPrice`, ...); do not hand-roll identity
   writes. The helpers are idempotent and race-safe; hand-rolled inserts are
   not.

4. **Idempotency lives in the database, not in app logic.** Unique guards exist
   for entitlement source_refs, Stripe credit grants, EXPIRE rows, generated
   slots, identity rows. New sync paths must survive being run twice
   (webhook retries, concurrent deliveries). If your new write path has no
   DB-level guard, that is a design gap - add one (via Luka for his tables).

5. **`source_ref` conventions are load-bearing.** Credit grants:
   `invoice_line:<id>`. Booking debits/refunds: `reservation:<id>`.
   Entitlements: granularity is an OPEN LUKA DECISION that blocks Phase 6.0 -
   do not pick one ad hoc.

6. **Webhook rules (Phase 5).** The access-sync path must return 5xx on failure
   so Stripe retries (the current webhook's return-200-on-error pattern is NOT
   acceptable for multi-write sync). Stripe does not guarantee event order:
   re-fetch current subscription/invoice state before applying downgrades.
   Resolve prices authoritatively via `offer_prices.stripe_price_id`; stamped
   metadata is diagnostic only.

7. **Capacity math has one source.** `slot_spots_taken` /
   `slot_spots_taken_bulk` (SQL). Never count reservations/trial_bookings in
   app code, never store spots_left. This is already live traffic - GTA website
   trials book against it.

8. **Scheduling writes go through RPCs/endpoints only.** No direct
   INSERT/UPDATE/DELETE on `schedule_slots`, `reservations`, `trial_bookings`,
   `waitlist_entries` - including "quick fixes" and test cleanup in prod.

9. **The credit engine is dormant until Phase 6 activation.** Do not call
   `apply_stripe_credit_grant` / `expire_lapsed_credit_entitlements` or wire
   the reconcile endpoint into webhook/cron. Activation is a deliberate cutover
   step with its own checklist (grant amounts need the Stripe interval check
   first). Weekly-credit prices must stay gated out of any checkout cutover
   until the engine is activated.

10. **Deny-all RLS stays deny-all.** No policies on parent/runtime tables, and
    no new staff tables with plain `authenticated` policies (parents hold real
    JWTs in this project).

## Code conventions for new cutover work

- **New API code is TypeScript.** The toolchain (tsc, eslint, vitest) already
  covers `api/_runtime`, `api/runtime`, `api/parent`, and the TS website
  endpoints - put new endpoints there in TS, not new `.js` files. The plain
  `.js` files under `api/` are legacy: not typechecked, not linted, not
  tested.
- **Converting existing JS to TS**: do it when that route's cutover already
  rewrites it substantially - not as drive-by refactors of live files, and
  never mixed into a behavior-change commit (conversion commit and behavior
  commit stay separate so diffs are reviewable). Never keep parallel TS and JS
  copies of the same logic.
- **Reuse the shared modules instead of copying.** Staff auth =
  `api/runtime/_staff-context.ts`; identity/entitlement/credit writes =
  `api/_runtime/*` helpers; sanitized errors = the `_errors` pattern; Sentry =
  `withSentryApiRoute`. The allowed-origins gating snippet already exists in
  three copies (`website/offer.js`, `website/availability.js`,
  `runtime/offers.ts`) - if you need it again, extract a shared helper rather
  than minting a fourth copy.
- **Anything touching runtime tables ships with tests** in the
  `npm run test:runtime` suites (vitest against local Supabase; handler-
  invocation and RPC patterns are established in `api/runtime/*.test.ts`).
  Gate on: `supabase db reset` + `npm run test:runtime` + `npx tsc --noEmit` +
  the scoped eslint.
- **Local dev lane**: `npx tsx scripts/local-api-dev.mjs` serves the real
  handlers on :3000 (`vercel dev` cannot run this project - function-count
  cap). It caches modules: restart it after editing anything under `api/`.

## Migration workflow (this bit us on 2026-07-02)

The file version committed to git MUST equal the version recorded in the
production migration history. If you apply via MCP `apply_migration`, commit
the file named with the exact version the MCP recorded - not a hand-rounded
timestamp. Never commit two files with the same version. After any migration
work, run `supabase migration list` from `bam-portal/` and confirm every row
has both columns filled; a one-sided row means drift that will break local
replay or double-apply on the next `db push`. Migrations touching Luka-owned
tables (boundary doc list) need Luka review before applying anywhere.

## Offers tie-in (Phase 6.8) - agreed split, 2026-07-02

Overarching shape: Business Blueprint (`offers.data`) stays the flexible
copy/content layer; the sync step derives TYPED runtime rows (`offer_options`,
`offer_prices`, `entitlement_templates`) from JSON pricing plus confirmed
`pricing_catalog` mappings; checkout and access then resolve only through the
typed rows. Tying offers in = building that sync + review path, not teaching
checkout to read JSON.

1. **Zoran owns the offers sync endpoint** (e.g. `POST /api/runtime/offers/sync`)
   - Luka-approved exception to the usual "Luka builds writers for his tables"
   split, CONDITIONAL on following the established patterns:
   - writes go through a transaction-safe SQL RPC (or service-role upserts
     that target the existing unique guards), idempotent and rerun-safe,
     mirroring the style of `book_trial_slot` / the guards migrations;
   - link lineage properly: `offer_prices.source_pricing_catalog_id`,
     `source_offer_id` / `source_offer_price_key`, `entitlement_templates`
     one-ACTIVE-per-price (the unique guards enforce this - work with them,
     not around them);
   - NEVER hard-delete typed rows that active `customer_entitlements` point
     at - archive/deactivate (`status='ARCHIVED'`, `is_active=false`);
   - no browser-side Supabase writes to these tables - server/RPC only;
   - Luka reviews the RPC/migration before it lands (it lives in his table
     domain even though Zoran builds it).

2. **Entitlement semantics are explicit input, never inferred.** What a price
   grants (N credits per period, unlimited, session pack, event registration)
   must come from a human- or agent-CONFIRMED rule captured in the Blueprint
   pricing UI or the sync review step, and written to `entitlement_templates`
   fields/config. Deriving it from price names, amounts, `pricing_catalog`,
   or Stripe metadata is forbidden. Zoran's entitlement agent may propose;
   a confirmation step must approve before the template goes ACTIVE. A price
   with no confirmed entitlement rule must not become routable.

3. **Hard prerequisites before checkout sells typed prices** (offer PAGE reads
   are fine to cut over first - read-only):
   - the Phase 5 webhook access-sync consumer exists and is proven (paid
     invoice -> entitlement activation), BEFORE the checkout producer changes;
   - Luka's entitlement `source_ref` granularity decision has landed;
   - weekly-credit prices stay hidden/gated until the credit engine is
     activated with real grant amounts.
   Treat all three as blocking, not advisory.

## Stop-and-ask-Luka gates

- Anything on the reserved/Luka-owned table list in the boundary doc.
- Entitlement `source_ref` granularity, cancel/period-end access policy,
  plan-change credit policy (all Open Decisions in the wiring plan).
- Activating the credit engine or webhook access sync in production.
- Cutting over `api/website/checkout.js`, `api/members.js` billing actions, or
  sorter promotion behavior (low-traffic window + Luka sign-off per the plan's
  cutover guidance).
- Deleting/archiving typed runtime rows that active members point at
  (archive/deactivate instead - never delete).

## Accepted risks (Luka-approved 2026-07-02, revisit later)

- Public lead/booking endpoints use a global origin allow-list and trust
  `client_id` from the body (cross-tenant capacity griefing is possible from
  any allowed origin). Accepted for now; scope origin -> client when convenient.
- Trial cancel/reschedule verifies parent_email match only. Accepted until
  parents exist as Supabase auth users (registration/claim flow), then move to
  authenticated or signed-link cancellation.

## Known follow-ups (Zoran-side, not blocking)

- Latent GHL-config gates: `api/website/leads.js` portal booking still sits
  inside the `ghl_location_id` gate; `api/agent-approvals.js` confirm-book and
  `api/ghl/post-trial.js` require a GHL token before checking
  `booking_provider='portal'`. Harmless for GTA (has GHL config); fix before
  onboarding a portal academy without GHL.
- `entry_points.bookable_program_id` linkage (shared-table sync with Luka).
- Delete the monthly slot-extend Routine once Luka ships the native cron.
