---
name: Member Management → Client Portal
description: 2026-07-06 (Session 8) — Member agent SHIPPED: natural-language command bar in the V2 Members tab. New api/members-agent.js runs a Claude tool-use loop (find_members/get_member auto; 13 write tools return a PROPOSAL, never executed). client-portal.html #magent-bar renders the proposal with Confirm/Cancel; Confirm fires the existing _memberAction() PATCH path. node --check + tour verifier pass. NOT yet tested live (needs deployed fn + ANTHROPIC_API_KEY + auth + Stripe — Vercel only). NEXT: push, then live-test on GTA safe-first (find_members, payment-link). Prior: Session 7 members offer-scoped; Sessions 1-6 built the whole Members tab + billing + intake + catalog + GHL/Inbox/Pipelines.
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

## Session 2 — 2026-05-24 — UI polish + LIVE Stripe + onboarding automation

### LIVE Stripe Connect (replaced the sandbox one from earlier this day)

- BAM Business live OAuth enabled (Settings → Connect → Onboarding options).
- Live `ca_UZXbIVcgsHzDVh1YZVi3u4QugpQeLM3L` + live `sk_live_…MO9I` swapped
  into Vercel env vars via CLI. The 3rd env var (`STRIPE_CONNECT_STATE_SECRET`)
  is mode-independent and was unchanged.
- Zoran logged in as `info@byanymeanstoronto.ca` (BAM GTA owner), clicked
  Reconnect, OAuth bounced through Stripe LIVE, came back green.
- **`clients.stripe_connect_account_id` is now `acct_1P7kUCRxInSEtAh8`** —
  the REAL Toronto account, matching what the Stripe MCP reports. The
  6 PATCH billing actions can now act on real GTA athlete subs.
- Live secret key was pasted in chat once; **rotate it** post-session
  (Stripe Dashboard → Developers → API keys → ⋯ → Roll key on the
  "bam business portal connect" key → paste new value into Vercel
  `STRIPE_CONNECT_SECRET_KEY` → redeploy).

### UI polish landed this session (all in `bam-portal/public/client-portal.html`)

- **Right-side drawer** replaced the centered modal for the member-detail
  popup. Slides in 250ms, backdrop fade, click-outside to close.
- **Cleaner popup layout** — bigger athlete name, parent as subtitle,
  status + engagement pills, 2-col key/value grid for Athlete / Parent /
  Billing / Coaching / History sections. Avatar at top-left.
- **Inline editable fields** in the Athlete section: Archetype / Trainer /
  Engagement as native `<select>`s. onChange fires a save via the new
  `update-profile` PATCH action.
- **Backend `update-profile` action** in `api/members.js` — handled
  BEFORE the Stripe-connect gate so member info can be edited even when
  Stripe isn't wired. Whitelist: archetype, trainer, engagement,
  skill_notes, parent_email, parent_phone, parent_archetype, group_num,
  avatar_url.
