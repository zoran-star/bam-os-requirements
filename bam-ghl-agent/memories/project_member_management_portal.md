---
name: Member Management → Client Portal
description: 2026-05-20 — incorporating the BAM GTA member-management system into the client portal as a client-side "Members" feature. Stripe model = Connect. Phases 1a/2a/2b done — Members tab built end to end; schema SQL not yet run. Resume via /member-management-continue.
type: project
---

## What this is

Taking the BAM GTA member-management system (a proven, working setup) and
building it into the BAM client portal as a first-class **client-side
"Members" feature** — so any academy owner manages their own athlete roster
+ billing from inside `client-portal.html`.

Session started 2026-05-20, named "MEMBER MANAGEMENT". Paused for a computer
restart. Resume via the `/member-management-continue` slash command.

## The blueprint — BAM GTA

`/Users/zoransavic/BAM GTA/` is a SEPARATE project (its own CLAUDE.md +
`memories/`, NOT a git repo). It automates BAM's own GTA basketball academy:

- **Supabase** project `oatwstyzxreujgsbmaxr` — tables: members,
  cancellations, referrals, refunds + bot tables (staff_whitelist,
  conversations, pending_actions, audit_log).
- **10 Claude skills** staff run from terminal: /info /list /pause /unpause
  /cancel /refund /change /payment-link /refer (+ /startup /exit).
- **Discord bot "bambot"** — Supabase Edge Function exposing the same skills
  via natural language. Phases 0-3 done, Phase 4 next. STAYS RUNNING for GTA
  — the portal is an ADDITIONAL surface, not a replacement.
- Locked Stripe conventions in `BAM GTA/memories/stripe-conventions.md`:
  trial_end-everywhere (NO pause_collection), 720-day cap for indefinite
  pause, package→monthly auto-rollover, orphan-draft void.

To resume, read `BAM GTA/CLAUDE.md` + `BAM GTA/memories/` — especially
schema-decisions.md, stripe-conventions.md, plans-and-pricing.md,
project-state.md.

## Decisions LOCKED this session

1. **Goal = client-side feature.** Academy owners get a "Members" tab in the
   client portal to manage their own roster + billing
   (pause/unpause/cancel/refund/change/refer).
2. **Data home = migrate into the portal Supabase** (`jnojmfmpnsfmtqmwhopz`),
   every table scoped per client via a `client_id` FK → `clients`.

## Corrected architecture

"Members" = the academy's ATHLETES (a paying roster), NOT the client's own
subscription to BAM. Each member has their OWN Stripe customer +
subscription, living in the ACADEMY's Stripe account.

```
PORTAL Supabase (jnojmfmpnsfmtqmwhopz)
  clients           ← academy businesses (BAM GTA = one row)
  members      NEW  ← athletes · client_id FK · own Stripe cust+sub
  cancellations NEW · referrals NEW · refunds NEW · client_id FK
  member_audit_log NEW
```

## Stripe access — DECIDED: Stripe Connect

Decision (2026-05-20): **Stripe Connect.** Each academy = a connected
account under BAM Business (the platform). The portal acts on an academy's
billing with the platform key + the `Stripe-Account: acct_XXX` header.

- Use **Standard Connect via OAuth** — connect each academy's EXISTING
  Stripe account. BAM GTA already has live athlete subs in its Stripe
  account; connecting it brings all customers/subs along — no sub migration.
- `clients` gets `stripe_connect_account_id` + `stripe_connect_status` +
  `stripe_connect_connected_at` (added by the Phase 1 migration).
- The Connect onboarding flow (Account Links / OAuth) must be built before
  billing writes can run for an academy — slot it ahead of Phase 3.

## The 4-phase plan

- **Phase 1 — Data foundation.**
  - **1a ✅ DONE** — schema SQL written:
    `bam-portal/supabase/member-management-schema.sql` (5 tables + client_id
    FKs + `member_status`/`cancellation_type` enums + indexes + updated_at
    trigger + per-client RLS + the clients Connect columns). NOT YET RUN
    against Supabase (no Supabase MCP this session) — run it in the Supabase
    SQL Editor for project `jnojmfmpnsfmtqmwhopz`.
  - **1b ⏳** — migrate BAM GTA's roster into the portal Supabase under a
    BAM GTA `clients` row. Generator-query migration written:
    `bam-portal/supabase/member-management-gta-data.sql` (run SECTION B in
    GTA's Supabase, paste its output into the portal's — no MCP needed).
    cancellations / referrals / refunds history = a later pass.
- **Phase 2 — Read-only Members tab.**
  - **2a ✅ DONE** — `bam-portal/api/members.js`: GET endpoint (list +
    single), client-scoped, DB-only (Stripe enrichment deferred to Phase 3).
    PATCH returns 501. Built on marketing.js conventions (sb + resolveUser).
  - **2b ✅ DONE** — the "Members" view in client-portal.html: sidebar +
    mobile nav items, `<div id="view-members">` container, `switchView`
    hook, and `fetchAndRenderMembers()` / `renderMembers()` (roster cards:
    athlete, parent, plan, trainer, status pill). Tour verifier passes.
