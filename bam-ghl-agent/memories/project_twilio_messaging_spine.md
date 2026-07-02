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

## A2P for GTA — EMPIRICALLY NOT A GATE (proven 2026-06-30)
GTA texts Canadian leads (CA→CA, 289/416 Toronto). Key findings:
- **US A2P 10DLC (TCR brand+campaign) is destination-based = for US-bound texts.**
  CA→CA is a separate, lighter, evolving Canadian-carrier regime, NOT TCR. So the
  whole TrustHub/Brand/Campaign dance does NOT apply to GTA's actual traffic.
- **Live empirical test (Twilio API):** sent +12898166569 → +14165733718 with ZERO
  registration (no brand, no campaign, no messaging service in the account) →
  `status=delivered, error_code=None`, landed on the real phone. So the 289 line can
  text Canadian leads RIGHT NOW. A2P does NOT block going live.
- **Caveat (not a blocker):** 1 delivered test ≠ guaranteed clean delivery at volume;
  Canadian carriers filter on content/volume. Register a Brand+Campaign LATER for
  durable deliverability (use the Canadian Business Number / BN-9, not an EIN —
  GTA's `clients.ein` is null; that field needs a BN if/when we register).
- **A2P registration does NOT survive a Twilio account transfer** (configs reset on
  transfer per Twilio). So any A2P "flipped" before the +1 289 transfer is gone; this
  account (AC…4773) had 0 brands / 0 campaigns / 0 messaging services as of 6/30.
- GTA Twilio Account SID = `AC…4773` (full value lives in Twilio console / Vercel env,
  NOT in this repo - GitHub push protection blocks raw AC SIDs). The +12898166569 number
  was created in-account 6/30 (transfer day), still pointed at Twilio's demo sms_url with
  no compliance bundle as of the check.

## Twilio REST recipe (researched 2026-06-30, from official docs)
Auth = Basic `AccountSid:AuthToken` (API Key SID+secret works in same slot).
- **Wire an owned number to our webhooks (simplest, no Messaging Service needed):**
  `POST /2010-04-01/Accounts/{AC}/IncomingPhoneNumbers/{PN}.json`
  with `SmsUrl=https://portal.byanymeansbusiness.com/api/twilio/inbound-webhook`,
  `SmsMethod=POST`, `StatusCallback=…/api/twilio/status`, `StatusCallbackMethod=POST`.
- **Messaging Service path (needed only for sender pool / future US A2P):**
  `POST messaging.twilio.com/v1/Services` (set `InboundRequestUrl`+`StatusCallback`),
  then `POST /Services/{MG}/PhoneNumbers` with `PhoneNumberSid`. Precedence gotcha:
  number-level `SmsUrl` wins only if service `UseInboundWebhookOnNumber=true`.
- **US ISV A2P (LATER, for US academies):** Secondary CustomerProfile (BU) + A2P Trust
  Bundle (BU) → `POST messaging/v1/a2p/BrandRegistrations` (BN) → `POST
  /Services/{MG}/Compliance/Usa2p` (campaign). Poll Brand `status=APPROVED` (tcr_id set)
  + campaign `campaign_status=VERIFIED`. Brand ~minutes; campaign carrier-reviewed
  ~10-15 days. Sandbox "mock" registration exists to test without TCR fees.

## CUTOVER STEPS (simplified — A2P is NOT a prerequisite for GTA)
1. Wire +12898166569 webhooks → our endpoints (1 API POST to IncomingPhoneNumbers,
   sets SmsUrl=/api/twilio/inbound-webhook + StatusCallback=/api/twilio/status).
2. Turn OFF GTA's GHL "form-filled" + reply workflows.
3. Load creds into `client_twilio_config` (encrypted) via MCP/endpoint, status='active'.
4. Final history import (the button).
5. Flip `clients.messaging_provider='twilio'` for GTA.
(Register a Canadian Brand+Campaign later for durability — not required to flip.)

## Gotcha discovered 2026-06-29
`vercel env pull` for bam-portal returned STALE Supabase + GHL creds (all 401) while
the live deploy works fine — so prod-cred SCRIPTS can't run locally; use MCP or the
deployed endpoint (that's why the import is a portal button, not a local script).

## Multi-academy plan (decided 2026-06-29)
Model: **BAM master Twilio account** (agency/ISV). Per academy: A2P Brand (from their
EIN/legal name/address — onboarding already collects these) + Campaign → Messaging
Service → their number; webhooks → our endpoints; encrypted creds → client_twilio_config.
**New academies default to messaging_provider='twilio' from day 1** (provision at
onboarding, no GHL history to import, never touch GHL for SMS).

**Sequence (decided): pilot GTA MANUALLY first**, then build auto-provisioning from the
proven steps. Do NOT build the provisioning/A2P automation before GTA's cutover proves
Twilio's exact A2P + number flow (and before the BAM master Twilio + TrustHub account
even exists — can't test otherwise).

To build AFTER the GTA pilot:
1. Staff "Set up Twilio" provisioning panel + endpoint: buy/assign number, create
   Messaging Service, register A2P brand+campaign via Twilio TrustHub/ISV API from the
   academy's DB business info, wire webhooks, encrypt+store creds, flip the flag.
2. Onboarding default → auto-provision new academies onto twilio.
3. A2P status poller: client_twilio_config.status pending → active when approved.

External prereqs (BAM/Twilio, gated by Twilio review): master account + payment, TrustHub
Primary Business Profile / ISV approval. A2P 10DLC is per-academy and unavoidable (days).

## Self-serve provisioning UX (planned, build after GTA pilot — 2026-06-29)
Target: academies set up their own texting number with no manual ops. A "Set up your
texting number" screen with TWO paths:
  ① GET A NEW NUMBER — pick area code → confirm prefilled business info (legal name,
     EIN, address from onboarding) + templated opt-in/sample messages → Submit →
     auto: buy number (Twilio API) + create Messaging Service + register A2P
     brand+campaign (TrustHub/ISV API) + wire webhooks + store creds.
  ② BRING EXISTING TWILIO NUMBER — enter their number/account → account-to-account
     transfer into BAM's master Twilio → attach to Messaging Service + A2P.
Then a status badge: Provisioning → Pending (carrier review) → 🟢 Live, auto-flipping
clients.messaging_provider='twilio' when A2P approves.

HONEST CONSTRAINT: everything is one-click/automatic EXCEPT A2P 10DLC carrier approval
(minutes to ~1-3 days). We automate the SUBMISSION + wiring + go-live; the approval
wait is external and shown as a status. There is no way to make carrier approval instant.

Build phases (after GTA proves the flow):
  0. (prereq, external) BAM master Twilio + TrustHub Primary Business Profile approved.
  1. provision-twilio endpoint (modes: new | import) + A2P brand/campaign via TrustHub
     API + status poller → auto-flip to Live. Extend client_twilio_config with
     brand_sid, campaign_sid, messaging_service_sid, a2p_status, provisioning_status.
  2. Self-serve screen (the 2-path flow) with prefilled info + status badge.
  3. New academies auto-run provisioning at onboarding → start on twilio day 1.

## Voice spine (calling) - built on top of this SMS spine

2026-07-01/02, PRs #1019/#1022/#1027. Cell-forwarding model (no softphone): inbound
rings staff cells via `<Dial>`; ring-out -> recorded voicemail (transcribed) -> staff
SMS alert + missed-call auto-text to the caller (threads in the portal inbox).
Click-to-call = `PATCH /api/members?id=&action=call` (members) and
`POST /api/twilio/call` {client_id, phone, contact_name?, ghl_contact_id?} (ANY
contact - the Inbox thread header + Pipeline drawer header 📞 use it; both render
a "Call in GHL" fallback, upgraded in place via `_callSlotUpgrade` once the
once-per-session `_voicePrime()` check says voice_enabled). Rings staff cell,
bridges to the contact; academy number = caller ID.

- Config: `client_twilio_config` + `voice_enabled`, `voice_ring_numbers text[]`,
  `voice_record`, `voicemail_enabled`, `missed_call_text_enabled`, `missed_call_text`.
- Log table: `calls` (direction/status/twilio_call_sid unique/contact_phone/
  ghl_contact_id/duration/recording_url/voicemail_transcript).
- Endpoints: `api/twilio/_voice.js` (helpers), `voice-inbound.js` (staged
  ?stage=dial|vm|txn), `voice-status.js`, `voice-outbound.js`, `wire-voice.js`
  (one-time VoiceUrl wiring, Bearer CRON_SECRET).
- UI: member drawer "Calls" section (history + in-place playback) and the
  phone-row Call button (member GET returns `calls` matched by ghl_contact_id or
  last-10-digits of parent_phone); voicemail inbox = 📼 button in the v15 inbox
  bar (unheard badge, transcripts, heard-on-play; `api/twilio/voicemails.js`,
  `calls.heard_at/heard_by`).
- GOTCHA: Twilio returns 401 on recording media without basic auth - never link
  the raw recording_url. All playback goes through the authenticated portal
  proxy (`/api/twilio/voicemails?recording=<call_id>` -> blob object-URL).
- GOTCHA: Twilio's final status callback reports "completed" on the parent call
  even when the caller rang out to voicemail - `updateCallBySid(sid, patch,
  unlessStatusIn)` guards so stage-set `voicemail`/`no-answer` survive.
- Branded caller ID: CNAM is impossible for CA numbers (Twilio forbids); Twilio
  Branded Calling Canada = private beta (Rogers/Bell only, account-rep enable).
  Portal fallback: public `GET /api/vcard?c=<client_id>` contact card (.vcf,
  business_name + number), linked automatically from the missed-call text -
  saved contact = name on every carrier.
- GTA live: +12898166569 rings +14165733718, voicemail + missed-call text on
  (verified live 2026-07-02). Roadmap + billing/subaccount plan: Zoran's personal
  memory note `bam-twilio-voice`.
