---
name: Team page wired to real backend
description: 2026-05-18 — Team tab was rendering hardcoded SAMPLE_STAFF + Add/Edit/Reset modals hit nonexistent /api/staff URLs (with a deceptive 404=success fallback). Now reads from supabase.from('staff') and all 3 modal actions go through api/clients.js.
metadata:
  type: project
---

## What was broken (pre-2026-05-18)

The Team tab (`/team` in staff portal) looked finished but was a Potemkin village:

1. **List was fake.** `src/views/TeamView.jsx` had a `SAMPLE_STAFF` const with 6 hardcoded rows (line 5-12). Real Supabase `staff` table had 8 different rows. Coleman showed in the UI but doesn't exist in the DB. Cameron Wells, Alex Silva, and Ximena Aguado existed in the DB but never showed in the UI. Several emails on the visible cards were also wrong (Mike, Rosano, Chris, Jenny had stale `@byanymeansbball.com` emails — real DB had `@byanymeansbusiness.com` for most).

2. **Modals hit nonexistent endpoints.** `src/components/StaffModals.jsx` POSTed to `/api/staff`, PATCHed to `/api/staff/:id`, POSTed to `/api/staff/:id/reset-password`. None of these routes existed under `api/`. The modals had a "graceful fallback" pattern (`if (!res.ok && res.status !== 404)`) that swallowed 404s as success — admins clicking Save or Send Link got a fake confirmation toast and nothing happened.

3. **NewStaffModal was the one exception** — it called `/api/staff` (POST) which 404'd, but its check (`if (!res.ok)`) DID surface that as an error. So Add Staff was visibly broken; Edit + Reset were invisibly broken.

## What changed

**Backend** (`bam-ghl-agent/bam-portal/api/clients.js`)

Added two new POST actions to the existing clients handler. Both are in `ADMIN_ONLY_ACTIONS` (which actually means admin + scaling_manager per the auth helper):

- `action=update-staff` — body `{id, name, email, role}`. Validates role against the canonical 6-role set, PATCHes the staff row by id, returns the updated row.
- `action=reset-staff-password` — body `{email}`. Same Resend-based flow as the client `reset-password` action, but the recovery link redirects to `${origin}/?type=recovery` (staff portal root) instead of `${origin}/client-portal.html?type=recovery`.

The existing `invite-staff` action was already correct — it inserts the staff row and sends a Supabase invite. No changes there.

**Frontend** (`src/components/StaffModals.jsx`)

All 3 fetch calls switched from `/api/staff/*` to `/api/clients?action=...`:
- NewStaffModal → `POST /api/clients?action=invite-staff` (unchanged body)
- EditStaffModal.saveChanges → `POST /api/clients?action=update-staff` with `{id, name, email, role}`
- EditStaffModal.sendResetLink → `POST /api/clients?action=reset-staff-password` with `{email}`

Removed the deceptive 404-as-success fallback in both Edit handlers. Real errors now surface.

**Frontend** (`src/views/TeamView.jsx`)

- Removed `SAMPLE_STAFF`. Reads from `supabase.from("staff").select("id,name,email,role").order("name")` on mount.
- `refresh()` re-increments a `refreshCounter` state that the useEffect depends on. Called after onCreated / onSaved so the list updates without a hard reload.
- Loading + fetch-error states added.
- Dropped the `§ TEAM / Staff Members / N members. Click any card...` decorative header block. Replaced with a single slim row: count on the left, `+ Add staff member` button on the right (matches the Marketing / Content / Guides cleanup pattern).
- Add button + card-edit click are now gated to `me.role === "admin"`. `scaling_manager` users can view the Team page (App.jsx gates the route to admin+scaling) but can't add or edit — pointer cursor flips to default for non-admins.
- Rows with `null` email render `no email` in italic muted text (Alex Silva is the one row in the current DB without an email).

## Files touched

- `bam-ghl-agent/bam-portal/api/clients.js` — added `update-staff` and `reset-staff-password` actions; added both to the `ADMIN_ONLY_ACTIONS` set
- `bam-ghl-agent/bam-portal/src/components/StaffModals.jsx` — URLs + error handling
- `bam-ghl-agent/bam-portal/src/views/TeamView.jsx` — full rewrite of the list view

## Gotchas worth remembering

- **The "graceful 404 fallback" pattern is dangerous.** It's a dev convenience that makes broken endpoints look like they work. Any modal that does this should explicitly comment WHY (e.g. "backend deliberately deferred until X is ready"), or remove the fallback. There may be similar patterns in other modals — worth a grep for `status !== 404` next polish round.
- **`ADMIN_ONLY_ACTIONS` in `api/clients.js` is misnamed.** It actually allows `admin` OR `scaling_manager` (via `ADMIN_LIKE_ROLES`). True admin-only would need a separate set. For staff edits, scaling_manager being allowed is probably fine but worth confirming with Zoran.
- **The `staff` table has nullable `email`.** Alex Silva's row has no email. UI handles this (italic placeholder), but if anything tries to send an invite/reset to a no-email staff member it'll 400. Currently impossible from UI since Edit modal pre-fills the email and refuses to save if empty.

## Related notes

- [[project_session_2026_05_17_polish]] — the polish session that added the Resend reset-password flow this builds on
- [[project_pre_launch_checklist]] — the "real client" gate; this fix knocks one item off (Team page is now actually functional, not just a mockup)
