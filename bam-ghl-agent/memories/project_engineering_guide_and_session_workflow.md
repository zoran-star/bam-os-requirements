---
name: Engineering guide + safe session workflow (/showtime primes, /byebye tests)
description: 2026-06-03. The portal's "know-everything + build-safely" doc, the /showtime priming + /byebye test-gate workflow, and the API hardening (canonical _roles.js, _env.js requireEnv, /api/health) that came out of it.
metadata:
  type: project
---

# Engineering guide + safe session workflow

Set up 2026-06-03 so any team session (Cam/Coleman/Mike/Rosano) starts fully primed and ships safely.

## The pieces

- **`docs/portal-engineering-guide.md`** — the canonical "know the whole portal + build without
  breaking anything" doc: codebase map, deploy model, canonical patterns, safe-build protocol,
  pre-ship checks, footguns, live-vs-reference HTML. **`/showtime` loads it automatically.** If the
  portal's structure / patterns / footguns change, update this guide in the same commit.

- **`/showtime`** (`.claude/commands/showtime.md`) now PRIMES first (pull latest → read the guide +
  CLAUDE.md + memory index → lock safe-build rules), THEN records. Priming is the point; recording
  is secondary. Per Zoran: the showtime skill is where session onboarding lives (no SessionStart
  hook).

- **`/byebye`** generates a session-specific TEST SCRIPT from the actual git diff and recommends
  running it before sending (generate + recommend — skippable, per Zoran). Also fixed the finish
  upload to `--slurpfile` + `curl -d @file` (the `$(cat)` path overflowed ARG_MAX on long sessions
  and failed live).

## API hardening (canonical patterns introduced)

- **`api/_roles.js`** — single source of truth for staff role sets (`ADMIN_ROLES`,
  `ADMIN_LIKE_ROLES`, `MARKETING_ROLES`, `MARKETING_OPS_ROLES` = marketing w/o scaling_manager,
  `SYSTEMS_ROLES`, `SYSTEMS_MANAGER_ROLES`, `ANY_STAFF_ROLES`, `ASSIGNABLE_STAFF_ROLES` = excludes
  legacy `systems`) + `hasRole()`. `clients.js` / `marketing.js` / `tickets.js` migrated to import
  from it (behavior-preserving — they used to re-declare drifting Sets). **New role gating must
  import from `_roles.js`; mirror changes in `App.jsx` `canSee*` flags.**
- **`api/_env.js`** — `requireEnv("A","B")` (throws clear "Missing required env var" → real 500),
  `firstEnv`, `envPresent`. Use instead of `process.env.X || ""` so missing config fails loudly.
  `agent-sessions.js` is the reference adopter. Rolling it across all functions is a follow-up.
- **`api/health.js`** — `GET /api/health?secret=<CRON_SECRET>` reports every integration's
  configured/live status (booleans only) + a live Supabase ping. `?strict=1` → 503 when a required
  integration is down (wire to an uptime monitor).

## Audit decisions (2026-06-03)

- Files starting with `_` in `api/` are NOT Vercel functions (helpers) — they don't count against
  the function cap. Portal is on **Vercel Pro (no cap)** anyway (27 functions live).
- `client_users` is **shipped & in use** (was wrongly listed as dead in CLAUDE.md — corrected).
- `board_items` + `content_*` tables are **deprecated, slated to drop after 2026-07-01** (backup
  first). See CLAUDE.md "Supabase tables — deprecated / cleanup".
- `client_meta_tokens` legacy fallback **kept on purpose** — remove only when client-side Meta OAuth
  launches.
- **eslint doesn't lint `api/` correctly** (no Node env → every file throws `'process' is not
  defined`). Pre-existing; `npm run build` + `node --check` + import tests are the real gate for
  serverless functions until the eslint config is fixed.
