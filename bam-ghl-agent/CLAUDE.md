# BAM GHL Agent

## ⛔ HARD RULE — never touch V1 unless explicitly told
**V1 is the live production tier** (academies still using GoHighLevel; a client
where `clients.v2_access = false AND clients.v15_access = false`). Do NOT let any
edit change V1 behavior **unless Zoran explicitly says "we're editing V1"** for
that task.

- New features / changes default to **V1.5 and/or V2 only** — gate them so V1
  academies are unaffected (e.g. `if (V2_ACCESS || V15_ACCESS)`, `data-feature`
  gates, or the `_bbIsV1()` pattern that hides things for V1).
- When a change *could* affect V1, call it out and confirm before shipping.
- Bug fixes that clearly apply to all tiers are fine, but say so explicitly.
- This rule is the default; only an explicit "edit V1" instruction lifts it.

## Project memory
Project notes live in [`memories/`](memories/). Scan [`memories/MEMORY.md`](memories/MEMORY.md) first (index of one-liners), then open the specific note. See [`memories/README.md`](memories/README.md) for conventions.

## Memory upkeep — UPDATE IN REAL TIME, NOT JUST AT COMMIT

Update memory **the moment** something changes, not at commit time. Commit-time checks are a safety net, not the trigger.

**Update memory IMMEDIATELY when:**
- A schema changes (new column, new table, renamed enum) → update the relevant note + `supabase_questions_db.md` if questions
- A new file or component is wired up → update the relevant project note
- A workflow/integration changes (Asana → Supabase, env var added, RLS policy changed) → update or create a note
- A decision lands ("we're going PWA not native") → save it
- A path moves → update CLAUDE.md
- A gotcha is discovered (RLS blocking anon, column case-sensitivity, etc.) → save it

**Then before commit, double-check:**
- New note added to `memories/`? → add a line to `MEMORY.md`
- `MEMORY.md` in sync with the `.md` files in the folder?

Run `/memory-audit` periodically. Memory drift wastes context — the cost of not updating is far higher than the cost of updating.

### Mandatory-update notes

A couple of memory notes are explicit sources of truth — if the underlying behavior changes and the note doesn't get updated in the same commit, future sessions will get the model wrong:

- **[V2 Onboarding Model](memories/project_v2_onboarding_model.md)** — must be updated whenever the staff V2 toggle, BB cards, tracker pill, welcome Slack, first-login tour, or auto-resend invite cron changes. The note itself has a "When to update" checklist at the bottom.
- **[Offer Architecture](memories/project_offer_architecture.md)** — must be updated on new offer types, field-renderer changes, or offers/offer_teams/offer_files schema changes.

## What this project is (plain english)

**BAM Business** is a white-labeled GoHighLevel agency service. Clients are sports academies and (eventually) home services companies. BAM handles their CRM, automations, websites, funnels, pipelines, and communications inside GHL sub-accounts.

**This project** is the system that:
1. Onboards new academy owners onto BAM Business (self-serve forms)
2. Handles ongoing support tickets from active clients
3. Gives BAM staff one dashboard to operate everything

**The north star** is **a single portal serving both clients and staff** for BAM Business.

- **Clients** can: interact with staff in dedicated chat windows, see every ad campaign they're running and adjust their own ad spend, submit support tickets and check the status of their systems.
- **Staff** can: operate every client account from one dashboard (the existing bam-portal/), with the autonomous GHL agent (described below) eventually drafting fixes/builds for staff to review before shipping.

The autonomous agent is a *capability* inside the staff side of the portal — not the destination. The destination is the portal itself.

---

## Who's working on it

- **Zoran** — founder, product direction, final decisions
- **Rosano Arandila** — systems_manager (systems/build side)
- **Cameron Wells (Cam)** — marketing_manager (content + guide cards + marketing ops). Email: cam@byanymeansbball.com. NOT the same person as Rosano.
- **Cole** — built the staff portal (bam-portal/), Zoran is admin on his Supabase project

Personal prefs go in `CLAUDE.local.md` (gitignored).

---

## The two portals

### 🚪 Customer-facing (HTML pages, front-end only right now)

Two separate flows — both source their questions from the **Supabase Questions DB**:

**Onboarding flow** — one-time, for a new academy signing up:
```
class-setup.html  →  offer-setup.html  →  parent-onboarding.html
```
*(entry URL — how the client lands here — TBD, will wire up later)*

