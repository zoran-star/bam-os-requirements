---
description: Resume the Member Management → Client Portal workflow exactly where it was paused
---

Resume the **Member Management → Client Portal** build. This continues a
session paused 2026-05-20 for a computer restart.

## Step 1 — Load the handoff

Read these in order:
1. `bam-ghl-agent/memories/project_member_management_portal.md` — the full
   handoff: decisions locked, corrected architecture, the open decision, the
   4-phase plan, portal architecture facts, and where we left off.
2. `bam-ghl-agent/CLAUDE.md` — the client portal project context.
3. `/Users/zoransavic/BAM GTA/CLAUDE.md` + `/Users/zoransavic/BAM GTA/memories/`
   — the blueprint. Focus on schema-decisions.md, stripe-conventions.md,
   plans-and-pricing.md, project-state.md.

## Step 2 — Confirm connections

Run `git pull` first. Confirm GitHub + Supabase MCP (portal project
`jnojmfmpnsfmtqmwhopz`). Flag anything missing.

## Step 3 — Catch the user up

Print a short, visual catch-up (Zoran is ADHD + a visual learner — lead with
diagrams/tables, minimum words):
- What we're building (1 line)
- The 2 locked decisions
- The 4-phase plan with a marker on where we are
- The OPEN decision that blocks Phase 1

## Step 4 — Re-ask the open decision

The session paused with one unanswered question: **how the portal reaches
each academy's Stripe account** — per-client restricted key vs Stripe Connect
vs defer. Ask it again via AskUserQuestion; the 3 options are spelled out in
the handoff note under "OPEN DECISION".

## Step 5 — Continue

Once answered, start **Phase 1 — Data foundation**: migrate the BAM GTA tables
into the portal Supabase, scoped per `client_id`. Follow the plan in the
handoff note, and update that note as each phase completes.
