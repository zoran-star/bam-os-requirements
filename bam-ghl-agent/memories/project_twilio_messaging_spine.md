# Twilio messaging spine (off-GHL SMS) — BAM GTA first

**2026-06-29.** Built the backend so an academy can send/receive SMS via its OWN
Twilio instead of GoHighLevel, toggled per-academy. DORMANT by default. SMS
transport only — contacts + pipeline + agents still live in GHL; the lead's phone
maps back to its GHL contact so the board/agents keep working after cutover.

## 2026-06-30 — GTA FULLY CUT OVER + lead automations moved off GHL (this session)
GTA is now LIVE on Twilio end-to-end and its lead messaging runs on the portal, not GHL.

**Cutover done:** number +12898166569 transferred into Twilio acct `AC…4773`; webhooks
wired (SmsUrl=/api/twilio/inbound-webhook, StatusCallback=/api/twilio/status); creds
encrypted into `client_twilio_config` (status=active) using prod `MESSAGING_ENC_KEY`
(pulled via `vercel env pull` for project bam-portal — it DOES work for this key, the old
stale-cred gotcha didn't bite); `clients.messaging_provider='twilio'`. Inbound + outbound
both verified delivered. GHL history imported (~14k msgs, 631 threads, May 2024→now).
**A2P is NOT a gate for GTA (CA→CA) — empirically delivered unregistered. See section below.**

**Portal automations made LIVE for GTA (enabled+approved):** contact_form, trial_form,
ghosted, nurture, onboarding, summer_special. `trial_followup` LEFT OFF on purpose (retired
2026-06-28, dupes trial_form intro). Flipping enabled+approved is the intended switch that
makes the portal OWN a journey (P6 triggers branch on isAutomationLive → auto-drop the GHL path).

**CRITICAL GAP found + fixed:** `clients.ghl_kpi_config.portal_entry_routing.enabled` was
FALSE. With GHL workflows turned off, a new contact/trial form-fill (api/website/leads.js
`maybePortalRoute`) fell through to a now-dead GHL workflow → NEW LEADS GOT NO TEXT. Flipped
it TRUE → form-fills now enroll the contact_form/trial_form intro via Twilio. Routing cfg:
pipeline 'TRAINING PIPELINE', intro keys are FIXED by form type (contact→contact_form,
free-trial→trial_form), NOT derived from the stage. **Lesson: messaging_provider=twilio is
only HALF the cutover; portal_entry_routing.enabled must also be ON or new leads silently drop.**

**Booking/post-trial:** Confirm + Closing INITIAL AUTOMATIONS approved via
`ghl_kpi_config.confirm_initial_automations` / `closing_initial_automations` =
{enabled:true,approved:true} (steps fall back to code defaults in agent/confirm-automations.js
+ closing-automations.js). Agent modes stay `hawkeye`.

**NEW behavior — scripted sequences bypass Hawkeye (PR #951):** `_mode.js`
`shouldAutoSendScripted(mode)=modeIsOn(mode)` — approved FIXED scripted touches (booking
confirmation, same-day check-in, post-trial) auto-send whenever the agent is ON, bypassing
the global self-drive kill-switch (`SELF_DRIVE_GLOBALLY_DISABLED=true`, still on). Wired at the
two scripted send sites only (agent-confirm.js:~398, agent-closing.js:~334, both `confidence:1`);
AI FREEFORM replies still use `shouldAutoSend` (kill-switch + confidence gated) — unchanged.

**Import made resilient (PR #933):** api/messaging/import-ghl-history.js is now CHUNKED (12s
wall-clock budget + resumable {start_after_date,start_after} cursor + `done` flag); the staff
MessagingMigrationPanel loops the cursor and shows a LIVE status bar. Fixes the timeout that
returned an HTML error → "Unexpected token 'A'... not valid JSON".

**Summer Special (PRs #933/#936):** ported off the GHL workflow to a portal-native 3-SMS
sequence (0d/1d/2d) + worker rolls summer_special→nurture on completion; pipelines.js
`enroll-workflow` is provider-aware (portal enroll + move opp to Interested when
isAutomationLive('summer_special'), else legacy GHL); surfaced as a pill in the client-portal
Automations (Train) view. automation_id `cb05f2a2-…`.

**Still on GHL (intentional):** ADAPT intake funnel (parked — set up its initial automation
later, keep entry_points rows). **OPEN:** Zoran turned off "all" GHL workflows — confirm he did
NOT disable NON-messaging ones (payments/membership, review requests, internal notifications);
those are not portal-replaced. **OPEN TEST:** Summer Special end-to-end button never fired.
**NEXT SESSION:** full analysis of everything GTA still relies on GHL for (contacts/pipeline
data, calendars/booking, payments, tags, KPI events, etc.).

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
