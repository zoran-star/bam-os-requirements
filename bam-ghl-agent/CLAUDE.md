# BAM GHL Agent

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
- **Cameron (Rosano)** — systems/build side
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

**Shareable signup URL:** `https://bam-portal-tawny.vercel.app/onboarding.html` — new clients/testers sign up there. See [[memories/project_public_onboarding.md]] for the flow.

### What's live end-to-end
- **bam-portal-tawny.vercel.app** — staff + client portals deployed on Vercel Pro (no fn cap).
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

### Two-path setup (IMPORTANT — causes confusion)
Project files live in TWO places:
- `/Users/zoransavic/bam-ghl-agent/` — LOCAL (not in monorepo git). Holds the working HTML files: `client-portal.html`, `class-setup.html`, `offer-setup.html`, `parent-onboarding.html`. Also holds `.claude/commands/` (skills) and `.claude/worktrees/` (session worktrees).
- `/Users/zoransavic/bam-os-requirements/bam-ghl-agent/` — GIT (inside the monorepo). Holds this CLAUDE.md, `bam-portal/` React app, `docs/`, `sections/`.

Both folders have a `.mcp.json` pointing Supabase at `jnojmfmpnsfmtqmwhopz`. When starting a new session, open Claude Code on `/Users/zoransavic/bam-os-requirements/bam-ghl-agent/` for portal work, or on `/Users/zoransavic/bam-ghl-agent/` for customer HTML work.

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
    └── add-question.md             ← skill for adding a question to Supabase DB
```

---

## Design standards

All frontend work follows the **Full Control design system** at [`front-end/fullcontrol-brand.md`](../front-end/fullcontrol-brand.md) (repo root). **Exception: `bam-gta-staff/` keeps its own branding — do not apply FullControl design system there.**
- Dark-first (ink surfaces); light mode via `data-theme="light"` toggle
- Space Grotesk for display, Inter for body, JetBrains Mono for labels
- Gold (`#E8C547`) is the only accent — one moment per screen
- No shadows, no gradients, no rounded corners > 6px
- UX principle: guiding info at the point of action; minimize eye travel

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

### When editing bam-portal (staff portal)
1. Stack is React/Vite/Supabase — see `bam-portal/package.json`
2. Check which of the 10 integrations the feature touches
3. Backend keys are still being reconnected — flag if you hit a key-missing issue

### When touching knowledge (sections, guides, questions)
1. Questions live in **Supabase** — add via `.claude/commands/add-question.md`
2. Everything else currently in **Notion** — will migrate to Supabase later
3. Don't create new Notion pages without Zoran's sign-off (migration in progress)

---

## Commit + push discipline

This folder is part of the `bam-os-requirements` monorepo at `bam-os-requirements/bam-ghl-agent/`. Commit and push promptly so Cameron + Cole always have latest state.
