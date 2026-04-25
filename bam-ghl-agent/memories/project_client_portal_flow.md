---
name: Client Portal Flow
description: Architecture and flow for the BAM OS client-facing portal — now live on Vercel
type: project
originSessionId: 8ad1de9a-293d-4f2c-8592-9ea7741d04d6
---
## Live URLs

| Page | URL |
|------|-----|
| Client portal | `https://bam-portal-zoran-stars-projects.vercel.app/client-portal.html` |
| Onboarding | `https://bam-portal-zoran-stars-projects.vercel.app/onboarding.html` |
| Staff portal | `https://bam-portal-zoran-stars-projects.vercel.app` |

All three are co-hosted on the same Vercel deployment — same origin as `/api/`, no CORS needed.

## File locations

- **Git (source of truth for portal files):** `bam-ghl-agent/bam-portal/public/client-portal.html` and `onboarding.html` in the `bam-os-requirements` monorepo
- **Local working copies:** `/Users/zoransavic/bam-ghl-agent/client-portal.html` and `onboarding.html` — kept in sync manually
- When editing: edit the local copies, then cp to `bam-portal/public/` and commit

## Architecture

- Single HTML files — no build step, plain JS + Supabase CDN
- All views (ticket list, error form, change form, build menu, per-item forms, confirmation) live in one file and swap via JS
- No iframes
- Light/dark theme via `data-theme="light|dark"` on `<html>`

## Flow

1. **Onboarding** (`onboarding.html`) → POST `/api/clients` → inserts `clients` row (status=onboarding) → redirects to `client-portal.html?client_id=<uuid>`
2. **Client portal** — shows live tickets at top (fetched from Supabase), then 3 tiles: Fix / Adjust / Build
3. **Ticket submission** → writes to `tickets` table with `client_id`
4. **File upload** → Supabase Storage bucket `ticket-files`, URLs stored in `tickets.files`
5. **Action required** → tickets with `status=awaiting_client` shown at top; client replies via PATCH `/api/tickets?action=client_respond&public=1`

## Ticket status → UI label mapping

| DB status | Client portal label |
|-----------|---------------------|
| awaiting_client | action-required (shown first) |
| done / approved | approved |
| anything else | in-progress |

## Client scoping (stopgap)

`?client_id=<uuid>` URL param → `localStorage.bam_client_id`. No real auth yet.
Next: magic link login.

## Design

Full Control design system: `docs/fullcontrol-brand.md`
- Dark-first, `#0A0A0B` ink, `#E8C547` gold accent
- Space Grotesk (display) + Inter (body) + JetBrains Mono (labels)
- No shadows, no gradients, corners ≤6px
- Light mode supported via `html[data-theme="light"]`

## Build menu items (10 tiles)

Gym Rental, Player Intake, New Hire, Youth Academy, Internal Tournament, Sponsor Inquiry, Camps/Clinics, Upsells, Staff Member, Promo + "Build something else" overflow
