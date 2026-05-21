---
description: Resume the Multi-User Client Portal Access build exactly where it was paused
---

Resume the **Multi-User Client Portal Access** build (many logins per academy
via the `client_users` join table). Session paused 2026-05-20.

## Step 1 — Load the handoff

Read these in order:
1. `bam-ghl-agent/memories/project_multi_user_portal.md` — the full handoff:
   locked decisions, the OPEN decision, what's done, what remains, code anchors.
2. `bam-ghl-agent/bam-portal/scripts/migration/client-users-multi-user.sql`
   — the DB migration (PARTS A + B applied; PART C pending).
3. `bam-ghl-agent/CLAUDE.md` — client portal project context.
4. `bam-ghl-agent/memories/project_client_auth.md` — the OLD single-user
   model being replaced.

## Step 2 — Confirm connections

Run `git pull`. Confirm GitHub + Supabase MCP (portal project
`jnojmfmpnsfmtqmwhopz`). Flag anything missing.

## Step 3 — Catch the user up

Print a short, visual catch-up (Zoran is ADHD + a visual learner — tables/
boxes, minimum words):
- What we're building (1 line)
- The 4 locked decisions
- What's DONE (DB foundation + RLS rewrite, live)
- What REMAINS (API, both portal UIs, Notion)
- The OPEN decision that's blocking

## Step 4 — Re-ask the open decision

The session paused with one unanswered question: **the wide-open "Staff" RLS
policies** — any logged-in client can read/update all academies' data via a
direct query. Ask again via AskUserQuestion: fix it now (PART C — add
`is_staff()`, scope the 5 policies) vs ship the feature first and log a High
Open Loop. Details + the ready fix are in the handoff note.

## Step 5 — Continue the build

Once answered, work the REMAINING list in the handoff note: API actions
(`invite-team-member`, `revoke-team-member`), client portal `boot()` + Team
section, staff portal Team tab, then Notion + memory. **Update the mobile UI
in the same pass as desktop** (standing instruction). Update
`project_multi_user_portal.md` as each piece lands.
