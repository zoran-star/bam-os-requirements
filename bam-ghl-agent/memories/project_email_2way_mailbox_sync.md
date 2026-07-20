# Email 2-way mailbox sync (V2) — hybrid: Resend for bulk + connected mailbox for humans

**Scoped 2026-07-20 (Zoran).** GTA is off-GHL; its email runs on the portal's
Resend spine, so mail lives ONLY in the portal - Gmail never sees it. Zoran wants
the human 1-to-1 emails visible in the real inbox (Gmail/Outlook) too, without
breaking the scalable automated sending. This note is the build plan.

## The core constraint (why it's the way it is)
- A domain has ONE inbound route (MX). GTA's MX points at **Resend**, so replies
  land in the portal store, not Gmail.
- Sending is also Resend (single BAM `RESEND_API_KEY`, from `info@{email_domain}`).
- Gmail's send caps are **per-mailbox** (~2,000/day Workspace, ~500 free) and the
  API does NOT raise them. Gmail = human 1-to-1 tool, NOT a bulk engine. So we do
  NOT move bulk onto Gmail.

## The model: TWO independent lanes (not a swap)
```
AUTOMATED / BULK   →  Resend        (nurtures, ghost nudges, confirmations, blasts)
   unchanged, scales           email_provider='resend' stays exactly as-is

HUMAN 1-to-1       →  Connected mailbox 2-way sync   ← NEW
   low volume, never caps      Gmail / Outlook / IMAP, true 2-way, lands in real inbox
```
Routing rule at send time:
- System/agent/bulk send  → Resend (existing `maybeSendEmailViaResend`).
- Human "reply"/"compose" in the portal inbox → connected mailbox if one exists,
  else fall back to Resend.

Inbound with a connected mailbox: MX → Google (real inbox exists). Portal ingests
via Gmail API (watch/history), NOT the Resend inbound webhook. Resend still SENDS
bulk from the domain (SPF includes both Resend + Google; DKIM stays verified in
Resend) - sending auth is separate from MX receiving, so they coexide fine.

## What already exists (the Resend spine, reuse it)
- Schema: `clients.email_provider` ('ghl'|'resend'), `clients.email_domain`;
  tables `email_threads`, `email_messages` (both already have a `provider` column -
  extend the check to add 'gmail'/'outlook'/'imap'). Migration:
  `20260702190000_email_spine_foundation.sql`.
- Outbound gate: `api/messaging/email-provider.js` `maybeSendEmailViaResend()`.
- Inbound: `api/resend/inbound-webhook.js` (store + side-effects: cancel drafts,
  exit automation → Responded, notify owner).
- Inbox read: `api/messaging/email-read-thread.js` (merged into `api/ghl/inbox.js`).
- Sender: `api/_email.js` `sendEmail()` (Resend raw fetch + suppression + audit).
- Send sites already routed through the gate: `members.js`, `ghl/send-message.js`,
  `_send.js`, `ghl/cron-trial-summary.js`, `ghl/inbox.js`.
- Mirrors the Twilio SMS spine pattern EXACTLY (provider resolver + gate + inbound
  webhook + read branch + provider-switch UI) - build this the same way.

## BUILD STATUS
- **Phase 0 (foundation) — BUILT, dormant, NOT yet applied to prod.** Migration
  `supabase/migrations/20260720170000_email_mailbox_sync_foundation.sql`:
  `client_mailboxes` table (one per academy, encrypted refresh token via
  `messaging/_crypto.js`), `email_messages.provider` check extended to
  gmail/outlook/imap, + mailbox threading/idempotency columns. **Apply to prod via
  MCP** (like the sibling spine foundations - local creds are stale, see the Twilio
  note gotcha).
- **Phase 1a (Gmail connect) — BUILT, needs env + Google setup to go live.**
  - `api/email/_mailbox.js` — Google OAuth/token helpers + `client_mailboxes` I/O.
  - `api/email/mailbox-connect.js` — `/api/email/connect` (login) + `/api/email/callback`.
    Domain-validates the connected inbox against `clients.email_domain`, stores the
    encrypted refresh token. Rewrites added to `vercel.json`.
  - **Reuses the existing `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET`** (same Google
    Cloud project as the staff calendar OAuth) - just add the Gmail API + scopes +
    the new redirect URI. Optional `EMAIL_OAUTH_BASE_URL` (default
    portal.byanymeansbusiness.com).
- **Phase 1b (Gmail inbound sync) — BUILT, needs live test.**
  `api/email/sync-gmail.js` (cron `*/3 * * * *`, also `?client_id=` for a single
  academy + Bearer CRON_SECRET / staff auth). Per active gmail mailbox: fresh
  access token (flags `needs_reconnect` if revoked), pulls new messages via the
  Gmail history cursor (`client_mailboxes.history_id`; baseline/backfill on
  missing/expired cursor = `newer_than:2d in:inbox OR in:sent`), mirrors BOTH
  directions into email_threads/email_messages (idempotent on
  `client_id+mailbox_message_id`), and fires the SAME inbound side-effects as the
  Resend webhook (notify owner, cancel agent drafts, exit automation→Responded).
  Gmail helpers (history/get/profile/parse) added to `_mailbox.js`. Side-effects
  are DUPLICATED from resend/inbound-webhook.js (Twilio-spine precedent) - keep in
  sync. NOTE: with a mailbox connected, MX points at Google so the Resend inbound
  webhook stops receiving for that domain; this cron becomes the inbound source.
- **NEXT (not built): Phase 2 send routing + UI.** `maybeSendEmailViaMailbox()`
  gate so human replies/compose go out via Gmail (threaded, shows in Gmail Sent),
  bulk/agent stays on Resend; merge mailbox threads into `api/ghl/inbox.js` read;
  "Connect your inbox" Settings card (mirror PhoneTab) with the green/reconnect
  badge. Optional: fire an instant `?client_id=` sync right after connect instead
  of waiting for the cron tick.

