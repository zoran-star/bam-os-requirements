---
name: Client Portal Auth (email + password)
description: How clients log in to client-portal.html — Supabase Auth, password-required, RLS-scoped queries. NOTE: cardinality is now MANY users per client — see [[Multi-User Client Portal Access]].
type: project
---

> ⚠️ **Superseded in part (2026-05-20):** the client portal is now
> **multi-user** — many logins per academy via the `client_users` join
> table, with RLS scoped by `my_client_ids()`. The "1 user per client /
> `clients.auth_user_id`" model below is the OLD design. The auth provider,
> password/invite/recovery machinery still apply. See
> [[Multi-User Client Portal Access]] for the current model.

## Model

- **Auth provider:** Supabase Auth, email + password (no magic links, no signup form, no third-party providers)
- **Cardinality:** ~~one Supabase auth user per client~~ → now **many users per client** via `client_users` (owner + invited teammates). `clients.auth_user_id` is kept as the owner pointer.
- **Provisioning:** owner via the staff portal; teammates via the in-portal "Invite teammate" flow or the staff portal Team tab.

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

**Two paths from the staff portal:**

### A) New client from scratch (Settings → Clients → "+ New client")
Use when adding a brand-new academy that's not in `clients` yet. Creates a new clients row + Supabase auth user in one step.

Form collects: academy name, owner name, owner email, password (or auto-generated), status (default `onboarding`). On submit, `POST /api/clients` does:
1. Verifies caller is staff with `role = 'admin'`
2. Creates the Supabase auth user via admin API (`auth_confirm: true`, no email verification)
3. Inserts the `clients` row with `auth_user_id` linked
4. Rolls back the auth user if the clients insert fails (no orphans)
5. Returns the new client `id` + `name`

UI then shows the email + password once, with a "Copy credentials" button — staff sends them to the client manually. Password never stored, never shown again.

### B) Send invite to an existing client (Clients page → card → "✉ Set up account")
Use for the 20+ clients seeded earlier without owner/email/auth_user_id. Each card shows one of two top-right pills (in the right column above the status pill):
- **"✉ Set up account"** (green) when `auth_user_id is null`
- **"🔑 Reset password"** (gold) when the account exists

**Invite-based flow (client picks their own password, never visible to staff):**

Clicking "Set up account" opens `SetupAccountModal` which collects only owner_name + email (no password). Submits to `POST /api/clients?action=setup-account` which:
1. Verifies admin auth
2. Validates client_id + owner_name + email
3. Confirms the client doesn't already have `auth_user_id` (otherwise rejects)
4. Calls Supabase `/auth/v1/invite` with `{ email, redirect_to: <origin>/client-portal.html?type=invite }` — this creates the auth user (no password) AND sends the invite email
5. UPDATEs the clients row with owner_name + email + auth_user_id
6. Rolls back the auth user (DELETE) if the UPDATE fails

Modal then flips to a "✓ Invite sent" success view explaining what happens next. Page reloads — card flips to "🔑 Reset password".

**Client receives:** standard Supabase invite email → clicks link → lands at `client-portal.html?type=invite#access_token=...` → portal detects `type=invite` and shows "Welcome — choose your password" form → submits via `_sb.auth.updateUser({ password })` → strips URL → reloads → normal logged-in portal. **The link expires in 24 hours**; if missed, click "Reset password" on the card to send a fresh one (same end-user experience).

Path A (Settings → New client) still uses staff-typed password for now — the Settings flow assumes the staff member is admin-creating an account they'll use themselves for testing. Could be unified later.

**Fallback (Supabase dashboard):** see `bam-ghl-agent/docs/client-account-setup.md`. Used for resets, deactivation, and one-off troubleshooting.

### "Already has a login" → account-added email (added 2026-06-01)

