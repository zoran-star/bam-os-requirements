# Twilio messaging spine (off-GHL SMS) — BAM GTA first

**2026-06-29.** Built the backend so an academy can send/receive SMS via its OWN
Twilio instead of GoHighLevel, toggled per-academy. DORMANT by default. SMS
transport only — contacts + pipeline + agents still live in GHL; the lead's phone
maps back to its GHL contact so the board/agents keep working after cutover.

## The toggle
`clients.messaging_provider` ('ghl' default | 'twilio'). Resolves to 'twilio' ONLY
if flipped AND `client_twilio_config.status='active'`; else falls back to 'ghl'
(so a half-finished setup can't break sends). Resolver: `api/messaging/provider.js`
`smsProvider(clientOrId)` — cached by client_id (robust to partial client rows).

## Schema (applied to prod 2026-06-29, migration 20260629150000)
- `clients.messaging_provider` text default 'ghl'.
- `client_twilio_config` (client_id PK, account_sid, auth_token_enc, api_key_sid,
  api_key_secret_enc, from_number, messaging_service_sid, status, …). Secrets are
  app-layer AES-256-GCM via env `MESSAGING_ENC_KEY` (set on bam-portal Vercel,
  Production+Development). RLS: service-role only (no policies).
- `sms_threads` (client_id, contact_phone E.164, ghl_contact_id, contact_name,
  last_message_*) unique(client_id, contact_phone).
- `sms_messages` (thread_id, client_id, provider, direction, channel, body, status,
  twilio_sid, ghl_message_id, occurred_at, raw). Idempotent on twilio_sid and
  (client_id, ghl_message_id).

## Code map (all under bam-portal/api)
- `messaging/_crypto.js` — encrypt/decrypt creds.
- `messaging/provider.js` — `smsProvider()`, `sendViaTwilio()`, and the gate
  `maybeSendSmsViaProvider(clientOrId, {toPhone|ghlContactId, body, sentBy})` →
  `{handled:false}` for GHL academies (caller runs its existing GHL send).
- `messaging/import-ghl-history.js` — `POST {client_id}` (staff): pages GHL convos
  → sms_threads/sms_messages. Idempotent. Triggered by a 1-click button in staff
  Settings → "Messaging migration" (`src/components/MessagingMigrationPanel.jsx`).
- `messaging/read-thread.js` — read a thread from the store (agent shape + inbox shape).
- `twilio/inbound-webhook.js` — replies in: signature-verified, STOP/START, store +
  same side-effects as GHL webhook (cancel drafts, exit automations→Responded,
  notify owner, wake agent). `twilio/status.js` — delivery receipts by twilio_sid.
- Outbound gate wired into: `_send.js`, `mass-send.js`, `ghl/send-message.js`,
  `ghl/_core.js sendSms`, and agents (`agent-followups`, `agent-approvals`,
  `agent-confirm`, `agent-closing` via `sendReplyViaGhl(token,contactId,reply,clientId)`).
  Read branch in `ghl/inbox.js` + the 3 agents' `draftForContact`.

## Known small gaps (safe — stay on GHL)
- `agent-confirm.js:528` + `agent-closing.js:471` self-drive sub-paths call
  sendReplyViaGhl WITHOUT clientId (no scope) → those stay on GHL even after flip.
- Inbound side-effects are DUPLICATED from `ghl/inbound-webhook.js` (not extracted) —
  keep them in sync if either changes.

## CUTOVER STEPS (when GTA's Twilio + A2P are ready)
1. Twilio: port number in, A2P 10DLC approved, point number's messaging webhook at
   `/api/twilio/inbound-webhook`, enable Advanced Opt-Out.
2. Turn OFF GTA's GHL "form-filled" + reply workflows.
3. Load creds into `client_twilio_config` (encrypted) via MCP, status='active'.
4. Final history import (the button).
5. Flip `clients.messaging_provider='twilio'` for GTA.

## Gotcha discovered 2026-06-29
`vercel env pull` for bam-portal returned STALE Supabase + GHL creds (all 401) while
the live deploy works fine — so prod-cred SCRIPTS can't run locally; use MCP or the
deployed endpoint (that's why the import is a portal button, not a local script).
