---
name: Support Ticket System — Current State
description: Full state of the BAM Business support ticket system — what's built, who's on staff, what's next
type: project
originSessionId: 8ad1de9a-293d-4f2c-8592-9ea7741d04d6
---
## What's built and live (as of 2026-04-24)

The full ticket pipeline is built and E2E tested:

```
Client submits (client-portal.html)
  → Manager sees in Systems → Delegation tab
  → Manager delegates to executor (or self-assigns)
  → Executor starts → writes notes → requests client action (optional)
  → Client replies from portal
  → Executor submits for review with user guide
  → Manager approves → client sees "done" with guide
```

Status FSM:
```
open → delegated → in_progress → awaiting_client ──┐
                               → in_review ─────────┼→ done
                               ← needs_rework ←──── ┘
```

## Key infrastructure

- **Supabase project:** `jnojmfmpnsfmtqmwhopz` (By Any Means Basketball Pro)
- **Vercel project:** `bam-portal` (zoran-stars-projects team)
- **Staff portal:** `https://bam-portal-zoran-stars-projects.vercel.app`
- **Client portal:** `https://bam-portal-zoran-stars-projects.vercel.app/client-portal.html`
- **Onboarding:** `https://bam-portal-zoran-stars-projects.vercel.app/onboarding.html`
- **Vercel authentication protection:** OFF (required for public client-facing routes)

## API routes (all in bam-portal/api/)

| File | Purpose |
|------|---------|
| `tickets.js` | Full ticket CRUD — staff (Bearer auth) + public client routes (?public=1) |
| `clients.js` | GET clients (staff auth) + POST create client (public, no auth) |

Public ticket actions: `GET ?public=1&client_id=`, `PATCH ?action=client_respond&public=1`

## Staff (seeded in Supabase `staff` table)

| Name | Email | Role |
|------|-------|------|
| Zoran Savic | zoran@byanymeansbball.com | admin |
| Rosano Arandila | rarandila@gmail.com | systems_manager |
| Chris Delos Trinos | mcdelostrinos@gmail.com | systems_executor |
| Jenny Babe | jennybabeco@gmail.com | systems_executor |

Rosano, Chris, Jenny need Supabase Auth invites sent (Supabase dashboard → Auth → Invite user).
user_id is backfilled automatically on first login.

## Clients table

```sql
clients (id, name, email, status, ghl_location_id, slack_channel_id,
         stripe_customer_id, notion_page_id, asana_project_id,
         created_at, updated_at)
```

`status` check: onboarding | active | paused | churned
13 real BAM clients already seeded from GHL locations.
New clients created via `POST /api/clients` from onboarding.html.

## Client scoping (stopgap)

Auth is `?client_id=<uuid>` URL param → localStorage (`bam_client_id`).
Real magic-link auth is the next planned step.

## Next steps (priority order)

1. **Slack notifications** — ping staff Slack channel when new ticket submitted (small, high impact, Slack already wired in bam-portal)
2. **Client auth** — replace URL-param stopgap with magic link login so clients can bookmark their portal
3. **Client notification emails** — email client when: staff requests action, ticket approved
4. **Onboarding → Slack channel auto-create** — new client row triggers Slack channel creation
