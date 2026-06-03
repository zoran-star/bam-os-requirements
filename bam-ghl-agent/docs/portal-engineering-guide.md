# Portal Engineering Guide — read this at the start of every build session

**Purpose:** give any session (you, Cam, Coleman, Mike, Rosano) enough to build in the BAM
portal **safely, fast, and without breaking anything else** — with zero ambiguity about where
things live and how we do them. `/showtime` loads this automatically. If you didn't get here via
`/showtime`, read it now before editing.

> This guide is the **canonical build reference**. CLAUDE.md is the project overview; the
> `memories/` notes are the deep dives. This doc is the "how to actually work here without
> footguns" layer. If this doc and the code ever disagree, **the code wins — then fix this doc
> in the same commit.**

---

## 1. 60-second codebase map

Everything the team builds lives under `bam-ghl-agent/`:

```
bam-ghl-agent/
├── bam-portal/                  ← THE app (React 19 + Vite + Supabase, on Vercel)
│   ├── src/
│   │   ├── App.jsx              ← top-level nav + role-based tab visibility (canSee* flags)
│   │   ├── views/               ← one file per tab (SystemsView, MarketingView, FeedbackView…)
│   │   ├── components/          ← shared UI
│   │   ├── lib/supabase.js      ← the browser Supabase client (anon key, RLS-scoped)
│   │   └── training/            ← Members/training sub-app
│   ├── api/                     ← Vercel serverless functions (the backend)
│   │   ├── clients.js           ← clients + staff + feedback (big; role-gated actions)
│   │   ├── agent-sessions.js    ← /showtime + /byebye ingest + summaries
│   │   ├── marketing.js, ghl.js, stripe/…, slack/…  ← integrations
│   │   └── …
│   ├── public/                  ← CUSTOMER-FACING HTML (plain, no build step)
│   │   ├── client-portal.html   ← logged-in client support portal  ← LIVE, canonical
│   │   └── onboarding*.html      ← public signup flows              ← LIVE, canonical
│   └── scripts/                 ← verify/migration scripts (verify-client-portal-ui.mjs)
├── docs/                        ← this guide, brand, schema, conventions
├── memories/                    ← deep-dive notes (READ THE INDEX: memories/MEMORY.md)
└── archive/, *.html (root)      ← LEGACY / reference-only — DO NOT edit, DO NOT re-create
```

**Two surfaces, two stacks:**
- **Staff portal** = `bam-portal/src/` (React). Build step. Deploys via Vercel.
- **Client/onboarding portal** = `bam-portal/public/*.html` (plain HTML, no build).
- **Backend** = `bam-portal/api/*.js` (Vercel functions). Same deploy.

**Canonical customer HTML lives in `bam-portal/public/` only.** The old root-level
`bam-ghl-agent/*.html` and `archive/` are reference-only — never edit them, never re-create the
deleted duplicates.

**Not every file in `public/` is a live customer page.** `public/` also serves internal reference
docs. Know which is which before editing:

