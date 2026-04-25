---
name: BAM GHL Agent File Locations
description: Where files live for the BAM GHL Agent project — local copies, git repo, and live Vercel URLs
type: project
originSessionId: 8ad1de9a-293d-4f2c-8592-9ea7741d04d6
---
## Two-path setup (important)

| Location | What lives here |
|----------|----------------|
| `/Users/zoransavic/bam-ghl-agent/` | Local working copies — client-portal.html, onboarding.html, onboarding flow HTML pages. Edit here first. |
| `bam-os-requirements/bam-ghl-agent/` | Git monorepo. `bam-portal/` React app + `public/` HTML files committed here. Push to main → Vercel auto-deploys. |

## Live Vercel URLs

- Staff portal: `https://bam-portal-zoran-stars-projects.vercel.app`
- Client portal: `https://bam-portal-zoran-stars-projects.vercel.app/client-portal.html`
- Client onboarding: `https://bam-portal-zoran-stars-projects.vercel.app/onboarding.html`

## Key files

**Local only (not git):**
- `/Users/zoransavic/bam-ghl-agent/client-portal.html` — local working copy
- `/Users/zoransavic/bam-ghl-agent/onboarding.html` — local working copy
- `/Users/zoransavic/bam-ghl-agent/class-setup.html` — onboarding step 1
- `/Users/zoransavic/bam-ghl-agent/offer-setup.html` — onboarding step 2
- `/Users/zoransavic/bam-ghl-agent/parent-onboarding.html` — onboarding step 3

**Git-tracked (bam-portal/public/ → served by Vercel):**
- `bam-ghl-agent/bam-portal/public/client-portal.html`
- `bam-ghl-agent/bam-portal/public/onboarding.html`

**API (Vercel serverless, bam-portal/api/):**
- `tickets.js` — full ticket CRUD (staff + public client routes)
- `clients.js` — GET list (staff) + POST create (public)
- `auth/google/[step].js` — Google Calendar OAuth (merged login+callback into one function to fit 12-function Hobby cap)

**React staff portal (bam-portal/src/):**
- `views/SystemsView.jsx` — Delegation / Execution / Review tabs
- `hooks/useStaffMe.js` — loads logged-in staff row by email
- `services/ticketsService.js` — all ticket API calls with Bearer token

## Workflow for editing HTML pages

1. Edit `/Users/zoransavic/bam-ghl-agent/<file>.html`
2. `cp` to `bam-ghl-agent/bam-portal/public/<file>.html` in the worktree
3. Commit + push to main → Vercel deploys

## Skills (Claude Code custom commands)

Path: `/Users/zoransavic/bam-ghl-agent/.claude/commands/`
- `setup-menu-item.md`
- `add-question.md`

## Supabase

- Project ref: `jnojmfmpnsfmtqmwhopz` (By Any Means Basketball Pro)
- MCP config: `/Users/zoransavic/bam-ghl-agent/.mcp.json`
- Vercel authentication protection: OFF (required for public client routes)