**Support portal** — `client-portal.html`, ongoing, for existing clients:
- 3 ticket types: **Error** (fix), **Change** (adjust), **Build** (build new)
- Build flow has 10 menu items: Gym Rental, Player Intake, New Hire, Youth Academy, Internal Tournament, Sponsor Inquiry, Camps/Clinics, Upsells, Staff Member, Promo (+ "Build something else" overflow)

> **Source of truth for UX**: the HTML files themselves. `docs/client-portal-flow.md` is the written version but the front end wins when they disagree.

### 🛠 Staff-facing (`bam-portal/` — React/Vite, Supabase, deployed but mostly broken)

Where BAM staff operates on everything the customer portal produces. Cole built it; Zoran is reconnecting the backend with his own keys for full control.

**Stack:**
- React 19 + Vite 8 + React Router 7
- Supabase (shared with Cole — Zoran is admin, Cole has pro)
- Anthropic SDK (Claude API) baked in
- Recharts
- Vercel serverless functions in `/api/`

**10 integrations (each needs a key — backend plan TBD):**
| Integration | Route | Purpose |
|---|---|---|
| Supabase | `lib/supabase.js` | Main DB + auth |
| Anthropic | `/api/ai/search.js` | Claude calls |
| Asana | `/api/asana/tasks.js` | Tickets |
| Google OAuth | `/api/auth/google/*` | Staff login |
| Google Calendar | `/api/calendar/events.js` | Scheduling |
| Google Sheets | `/api/sheets/onboarding.js` | Onboarding data |
| GHL | `/api/ghl.js` | Sub-account ops |
| Notion | `/api/notion/query.js` | Knowledge base |
| Slack | `/api/slack/channels.js` | Comms |
| Stripe | `/api/stripe/overview.js` | Payments |

---

## Current phase (what we're working on NOW)

**Status as of 2026-05-17 — portal is live in production, public onboarding URL is shareable, focus is hardening + filling round-3 gaps.**

**Portal URLs:** `https://staff.byanymeansbusiness.com` = STAFF portal (the React app, `bam-portal/src`); `https://portal.byanymeansbusiness.com` = CLIENT portal (`bam-portal/public/client-portal.html`). Same Vercel project, two domains; APIs + webhooks are served on `portal.byanymeansbusiness.com` (the `PROD` constants in `api/`). Old `bam-portal-tawny.vercel.app` still resolves but the custom domains are canonical. Shareable signup: `portal.byanymeansbusiness.com/onboarding.html`. See [[memories/project_public_onboarding.md]] for the flow.

### What's live end-to-end
- **staff.byanymeansbusiness.com** (staff portal) + **portal.byanymeansbusiness.com** (client portal) — one Vercel Pro project (no fn cap).
- **Supabase** — project ref `jnojmfmpnsfmtqmwhopz`. Tables: `clients` (13 GHL locations seeded), `staff`, `marketing_tickets`, `content_tickets`, `staff_meta_tokens`, `client_meta_tokens` (legacy), `Questions Database` (202 rows), plus auth.
- **Meta API (staff-side)** — one BAM staff token powers every client's campaigns + creatives. Client Setup page bulk-wires clients to ad accounts. See `[[project_meta_api_integration]]`.
- **Marketing/content two-stage flow** — clients submit raw assets, content team produces finals, marketing team launches. See `[[project_marketing_content_flow]]`.
- **Slack** — staff-level OAuth + per-client channel notifications on action requests + ticket completion.
- **Stripe, GHL, Asana, Anthropic, Notion** — all 10 integrations wired.
- **Onboarding** — public self-serve signup flow for new clients (first-run wizard).
- **Permissions** — admin / marketing / content roles; Financials admin-only, Client Setup open to marketing.

