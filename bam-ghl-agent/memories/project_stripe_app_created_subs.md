---
name: Stripe "sub not created by your application" — blocks portal billing actions
description: Members whose Stripe subscription was NOT created by the BAM portal app cannot be paused/cancelled/changed/refunded via the portal — Stripe Connect (OAuth) rejects writes. Billing must be handled by hand in Stripe; only the DB status is updated.
metadata:
  type: project
---

# Gotcha: Stripe Connect blocks writes to subs the app didn't create

## The error

When a portal billing action (pause / cancel / change / refund) hits Stripe for
a member whose subscription was created **outside** the BAM portal (manually in
the Stripe dashboard, or by another integration), Stripe Connect returns:

```
You can't make any changes on a subscription that was
not created by your application.
```

This is an OAuth-Connect restriction: a platform connected to a sub-account via
OAuth can only mutate objects **it created**. Subs created directly in the
connected account's dashboard are off-limits to the portal's Connect key.

## What it affects

ALL six member PATCH actions that call Stripe — pause, unpause, cancel, change,
refund, payment-link — will fail the Stripe step for these legacy/hand-made subs.
This is directly relevant to the [[project_next_session_pickup]] thread (testing
the 6 PATCH actions): any migrated/backfilled member whose sub predates the app
may hit this.

## The workaround (what we did for Knowl Beharie, 2026-06-01)

Knowl's sub (`sub_1TJLFERxInSEtAh8IehOYB4r`, BAM GTA) was created directly in
Stripe. Zoran wanted a free month + paused status.

1. **Billing handled by hand in Stripe** — Zoran set `trial_end = 2026-06-30`
   manually in the dashboard (the portal couldn't).
2. **DB-only pause** — flipped `members.status` to `paused` + inserted an active
   `cancellations` pause row (pause_start/pause_end matching the trial window,
   `activated_at = now`, `completed_at = null`) so the hourly cron
   ([[project_pause_lifecycle]] Phase B) auto-recovers him to `live` on the
   pause_end date. **No Stripe call made.**
3. Logged a `member_audit_log` row noting mode=manual_no_billing.

## How to tell if a sub is app-created

The failed portal attempt leaves a `cancellations` row with
`reason` starting `stripe failed: You can't make any changes...`. If you see
that, the sub is not app-created — fall back to the manual-billing + DB-pause
pattern above.

## Open question / future fix

To let the portal manage these subs, the connected account would need to grant
the platform broader access, or the subs would need to be recreated through the
app. Not solved yet — flag to Zoran if it recurs at scale.
