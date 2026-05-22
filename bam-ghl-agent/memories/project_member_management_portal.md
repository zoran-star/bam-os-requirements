---
name: Member Management → Client Portal
description: 2026-05-22 — Phase 3 SHIPPED. Stripe Connect OAuth route + 6 PATCH billing actions (pause/unpause/cancel/refund/change/payment-link/referred) + member-detail popup UI. Awaiting Zoran's live test once he sets Stripe Dashboard up + adds env vars.
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

## Phase 3 — SHIPPED 2026-05-22 (commit `0540dd7`)

- **`api/stripe/connect.js`** (new) — Standard Connect OAuth route modeled
  on the Meta OAuth pattern in `api/marketing.js`. POST=prepare (signed
  state, returns Stripe authorize URL); GET=callback (verifies state,
  exchanges code, writes `stripe_user_id` (`acct_...`) to clients row).
  Method-based dispatch on a single path — no vercel.json rewrite needed.
- **`api/members.js`** — expanded with PATCH actions for the 6 GTA billing
  operations: `pause`, `unpause`, `cancel`, `refund`, `change`,
  `payment-link`, `referred`. Each honors locked Stripe conventions
  (trial_end pauses · NEVER pause_collection · 720-day indefinite cap ·
  canonical plan→price map · idempotency key on refunds · audit row per
  write). GET single-member now returns Stripe enrichment (price, next
  payment, status) + recent history. GET list returns the academy's
  stripe connect status alongside the roster.
- **`public/client-portal.html`** — Stripe Connect status card at the top
  of the Members tab (renders not_connected/onboarding/connected/disabled
  states). Roster cards are clickable → member-detail popup with 5
  sections (Athlete · Parent · Billing · Coaching · History) + 6 action
  buttons. v1 action UX uses prompt/confirm (polish to real modals later).
  Handles `?stripe_connect=connected|error` return redirect. Tour
  verifier still passes.
- **`env/.env.example`** — documented `STRIPE_CONNECT_CLIENT_ID` and
  `STRIPE_CONNECT_STATE_SECRET`.

Schema: no migration needed — all 5 tables + the `clients.stripe_connect_*`
columns were already in place from Phase 1.

### Cancel semantics

`/cancel` action DELETES the row from `members` and inserts a row in
`cancellations` (denormalized athlete/parent copies preserve history).
This avoided a schema migration to add a "cancelled" status to the
`member_status` enum. The cancellations table stays the source of truth
for cancelled members.

### Ahead of Zoran's first live test

1. Stripe Dashboard — enable Connect, grab the live `ca_...` OAuth client
   id, register redirect URI:
   `https://portal.byanymeansbusiness.com/api/stripe/connect`
   (also add `https://bam-portal-tawny.vercel.app/api/stripe/connect`).
2. Vercel env vars: `STRIPE_CONNECT_CLIENT_ID` + `STRIPE_CONNECT_STATE_SECRET`
   (state secret was generated 2026-05-22 — not stored in repo).
3. Redeploy in Vercel.
4. Test the Connect handshake on Members tab, then test each of the 6
   actions on a live GTA member.

### Data audit conclusion (2026-05-22)

The 4 members with null `stripe_subscription_id` are CORRECT, not broken:
Stefan Djeric (no Stripe by design — already blocked by the `/change`
skill), Samuel + Santiago (paused mid-cycle with no current sub — need a
new sub on resume), Tony Li (`payment_method_required` literally means
"no active sub — use payment-link"). The PATCH handlers all guard on
`stripe_subscription_id` and return clean 400s when it's missing. No
data cleanup needed.

### Polish work for after the live test

- Replace `prompt`/`confirm` action inputs with real modal forms
- Per-row Stripe enrichment in the roster (next payment, MRR)
- Roster filters (live/paused/payment issues)
- Handle Stripe `account.application.deauthorized` webhook → set
  `stripe_connect_status='disabled'`
- Per-academy `MEMBER_MGMT` gating (currently global — non-GTA academies
  see an empty roster + a "Connect Stripe" CTA that errors until they get
  their own setup)

### Native-app firewall (verified intact)

The Members tab is hidden inside the Capacitor wrapper via
`showMembers = MEMBER_MGMT_ENABLED && !isNativeApp()` in
`applyMemberMgmtNavState()`. App reviewers never see it. **Do not touch
that guard.**

## Related notes
- [[project_client_auth]] — how client login + client_id scoping works
- [[project_marketing_content_flow]] — the api/ + view pattern to model
- [[project_app_store_launch]] — the other active client-portal thread
