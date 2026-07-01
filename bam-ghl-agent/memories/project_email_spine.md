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

## Build status (2026-07-01)
- Phase 1 (foundation: schema + toggle + provider gate) — PR #989. DORMANT.
- Phases 2-3 (inbound webhook + email store reads + inbox merge + outbound gate) — PR pending. DORMANT.
- Every academy stays `email_provider='ghl'` → zero behavior change until cutover.

## CUTOVER STEPS (GTA) — not done yet
1. **DNS (Squarespace):** add Resend's MX records for `byanymeanstoronto.ca` (send-only domain;
   Zoran's Gmail is on byanymeansbball.com, so this doesn't touch his inbox). Verify no inbox
   currently reads `@byanymeanstoronto.ca`.
2. In Resend: enable inbound for the domain, set the inbound webhook to
   `https://portal.byanymeansbusiness.com/api/resend/inbound-webhook`, copy the signing secret →
   set `RESEND_INBOUND_SECRET` on bam-portal Vercel (Prod+Dev).
3. Set GTA `clients.email_domain='byanymeanstoronto.ca'`.
4. (optional) import GHL email history into the store (email-import — not built yet).
5. Flip GTA `clients.email_provider='resend'`.

## Known TODO / gaps
- **History import not built** (email-import-ghl-history.js) — the SMS spine has one; add if we
  want GTA's past GHL email threads in the store. Not required to flip (new mail flows in live).
- **Body-fetch endpoint** `/emails/receiving/{id}` is best-effort; verify the exact path at cutover
  (metadata-only webhook confirmed via Resend docs). Store falls back to subject-only if it 404s.
- **Inbox merge caveat:** an academy on `email_provider='resend'` but `messaging_provider='ghl'`
  would serve the email store only (SMS/IG/FB not merged from GHL). Doesn't affect GTA (already
  twilio → both stores merge). IG/FB DMs are still GHL-only regardless.