| Live (customer-facing) | Reference / internal (don't treat as product UI) |
|---|---|
| `client-portal.html` | `infrastructure-map.html`, `offer-architecture.html` |
| `onboarding.html`, `onboarding-reloaded.html` | `scale-security-audit.html`, `client-page-layouts.html` |
| `privacy.html` | `client-page-stories.html`, `font-playground.html`, `systems-fonts.html` |

(`support.html` ownership is unconfirmed — ask before touching.)

---

## 2. How we deploy (know this before you touch anything)

- **`main` is protected and auto-deploys to production** (`portal.byanymeansbusiness.com`) on
  every merge. There is no staging gate. A bad merge = a bad prod.
- **Never commit to `main` directly. Always branch → PR → merge.** (See safe-build protocol.)
- Vercel deploys the whole `bam-portal/` on push — frontend **and** `api/` functions together.
- **Do NOT deploy via CLI.** Merging to `main` is the deploy.

---

## 3. Canonical patterns — do it the way the codebase already does it

Match the surrounding code. When there are two ways, these are the blessed ones:

### Supabase — two clients, two trust levels
| Context | Use | Trust |
|---|---|---|
| Browser (`src/`) | `import { supabase } from "../lib/supabase"` (anon key) | **RLS applies** — user only sees their own rows |
| Server (`api/`) | service-role key via the file's `supabaseSelect`/`sbSelect` helpers | **RLS bypassed** — full access |

⚠️ **The #1 footgun:** server functions use the **service-role key, which bypasses RLS.** That
means the API itself is the only thing enforcing "who can see what." If you add an `api/` endpoint
that returns data, **you must gate it in code** — RLS will not save you. (This is exactly why the
Feedback endpoints check `role` by hand.)

### Auth + role gating in `api/` functions
The established pattern (see `api/clients.js`): resolve the caller from their Supabase auth bearer,
look up their `staff.role`, then gate:

```js
const user = await getUserFromBearer(req);            // Supabase /auth/v1/user
const staffRows = await supabaseSelect(`staff?email=eq.${enc(user.email)}&select=role`);
const role = staffRows?.[0]?.role;
if (role !== "admin") return res.status(403).json({ error: "admin only" });
```

Known roles: `admin`, `scaling_manager`, `marketing_manager`, `marketing_executor`,
`systems_manager`, `systems_executor`, `systems`. Common groupings used in code:
`ADMIN_LIKE = {admin, scaling_manager}`.

### Frontend tab/feature visibility
Gated in `App.jsx` via `canSee*` booleans off `me.role` (e.g.
`canSeeFeedback = me?.role === "admin"`). **Frontend gating is UX only — the API must gate too.**

### Customer HTML conventions
- Follow the Full Control design system (`docs/` / `front-end/fullcontrol-brand.md`): dark-first,
  Space Grotesk/Inter/JetBrains Mono, gold `#E8C547` as the only accent, no shadows/gradients,
  corners ≤ 6px.
- Copy tokens: `{{COPY:field}}` (AI copy), `{{custom_values.key}}` (GHL value),
  `<!-- EMBED: [name] -->` (GHL embed point).

---

## 4. Safe-build protocol — the rules that keep prod alive

1. **Pull first.** `git checkout main && git pull` before starting. Cole/Cam may have pushed.
2. **Branch, always.** `git checkout -b <category>/<short-desc>` (`fix/`, `feat/`, `copy/`,
   `chore/`, `docs/`). **Never edit `main`.**
3. **Smallest diff that does the job.** Don't refactor unrelated code in a feature branch. Don't
   reformat files you're not changing. Touch only what the task needs.
4. **Don't delete/replace what you didn't create** without reading it first and confirming. If
   something contradicts how it was described, surface it instead of plowing ahead.
5. **Respect the legacy line.** `archive/` and root-level `*.html` are off-limits.
6. **Update the paired source.** Prototype ↔ Notion, and **update the relevant `memories/` note in
   the same commit** when you change schema, a workflow, a path, or a gotcha (this is a hard rule —
   see CLAUDE.md "Memory upkeep").
7. **Run the pre-ship checks (Section 5) before you commit.**
8. **PR → merge.** Descriptive message; body doubles as the change log. Push promptly so the team
   has latest.

---

## 5. Pre-ship checks — run before committing (and `/byebye` will offer a tailored script)

Minimum gate for any `bam-portal/` change:

```bash
cd bam-ghl-agent/bam-portal
npm run build          # must succeed — catches most breakage in src/ + import errors
npm run lint           # eslint
```

Change-specific:
- Touched **`public/client-portal.html`** → `node bam-portal/scripts/verify-client-portal-ui.mjs`
  (asserts the 6 first-login tour targets still exist; exits 1 if you broke one).
- Touched an **`api/` function** → syntax-check it: `node --check api/<file>.js`, and if it's an
  endpoint, hit it with `curl` against prod/preview to confirm the contract (auth 401/403, happy
  path 200). Prefer a non-mutating probe (e.g. a bogus `?action=` to test auth without writing).
- Touched **Supabase schema / RLS** → confirm both the migration and the code path; remember the
  service-key bypass.

`/byebye` will generate a session-specific test script from your actual diff and recommend running
it before you confirm. **It's skippable — but the summary-parse bug shipped because a step like
this was skipped. Run it.**

---

## 6. Known footguns (the stuff that bites)

- **Service-role key bypasses RLS** in every `api/` function — gate access in code (Section 3).
- **Stripe "sub not app-created":** Connect rejects portal pause/cancel/change/refund on subs the
  app didn't create. Legacy/backfilled members need manual Stripe + DB-only handling. See
  `memories/project_stripe_app_created_subs.md`.
- **GHL white-label path block + scopes:** trim() inputs; white-label "ghl" path is blocked; OAuth
  scope incompatibilities. See `memories/project_next_session_pickup.md`.
- **`claude-sonnet-4-6` rejects assistant-message prefill** — force structured JSON via a tool call
  (`tool_choice`), not a prefilled `{`. (This is in `api/agent-sessions.js`.)
- **Env vars fail silently.** A missing/stale key (e.g. `ANTHROPIC_API_KEY`, ingest secret) won't
  crash — it returns an error string or 401 deep in a response. If something "works locally but not
  in prod" or vice-versa, suspect Vercel env first. Local `.env.local` keys can be stale.
- **Hardcoded identities** still exist in spots (emails, IDs). If you're widening access, grep for
  the old hardcode in **both** the API and the frontend — gates are often duplicated.

---

## 7. Going deeper — where the real detail lives

Read `memories/MEMORY.md` (the index) and open the note that matches your task. High-value ones:
- `supabase_questions_db.md` — Questions DB schema + UUID→label lookup
- `project_v2_onboarding_model.md` — **source of truth** for onboarding behavior
- `project_offer_architecture.md` — Offers wizard / schema
- `project_agent_sessions.md` — the /showtime → /byebye system itself
- `project_next_session_pickup.md` — GHL gotchas + current live state
- `project_pre_launch_checklist.md` — what's intentionally deferred before a real client

> Maintenance: when the portal's structure, deploy model, canonical patterns, or footguns change,
> update this guide **in the same commit** as the code change.
