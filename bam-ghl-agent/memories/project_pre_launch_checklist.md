---
name: Pre-Launch Checklist (BAM Business client portal)
description: Everything we've intentionally deferred during development that needs to land before the portal goes live to real paying clients
type: project
---

Things we shipped fast for testing but should be tightened before real clients are on the system. Grouped by urgency.

## 🔴 Block launch — must do before first real client

- **SMTP for transactional email.** Supabase default SMTP is rate-limited (3 emails/hour project-wide) and sender is `noreply@mail.app.supabase.io`. Hook up Postmark / Resend / SendGrid before sending real password resets, magic links, or anything to a paying client. Configure under Supabase dashboard → Project Settings → Auth → SMTP Settings.
- **Branded email templates.** Once SMTP is in place, customize the magic-link / password-reset / welcome templates (Supabase dashboard → Authentication → Email Templates) — currently they're plain default text. Cover at minimum: subject line, sender name, BAM logo, support footer.
- **Production redirect URLs in Supabase.** Already added `https://bam-portal-zoran-stars-projects.vercel.app/**` and `http://localhost:5173/**`. If the prod URL ever changes (custom domain like `portal.bambusiness.com`), add the new origin too.

## 🟡 Should do soon — security / reliability hardening

- **Notifications when staff sends a client request OR client responds.** Right now it's silent — the only signal is the in-app badge / pin. Build Slack DM (staff side) and email (client side) when client comms become a priority. Detail in `project_client_action_notifications_todo.md`.
- **Per-client storage isolation (signed URLs).** Today: `ticket-files` bucket is `public: true`, all authenticated users can upload anywhere. Practical risk is low (URL paths are random UUIDs), but switch to `createSignedUrl` + path-prefix RLS for proper isolation when there's >1 real client uploading. Detail in `project_client_auth.md`.
- **File-size cap in client-portal upload UI.** Currently no client-side limit; Supabase Storage tier limits eventually catch oversized uploads but the failure mode is ugly. Add a soft 25 MB warning before upload.
- **Audit trail for ticket messages.** `tickets.messages` is a mutable jsonb array — anyone with edit access could rewrite history. Fine for client trust today, not OK for legal disputes. Migrate to a separate `ticket_messages` table (immutable inserts only) when it matters. Detail in `project_client_action_thread.md`.
- **Race condition on simultaneous staff + client message edits.** Both sides re-read + append to the same array; last writer wins, could clobber a message. Probability is tiny but real. Same fix as above (separate messages table).

## 🟢 Nice to have — polish / cleanup

- **Self-serve password reset UI for clients.** Today: clients can't request a reset from the login screen — staff must trigger it. Add a "Forgot password?" link on the login overlay that calls `resetPasswordForEmail` with the user's email.
- **Real health + tier columns on clients.** Today: `api/clients.js` returns hardcoded `health: 95` (or 50) and `tier: "Foundations"` for everyone. UI now hides both. Add real columns + populate them when there's a real signal to show.
- **iOS push notifications via PWA + Web Push.** Once email/SMS aren't enough. Detail in `project_ios_push_pwa.md`.
- **Clean up bad `academy_mappings` row.** One row has a ticket title (`"Need the section..."`) saved as `asana_name`. Doesn't break anything but is ugly.
- **Leads count investigation.** Clients view shows "Leads 200" — round number, probably mock. Trace where that comes from and either wire to real GHL data or hide.
- **Notion + GHL MCP reconnection.** Both intermittently drop during long sessions. Investigate why.
- **Reconnect / consolidate the prototype's Notion fetch.** The Clients page falls back to "SAMPLE" mode whenever Notion is empty. Even though we now hide the SAMPLE labels, the underlying split between "Notion-as-truth" vs "Supabase-as-truth" is still inconsistent across views — pick one, refactor others.

## How to use this list

When you're ready to onboard a real paying client, walk through the 🔴 items first and confirm each one. Don't promise SLA-grade comms until SMTP is hooked up.
