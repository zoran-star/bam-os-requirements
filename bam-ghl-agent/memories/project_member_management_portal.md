---
name: Member Management → Client Portal
description: 2026-05-24 — Phase 3 SHIPPED + handshake verified. Stripe Connect OAuth route + 6 PATCH billing actions + member-detail popup UI. Sandbox connect proven end-to-end (acct_1Tadj7RjDVVdFueQ stored on BAM GTA clients row). Live-mode billing-action testing blocked on Stripe's live-mode verification of BAM Business platform.
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

### Sandbox handshake — VERIFIED 2026-05-24

- Stripe Connect set up in **sandbox** on `By Any Means Business` (the
  intended platform account — confirmed via the existing
  `rk_live_...tgVB` restricted key on that account named "bam business
  portal", proving it's the account that powers the portal).
- 3 Vercel env vars set via CLI (`vercel env add ... production`):
  `STRIPE_CONNECT_CLIENT_ID`, `STRIPE_CONNECT_SECRET_KEY` (sandbox
  `sk_test_...s98K`), `STRIPE_CONNECT_STATE_SECRET` (fresh hex).
  Redeploy triggered via empty commit.
- Zoran logged in as **info@byanymeanstoronto.ca** (the BAM GTA owner in
  `client_users`), clicked Connect Stripe, OAuth bounced him to Stripe
  sandbox, he created/picked a test connected account, OAuth returned.
- Result in `clients` (id `39875f07-...`):
  `stripe_connect_status = 'connected'`,
  `stripe_connect_account_id = 'acct_1Tadj7RjDVVdFueQ'` (sandbox test
  acct — no real subs on it),
  `stripe_connect_connected_at = 2026-05-24 15:14 UTC`.

No `member_audit_log` rows yet — sandbox connected account has no athlete
subs, so the 6 PATCH actions can't be meaningfully tested here. The action
code is a faithful port of GTA's existing terminal skills (which run
daily), so it's tested-by-equivalence pending live-mode billing trial.

### UX nit observed during handshake

Right after Stripe's callback redirected back to `/client-portal.html?stripe_connect=connected#members`,
Zoran's portal session appeared lost — he had to log in via a separate tab
to land on the green pill. Likely a multi-tab Supabase localStorage timing
issue (the original tab's session was stale; logging in elsewhere refreshed
the shared session). Not blocking, worth a small follow-up.

### Live-mode plumbing — blocked on Stripe verification

Settings → Connect → OAuth in **live mode** on BAM Business shows:
- `Live client ID: Unavailable`
- `Enable OAuth` toggle is **disabled** (greyed out)
- "No redirect URIs set"

→ Stripe gates live Connect behind "Go live" / platform identity
verification. To unblock real-data action testing:

1. In the BAM Business Stripe account: complete the Setup Guide's
   "Go live" / payments capability / identity verification steps.
2. Once live Connect is enabled, the live `ca_...` will appear in
   the same OAuth screen. Add the redirect URI in live mode too:
   `https://portal.byanymeansbusiness.com/api/stripe/connect`.
3. Grab the live `sk_live_...G6rC` from Developers → API keys (Reveal).
4. Update the 3 Vercel env vars to live values (replace sandbox ones).
   The code's `STRIPE_CONNECT_SECRET_KEY` env var (with fallback to
   `STRIPE_SECRET_KEY`) was added precisely so live Connect can use a
   different platform key than the existing financials endpoint.
5. Redeploy.
6. Click Connect Stripe again, this time OAuth with the real BAM Toronto
   account (`acct_1P7kUCRxInSEtAh8`). The clients row's
   `stripe_connect_account_id` will update to the live acct id.
7. Then test each of the 6 actions on a real GTA member (start with a
   low-stakes one like `/payment-link` which doesn't write to billing).

### Data audit conclusion (2026-05-22)

The 4 members with null `stripe_subscription_id` are CORRECT, not broken:
Stefan Djeric (no Stripe by design — already blocked by the `/change`
skill), Samuel + Santiago (paused mid-cycle with no current sub — need a
new sub on resume), Tony Li (`payment_method_required` literally means
"no active sub — use payment-link"). The PATCH handlers all guard on
`stripe_subscription_id` and return clean 400s when it's missing. No
data cleanup needed.

### Polish work for after the live test

- **Multi-tab session handoff on OAuth return** — the session-drop after
  the Stripe callback (observed 2026-05-24). Fix by either re-fetching
  the session in the URL-param check or redirecting to a stable URL
  that's resilient to a lost-then-recovered session.
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
