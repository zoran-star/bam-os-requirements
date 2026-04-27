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

## Manual account creation (Supabase dashboard)

See `bam-ghl-agent/docs/client-account-setup.md` for the step-by-step.

## Deferred TODOs

- Self-serve password reset link in the login UI (currently the only way to reset is via Supabase dashboard or `_sb.auth.resetPasswordForEmail()` — wire up later)
- Branded email templates (verify, password-reset) — Supabase defaults are plain
- SMTP for prod deliverability — Supabase's built-in is fine for testing, switch to Postmark/Resend before scaling
- Per-client storage isolation — currently any authed client could upload anywhere in `ticket-files`. URL paths are random UUIDs so practical risk is low. Tighten with a path-prefix RLS check if it becomes a concern.
