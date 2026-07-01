# Email spine (off-GHL email via Resend) — BAM GTA first

**2026-07-01.** Moving the EMAIL channel off GoHighLevel onto Resend (send +
receive + thread in the portal), toggled per-academy. DORMANT by default. Mirrors
the [[project_twilio_messaging_spine]] pattern (provider toggle + own-store +
inbound webhook + inbox read branch + outbound gate). Contacts/pipeline/agents
stay in GHL; the lead's email maps back to its GHL contact so they keep working.

## The toggle
`clients.email_provider` ('ghl' default | 'resend') + `clients.email_domain` (the
receiving domain, e.g. 'byanymeanstoronto.ca'). Resolver: `api/messaging/email-provider.js`
`emailProvider(clientOrId)`. Unlike SMS (per-academy Twilio creds), email uses the
single BAM **Resend account** (`RESEND_API_KEY`), sending from the academy's
verified domain — no per-academy config table.

## Schema (applied to prod 2026-07-01, migration 20260701200000)
- `clients.email_provider` text default 'ghl' (check ghl|resend) + `clients.email_domain`.
- `email_threads` (client_id, contact_email, ghl_contact_id, contact_name,
  last_message_*, last_subject, unread) unique(client_id, contact_email).
- `email_messages` (thread_id, client_id, provider ghl|resend, direction in|out,
  channel, subject, body, status, resend_id, ghl_message_id, occurred_at, raw).
  Idempotent on resend_id and (client_id, ghl_message_id). RLS: staff/my_client_ids read.

## Code map (all under bam-portal/api)
- `_email.js` — `sendEmail()` Resend outbound (ALREADY existed: suppression gate +
  `email_events`/`email_suppressions` audit). From = `info@byanymeanstoronto.ca` (DNS-verified).
- `messaging/email-provider.js` — `emailProvider()` + `maybeSendEmailViaResend(clientOrId,
  {toEmail, subject, html, text, ghlContactId, sentBy})` gate → `{handled:false}` for GHL
  academies (caller runs its GHL email send). Sends via `sendEmail` + records the own-store.
- `messaging/email-read-thread.js` — store reads (list / by-contact / by-id / agent), type:"Email".
- `messaging/email-import-ghl-history.js` — STAFF-only chunked import of GHL email history into the
  store (pages /conversations/search, keeps EMAIL msgs, pulls subject/direction from `meta.email`,
  fetches each body via `GET /conversations/messages/email/{id}`, upserts email_threads on
  contact_email + email_messages idempotent on ghl_message_id). Read-only vs GHL.
- `resend/inbound-webhook.js` — INBOUND: Svix-verified `email.received`. **Resend inbound is
  METADATA-ONLY** → fetches the body via `GET /emails/receiving/{email_id}`. Resolves the
  academy by the To-domain (`clients.email_domain`), the lead's ghl_contact_id from `contacts`
  by email, upserts `email_threads` + records `email_messages`, then the SAME side-effects as
  the SMS/GHL webhooks (notify owner, cancel drafts, exit automations→Responded).
- `resend/webhook.js` — delivery events (bounce/complaint → suppression). ALREADY existed.
- `ghl/inbox.js` — read branch now MERGES the SMS store (twilio) + Email store (resend) into
  one inbox when either/both are on; falls through to GHL for academies on neither.
- `ghl/send-message.js` — Email reply gate: `emailProvider==='resend'` → `maybeSendEmailViaResend`
  (resolves toEmail from body.contact_email or `contacts`), else the existing GHL email send.

## Build status
- Phase 1 (schema + toggle + provider gate) — PR #989. Phases 2-3 (inbound webhook + store reads +
  inbox merge + outbound gate) — PR #992. History importer — PR #994.
- **GTA CUT OVER LIVE 2026-07-01**: `email_provider='resend'`. Other academies stay `ghl` (dormant).

## GTA CUTOVER — DONE (2026-07-01, LIVE)
1. ✅ DNS (Squarespace): Resend inbound MX on the root — `dig MX byanymeanstoronto.ca` →
   `0 inbound-smtp.us-east-1.amazonaws.com` (priority 0 beats the old Mailgun MX at 10, so inbound
   is pulled off GHL to Resend). `send` subdomain MX (feedback-smtp) = the SENDING record, was
   already there. Zoran's personal Gmail is byanymeansbball.com, so this domain is safe to redirect.
2. ✅ Resend: inbound enabled + webhook `→ /api/resend/inbound-webhook`, event `email.received`.
   Signing secret set as `RESEND_INBOUND_SECRET` in Vercel (Production + Development).
3. ✅ `clients.email_domain='byanymeanstoronto.ca'`.
4. ✅ History imported (457 threads / 2,318 msgs — see below).
5. ✅ `clients.email_provider='resend'`.
- **Verified end-to-end**: test email in → stored (provider=resend, inbound, subject+body fetched via
  `/emails/receiving/{id}`, sender resolved to its ghl_contact_id).

## Gotcha: automations already send email via Resend (NOT changed by the flip)
`api/_send.js` `sendOn({channel:'email'})` calls `_email.js sendEmail` (Resend) directly — so
automation/agent emails were ALWAYS on Resend, independent of `email_provider`. The flip only changes
(a) the inbox read (merges the email store) and (b) manual inbox replies (→ Resend via
send-message.js). NOTE: `sendOn` email does NOT record into `email_messages`, so automation-sent
emails don't yet show in the inbox thread (inbound + manual replies do) — see TODO.

## GTA email history — IMPORTED (2026-07-01)
The SMS importer had already pulled ALL GHL channels into `sms_messages` (email tagged
`channel='email'`: 2,882 msgs / 538 threads). Migrated those into the email store via SQL
(resolving contact_email from `contacts` by ghl_contact_id): **457 email_threads, 2,318
email_messages**, subjects backfilled from `raw->meta->email->subject` (2,310/2,318). Direction:
15 inbound / 2,303 outbound (mostly automated receipts + training emails). **Bodies are NOT
populated for these historical rows** (GHL's conversation list omits email bodies; they need the
per-message fetch). Subjects + thread structure are there. To fill bodies, run
`email-import-ghl-history.js` for GTA (it fetches each body from GHL) — heavy (~2.3k fetches),
low value since most are outbound receipts. Post-cutover, all NEW email has full bodies via Resend.

## Known TODO / gaps
- **Automation emails not threaded**: `_send.js sendOn(email)` sends via Resend but does NOT write
  `email_messages`, so automation/agent emails don't show in the inbox email thread. Fix = record to
  the store there (mirror maybeSendEmailViaResend's store write). Inbound + manual replies DO thread.
- **Body-fetch endpoint** `/emails/receiving/{id}` — CONFIRMED working at cutover (test body fetched).
- **Historical email bodies** empty for GTA's imported threads (see above) — optional backfill.
- **Inbox merge caveat:** an academy on `email_provider='resend'` but `messaging_provider='ghl'`
  would serve the email store only (SMS/IG/FB not merged from GHL). Doesn't affect GTA (already
  twilio → both stores merge). IG/FB DMs are still GHL-only regardless.