When you set someone up whose **email already exists as a confirmed auth user** (e.g. an owner taking on a 2nd academy, a teammate who's also staff, a staffer who already had a client login), Supabase `generate_link(invite)` returns **422 already-registered** and the code falls into a **link-existing** branch. These people don't need to set a password — they already have one.

Previously the link-existing branches sent the generic "set your password" invite email built around a **magic link**, and the whole email send was **gated on `actionLink`** — so if `generate_link(magiclink)` failed, the user got wired up but **received nothing**, and staff saw a 200 (silent failure). `invite-staff` link-existing sent **nothing at all**, ever.

**Fix (commit on `fix/new-client-email-not-sending`):** new `buildAccountAddedEmail` / `sendAccountAddedEmail` in `api/clients.js`. It points at the **plain login page** (not a magic link), so it can never silently no-op; the magic link is now only an optional one-tap convenience line. Copy: *"You've been added to X — you already have a BAM login, just sign in."* `kind` ∈ `owner | teammate | staff` only changes wording. From domain is the same verified `portal@byanymeansbball.com`.

**Wired into all four link-existing spots:**
| Action | kind | login URL |
|---|---|---|
| `setup-account` | owner | `<clientUrl>/client-portal.html` |
| `invite-team-member` | teammate | `<clientUrl>/client-portal.html` |
| `invite-staff` (was silent) | staff | `<staffUrl>/` |
| `transfer-owner` (was reset email) | owner | `<clientUrl>/client-portal.html` |

Fresh-invite / resend modes are unchanged — they still send the "set your password" invite (`sendInviteEmail`) since those users genuinely have no password yet.

**How this surfaced:** Zoran created client "By Any Means Basketball" (owner `coleman@byanymeansbball.com`) on 2026-06-01. Coleman's email had been a confirmed, already-signed-in auth user since 2026-03-27, so setup-account took link-existing → magic-link invite. He already had a working password (didn't need any email). The real gap was that anyone in that situation gets confusing/spam-prone mail or nothing.

**Slack note (minor follow-up):** link-existing still posts the invite-flavored `postInviteToSlack` ("set your password") rather than an "added — just log in" variant. Email is fixed; Slack copy not yet specialized.

## Password reset (and invite — same machinery)

**Staff-triggered** (only path for now — self-serve "Forgot password?" is a deferred TODO):
- Each card with `auth_user_id` shows "🔑 Reset password" (gold) in the top-right of the card right column
- Click → confirm → `POST /api/clients?action=reset-password` with `{ email }`
- Server is admin-only, hits Supabase `/auth/v1/recover` with `redirect_to: <origin>/client-portal.html?type=recovery`
- Client gets a standard Supabase email → clicks → lands at `client-portal.html?type=recovery#access_token=...`

**Same destination, different copy:**
- `boot()` reads `type` from query (preferred) or hash (fallback)
- Calls `showRecoveryForm(flowType)` which adapts the title/sub/button copy:
  - `type=invite` → "Welcome — choose your password" / "Save & sign in →"
  - `type=recovery` → "Set a new password" / "Save password →"
- Supabase JS auto-creates a session from the access_token in the hash
- `submitNewPassword()` validates (8+ chars, must match), calls `_sb.auth.updateUser({ password })`, `history.replaceState` strips the hash, `location.reload()` → normal logged-in portal (session persists in localStorage)

**Required Supabase configuration:**
- Authentication → URL Configuration → Redirect URLs must include `https://<portal-origin>/**` and `http://localhost:5173/**`

### ⚠️ Gotcha — redirect_to → Site URL fallback (found + fixed 2026-05-21)

If the `redirect_to` passed to Supabase Auth (`/invite`, `/recover`,
`generate_link`) does NOT match the project's Redirect URL allow-list,
Supabase **silently** drops it and substitutes the **Site URL** — which
is `https://staff.byanymeansbusiness.com`. The user then lands on the
staff portal HQ login instead of the client portal.

