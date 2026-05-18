---
name: 2026-05-17 polish session — audit, fixes, design system, feedback widget
description: Major session that ran 2 audits, fixed 13 issues across security + scale, overhauled password reset to bypass broken Supabase email templates via Resend, added self-serve forgot password, shipped admin feedback widget + Feedback tab, applied FullControl design system to client portal.
type: project
---

## Major changes shipped this session

### Round-1 infrastructure audit (17 findings)
Most fixed. See `bam-portal/public/infrastructure-map.html` (HTML map you can open in a browser to see + click red callouts).
- Deleted 7 orphan React views + 10 mock-data files + 8 archived legacy HTML.
- Dropped `bam_channel_settings` + `bam_channel_snapshots` tables + the `?section=channel-ingest` endpoint (Cole's test ended).
- Dropped `clients.name` alias from shapeClient; UI now uses `business_name` everywhere.
- Fixed SystemsView name/business_name inconsistency.
- Calendar service returns honest `connected: false` instead of mock data fallback.
- Notion query catches now `console.warn` with page IDs (no more silent failures).
- Asana `parseNotes` warns when required template sections are missing.
- Deleted duplicate Zoran staff rows + the "marketing test" junk row (had to repoint 1 ticket FK first).
- App.jsx bundle split with React.lazy: 893KB → 377KB main (−58%).
- 19 hardcoded Notion IDs left in place — all still used; logs make drift visible.
- 6 mystery Supabase tables (`client_users`, `board_items`, `content_*`) documented in `bam-ghl-agent/CLAUDE.md` but left alone pending owner confirmation.

### Round-2 scale + security audit
See `bam-portal/public/scale-security-audit.html` (live HTML doc).

Fixed all 3 critical security issues:
- **SEC-1** Hardcoded Supabase anon key fallback removed (`src/lib/supabase.js`). Throws if env var missing.
- **SEC-2** Public signup email enumeration closed. Now returns generic `{ ok, message }` regardless of whether email exists. IP rate-limited at 10/24h via new `signup_attempts` table.
- **SEC-3** `/api/notion/query` now requires staff Bearer token + validates pageId is UUID-shaped. Previously anyone could read any Notion page in our workspace.

Fixed HIGH severity:
- **S-2** Marketing + content ticket queries paginated (default 50, max 200, with `hasMore` flag).
- **SEC-5** Internal messages stripped from PATCH responses for clients (was leaking).
- **S-3** confirmed already done (audit was wrong, indexes existed).

Fixed MED:
- **SEC-9** Sanitized 9 `console.error(err)` sites → `err?.message`.
- **SEC-13** Added security headers (HSTS, X-Frame-Options, etc.) in `vercel.json`.
- **S-4** Cap of 500 on Clients list query (defensive only).
- **S-6** File upload concurrency limited to 3 in flight (ContentView).
- **S-8** GHL location cache TTL bumped to 60min.

Deferred by Zoran:
- **SEC-6** ticket-files bucket lockdown (too risky right now)
- **S-1** Stripe MRR caching (works for now)
- **SEC-7** signup CAPTCHA (IP rate limit good enough)
- **SEC-8** RLS-via-anon-key refactor (too big)
- **SEC-11** CSRF (Bearer tokens already mitigate)

### Password reset overhaul
The Supabase "Reset Password" email template in the dashboard was broken (the `{{ .ConfirmationURL }}` placeholder must have been deleted). Email arrived with no link.

Rather than fix the dashboard template, we **bypassed Supabase email entirely** for password reset:
1. Call `POST /auth/v1/admin/generate_link` with `type: recovery` to get a one-shot URL
2. Send the email ourselves via **Resend API** with a BAM-branded template

`buildResetPasswordEmail()` + `sendResetPasswordEmail()` helpers at top of `api/clients.js`. Used by BOTH the staff-initiated path and the new public path.

**Email template**: table-based layout (Outlook-safe), inline styles, "bulletproof" button pattern (`<td bgcolor>` + `<a>`), gold-on-cream BAM branding, prominent fallback URL.

### Self-serve "Forgot password?" flow
New: `POST /api/clients?action=request-password-reset` (anonymous). Anti-enumeration (always returns generic `{ ok, message }`). Rate limit: 5/IP/24h. Same Resend send flow.

Frontend: new "Forgot password?" link below Sign in button on `client-portal.html` → reveals `#forgot-card` (email-only form).

### Client portal recovery flow (3 bugs converged)
- `loadAcademyName()` queried `clients.name` (column was renamed). Fixed.
- Recovery form trigger relied on `?type=recovery` URL parsing which was unreliable. Now uses Supabase's official `PASSWORD_RECOVERY` event via `onAuthStateChange` (captured at module-init time, resolved via `_recoveryFlowReady` promise that boot() awaits).
- Staff users used to get redirected away BEFORE the password-set form showed. Now any user in recovery flow sees the form first; staff redirect happens AFTER they save.

### Admin feedback widget
**Red floating button (bottom-right) on client portal**, visible only to admin/scaling_manager staff. Opens modal: textarea + optional file upload. Submission goes to `portal_feedback` (extended schema), surfaces in a new **Feedback tab** in the staff portal sidebar.

- Schema: `portal_feedback` got `file_url`, `file_name`, `submitter_email`, `portal` ('staff' | 'client') columns.
- New API actions: `submit-feedback` (admin+scaling) and `list-feedback` (admin+scaling).
- New view: `src/views/FeedbackView.jsx` — filter pills (All / Client portal / Staff portal), inline image thumbs for screenshot attachments, refresh button.

### FullControl design system applied to client portal
Visual refresh derived from `prototype/` (live at fullcontrol-prototype-six.vercel.app). Zero behavior changes — no JS touched, no class renames.

Tokens (in `:root` of `client-portal.html`):
- Fonts: **Plus Jakarta Sans** body + **Nunito** display + **DM Mono** mono. Was Inter/Space Grotesk/JetBrains.
- Radii: 8/12/16/20/24/28 scale (was 3/4/6).
- Shadows: `--shadow-{sm,md,lg,gold}`, multi-layer.
- Gold: `#D4B65C` dark / `#C8A84E` light. With `--gold-glow` for focus rings.
- Easings: `--es` (cubic-bezier(0.4,0,0.2,1)) and `--espring` (1.56 bounce).

11 UI improvements bundled (override block at end of `<style>`):
1. Nav: smooth hover slide + 3px gold accent on active
2. Eyebrows: gold mono caps with 0.12em tracking
3. Big Nunito 48px numbers on KPI/stat tiles
4. Card cascade (staggered fade-up, 40ms steps)
5. `.segmented` utility class for pill-style tab controls
6. Status pills tinted in semantic color (was just colored dots)
7. Gold-glow focus ring on every input
8. Gradient + lift hover on primary CTAs
9. Animated `.dform-option-dot` with spring easing
10. `.empty-state` with pulsing gold orb
11. 220ms crossfade on theme toggle

Design guide doc: `bam-ghl-agent/bam-portal/docs/client-portal-design.md`.

### Font playground
New standalone tool at `public/font-playground.html`. 15 sans + 12 display + 6 mono picks (all Google Fonts). Live-swaps CSS vars via 3 dropdowns. localStorage persists picks. "Copy CSS" button outputs the `:root` block.

Picks lean toward what Linear/Vercel/Stripe/Arc actually ship (Inter, Geist, Manrope, Fraunces, Bricolage, etc.).

## New env vars
- `RESEND_API_KEY` — added to Vercel (production + preview) and `.env.local`. Used by both reset password paths.

## New DB schema this session
```sql
-- 2026-05-17: signup attempts (rate-limit + audit)
CREATE TABLE signup_attempts (id, ip, email, succeeded, attempted_at, kind);
-- kind: 'signup' | 'password_reset' (CHECK constraint)

-- 2026-05-17: feedback extended
ALTER TABLE portal_feedback ADD COLUMN file_url, file_name, submitter_email, portal;
-- portal: 'staff' | 'client' (CHECK constraint), default 'staff'

-- 2026-05-17: client soft-delete
-- (added earlier same day, in scope here)
ALTER TABLE clients ADD COLUMN archived_at timestamptz;
```

## Active deferred backlog
1. **SEC-6** ticket-files bucket → private + signed URLs
2. **S-1** Stripe MRR cache (nightly cron or webhook)
3. **SEC-7** signup CAPTCHA (Turnstile or hCaptcha)
4. **SEC-8** RLS-via-anon-key refactor for client portal endpoints
5. **SEC-11** CSRF tokens
6. Round-3 backlog still standing: email/SMS notifications, Supabase Realtime, Meta token refresh on 401, App Review submission, polish ad-account picker UI

## Production deploys this session
Each shipped + verified live:
- `b4fa26f` Critical security batch (SEC-1, 2, 3, S-3)
- `aa367ca` Ticket pagination + internal message stripping
- `e55e212` 5 no-decision fixes (SEC-9, 13, S-4, 6, 8)
- `3c01ef4` Password reset via Resend (replaces broken Supabase template)
- `fcb1687` Self-serve forgot password
- `2e57f5e` Bulletproof BAM-branded reset email template
- `8aa30b8` Recovery flow rebuild (PASSWORD_RECOVERY event + loadAcademyName fix)
- `dd7c4bc` Admin feedback widget + Feedback tab
- `fd1fec4` Design system + 11 UI improvements + font playground

## Gotchas worth remembering
- **Supabase email templates can silently break** — when the dashboard template gets edited and `{{ .ConfirmationURL }}` removed, the email arrives with no link. Bypass via admin/generate_link + Resend is the resilient pattern.
- **Site URL fallback on Supabase auth** — if your `redirect_to` URL isn't in the Allowed Redirect URLs list, Supabase silently uses the Site URL instead, stripping your `?type=recovery` query. The `PASSWORD_RECOVERY` event on `onAuthStateChange` is the canonical detection signal, not URL parsing.
- **Mike's email (`mike@byanymeansbusiness.com`) is BOTH staff and is set as the email on DETAIL Miami client row.** When you reset the DETAIL Miami client, Mike gets the email and signs in as his staff auth account. The portal correctly identifies him as staff and redirects.
- **Vercel env vars with `echo |` get a trailing `\n` literal.** Use `printf` instead. See `feedback_vercel_env_no_newline` memory note.

## Related notes
- [[project_clients_supabase_consolidation]] — earlier same day, Notion→Supabase migration
- [[project_marketing_portal_state]] — portal state pre-session, round-3 backlog
- [[project_meta_api_integration]] — hybrid Meta OAuth (unchanged this session)
