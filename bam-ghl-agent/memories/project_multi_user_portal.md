---
name: Multi-User Client Portal Access
description: 2026-05-20 — letting an academy owner add multiple staff logins to their client portal. DB foundation + RLS rewrite applied; API + both portal UIs still to build. Resume via /account-continue.
type: project
---

## Goal

Move the client portal from **1 login per academy** to **many logins per
academy**. An academy owner (and any teammate) can invite more staff into
their client portal; BAM staff can do the same from the staff portal and
see the full team on each client's page.

Resume with **`/account-continue`**.

## Locked decisions (Zoran, 2026-05-20)

| Decision | Answer |
|---|---|
| Added staff access level | **Same as owner** — full access, no role gating |
| Who can invite | **Any portal user** of that client |
| Revoke access | **Owner + BAM staff** can revoke (regular members cannot) |
| New teammate added | **Slack notification** to the client's channel |
| UI naming | Call them **"Team"** (avoids clash with BAM "staff") |

## 🔴 OPEN DECISION — blocks the rest, re-ask on resume

While rewriting RLS we found the **"Staff" RLS policies are wide open**:
- `tickets/staff_select_all_tickets` SELECT → `qual = true`
- `clients/"Staff can read clients"` SELECT → `auth.role()='authenticated'`
- `clients/"Staff can update clients"` UPDATE → `auth.role()='authenticated'`
- `tickets/"Staff can update tickets"` UPDATE → `auth.role()='authenticated'`
- `client_users/"Staff can read all client users"` SELECT → `auth.role()='authenticated'`

**Effect:** any logged-in client can read/update EVERY academy's data via a
direct Supabase query with their own token. Pre-existing hole. It also means
the new PART B client policies are dead code until this is fixed.

Fix is ready (PART C in the SQL file): add `is_staff()` SECURITY DEFINER
function, scope the 5 policies to it. `staff` table has `user_id` → auth.users
(7 of 8 staff linked). **Re-ask Zoran: fix now, or ship feature + log as a
High Open Loop.** Session paused here.

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

## ⏳ REMAINING — to build on resume

1. **PART C** — staff RLS hardening (pending the open decision above).
2. **API** (`bam-portal/api/clients.js`) — two new actions:
   - `invite-team-member` — caller = BAM staff (admin) **OR any active
     `client_users` member of the target client**. Dual-auth: mirror the
     client Bearer-token verification in `api/tickets.js?public=1`. Generate
     a Supabase invite link, insert a `client_users` row (role 'member'),
     send email + Slack (reuse `postInviteToSlack` / `sendInviteEmail`).
   - `revoke-team-member` — caller = BAM staff OR the client's **owner**.
     Delete the `client_users` row; delete the auth user only if they belong
     to no other client. Cannot revoke an 'owner' row via this path.
3. **Client portal** `bam-portal/public/client-portal.html`:
   - `boot()` (line ~9814) currently resolves clients via
     `clients.auth_user_id = session.user.id` → change to resolve via
     `client_users` (membership). Keep the multi-client switcher (`CLIENT_ROWS`).
   - New **"Team" section/nav item**: list teammates, "Invite teammate"
     button (any user), "Revoke" (owner only). **+ mobile layout** (file has
     a ≤768px stylesheet + bottom tab bar — see [[project_client_portal_mobile]]).
4. **Staff portal** `bam-portal/src/views/ClientsCombinedView.jsx`:
   - `ClientDetail` tabs are defined ~line 372 (overview/messages/setup/
     marketing/activity/notes). Add a **"Team" tab** listing all
     `client_users` for the client + invite + revoke. `AuthActions`
     component (~line 1499) shows the `send()` → `/api/clients?action=`
     pattern to copy.
5. **Notion + memory** — add a PRF requirement (Profiles & Identity domain)
   for multi-user portal access; check Onboarding Data Points DB; update
   [[project_client_auth]] (the "1 user per client" note is now outdated).

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
