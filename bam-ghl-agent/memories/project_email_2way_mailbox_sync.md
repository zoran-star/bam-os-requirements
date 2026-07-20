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

## Build phases
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

## Open decisions for Zoran
1. Human replies: default to the connected mailbox always, or per-message choice?
2. Do we keep the Resend inbound webhook as a fallback for academies with NO
   mailbox connected (current GTA behavior), and only switch to Gmail-ingest once a
   mailbox is connected? (Recommended: yes, both coexist per-academy.)
3. Whose mailbox connects - one shared academy inbox (info@) or per-rep mailboxes?
   (Affects the trainer-tab comms model in `project_sales_comms.md`.)

## When to update
- Any phase ships → mark done, note the new endpoints/tables.
- `email_messages.provider` / `client_mailboxes` schema changes → update here + the
  Resend spine note.
- If Zoran picks per-rep mailboxes → reconcile with the Communications trainer tabs.
