---
name: Client Portal Auth (email + password, 1 user per client)
description: How clients log in to client-portal.html — Supabase Auth, password-required, manually invited via Supabase dashboard, RLS-scoped queries
type: project
---

## Model

- **Auth provider:** Supabase Auth, email + password (no magic links, no signup form, no third-party providers)
- **Cardinality:** one Supabase auth user per client. The `clients.auth_user_id` column links them.
- **Provisioning:** manual via Supabase dashboard (no in-app signup, no automatic invite trigger).

## Schema

```sql
clients.auth_user_id uuid unique references auth.users(id) on delete set null
```

## RLS policies

`tickets`:
- `client read own tickets` (SELECT, authenticated) — `client_id in (select id from clients where auth_user_id = auth.uid())`
- `client insert own tickets` (INSERT, authenticated) — same predicate
- `client update own ticket messages` (UPDATE, authenticated) — same predicate (UI restricts what the client edits, RLS just gates the row)
- `staff_select_all_tickets`, `Staff can update tickets` — unchanged, gated to authenticated staff (the API endpoint also re-verifies via service role)

`clients`:
- `client read own client row` (SELECT, authenticated) — `auth_user_id = auth.uid()`

`storage.objects` (bucket `ticket-files`):
- SELECT: anon + authenticated (bucket is public, URLs are unguessable UUIDs)
- INSERT: authenticated only (was anon — tightened on auth rollout)

## API

`/api/tickets?public=1`:
- Now requires Bearer token from the Supabase session (was: trusted `client_id` from request body — that pattern is gone)
- Server verifies token via `${SUPABASE_URL}/auth/v1/user`, looks up `clients.auth_user_id = user.id` to derive `client_id`, then scopes queries

## Client portal flow

1. Page load → check Supabase session via `_sb.auth.getSession()`
2. No session → show login overlay (email + password)
3. Sign in success → session is stored in localStorage by Supabase JS
4. Boot resolves CLIENT_ID from `clients.auth_user_id = user.id`
5. Direct Supabase queries from the page are auto-authed via session (RLS scopes)
6. API calls (`/api/tickets?public=1`) include `Authorization: Bearer <access_token>`
7. Sign out clears session + reloads → login overlay

## Removed

- `?client_id=<uuid>` URL param flow — no longer accepted. CLIENT_ID only resolves from the authed user.
- Anon ticket reads — RLS now requires authenticated.
- "Trust the client_id from the body" pattern in /api/tickets.

## Account creation

**Preferred path: Settings → Clients → "+ New client" (admin only).**

Form collects: academy name, owner name, owner email, password (or auto-generated), status (default `onboarding`). On submit, `POST /api/clients` does:
1. Verifies caller is staff with `role = 'admin'`
2. Creates the Supabase auth user via admin API (`auth_confirm: true`, no email verification)
3. Inserts the `clients` row with `auth_user_id` linked
4. Rolls back the auth user if the clients insert fails (no orphans)
5. Returns the new client `id` + `name`

UI then shows the email + password once, with a "Copy credentials" button — staff sends them to the client manually. Password never stored, never shown again.

**Fallback (Supabase dashboard):** see `bam-ghl-agent/docs/client-account-setup.md`. Used for resets, deactivation, and one-off troubleshooting.

## Password reset

**Staff-triggered reset** (preferred):
- Each card on the Clients view has a "🔑 Reset password" action (top-right, only when `client.email` is present)
- Click → confirm → `POST /api/clients?action=reset-password` with `{ email }`
- Server is admin-only, hits Supabase `/auth/v1/recover` with `redirect_to: <origin>/client-portal.html?type=recovery`
- Client receives the standard Supabase recovery email
- Click in email → lands at `client-portal.html#access_token=...&type=recovery`
- Supabase JS picks up the recovery session automatically; `boot()` detects `type=recovery` in URL hash and shows the **"Set a new password"** card instead of the login overlay
- `submitNewPassword()` validates (8+ chars, match), calls `_sb.auth.updateUser({ password })`, strips the recovery hash, reloads → normal login flow

**Required Supabase configuration:**
- Authentication → URL Configuration → Redirect URLs must include `https://<portal-origin>/**` and `http://localhost:5173/**`

**Files touched:**
- `bam-portal/api/clients.js` (action router + recover call + email/auth_user_id in shapeClient)
- `bam-portal/public/client-portal.html` (recovery card + boot detection + submitNewPassword)
- `bam-portal/src/views/ClientsView.jsx` (Reset password button on each card)

## Deferred TODOs

- Self-serve "Forgot password?" link on the login overlay (today: only staff can trigger a reset). Wire up later.
- Branded email templates (verify, password-reset) — Supabase defaults are plain
- SMTP for prod deliverability — Supabase's built-in is fine for testing, switch to Postmark/Resend before scaling
- Per-client storage isolation — currently any authed client could upload anywhere in `ticket-files`. URL paths are random UUIDs so practical risk is low. Tighten with a path-prefix RLS check if it becomes a concern.
