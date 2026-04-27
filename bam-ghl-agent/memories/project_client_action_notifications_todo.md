---
name: Client Action Notifications (deferred TODO)
description: Notifications for when staff sends a client request OR client responds — deferred from the multi-round client action thread feature
type: project
---

When the multi-round client action thread shipped (see `project_client_action_thread.md`), notifications were intentionally left out. This note tracks what to build when notifications become a priority.

## What needs to happen

### When staff sends a client request (`action=request_client`)
- Notify the client. Channels TBD (decision deferred):
  - Email (most reliable, no install required)
  - SMS (fast, attention-grabbing, has cost per message)
  - In-app banner only (zero infra, but client must be in portal)
- Should be configurable per-client and/or per-academy.

### When client responds (`action=client_respond`)
- Notify the assigned staff member. Channels TBD:
  - Slack DM (most likely — staff lives in Slack)
  - In-app badge on the ticket card (no infra)
  - Email (low priority)

### Optional: idle escalation
- If a ticket has been awaiting_client for >7 days, ping staff to consider canceling/re-asking, and optionally re-ping the client. Out of scope for V1.

## Where to wire it

Both notification points live in `bam-portal/api/tickets.js`:
- After the `sbPatch(...)` in `request_client` case
- After the `sbPatch(...)` in `client_respond` case

Existing infra to lean on:
- Slack API: `bam-portal/api/slack/*` (already used for staff)
- Email: not yet wired — would need SMTP/Resend/Postmark
- SMS: not yet wired — Twilio is the obvious pick (BAM already uses it elsewhere)

## When to revisit

When client comms become a priority, or when a real client (not test_business) is using the portal and we hear "I didn't know I had an action request" complaints.

Reference: PWA Web Push plan (`project_ios_push_pwa.md`) for the iOS push notification path that may converge with this.
