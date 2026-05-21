---
name: Multi-User Client Portal Access
description: 2026-05-20 — many logins per academy via the client_users join table. DB + API + both portal UIs SHIPPED. Notion requirement still to add.
type: project
---

## Goal

Move the client portal from **1 login per academy** to **many logins per
academy**. An academy owner (and any teammate) can invite more staff into
their client portal; BAM staff can do the same from the staff portal and
see the full team on each client's page.

**Status: feature SHIPPED end to end (2026-05-20).** Only the Notion
business-requirement write-up is outstanding.

## Locked decisions (Zoran, 2026-05-20)

| Decision | Answer |
|---|---|
| Added staff access level | **Same as owner** — full access, no role gating |
| Who can invite | **Any portal user** of that client |
| Revoke access | **Owner + BAM staff** can revoke (regular members cannot) |
| New teammate added | **Slack notification** to the client's channel |
| UI naming | Call them **"Team"** (avoids clash with BAM "staff") |

## ✅ RESOLVED — staff RLS hole fixed (PART C)

The pre-existing "Staff" RLS policies on tickets/clients/client_users were
wide open (`qual = true` / `auth.role()='authenticated'`). Zoran chose to
fix now. Migration `staff_rls_scope_to_real_staff` applied: added
`is_staff()` SECURITY DEFINER fn, scoped all 6 open policies to it.
Verified — staff sees all, client sees only their own.

## ✅ DONE — applied to live Supabase (jnojmfmpnsfmtqmwhopz)

SQL recorded in `bam-portal/scripts/migration/client-users-multi-user.sql`.

- **PART A** (migration `client_users_multi_user_foundation`):
  - Dropped old `client_users_user_id_key` UNIQUE(user_id) — one auth user
    can own multiple clients (e.g. Mike).
  - `client_users` extended: `role` ('owner'|'member', default 'member'),
    `status` ('active'|'revoked', default 'active'). CHECK constraints +
    `unique(user_id, client_id)` + indexes.
  - Backfilled **7 owner rows** (every client with `auth_user_id`). Verified.
  - `public.my_client_ids()` — SECURITY DEFINER fn returning the caller's
    active client_ids. Recursion-safe (bypasses client_users RLS).
- **PART B** (migration `client_users_rls_multi_user`):
  - Rewrote 13 client-scoped policies across 8 tables (clients, tickets,
    marketing_tickets, content_tickets, conversations, conversation_messages,
    client_meta_tokens, client_users) → `client_id in (select my_client_ids())`.
  - `device_tokens` + `conversation_reads` left alone (keyed to user's own id).
- **Verified** my_client_ids() returns correctly when impersonating a real
  owner. RLS filtering itself can't be fully proven until PART C closes the
  open staff policies.

## ✅ DONE — API (`bam-portal/api/clients.js`)

Two new dual-auth actions, placed BEFORE the staff-only gate so a
client-portal caller isn't 403'd:
- `invite-team-member` — caller = BAM staff **OR any active `client_users`
  member** of the target client. generate_link (invite, or magiclink for an
  existing auth user), upserts a `client_users` row (`role 'member'`,
  reactivates a revoked row), emails the teammate + posts to the client's
  Slack channel.
- `revoke-team-member` — caller = BAM staff **OR the client's owner**.
  Soft-revoke (`status='revoked'`); the auth user is left intact (re-invite
  reactivates). Cannot revoke an `owner` row.

## ✅ DONE — Client portal (`client-portal.html`)

- `boot()` now resolves clients with no `auth_user_id` filter — RLS
  (`my_client_ids()`) scopes the query, so owners AND teammates resolve.
- New **"Team"** sidebar nav item + `view-team` + mobile bottom-nav tab.
- Team view: lists members (owner badged), "+ Invite teammate" (any user),
  "Revoke" (owner only, on member rows). Invite + revoke modals.
- Mobile styles included in the same pass (`@media (max-width:768px)` in
  the team `<style>` block; modals get the existing bottom-sheet treatment).
- Tour verifier (`scripts/verify-client-portal-ui.mjs`) passes.

## ✅ DONE — Staff portal (`ClientsCombinedView.jsx`)

- New **"Team" tab** on the client detail page (`TeamTab` component).
- Lists all `client_users` for the client, inline invite form, inline
  revoke confirm. Routes through `/api/clients?action=invite-team-member`
  / `revoke-team-member`. `npm run build` passes.

## ⏳ REMAINING

- **Notion** — add a PRF requirement (Profiles & Identity domain) for
  multi-user portal access. Onboarding Data Points DB: nothing to add
  (teammates are added ad-hoc, not during onboarding; no new config/threshold).

## Known minor gaps (not blockers)

- The first-login tour's `complete-onboarding` API matches the client by
  `clients.auth_user_id` — a non-owner teammate on a not-yet-onboarded
  client couldn't mark the tour done. Edge case; cosmetic.
- "Invited but not yet logged in" state is not shown in either Team list —
  v1 shows all active members flat. Enhancement: enrich with
  `auth.users.last_sign_in_at`.

## Code anchors (so resume doesn't re-explore)

- `client-portal.html` — 10,288 lines. `boot()` ~9814, `signOut()` ~8828,
  CLIENT_ID/CLIENT_ROWS module vars ~7653, recovery/invite flow in boot.
- `ClientsCombinedView.jsx` — 1831 lines. `ClientDetail` ~367, tab list
  ~372, `SetupTab` ~523, `AuthActions` ~1499.
- `api/clients.js` — `setup-account` action ~1301 (genLink helper, smart
  3-way invite), `invite-staff` ~899, `postInviteToSlack` ~353,
  `ADMIN_ONLY_ACTIONS` set ~883. Existing actions assume a STAFF caller —
  `invite-team-member` needs the new dual-auth path.

## client_users schema (current)

`id, user_id (→auth.users), client_id (→clients), name (NOT NULL), email,
phone, created_at, updated_at, role ('owner'|'member'), status
('active'|'revoked')`. Unique on `(user_id, client_id)`.

## Related notes
- [[project_client_auth]] — the OLD single-user model (now being replaced)
- [[project_client_portal_mobile]] — mobile layout; update mobile in same pass
- [[project_app_store_launch]] — client portal is also going native