### What's actively pending (round 3)
1. **Email/SMS ticket notifications** — Slack ✅; email/SMS still needed for clients without Slack.
2. **Supabase Realtime subscriptions** — portals refresh without manual reload.
3. **Per-client signed URLs** on `ticket-files` bucket (currently public).
4. **Meta token refresh on 401** — 60-day token has no auto-refresh; surface "Reconnect Meta" CTA.
5. **End-to-end test of client-side Meta OAuth** — added 2026-05-16, untested with a non-staff Meta account.
6. **Polish ad-account picker UI** — currently a native `prompt()`. Upgrade to a real modal.
7. **App Review (Meta)** — required before non-tester Meta users can complete client-side OAuth.
8. **Cleanup orphan test tickets/files** for DETAIL Miami (Mike's 4 empty content tickets + ~8 orphan files).

### Deferred / will figure out later
- Per-user Google Calendar OAuth flow
- Customer-portal-to-Slack mirroring (Option B for client comms)
- Onboarding checkpoints/alerts (waiting for client-portal.html scope to fully settle)
- Cleanup legacy `client_meta_tokens` code paths in marketing.js

### Where customer-facing HTML lives
**All customer-facing HTML is canonical at `bam-portal/public/`** (in git, served by Vercel):
- `bam-portal/public/onboarding.html` — public signup
- `bam-portal/public/client-portal.html` — logged-in client portal

The old `/Users/zoransavic/bam-ghl-agent/` local-only folder previously held duplicate copies of these files. The duplicates were deleted 2026-05-17 because they had drifted 23 days stale. **Never re-create them there.** Edit the git versions in `bam-portal/public/`.

The `/Users/zoransavic/bam-ghl-agent/` folder still holds: `.claude/commands/` (skills), `.claude/worktrees/` (session worktrees), and an `archive/` folder of pre-React prototype HTML files (analysis, build-mode, change-ticket-internal, class-setup, offer-setup, parent-onboarding, dashboard, error-ticket-internal). Archived 2026-05-17 — none of these are referenced anywhere in production code. Treat as reference-only.

---

## Data flow (once wired up)

```
Client submits form
  → Write to Supabase
  → Create Asana ticket
  → Staff sees it in bam-portal
  → Staff builds the asset (eventually: agent drafts, staff approves)
  → Pushed into client's GHL sub-account
```

---

## Supabase tables — deprecated / cleanup (audit 2026-05-17, updated 2026-06-03)

> **`client_users` is NOT dead** — it shipped 2026-05-20 as the many-users-per-academy join table
> (owner + invited teammates) and is actively read by both portals' Team tabs. See
> [[memories/project_multi_user_portal.md]].

**DEPRECATED — slated to drop (Zoran's call 2026-06-03).** No code in `bam-portal/` reads or writes
these; they are stale data. **Do not build on them.** Drop after a backup, on/after **2026-07-01**
(retention window). Take a `pg_dump`/CSV export first.

| Table | Rows | Last touched | Note |
|---|---|---|---|
| `board_items` | 20 | 2026-04-09 | Old Notion sync / planning artifact — unused |
| `content_themes` | 20 | 2026-04-05 | Predates `content_tickets`; superseded |
| `content_creatives` | 9 | 2026-03-28 | Same |
| `content_scripts` | 1 | 2026-03-28 | Same |
| `content_feedback` | 15 | 2026-03-28 | Same |

These are SEPARATE from `content_tickets` (the LIVE staff-portal content workflow — used by
MarketingView + ContentView). The `content_*` tables above predate that system.

**`client_meta_tokens` (legacy, KEPT on purpose):** `api/marketing.js` still reads it as a fallback
before `staff_meta_tokens`. The live model is the **staff-side** Meta token powering all clients;
client-side OAuth is untested/deferred. The fallback is harmless (read-only) and removing it would
break any client who self-connected, so **leave it until client-side Meta OAuth actually launches** —
then migrate to `staff_meta_tokens` only and delete the fallback paths.

## Knowledge storage — what lives where

| What | Where | Status |
|---|---|---|
| Form questions for all HTML pages | **Supabase Questions DB** | Live, source of truth |
| Form UX + front-end behavior | **HTML files** in this folder | Source of truth |
| Template sections (HTML for funnel sections) | Notion → Supabase (migration coming) | In Notion for easy reading |
| Build guides per menu item | Notion → Supabase (migration coming) | In Notion |
| Template pages, funnels, forms, custom values, tags | Notion → Supabase (migration coming) | In Notion |

**Notion knowledge base:** https://www.notion.so/33a5aca8ac0f81f38881d3f7003294ec
**Questions DB schema viewer:** `docs/questions-db-schema.html`

---

## File structure

```
bam-ghl-agent/
├── CLAUDE.md                       ← you are here
├── CLAUDE.local.md                 ← personal prefs (gitignored)
├── agent-prompt.md                 ← Claude API system prompt (for eventual agent)
│
├── CUSTOMER-FACING
│   ├── client-portal.html          ← main support portal (Error/Change/Build)
│   ├── class-setup.html            ← onboarding step 1
│   ├── offer-setup.html            ← onboarding step 2
│   └── parent-onboarding.html      ← onboarding step 3
│
├── STAFF-FACING
│   └── bam-portal/                 ← React/Vite staff portal (deployed, live in production)
│
├── NATIVE APP
│   └── bam-portal-app/             ← Capacitor iOS/Android wrapper for the client portal
│                                     (App Store launch — see memories/project_app_store_launch.md)
│
├── LEGACY / STATUS UNKNOWN         ← may be deprecated; confirm before editing
│   ├── dashboard.html
│   ├── error-ticket-internal.html
│   ├── change-ticket-internal.html
│   ├── build-mode.html
│   └── analysis.html
│
├── docs/
│   ├── fullcontrol-brand.md        ← design system (source of truth)
│   ├── questions-db-schema.html    ← Supabase Questions DB visual schema
│   ├── client-portal-flow.md       ← written flow (front end wins if conflict)
│   ├── notion-schema.md            ← Notion KB schema (until migration)
│   ├── ghl-technical-notes.md      ← GHL quirks, API limits
│   ├── copy-convention.md          ← {{COPY:field}} and {{custom_values.key}} rules
│   └── questions-by-form.md        ← question list per form
│
├── sections/                       ← HTML section templates (will move to Supabase)
│   └── README.md
│
├── env/
│   └── .env.example                ← env var reference (real values not in git)
│
└── .claude/commands/
    ├── setup-menu-item.md          ← skill for building a menu item
    ├── add-question.md             ← skill for adding a question to Supabase DB
    └── consolidate-lessons.md      ← skill: cluster/dedup the agents' teach-why
                                      lessons, route them (brain fact / academy /
                                      preset-tagged general / drop), and mine
                                      academy lessons for onboarding intake gaps
                                      (ledger: docs/onboarding-intake-candidates.md;
                                      uses bam-portal/scripts/lessons-io.mjs).
                                      Rollout: docs/agent-academy-rollout.md
```

---

## Design standards

**⛔ MANDATORY for any V2 portal front-end work: read [`bam-portal/design-system/DESIGN.md`](bam-portal/design-system/DESIGN.md) FIRST and use its tokens ([`bam-portal/design-system/tokens.css`](bam-portal/design-system/tokens.css)).** It is the living design system extracted from the V2 Home / Assets / Calendar pages (2026-07-05) and it supersedes the old brand guide for portal surfaces. Quick anchors:
- ONE gold: `var(--gold)` = `#D4B65C` dark / `#C8A84E` light. The old `#E8C547` is DEAD - never reintroduce it.
- Fonts: Plus Jakarta Sans (`--font-ui`) + Nunito for big numbers (`--font-num`) + DM Mono for technical values.
- Locked radius scale: 6 / 8 / 12 / 16 / 24 / 999 via `--r-*` tokens. Nothing in between.
- Rounded warm-SaaS look, soft lift shadows, right-side drawer for detail views, **NO emojis anywhere in product UI or copy** (SVG stroke icons only; client-typed message content renders as-is).

Scope exceptions:
- **`bam-gta-staff/` keeps its own branding** - do not apply the design system there.
- Marketing/editorial pages (non-portal) still follow [`front-end/fullcontrol-brand.md`](../front-end/fullcontrol-brand.md).
- UX principle everywhere: guiding info at the point of action; minimize eye travel.
- **NEVER use an em dash (Unicode U+2014, the long dash) in ANY person-facing output** - emails, SMS, automation messages, UI copy, client sites, agent/chat replies, in every repo, always (this is the repo-wide HARD RULE). Use a hyphen `-`. In the portals specifically (client portal `bam-portal/public/client-portal.html` + staff portal `bam-portal/src/`): for empty fields use `-`; don't use an em dash as a JS "empty" sentinel - detect the placeholder by shape (e.g. money `startsWith('$')`). Note: backend `api/*.js` still emits some U+2014 placeholders; the client should hide/replace them, not render them.

---

## Technical standards

- Customer-facing pages: plain HTML (no build step)
- Staff portal (bam-portal): React/Vite/Supabase
- GHL forms embedded via iframe embed code
- GHL calendars embedded via embed code (free trial calendar only)
- Custom values injected using `{{custom_values.key_name}}` syntax
- No third-party page builders — HTML written directly
- Images hosted on Cloudinary, URLs stored as GHL custom values
- Agent (eventually) outputs HTML + build checklist — human pastes into GHL

### Copy convention
- `{{COPY:field_name}}` — placeholder for AI-written copy
- `{{custom_values.key_name}}` — GHL custom value (injected at render)
- `<!-- EMBED: [Form/Calendar Name] -->` — marks where a GHL embed goes

---

## North star — the BAM Business portal (clients + staff)

The destination is **one portal that serves both sides** of BAM Business:

### Client side — what clients can do in their portal
- **Chat with staff** in dedicated, per-topic chat windows (not a single firehose).
- **See every ad campaign** they're running across BAM-managed channels, and **adjust their own ad spend** without going through staff.
- **Submit support tickets** (Error / Change / Build) and **check the status of their systems** — what's live, what's broken, what's being worked on.

The current `client-portal.html` and onboarding HTML files are the seed of this surface; they will eventually consolidate into a real authenticated client portal.

### Staff side — what staff can do in their portal
The existing `bam-portal/` React app: cross-client roster, financials, communications, knowledge base, tasks, calendar, systems health. This is where staff operate every client account.

### The autonomous GHL agent (capability inside the staff side, not the destination)

The agent is a feature that lives inside the staff portal — it drafts work for staff to review and approve. **Two eventual modes (NOT built yet; portal infrastructure is step 1):**

### Mode 1 — Support Ticket Agent (augmenting staff)
When a client submits an Error/Change/Build ticket:
1. Read ticket type + client inputs
2. Search Supabase for relevant Build Guide
3. Pull matching Template Sections
4. Draft: diagnosis → fix steps → assets → user guide
5. Staff reviews, tweaks if needed, approves → deploys

### Mode 2 — Onboarding Build Agent (augmenting staff)
When new onboarding completes:
1. Read all client inputs
2. Decide site structure (pages/funnels) by business type
3. Pull matching Template Sections for each page
4. Assemble in correct order (Hero first, CTA near bottom)
5. Inject `{{COPY:field}}` with written copy per Copy Instructions
6. Inject `{{custom_values.key_name}}` as-is for GHL to resolve
7. Mark embed points with `<!-- EMBED: [name] -->`
8. Output page-by-page HTML + build checklist → staff reviews → deploys

### Agent rules (for when it's built)
- Never guess a custom value key — always pull from Supabase/Notion
- Never guess a form name — always pull from Supabase/Notion
- Never skip Copy Instructions — treat as mandatory creative brief
- If required inputs aren't satisfied by client answers, flag in Open Items
- Only GHL-native embeds: forms and the free trial calendar
- Default copy tone: direct, athletic, results-focused
- Always draft → staff approves (never ship directly to client)

---

## How to work here

### When editing customer-facing HTML
1. Check `docs/fullcontrol-brand.md` for design rules
2. Pull questions from Supabase Questions DB (see `docs/questions-db-schema.html` and `.claude/commands/add-question.md`)
3. Front-end HTML is the source of truth — `docs/client-portal-flow.md` is reference only
4. **After ANY edit to `bam-portal/public/client-portal.html` UI, run the tour verifier** to confirm the first-login onboarding spotlight targets still exist:
   ```bash
   node bam-portal/scripts/verify-client-portal-ui.mjs
   ```
   The tour depends on 6 specific selectors (ticket types, live tickets list, marketing nav item, new campaign button, change campaign button, pending requests list). If you rename or remove any of them, the script exits 1. Fix by restoring the selector OR updating `TOUR_STEPS` / `TOUR_DEMO_CONTAINERS` in `client-portal.html`. See [[memories/project_client_portal_tour]] for the full tour design.

### When editing bam-portal (staff portal)
1. Stack is React/Vite/Supabase — see `bam-portal/package.json`
2. Check which of the 10 integrations the feature touches
3. Backend keys are still being reconnected — flag if you hit a key-missing issue
4. Before touching Supabase migrations, seeds, local replay, storage buckets, or linked project repair, read `bam-portal/supabase/README.md`. It explains the temporary historical backfills, repair-applied requirement, seed ordering, storage caveat, and why `supabase migration fetch --linked` is risky right now.

### When touching knowledge (sections, guides, questions)
1. Questions live in **Supabase** — add via `.claude/commands/add-question.md`
2. Everything else currently in **Notion** — will migrate to Supabase later
3. Don't create new Notion pages without Zoran's sign-off (migration in progress)

---

## Commit + push discipline

This folder is part of the `bam-os-requirements` monorepo at `bam-os-requirements/bam-ghl-agent/`. Commit and push promptly so Cameron + Cole always have latest state.