### What Zoran must do (Google-side, one-time, unblocks Phase 1a testing)
1. Google Cloud Console → the existing OAuth project → **enable the Gmail API**.
2. OAuth consent screen → add scopes `gmail.modify`, `gmail.send`,
   `userinfo.email`. (These are RESTRICTED → app stays in **Testing** mode for now;
   add GTA's `info@` as a test user. Full Google verification/CASA needed later for
   many external academies.)
3. Add redirect URI `https://portal.byanymeansbusiness.com/api/email/callback` to
   the OAuth client.
4. Confirm GTA's `clients.email_domain` = `byanymeanstoronto.ca` (connect blocks
   with `no_domain_on_file` otherwise). `MESSAGING_ENC_KEY` already set (Twilio).
5. Apply the Phase 0 migration to prod (MCP).

## Build phases (original plan)
**Phase 0 — schema + connection store**
- New `client_mailboxes` (client_id, provider 'gmail'|'outlook'|'imap', email,
  oauth tokens *encrypted* (reuse `messaging/_crypto.js` AES-256-GCM), imap creds,
  history_id/watch_expiry for Gmail, status). Extend `email_messages.provider`
  check + add `mailbox_message_id` (idempotency) + `in_reply_to`/`thread_ref` for
  proper threading.
- Add `email_send_lane` resolver: 'bulk' → Resend, 'human' → mailbox.

**Phase 1 — Gmail connector (first, GTA is Google)**
- OAuth connect: `api/email/connect-google.js` (scopes: gmail.send + gmail.readonly
  or gmail.modify). Store encrypted tokens in `client_mailboxes`.
- Inbound: Gmail `users.watch` → Pub/Sub push → `api/email/gmail-webhook.js` pulls
  history since `history_id`, upserts into email_threads/email_messages, fires the
  SAME side-effects as the Resend inbound webhook (extract the shared block).
  Watch expires ~7d → renewal cron.
- Outbound (human): `api/email/mailbox-send.js` → Gmail `messages.send` with proper
  `In-Reply-To`/`References` so it threads in Gmail; store outbound row.

**Phase 2 — send-site routing**
- Add `maybeSendEmailViaMailbox()` alongside the Resend gate; human compose/reply
  in the inbox calls mailbox-first, bulk/agent paths stay on Resend untouched.
- Inbox read branch: merge mailbox threads the same way email store threads merge.

**Phase 3 — Outlook + IMAP (other providers)**
- Outlook/M365: Microsoft Graph OAuth (`/me/messages`, subscription webhooks) -
  same connector shape.
- Everyone else: generic IMAP (poll or IDLE) inbound + SMTP send. User + app
  password, encrypted.

**Phase 4 — UI + provisioning**
- Staff/client Settings card "Connect your inbox" (mirror `PhoneTab.jsx` /
  `provider-switch.js`): pick Google / Outlook / Other → connect → green status.
- Show which lane sends what; let human replies default to the connected mailbox.

## Scalability answer (for the record)
- Bulk stays on Resend → tens of thousands/day, one domain reputation, no caps.
- Human mailbox lane is inherently low volume (1-to-1) → never approaches Gmail's
  ~2,000/day. That's WHY the split works. Never route bulk through a mailbox.
- Recipient's provider is irrelevant - you can send to any address from any lane.
  Provider only matters for the ACADEMY's own connected mailbox (Gmail→Graph→IMAP).

## Decisions LOCKED (2026-07-20, Zoran)
1. **Human replies always route through the connected mailbox** (no per-email
   toggle - trivial with one shared inbox).
2. **Resend inbound webhook stays as the fallback** for academies with no mailbox
   connected; Gmail-ingest takes over only once a mailbox is connected. Both
   coexist per-academy.
3. **One shared academy inbox** (`info@`), NOT per-rep, for now. (Revisit against
   the trainer-tab comms model in `project_sales_comms.md` if per-rep ever needed.)
4. **Setup = Model A: academies connect their OWN existing mailbox.** All academies
   already have a real mailbox (GTA = Google Workspace `info@byanymeanstoronto.ca`).
   Nothing is provisioned/created - it's a ONE-TIME OAuth connect by whoever holds
   the info@ login (self-serve onboarding screen or staff-assisted screen-share).

### "Right inbox" guarantee (how we tie the correct mailbox to the portal)
The OAuth connection IS the proof - Google returns the authorized address; we don't
guess. Safeguards on connect:
- OAuth callback returns the real authenticated address → store that, tied to
  `client_id` (one mailbox per academy, idempotent).
- **Domain-match check** against `clients.email_domain` → block + warn if the
  connected address's domain doesn't match (stops a personal @gmail slip).
- Confirm-back screen ("✅ Connected: info@…") before it goes live.
- Red "Reconnect inbox" status badge when the token expires/revokes (never fails
  silent) → renewal cron + reconnect CTA.

### MX / DNS at connect time
Turning on the real inbox = the domain's MX points at Google (GTA already does -
they run Workspace). Inbound then syncs via Gmail API (Resend inbound webhook stops
being the source once connected). Resend KEEPS sending bulk from the domain (SPF
includes Google + Resend, DKIM stays verified in Resend) - sending auth ≠ receiving
MX, so they coexist. For GTA, BAM controls the domain DNS already.

## When to update
- Any phase ships → mark done, note the new endpoints/tables.
- `email_messages.provider` / `client_mailboxes` schema changes → update here + the
  Resend spine note.
- If Zoran picks per-rep mailboxes → reconcile with the Communications trainer tabs.