- **Phase 3 — Billing actions.** PATCH actions porting the 7 GTA skills,
  honoring GTA's locked Stripe conventions; confirm modal as the
  "preview → y" safety gate; a member_audit_log row per write.
- **Phase 4 — Generalize (later).** Per-client plan→price map, add-member
  flow, trainer/archetype as per-client config.

## v1 schema calls (in the Phase 1a SQL)

- `status` = Postgres enum `member_status` (universal billing state);
  `cancellation_type` enum too.
- `plan` / `trainer` / `archetype` / `parent_archetype` = plain TEXT —
  academy-specific, varies per academy (Phase 4 makes plan a per-client
  price map).
- `created_at` / `updated_at` included on `members` (GTA omitted them;
  portal convention keeps them).
- RLS: real per-client SELECT policy via `public.my_client_ids()` (a user
  reads only academies they belong to, even via direct REST); writes go
  through the API only (service role).
- Discord bot stays running for GTA; the portal is an additional surface.

## Portal architecture facts (so we don't re-explore)

- **UI** — `bam-portal/public/client-portal.html`. Views are
  `<div class="view" id="view-NAME">`; `switchView(name, el)` (~line 5435)
  toggles `.active` + fires per-view init. Sidebar nav items ~4657-4685;
  mobile bottom nav ~5409-5429. Add a view = nav item + mobile item +
  container + `if (name==='members') fetchAndRenderMembers();` in switchView.
- **API** — `bam-portal/api/*.js`, Vercel serverless. Action-based dispatch
  (query-param routing + `action` in the body). `resolveUser(req)` validates
  the Supabase JWT → resolves staff + client rows. Client scoping =
  `client_id=eq.${ctx.client.id}` on Supabase REST queries. Model
  `api/marketing.js` for the pattern.
- **Auth** — client-portal.html boots a Supabase client, `getSession()`,
  looks up `clients` by `auth_user_id`, sets global `CLIENT_ID`. API calls
  send `Authorization: Bearer <access_token>`.
- **`clients` table key cols** — id (uuid PK), business_name, status,
  owner_name, email, auth_user_id, stripe_customer_id, ghl_location_id,
  marketing_included, archived_at, onboarding_completed_at.
- **Stripe** — server-side via `process.env.STRIPE_SECRET_KEY` (BAM master
  key). This is exactly WHY the open decision above matters.

## Multi-user portal model — aligned 2026-05-20

The portal moved from 1 login/academy to many, via a `client_users` join
table — see [[project_multi_user_portal]]. PART A + B are LIVE on the portal
Supabase: `public.my_client_ids()` (SECURITY DEFINER) returns the caller's
active client_ids; ~8 tables' RLS now use `client_id in (select my_client_ids())`.

Member Management was built to match this:
- `member-management-schema.sql` RLS uses `public.my_client_ids()` — NOT
  `clients.auth_user_id`.
- `api/members.js` `resolveUser` resolves academies via `client_users`
  (active rows), returns a `clients` array; the caller passes `?client_id=`
  to choose one (staff may target any).
- `client-portal.html` `fetchAndRenderMembers()` passes `&client_id=CLIENT_ID`.

⚠️ marketing.js and other existing endpoints still use the OLD
`clients.auth_user_id` resolve — the multi-user project (`/account-continue`)
owns fixing those; not our concern here.

## Where we left off

GOAL (session): get the Member Management tab live for BAM GTA's account.
Stripe model = Connect. Phases 1a/2a/2b done + multi-user-aligned. Driving
the go-live checklist:
1. Run `member-management-schema.sql` in the PORTAL Supabase
   (`jnojmfmpnsfmtqmwhopz`) — creates the 5 tables.
2. Run `member-management-gta-data.sql` — Phase 1b: SECTION A ensures the
   BAM GTA `clients` row; SECTION B (GTA Supabase) generates the INSERT;
   SECTION C (portal Supabase) runs it.
3. Flip `MEMBER_MGMT_ENABLED` to `true` in client-portal.html → commit →
   push (auto-deploys). Tab goes visible.
4. Verify: log into the portal as BAM GTA → Members tab shows the roster.
Then Phase 3 — Stripe Connect onboarding + billing PATCH actions
(pause/unpause/cancel/refund/change/payment-link/refer).

The Members tab is gated behind `MEMBER_MGMT_ENABLED` — a const in
client-portal.html, currently `false` — so it is hidden from clients on
deploy. Flip it to `true` once the schema SQL is run and the roster is
migrated in. (`applyMemberMgmtNavState()` toggles the `[data-feature=
"members"]` nav items; called in boot.)

## Related notes
- [[project_client_auth]] — how client login + client_id scoping works
- [[project_marketing_content_flow]] — the api/ + view pattern to model
- [[project_app_store_launch]] — the other active client-portal thread
