---
name: Member Management → Client Portal
description: 2026-05-20 — incorporating the BAM GTA member-management system into the client portal as a client-side "Members" feature. Planning done; Phase 1 not started; blocked on a Stripe-access decision. Resume via /member-management-continue.
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

## OPEN DECISION — blocks Phase 1

How does the portal reach each academy's Stripe account? The portal today
only holds BAM Business's master Stripe key (`process.env.STRIPE_SECRET_KEY`);
GTA's athlete subs live in GTA's own Stripe account. Options presented,
NOT yet answered:

- **A. Per-client restricted key** — store each academy's Stripe restricted
  API key on its `clients` row (secret/encrypted). GTA already made one for
  the Discord bot. Lowest effort, matches the bot's model. (Leading recommendation.)
- **B. Stripe Connect** — each academy a connected account under BAM
  Business. Cleaner long-term, much bigger lift.
- **C. Defer** — build Phase 1 + 2 (data + read-only roster) now, decide the
  write model before Phase 3.

→ `/member-management-continue` should re-ask this first.

## The 4-phase plan

- **Phase 1 — Data foundation.** Create members / cancellations / referrals /
  refunds / member_audit_log in the portal Supabase, each with a `client_id`
  FK; create/identify a `clients` row for BAM GTA; migrate GTA's ~50 member
  rows + history under that client_id.
- **Phase 2 — Read-only Members tab.** New "Members" view in
  client-portal.html (sidebar nav + mobile bottom nav + view container) +
  `api/members.js` GET, client-scoped roster with live Stripe status.
- **Phase 3 — Billing actions.** PATCH actions porting the 7 GTA skills,
  honoring GTA's locked Stripe conventions; confirm modal as the
  "preview → y" safety gate; a member_audit_log row per write.
- **Phase 4 — Generalize (later).** Per-client plan→price map, add-member
  flow, trainer/archetype as per-client config.

## v1 default assumptions (unless Zoran objects)

- Keep GTA's `plan` + `status` enums as-is.
- `trainer` / `archetype` become plain text (academy staff vary).
- Discord bot stays running for GTA; portal is an additional surface.

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

Planning complete. Phase 1 NOT started. Next action on resume: get the
Stripe-access decision, then start Phase 1 (Supabase migration).

## Related notes
- [[project_client_auth]] — how client login + client_id scoping works
- [[project_marketing_content_flow]] — the api/ + view pattern to model
- [[project_app_store_launch]] — the other active client-portal thread