- **Avatars** — migration `add_member_avatars` added `members.avatar_url`
  + public `member-avatars` Supabase storage bucket (5 MB, image/*) +
  4 RLS policies. Card avatar is a 38px circle (uploaded image OR
  initials on a deterministic colored circle). Popup header has a 64px
  circle with a gold ✎ edit overlay; click opens file picker, uploads
  via `_sb.storage.from('member-avatars').upload(...)`, saves URL via
  `update-profile`.
- **Search + filter popover** — toolbar replaces the previous full-width
  Stripe card. `🔍 Search` matches athlete OR parent name. Filter button
  opens a popover (right-anchored) with three sections: Status / Trainer /
  Engagement. Trainer chips are derived from data (GTA canonical order:
  Filip / Zoran / Adrian / Sergio first). Filter-button shows active-
  count badge + turns gold when filters set.
- **Grid card layout** (38 | 1fr | 70 | 100 | 200) replaced flex-wrap
  so every column lines up; long names ellipsis.
- **Hover effect** — `.member-card:hover` gets a gold-tinted background
  + border highlight, 150ms transition.
- **Engagement chip** added next to status pill on both card + popup
  header (green outlined for consistent, amber for at_risk).
- **Stripe Connect moved to a topbar pill + modal.** No more loud card
  at top of roster. Right-corner button color-coded by status (gold CTA
  when not_connected, outlined green/amber/red otherwise). Click opens a
  centered modal with status + connected acct id + contextual action.
- **Reconnect link** on the connected-state Stripe modal so the user can
  re-run OAuth (e.g. when switching from sandbox to live).
- **Multi-tab session-drop fix** for OAuth return. An early-load IIFE
  stashes `?stripe_connect=` params to sessionStorage before any auth
  check runs; post-login boot reads from URL OR stash so the green-pill
  alert + Members switch survive a login bounce.

### Onboarding automation — SHIPPED 2026-05-24

Two-leg auto-add flow: GHL form submission creates a pending member,
Stripe payment flips it to live.

```
Parent fills GHL Onboarding Form
       │
       ▼
GHL Workflow → POST /api/members/intake
       │  (header: X-Webhook-Secret: <GHL_INTAKE_WEBHOOK_SECRET>)
       │  (body: customData wrapper with athlete_name + parent fields)
       ▼
members row inserted  status='payment_method_required'

Parent picks plan on funnel + pays
       │
       ▼
Stripe creates sub on BAM Toronto connected account
       │
       ▼
Stripe → POST /api/stripe/webhook  (Connect-scoped endpoint)
       │  customer.subscription.created event
       ▼
matches pending member by parent_email FIFO → flips status to 'live',
  populates stripe_customer_id + stripe_subscription_id, auto-derives
  members.plan from sub.items[0].price.id via PRICE_TO_PLAN map.
```

**New files:**
- `bam-portal/api/members/intake.js` — GHL webhook landing. Shared-secret
  auth via `X-Webhook-Secret`. Idempotent on (athlete_name, parent_email).
  Flattens `body.customData` / `body.custom_data` if GHL nests fields one
  level deep (it does — see field-mapping note below).
- `bam-portal/api/stripe/webhook.js` — raw-body Stripe signature
  verification (`bodyParser: false`), 4 event handlers:
  - `customer.subscription.created` — intake link + plan auto-set
  - `customer.subscription.deleted` — auto-cancel (cancellations row +
    delete members row), mirroring `/cancel`
  - `customer.subscription.updated` — sync `members.plan` if price ∈
    PRICE_TO_PLAN
  - `invoice.payment_failed` — flag `status='payment_failed'`
  Always returns 200 to prevent Stripe retry storms; errors logged.

**GHL field-mapping gotcha:** GHL's webhook payload is huge — every
custom field on the contact at the top level — but our 5 custom-data
rows arrive nested under `body.customData`. The intake endpoint
auto-flattens that. Mapping that works:

```
Custom Data row    GHL token (picked via 🏷 icon)
─────────────────  ──────────────────────────────
athlete_name       "Athlete's Full Name" custom field
                   (query_key athletes_full_name)
parent_name        "Parent's Full Name"
parent_email       "Parent's Email"   (or {{contact.email}})
parent_phone       "Parent's Phone"   (or {{contact.phone}})
ghl_contact_id     "Contact ID"       ({{contact.id}})
```

**Plan derivation:** not captured on the GHL form (plan is selected on
the funnel page → carried into Stripe checkout). The Stripe webhook
auto-sets `members.plan` from the sub's price_id via PRICE_TO_PLAN.

**Env vars (set in Vercel):**
- `GHL_INTAKE_WEBHOOK_SECRET = 94488bfa…c75f` (generated 2026-05-24)
- `STRIPE_WEBHOOK_SECRET     = whsec_…eTv4`   (from Stripe webhook dashboard)

**Stripe webhook config:**
- Endpoint: `https://portal.byanymeansbusiness.com/api/stripe/webhook`
- Scope: **Connected accounts** (NOT 'events on your account')
- 4 events: `customer.subscription.created` / `deleted` / `updated`,
  `invoice.payment_failed`

**GHL Workflow config:**
- Trigger: Form Submitted on the "Onboarding Form (Boys)" form
- Action: Webhook (POST to `/api/members/intake`)
- Headers: `X-Webhook-Secret` + `Content-Type: application/json`
- Custom Data: 5 rows (see field-mapping above)

**Verified working end-to-end (intake leg):** 2026-05-24 — Zoran submitted
the real GHL form, audit log captured `intake-ghl` with full body, member
row created. **Stripe leg untested with a real payment yet** — code is
logically equivalent to the proven `/cancel` etc. flows, but a real
payment is the final confirmation.

### Debug aids left in place

- `api/members/intake.js` logs every received body to Vercel function
  logs (`console.log("[intake] received body:", ...)`).
- On validation failure (missing athlete_name OR parent_email), writes
  an `intake-ghl-failed` audit row with the full received body + key list
  so you can query Supabase to inspect.
- Once intake is reliably stable: prune the debug log + failure-audit
  if the noise becomes annoying.

### Useful Supabase queries during testing

```sql
-- latest intake activity (success or failure)
select action_type, args, created_at
from member_audit_log
where created_at > now() - interval '1 hour'
  and action_type like 'intake-%'
order by created_at desc;

-- pending members waiting for Stripe linkage
select id, athlete_name, parent_email, created_at
from members
where status = 'payment_method_required'
  and stripe_subscription_id is null
order by created_at desc;
```

## Session 3 — 2026-05-25 — Sync audit + mobile polish + popup tweaks

### Members ↔ Stripe sync audit

Cross-referenced all 51 members against live Stripe account
`acct_1P7kUCRxInSEtAh8` (BAM Toronto). Process:
1. `select * from members where client_id = '39875f07-...'`
2. `stripe.list_subscriptions({status: 'active'|'trialing'|'past_due'|'all'})`
3. Match by `stripe_subscription_id`. Diff statuses.

**Real mismatches found + fixed (2):**
- **Vedant** — DB `paused` but Stripe sub `canceled` → moved to
  cancellations (denorm copy), removed from members. Reason recorded
  as "Cancelled in Stripe (outside portal) — sync cleanup 2026-05-25".
- **Aarav Arora** — DB `live` but Stripe sub `past_due` → flipped to
  `payment_failed` (now surfaces under the Members tab "Issues" filter).

**Known-design exceptions (4):** Stefan Djeric (no Stripe by design,
blocked from /change), Samuel + Santiago (paused, sub gone — expected
per schema), Tony Li (payment_method_required = literally "no sub").

**Tripped over (2 — both legit, NOT mismatches):**
- **Jaxson** — Stripe shows `trialing` with trial_end pushed out, DB
  `live`. Cause: `/refer` skill credit (each referral pushes trial_end
  by 4 weeks). Same Stripe shape as a package payer rollover. CORRECT.
- **Sergio** — Stripe sub not in active/trialing/past_due. DB already
  flagged `payment_failed`. Correctly surfaced.

**Final roster: 50 members, fully in sync.**

### UI polish landed this session

- **Plan column removed** from roster cards (still in popup BILLING).
  Desktop card: avatar | name+parent | trainer | pills.
- **Mobile-responsive grid** (≤640px): 3 cols only (avatar | name+parent
  | pills), trainer column hidden, pills stack vertically right-aligned,
  tighter padding. Everything fits in a 375px viewport.
- **Card markup extracted** from inline-style to `.member-card-*` class
  names so the media query can override cleanly. Hover transition
  preserved.
- **Popup Group field** is now an inline `<input type="number">` (1..99)
  — saves via `update-profile` with `Number(value)` so the PG int column
  gets a real int. Empty input → null via the API normalizer.
- **Joined date** removed from popup Athlete section.
- **Subscription ID replaced Customer ID** in popup BILLING section —
  more actionable Stripe identifier and matches what the 6 action
  handlers use.

### Useful sync-audit playbook (for future Claude / Zoran)

```sql
-- 1. Get the current roster state
SELECT id, athlete_name, status, plan, stripe_customer_id, stripe_subscription_id
FROM members
WHERE client_id = '39875f07-0a4b-4429-a201-2249bc1f24df'
ORDER BY status, athlete_name;
```

```
-- 2. Pull Stripe (via Stripe MCP), in this order:
mcp__stripe__list_subscriptions(status: 'active',  limit: 100)
mcp__stripe__list_subscriptions(status: 'trialing', limit: 100)
mcp__stripe__list_subscriptions(status: 'past_due', limit: 100)
mcp__stripe__list_subscriptions(status: 'unpaid',   limit: 100)
mcp__stripe__list_subscriptions(status: 'canceled', limit: 100)
```

```
-- 3. For each member, compare DB status vs Stripe sub status:
   STRIPE active     → DB live              ✓
   STRIPE trialing   → DB paused  (or live if /refer credit OR package rollover)
   STRIPE past_due   → DB payment_failed    (fix if not)
   STRIPE unpaid     → DB payment_failed    (fix if not)
   STRIPE canceled   → DB cancelled (move to cancellations + delete from members)
   No matching sub   → DB payment_method_required (or by-design exception)
```

```
-- 4. For an out-of-band cancelled sub (Vedant pattern), the fix is:
INSERT INTO cancellations (client_id, member_id, athlete_name, archetype,
  parent_name, type, cancel_date, reason, stripe_subscription_id, stripe_customer_id)
SELECT client_id, id, athlete_name, archetype, parent_name, 'cancel',
       current_date, '<reason>', stripe_subscription_id, stripe_customer_id
FROM members WHERE id = '<member_id>';

DELETE FROM members WHERE id = '<member_id>';
```

## Production-readiness checklist for BAM GTA

Path from "code shipped" to "Filip/Adrian/Sergio can rely on the portal":

### 🟥 Must-do before staff starts using it

```
1. ROTATE the leaked sk_live_…MO9I key
     Stripe → Developers → API keys → "bam business portal connect"
     → ⋯ → Roll key → paste new value into Vercel
     STRIPE_CONNECT_SECRET_KEY → redeploy.

2. TEST a real billing action end-to-end on a real GTA member.
     Safest: Payment link on Aarav (he's payment_failed, so the link
     is actually useful). Confirms the platform key + Stripe-Account
     header pipeline works against the real Toronto account.

3. TEST one real /pause + /unpause on a member you control.
     Verifies trial_end convention writes are firing correctly.

4. STAFF TRAINING — walk Filip/Adrian/Sergio through:
     - Where the Members tab is in the portal
     - Click a member → drawer popup → 6 action buttons
     - Inline edits (Archetype/Trainer/Engagement/Group)
     - Confirm that Discord bot stays running too (portal is
       ADDITIONAL, not replacement, per project-state.md).
```

### 🟧 Should-do for confidence

```
5. REPLACE prompt/confirm action UX with real modal forms.
     Right now Pause/Cancel/Refund/Change/Referred use browser
     prompts — works but ugly. Modal forms would:
     - Validate inputs (e.g., refund amount must be a number)
     - Show better confirm previews
     - Match the rest of the portal's UI

6. ADD MEMBER button on the Members tab.
     For one-off / legacy migrations / pre-launch adds before the
     GHL intake flow is the canonical path. Currently every member
     has to come via GHL form OR via direct DB insert.

7. STRIPE WEBHOOK CONNECT SCOPE check — open the webhook detail
     page in Stripe Dashboard and confirm it says "Listening on:
     Connect". (Never explicitly verified, but the LIVE Connect
     handshake already worked, so it's probably set right.)
```

### 🟨 Nice-to-have polish

```
8. "Run sync check" admin button (one-click roster audit + fix)
9. KPI bar at top of Members tab (MRR / Active / Paused / At-risk)
10. Per-row Stripe enrichment in roster (next payment date + amount)
11. Sort controls on roster (alphabetical / status / joined / etc.)
12. Bulk actions (select multiple → cancel all, etc.)
13. Per-academy MEMBER_MGMT gating (currently global flag — non-GTA
     academies see an empty roster + a Connect Stripe CTA that errors
     until they get their own setup)
14. Stripe `account.application.deauthorized` webhook handler
     (auto-set stripe_connect_status='disabled' if academy revokes)
15. Audit-log viewer page (currently only visible via direct
     Supabase access; the per-member History section in popup is
     the only in-portal surface)
```

### Known quirks to document for staff

- **Stefan Djeric** has no Stripe link — by design, blocked from
  /change. Cancel/refund actions will reject. Pause shows error.
  Use the Discord bot or terminal for any Stefan-specific action.
- **Samuel + Santiago** are paused with no sub — they exited
  mid-pause. When they resume, they'll need a new sub set up
  (likely a payment_link first to capture card).
- **Tony Li** is payment_method_required — needs a new sub setup.
  Click Payment link button to send him the Customer Portal.
- **Jaxson + the 6 package payers** (Scott/Chase/Luke/Bradley/
  Krishay/Skylar) — Stripe will show 'trialing' but DB shows
  'live'. This is correct — trial_end is being used for /refer
  credit or package rollover, not a pause.

## Session 4 — 2026-05-28 — Pricing catalog (per-academy Stripe price source of truth)

The bigger build: a portal-side `pricing_catalog` table that is the source
of truth for every Stripe price an academy has, classified by tier
(canonical / lil_sale / legacy_match / legacy_unknown / deprecated). Replaces
the hardcoded PRICE_TO_PLAN map in api/members.js (Phase 11 — still pending)
and generalizes everything to every academy, not just BAM GTA.

### Why this shipped

`/Users/zoransavic/BAM GTA/memories/plans-and-pricing.md` was BAM GTA's
manual source of truth — 170 lines of canonical vs legacy classification.
The portal couldn't read it. Now it lives in `pricing_catalog`, queryable
by any code path (/change, webhooks, UI, future cron audits) and auto-keeps
fresh via Stripe webhooks.

### Schema — `pricing_catalog`

`bam-portal/supabase/pricing-catalog-schema.sql` (idempotent migration).

```
pricing_catalog
  id                uuid PK
  client_id         uuid → clients (CASCADE)
  stripe_price_id   text       UNIQUE per client_id
  stripe_product_id text
  stripe_account_id text       denorm for fast filter
  display_name      text       "Steady", "Dominate lil sale", etc
  canonical_plan    text       1/wk · 2/wk · 3/wk · unlmtd · NULL
  tier              text       canonical · lil_sale · legacy_match · legacy_unknown · deprecated
  is_routable       bool       /change can route NEW subs onto this?
  amount_cents      int
  currency          text       default 'cad'
  interval          text       4_weeks · 3_months · 6_months · one_time
  hst_mode          text       all_in · pre_tax · NULL
  notes             text
  metadata          jsonb
  last_synced_at    timestamptz
```

Indexes: `(client_id, canonical_plan) WHERE is_routable`, `(client_id, tier)`,
`(stripe_price_id)`. RLS SELECT via `my_client_ids()`; writes service-role only.

### BAM GTA seed — 31 rows

`bam-portal/supabase/pricing-catalog-gta-seed.sql` (re-runnable).

```
canonical       12  Steady · Accelerated · Elevate · Dominate (monthly)
                    + 8 prepay (3mo/6mo × 4 tiers)
lil_sale         2  Dominate $395.50 (preferred + variant)
legacy_match     2  amount = canonical → auto-classified
legacy_unknown  13  GHL Dynamic / "Starter" / "Girls" / Carson $356 etc
deprecated       2  Parker 50%-off, Qundi old plan
```

Source: extracted manually from plans-and-pricing.md PLUS a Stripe sweep
of every distinct price ID in use on active/trialing/paused/payment_failed
member subs (so the catalog covers 100% of current members).

### Auto-classification rule (used by webhook + on backfill)

```
new price arrives → match its amount against this client's tier='canonical'
  ├─ MATCH    → tier='legacy_match', canonical_plan inherited, is_routable=false
  └─ NO MATCH → tier='legacy_unknown', canonical_plan=NULL,    is_routable=false
```

Owner-set classifications (`canonical` / `lil_sale` / `deprecated`) are
NEVER overwritten by Stripe events — once classified, the row's
tier/canonical_plan/is_routable are preserved on upsert.

### Stripe webhook — `price.created` + `price.updated` shipped

`bam-portal/api/stripe/webhook.js` got 2 new event cases routed to
`handlePriceUpserted()`:

1. Resolve `client_id` from `event.account` (the connected Stripe acct) via
   `clients.stripe_connect_account_id` lookup.
2. If price exists in catalog → preserve owner classification.
3. If new → auto-classify per rule above.
4. PostgREST upsert via `Prefer: resolution=merge-duplicates`.
5. Write audit row (`stripe-price-created` / `stripe-price-updated`).
6. Returns 200 even on error so Stripe doesn't retry-storm.

**Stripe dashboard action needed (manual):** add `price.created` +
`price.updated` events to the Connect webhook endpoint
`https://portal.byanymeansbusiness.com/api/stripe/webhook`. Until then,
the catalog is static.

### `members.stripe_price_id` column + backfill

```sql
ALTER TABLE members ADD COLUMN stripe_price_id text;
CREATE INDEX members_stripe_price_idx ON members (client_id, stripe_price_id);
```

Backfilled 46 of 50 GTA members from the Stripe sub→price mapping pulled
during the reverse sync audit. The 4 NULLs are by-design (Stefan Djeric,
Samuel, Santiago, Tony Li — none have an active sub).

Going forward, the Stripe webhook keeps it in sync. Out-of-band Stripe
edits (price change in dashboard, sub item swap) will flow through
`customer.subscription.updated` and should update `members.stripe_price_id`
too — Phase 11 will add that handler tweak.

### GET /api/members — pricing enrichment

The list endpoint now batch-queries `pricing_catalog` once per request and
attaches a `.pricing` object to each member row:

```js
m.pricing = { tier, canonical_plan, display_name, amount_cents, interval }
   // OR { tier: "uncatalogued" } if sub uses a price not in catalog at all
```

Single batched query (uses the indexes) — no N+1 per member. Tier=null
when member has no `stripe_subscription_id` (Stefan + Samuel + Santiago
+ Tony Li).

### Roster pill — legacy / deprecated visible at a glance

`_memberPricingPill(pricing)` in `client-portal.html` renders one of:

```
🟫 "legacy"      legacy_match OR legacy_unknown    amber-brown outline
🟥 "deprecated"  deprecated                         red outline
⬜ "unknown $"   uncatalogued (sub price not in     grey outline
                catalog at all — gap to investigate)
(no pill)        canonical OR lil_sale (the normal sellable case)
```

Hover title shows the catalog `display_name` + tier. Slotted into
`.member-card-pills` after engagement chip.

### Reverse sync audit — 2 pre-automation orphans surfaced

Ran members ↔ Stripe diff in BOTH directions for the first time. Found:

```
Kun Liu (Ryan)   cus_UVq5pKmKTHcKHg   sub_1TWoQ0Rx…   active   signed 2026-05-14
John Fu          cus_UWo0Cw0OB5BiZ3   sub_1TXkQORx…   active   signed 2026-05-16
```

Both signed up BEFORE the 2026-05-24 intake automation went live. NOT a
bug — they predate the wire-up. Anyone signing up after 2026-05-24 via
the GHL form auto-populates correctly. These 2 still need manual backfill
into `members` (athlete name + plan from GHL form). Kun Liu/Ryan also has
a pending Cancel ticket from Sergio.

**New playbook addition:** the 2026-05-25 sync audit only checked
DB → Stripe. The reverse check (Stripe → DB) is the one that catches
orphans. Run BOTH directions periodically.

### What's still pending after this session

```
#10  UI    Extend Offers system (Training offer Pricing section) to surface
            catalog rows grouped by tier. Owner can re-tag canonical → lil_sale
            or promote legacy_unknown → canonical. Inside the offer per Zoran's
            UI surface call (2026-05-28).
#11  API   Refactor api/members.js actionChange to read pricing_catalog
            instead of the hardcoded PLAN_TO_PRICE map. Same swap in the
            webhook handleSubCreated/Updated PRICE_TO_PLAN. Generalize to
            non-GTA academies.
#4 #6     Backfill Kun Liu/Ryan + John Fu in members + cancel Ryan.
#1 #2 #3  Pause Tristan/Nathan/Christ (3 real Sergio tickets).
#13      Re-verify all 8 PATCH actions still work after the catalog refactor.
```

## Session 5 — 2026-05-29 — GHL OAuth + Inbox + Payment-link modal

### GHL OAuth Connect flow

Per-academy OAuth into each academy's GHL sub-account. Mirrors the existing
Stripe Connect pattern. White-label vision: BAM Business owns one master
Marketplace app; each academy clicks "Connect GHL" once and is set forever.

**Schema added to `clients`:**
```
ghl_access_token         text   — bearer used on every GHL call
ghl_refresh_token        text   — refresh path; ~24h expiry on access
ghl_token_expires_at     ts     — when to refresh (60s skew)
ghl_connect_status       text   — not_connected | onboarding | connected | disabled
ghl_connected_at         ts
ghl_company_id           text   — agency id (informational)
```

**Endpoints:**
- `api/ghl/connect.js`  POST = prepare (signed-state authorize URL pointed
  at `marketplace.gohighlevel.com/oauth/chooselocation`); GET = callback
  (verifies state, POSTs to `services.leadconnectorhq.com/oauth/token`
  with `user_type=Location`, writes access + refresh + expiry +
  locationId + companyId + status='connected').
- `api/ghl/send-message.js`  Token resolution order:
  1. Per-academy OAuth (with auto-refresh if expiring within 60s)
  2. GHL_LOCATIONS_JSON entry (interim — same env var existing api/ghl.js uses)
  3. Plain GHL_API_KEY env var (last-resort fallback)
  Also: accepts `contact_id` directly (Inbox reply path) to skip the
  phone/email lookup.
- `api/ghl/inbox.js`  GET = list conversations + classification
  (member if contactId/email/phone matches a member row, else lead),
  counts (all/members/leads/unread). Or `?conversation_id=` = full
  thread (sorted oldest→newest).

**Scopes requested (comprehensive set so adding pipelines/calendars/invoices
later doesn't require re-OAuth):**
contacts.{readonly,write} · conversations.{readonly,write} ·
conversations/message.{readonly,write} · locations.readonly ·
opportunities.{readonly,write} · calendars.{readonly,write} ·
calendars/events.{readonly,write} · calendars/groups.{readonly,write} ·
forms.readonly · workflows.readonly · campaigns.readonly ·
locations/customFields.{readonly,write} ·
locations/customValues.{readonly,write} ·
locations/tags.{readonly,write} · locations/tasks.{readonly,write} ·
locations/templates.readonly · products.{readonly,write} ·
products/prices.{readonly,write} · products/collection.readonly ·
invoices.{readonly,write} · invoices/schedule.{readonly,write} ·
invoices/template.readonly · payments/orders.{readonly,write} ·
payments/transactions.readonly · payments/subscriptions.readonly ·
payments/integration.readonly · payments/coupons.{readonly,write} ·
snapshots.readonly · socialplanner/post.{readonly,write} ·
socialplanner/account.readonly · socialplanner/oauth.readonly ·
socialplanner/medialibrary.readonly · courses.{readonly,write} ·
emails/builder.{readonly,write} · blogs.{readonly,write} ·
businesses.readonly · users.readonly · surveys.readonly

**Env vars (Zoran adds in Vercel after creating the Marketplace App):**
- `GHL_OAUTH_CLIENT_ID` — Marketplace App client id
- `GHL_OAUTH_CLIENT_SECRET` — same, secret
- `GHL_OAUTH_STATE_SECRET` — random hex for HMAC (falls back to
  service-role key if unset)

**Redirect URI to register in the GHL Marketplace app:**
`https://portal.byanymeansbusiness.com/api/ghl/connect`

**App Type:** Sub-Account (NOT Agency — we want location-scoped tokens).
**Distribution:** Private is fine for the BAM-only phase; switch to Public
when onboarding non-BAM academies.

### Payment-link modal

`mPaymentLink` no longer alerts — opens a right-half modal:
- Stripe portal URL + Copy + Open buttons
- Editable SMS preview (default per Zoran:
  `Hi, here's the link to update your card with <Academy>: <URL>`)
- Editable email subject + body
- Send SMS / Send Email buttons (POST to `/api/ghl/send-message`)
- Reasons panel listing why a button is greyed (no phone / no email /
  GHL not connected)
- Copy-link fallback always available

`actionPaymentLink` now returns `{ url, parent: {name,phone,email},
ghl: {ready, location_id}, suggested: {sms_text, email_subject, email_html} }`.

### Inbox view (new sidebar nav)

`Messages` (BAM team chat) is kept — `Inbox` is a separate sibling. Three
tabs (All / Members / Leads), search, refresh, classification logic in the
API, right-side drawer with sorted bubbles (gold-right outbound, outlined
left inbound) + inline reply box with SMS/Email type picker.

Reply path: drawer → `/api/ghl/send-message` with `contact_id` (skip
lookup) → optimistic append + background list refresh.

### Member popup extras

- `View in Stripe ↗` button — opens
  `https://dashboard.stripe.com/{acct_id}/customers/{cus_id}` in a new tab.
  Hidden when either ID is missing (Stefan Djeric).
- `Joined` row in BILLING section — pulls from
  `stripe.created` (live) or `members.stripe_joined_at` (persisted)
  or `members.joined_date` (fallback).
- Sort dropdown on Members toolbar: Name (A–Z) · Newest joiners ·
  Oldest joiners. Sort happens server-side via
  `?sort=joined_newest|joined_oldest`.
- Backfill: ran `mcp__stripe__fetch_stripe_resources` 46x via this
  Claude session, then a single bulk UPDATE FROM (VALUES …). 46/50
  members populated; 4 NULLs are by-design (Stefan, Samuel, Santiago,
  Tony Li — no sub).
- `/api/admin/backfill-stripe-joined-at.js` also added for re-running
  this per-academy (chunked 8-wide).

### Pricing view (sidebar nav 'Pricing')

Standalone view that shows every catalog row grouped by tier with member
count. Click row → drawer with full detail + members list. Includes an
"Uncatalogued" surface for any sub price not yet in the catalog (steady
state should be empty since the webhook now syncs `price.created` /
`price.updated`).

### Test SMS button

Small dashed "📱 Test GHL SMS to me" button at the top of the Members tab,
hardcoded to `+14165733718` (Zoran). One click verifies the entire
OAuth → send-message → GHL → Twilio chain works. Result alerted, no
DevTools needed.

### What still needs to happen on Zoran's side

1. Create the BAM Business Portal Marketplace App in GHL
2. Tick all scopes listed above
3. Set the 3 env vars in Vercel
4. Click "Connect GHL" on the Members tab for BAM GTA
5. Click "Test GHL SMS to me" — phone buzzes
6. Click any Inbox conversation → reply box works

Once those work for BAM GTA, the same code handles every future academy
with zero changes — just OAuth in.

## Session 6 — 2026-05-30 — Pipelines view + Mike fix + GHL setup-in-progress

### Pipelines view (commit `fc59b0a`)

New "Pipelines" sidebar nav in client portal (V2-gated, web-only, same
firewall as Members/Pricing/Inbox). Per-academy GHL kanban with all
pipelines the academy has.

- **`api/ghl/pipelines.js`** (new):
  - `GET ?client_id=<uuid>` — all pipelines + stages + opportunities,
    each opportunity classified `member` (if contactId/email/phone
    matches a member row) or `lead`. Returns totals.
  - `PATCH ?client_id=<uuid>&opportunity_id=<id>` body
    `{ pipeline_id, stage_id }` — moves the opp to a new stage via
    GHL `PUT /opportunities/{id}`.
  - `POST ?action=convert&client_id=<uuid>` body
    `{ opportunity_id }` — creates a member row from the opp's contact
    info (status='payment_method_required'). Idempotent on
    (athlete_name, parent_email). Writes a `convert-from-pipeline`
    audit row.

- **UI (`client-portal.html`)**:
  - New sidebar nav `Pipelines` next to `Inbox`.
  - Pipeline tabs at top; horizontal kanban below.
  - Cards are draggable (HTML5 native). Drop → optimistic UI +
    PATCH to GHL → roll back on failure.
  - Card shows: name, contact name + phone, member/lead tag, age in
    stage (amber tint when >7 days = stale).
  - Click card → right drawer: full contact info, value, status,
    stage age. Drawer actions:
    - `Open member popup` if matched to a member.
    - `Convert to member` if it's a lead.
    - `Open in GHL ↗` deep link to `app.gohighlevel.com`.

- **Scopes**: `opportunities.readonly` + `opportunities.write`
  already in the OAuth scope set we shipped Session 5.

- **Mobile note**: drag-drop is desktop-only practical. A button-based
  "advance one stage" fallback for mobile is parked.

### Client switcher fix — Mike (commit `b84ec6e`)

`mike@byanymeansbusiness.com` (BAM staff, member of 18 academies) was
stuck on the bottom-left account switcher. Buttons rendered but had no
max-height + no overflow scroll, so the lower 13 academies were pushed
off-screen and unreachable.

- `.client-switcher` CSS got `max-height: 280px` + `overflow-y: auto`.
- `renderClientSwitcher()` adds a search input when `CLIENT_ROWS.length > 5`
  — case-insensitive substring filter on business_name. Persists cursor
  position between keystrokes via `_clientSwitcherSetFilter()`.

No regression for users with 2-5 clients — input only renders past that
threshold; max-height is harmless when the list fits.

### GHL setup — IN PROGRESS

Zoran is in the middle of (as of session end 2026-05-30):
1. Creating BAM Business Portal Marketplace App at
   `marketplace.gohighlevel.com` (or via `app.gohighlevel.com` →
   sidebar → Marketplace if no separate login)
2. App config: Sub-Account type (NOT Agency), Private distribution,
   Redirect URI = `https://portal.byanymeansbusiness.com/api/ghl/connect`,
   tick every scope box visible.
3. Copy Client ID + Client Secret → paste into Vercel env vars
   `GHL_OAUTH_CLIENT_ID` + `GHL_OAUTH_CLIENT_SECRET` +
   `GHL_OAUTH_STATE_SECRET` (any 60+ char hex).
4. Wait for Vercel redeploy (~60s).
5. Click `Connect GHL` button on Members tab → OAuth → pick BAM GTA
   location → approve.
6. Click `📱 Test GHL SMS to me` button → expect phone to buzz.

**When he confirms "connected" + test SMS arrived** → that's the
trigger to:
1. Auto-backfill Kun Liu/Ryan + John Fu from GHL contact form data
   (search GHL by name → pull contact + form fields → INSERT member row).
2. Cancel Kun Liu's sub via portal Cancel action (sub_1TWoQ0Rx…) —
   Sergio's ticket #4.
3. Unpark the onboarding wizard (see [[project_onboarding_wizard_parked]]).

### Open items at session end (for next session pickup)

```
ORIGINAL MISSION (still open)
  #1 Pause Lucrecia → Tristan Pierre        sub_1TR9KkRx…
  #2 Pause Amy / Nathan                       sub_1SQKAmRx…
  #3 Pause Christ's mom / Christ              sub_1THXifRx…
  #4 Cancel Kun Liu / Ryan ticket             sub_1TWoQ0Rx… (cancel via portal once backfilled)
  #6 Backfill John Fu in members              sub_1TXkQORx…

GHL-DEPENDENT (waits on Zoran finishing Marketplace setup)
  - Verify Connect GHL flow works for BAM GTA
  - Verify Test SMS button delivers SMS to 4165733718
  - Verify Inbox shows real conversations
  - Verify Pipelines shows real boards
  - Backfill Kun Liu + John Fu using GHL access
  - Cancel Kun Liu's sub via portal Cancel action

CATALOG-DEPENDENT
  #10 UI extend Offers system to surface catalog
  #11 /change route via catalog lookup (replace hardcoded PLAN_TO_PRICE)
  #13 Re-verify all 8 PATCH actions still work with catalog

PARKED
  #21 Onboarding wizard (3-step, ~1.5 days)
       see [[project_onboarding_wizard_parked]]
       trigger to unpark: "GHL verified end-to-end for BAM GTA"
```

### Commits this session
- `fc59b0a` — Pipelines view + Convert to member
- `b84ec6e` — Mike's client switcher fix (max-height + filter)

## Session 7 — 2026-06-18 — Members are offer-scoped (V2 offer-centric)

The V1.5→V2 jump is member management, and members now join the offer-centric
model (same as `entry_points.offer_id` ties pipelines to offers). A member
belongs to the offer its **Stripe price** maps to — no up-front choice; derived
from the price match you already built (`pricing_catalog.offer_id`).

- **Schema** (migration `20260618000000_member_offer_scope.sql`, applied live via
  MCP): `offer_id uuid REFERENCES offers(id)` on **`members`** + **`members_staging`**
  (nullable) + `(client_id, offer_id)` indexes. Nullable = a member whose price
  isn't offer-mapped yet stays NULL → surfaces in the existing cleanup "no offer"
  flag.
- **Resolution at promote** (`api/sorter/cleanup.js` promote action): builds a
  `priceToOffer` (stripe_price_id→offer_id) + `keyToOffer` (offer_price_key→offer_id)
  map once from `pricing_catalog` (offer_id not null), resolves per staging row,
  sets `members.offer_id` on insert. Guarded: only set when resolved, so re-import
  of an unmapped member never clobbers an existing offer.
- **`connect-offer` cleanup action** now ALSO sets `offer_id` on the staging row
  AND backfills any already-promoted live `members` on that same price
  (`stripe_price_id=eq & offer_id=is.null` → PATCH). So tying a price to an offer
  scopes existing members too, not just future imports.
- **GET /api/members (list)** enriches each member with `m.offer = { id, title }`
  (batched `offers?id=in.(…)&select=id,title`), alongside the existing `m.pricing`.
- **Roster UI** (`client-portal.html`): `_memberOfferPill(m)` (gold pill, offer
  title) on the card + an **Offer** section in the filter popover + `offer` in
  `_MEMBERS_FILTER`/`_filterMembers`/`_membersClearFilters`. Both gated on
  `_MEMBERS_MULTI_OFFER` (roster spans 2+ offers) so single-offer GTA stays clean
  today and the pill/filter light up when offer #2 lands — mirrors the Sales page
  ("offer switcher comes when offer #2 goes live").
- **Branch:** `feat/member-import-offer-scope`. Tour verifier passes; api files
  `node --check` clean. (Local `npm run build` fails ONLY on missing `@sentry/react`
  in stale node_modules — pre-existing, unrelated.)
- **Follow-up (not built):** offer row in the member-detail popup Billing section
  (needs the single-member GET to enrich offer too); a real offer switcher header
  on the Members tab (deferred with Sales' until offer #2). See
  [[project_website_leads]] "Offer scoping" + [[project_pricing_sorter_wizard]].

## Session 8 — 2026-07-06 — Member agent (natural-language command bar)

Conversational agent in the V2 Members tab: staff type plain English
("pause Tristan 30 days", "refund Aarav $50", "change Maya to 3/wk") and
Claude proposes ONE billing action; a Confirm click runs it. Like bambot
(the GTA Discord bot) but portal-native. The 13 existing members.js actions
are the agent's tools.

**Design — translator, not executor (lowest risk):**
- **`api/members-agent.js`** (new): `POST { client_id, message, history? }`.
  Claude tool-use loop (model `claude-sonnet-4-6`, same as the sales agents).
  - READ tools run server-side automatically: `find_members(query)` (roster
    ILIKE search → member_id + status), `get_member(member_id)` (DB fields +
    recent Stripe charges w/ charge_id + status, for refunds / "why did the
    payment fail"), `list_members({status?, issues_only?})` (roster-level
    Q&A: "who has failed payments" → status=payment_failed;
    issues_only=true = payment_failed + payment_method_required; no args =
    counts by status). The agent ANSWERS questions too, not just acts.
  - WRITE tools are named EXACTLY like the members.js action strings
    (pause, pause-date-fix, unpause, cancel, refund, change, apply-coupon,
    remove-coupon, payment-link, card-setup-link, referred, update-profile,
    call). When Claude calls one, the endpoint STOPS and returns
    `{ proposal: {action, member_id, member_name, body, summary} }` — it does
    NOT execute. `toActionBody()` maps tool input → members.js PATCH body
    (refund: amount_dollars→amount_cents; update-profile: fields wrapped).
    `summarize()` builds the confirm-card line server-side (trustworthy).
  - Auth = same resolveUser pattern as members.js (staff any academy, client
    only their own). Scope re-checked. This file never writes billing.
- **`client-portal.html`** command bar at top of `#view-members` content
  (`#magent-bar`): input + Send, thread of bubbles, proposal card with
  Confirm/Cancel (red accent for cancel/refund). `magentSend/Confirm/Cancel`
  + `_MAGENT` state. **Confirm calls the existing `_memberAction(id, action,
  body)` executor** → proven `PATCH /api/members?id=` path (auth re-checked,
  Stripe conventions honored, audit row written THERE). Then
  `fetchAndRenderMembers()` refreshes. history = plain-text turns for
  follow-ups ("make it 60 days").

**Safety:** every write is behind a human Confirm click AND re-authorized by
members.js PATCH. Even a bad proposal can't fire on its own. V1 untouched —
the bar lives inside the V2/web-only Members view (native-app firewall +
`data-feature="members"`).

**Verified:** `node --check api/members-agent.js` clean; tour verifier passes.
NOT yet tested live (needs deployed fn + ANTHROPIC_API_KEY + auth + Stripe —
only exercisable on Vercel). Env: `ANTHROPIC_API_KEY` already live in prod.

**Follow-ups / polish (not built):**
- Live end-to-end test on GTA (safe-first: find_members, payment-link).
- Multi-action commands ("pause X and Y") — v1 does one action per proposal.
- Quick-suggestion chips under the bar; per-academy MEMBER_MGMT gating already
  applies (non-GTA academies without Stripe connect will get clean errors on Confirm).
- Voice input (mic) reusing the ticket-form voice pattern.

## Session 8b — 2026-07-06 — Payment-link modal off GHL

The member payment-link / card-link send modal (`_openPaymentLinkModal` in
client-portal.html) used to label its buttons "Send SMS via GHL" / "Send Email
via GHL" and DISABLE them unless the academy had a GHL `location_id`
(`ghl.ready`). GTA is fully off GHL, so both buttons were stuck disabled.

Fix (the send endpoint `api/ghl/send-message` was ALREADY provider-aware -
routes SMS→Twilio, Email→Resend for off-GHL academies via
`maybeSendSmsViaProvider` / `maybeSendEmailViaResend`; only the modal was
wrong):
- **members.js** `actionPaymentLink` + `actionCardSetupLink` now return a
  `messaging: { sms_provider, email_provider, sms_ready, email_ready }` block,
  computed by new `messagingReadiness()` (imports `smsProvider` from
  `messaging/provider.js` = "twilio"|"ghl", `emailProvider` from
  `messaging/email-provider.js` = "resend"|"ghl"). sms_ready = twilio OR has
  GHL location; email_ready = resend OR has GHL location.
- **client-portal.html** modal gates SMS on `messaging.sms_ready && hasPhone`,
  Email on `messaging.email_ready && hasEmail` (falls back to legacy `ghl.ready`
  if `messaging` absent). Buttons relabeled **"Send SMS" / "Send Email"**;
  status text "Sending X…"; reasons line drops the GHL mention and says
  "SMS/Email is not set up for this academy yet." when a channel isn't ready.
- Also fixed 2 em-dashes in the suggested email subjects (HARD RULE).

### Full "off GHL" label audit (2026-07-06)

Audited every send surface + user-facing GHL string in client-portal.html.
Conclusion: the Inbox / V1.5 Inbox / Member inbox / Contacts / Calendar / Home
send boxes (`_ibSendReply`, `_ibComposeSend`, `_v15ibSend`, `_memberInboxSend`,
`_contactsSendMsg`, `_ccQuickSend`, etc.) already just say "Send"/"Reply" with
NO GHL label and NO GHL gating - they POST to the provider-aware
`/api/ghl/send-message` which routes Twilio/Resend off GHL. So they were
already correct; nothing to clean (cleaning = redundant).

The one genuinely-wrong item was the **persistent top banner** (`#ghl-banner`,
toggled in `renderGhlConnectButton`): it told EVERY not-connected academy
"Inbox, Sales, and Payment-Link SMS are inactive until you connect [GHL]" -
false for native academies. Fixed: banner now also requires
`CONTACT_PROVIDER !== 'portal'`, so fully-off-GHL academies (GTA) never see it;
GHL-intended academies still get nagged until they connect.

Left as-is (legit GHL-only, not redundant): workflow picker "No GHL workflows
found", "Open in GHL", "Link GHL contacts", GHL tags/pipelines/calendars refs -
these name real GHL data/features, shown only in GHL context.

## Related notes
- [[project_client_auth]] — how client login + client_id scoping works
- [[project_marketing_content_flow]] — the api/ + view pattern to model
- [[project_app_store_launch]] — the other active client-portal thread
- [[project_onboarding_wizard_parked]] — the 3-step wizard plan, parked
  until GHL is verified end-to-end for BAM GTA
