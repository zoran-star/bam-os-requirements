---
name: Member Management → Client Portal
description: 2026-05-20 — incorporating the BAM GTA member-management system into the client portal as a client-side "Members" feature. Stripe model = Connect. Phase 1a done (schema SQL written, not yet run). Resume via /member-management-continue.
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
  - **1b ⏳** — migrate BAM GTA's ~50 member rows + cancellations / referrals
    / refunds history into the portal Supabase under a BAM GTA `clients`
    row. Needs read access to GTA's Supabase project `oatwstyzxreujgsbmaxr`.
- **Phase 2 — Read-only Members tab.** New "Members" view in
  client-portal.html (sidebar nav + mobile bottom nav + view container) +
  `api/members.js` GET, client-scoped roster with live Stripe status.
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
- RLS: real per-client SELECT policy (academy reads only its own rows,
  even via direct REST); writes go through the API only (service role).
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

## Where we left off

Stripe model decided (Connect). Phase 1a done — schema SQL written, not yet
run. Next actions:
1. Run `bam-portal/supabase/member-management-schema.sql` in the Supabase
   SQL Editor (project `jnojmfmpnsfmtqmwhopz`).
2. Phase 1b — migrate BAM GTA's member data in (needs GTA Supabase access).
3. Phase 2 — the read-only Members tab + `api/members.js` GET.

## Related notes
- [[project_client_auth]] — how client login + client_id scoping works
- [[project_marketing_content_flow]] — the api/ + view pattern to model
- [[project_app_store_launch]] — the other active client-portal thread