Root cause: `portalUrls()` in `api/clients.js` built the client URL from
the `CLIENT_PORTAL_URL` Vercel env var, which was misconfigured → the
redirect_to never matched the allow-list → Site URL fallback. Every
client invite, password reset, and team invite landed users on the staff
portal. Proven via a live invite whose verify link came back with
`redirect_to=https://staff.byanymeansbusiness.com`.

Fix (commit `d35d124`): `clientUrl` is now a hardcoded constant
(`https://portal.byanymeansbusiness.com`), not env-overridable. The stale
`CLIENT_PORTAL_URL` env var can be deleted from Vercel.

### ⚠️ Gotcha — "Auth session missing!" on the password-set screen (found + fixed 2026-05-25)

When a client clicks the invite/recovery link, the URL fragment `#access_token=...` is consumed by Supabase JS to create the session. If they click the link a second time, reload the page after the hash is stripped, open it in a different browser, clear cookies/localStorage, or wait >24h — the session is gone. `_sb.auth.updateUser({ password })` then throws `AuthSessionMissingError: Auth session missing!`, which the form was surfacing as a raw error string and a dead-end.

Most-recent report: **Basketball+ (Jake)** — 2026-05-25. Same root cause has been hit by others silently (probably explains some "I never got a chance to set my password" tickets).

Fix (commit `706bd4c`): `submitNewPassword()` now matches `session missing` / `auth session` / `not authenticated` / `jwt expired` substrings and renders an inline recovery card inside the existing error slot:

> ⚠ Your invite link expired or was already used
> [email field] [Send me a fresh link]

Button fires `_sb.auth.resetPasswordForEmail(email, { redirectTo: '<origin>/client-portal.html?type=recovery' })` (works without a session). All other `updateUser` errors still surface their raw message — we did not generalize.

**Functions:** `_showFreshLinkRecovery(errEl)` + `_sendFreshLink()` in `bam-portal/public/client-portal.html` around line 13095.

**Open follow-up:** Basketball+'s `clients.slack_channel_id` = `C0AA9RFL87J` is invalid (bot returns `channel_not_found` on both `conversations.info` and `conversations.list`). Bot was likely removed from that channel, or ID is stale. Until corrected: no Slack post will land for that client, and the BAM-side "Reset password" trigger for Jake silently fails on Slack notification (the email still sends). Worth a one-time DB cleanup pass for invalid channel IDs across all clients.

### ⚠️ Gotcha — owner needs a `client_users` row (found + fixed 2026-05-22)

The multi-user portal resolves access ONLY from `client_users` (via the
`my_client_ids()` RLS predicate). `clients.auth_user_id` alone does NOT
grant portal access — the owner just sees "Your account is not linked to
a client."

All three client-creation paths in `api/clients.js` (staff "New client"
default path, public signup, `setup-account`) created the `clients` row +
auth user but never created the owner's `client_users` row. Only the
2026-05-20 multi-user migration backfilled owner rows for clients that
existed then; anything created after hit the wall.

Fix: `ensureOwnerMembership()` helper in `api/clients.js`, called from
all three create paths — idempotently inserts/reactivates the owner's
`client_users` row (`role=owner, status=active`).

**Files touched:**
- `bam-portal/api/clients.js` (action router + recover call + email/auth_user_id in shapeClient)
- `bam-portal/public/client-portal.html` (recovery card + boot detection + submitNewPassword)
- `bam-portal/src/views/ClientsView.jsx` (Reset password button on each card)

## Deferred TODOs

- Self-serve "Forgot password?" link on the login overlay (today: only staff can trigger a reset). Wire up later.
- Branded email templates (verify, password-reset) — Supabase defaults are plain
- SMTP for prod deliverability — Supabase's built-in is fine for testing, switch to Postmark/Resend before scaling
- Per-client storage isolation — currently any authed client could upload anywhere in `ticket-files`. URL paths are random UUIDs so practical risk is low. Tighten with a path-prefix RLS check if it becomes a concern.
