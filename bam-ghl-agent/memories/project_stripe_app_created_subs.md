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

## Root cause (confirmed 2026-06-01) — it's the account TYPE, not the key

Retrieved the connected account `acct_1P7kUCRxInSEtAh8`:

```
type       : standard
controller : { "type": "account" }   (the academy controls its own Stripe)
business   : By Any Means Toronto
```

For **Standard** connected accounts, Stripe gives the platform READ access to
everything but WRITE access **only to objects the platform itself created**.
This is a hard, by-design limit — **no API key (restricted or full secret)
lifts it.** We confirmed empirically: the platform secret key + `Stripe-Account`
header READS Knowl's sub fine but the portal's PATCH is rejected.

The only way to get full write access to dashboard/imported subs would be if the
account were **Express or Custom** (controller = the platform/application), i.e.
BAM controls the academy's Stripe instead of the academy owning its own
dashboard. Not worth it — would mean re-onboarding their entire Stripe under BAM.

## Doc verification (2026-06-11) — what's confirmed vs not

Checked against Stripe's official docs:

- ✅ **CONFIRMED — sub writes.** [docs.stripe.com/connect/subscriptions](https://docs.stripe.com/connect/subscriptions)
  → Restrictions: *"Your platform can't update or cancel a subscription that it didn't
  create."* So pause / unpause / cancel / change / referred-discount on foreign subs are
  hard-blocked, exactly as observed with Knowl.
- ✅ **CONFIRMED — the manual workaround is by-design.** Same page: Standard accounts with
  full Dashboard access manage their own customers' subscriptions — the academy can always
  edit any sub by hand in their dashboard.
- ⚠️ **UNVERIFIED — refunds.** No documented "created by your application" restriction on
  refunding direct charges on a Standard account. The portal's `POST /refunds` (as the
  connected account) on a CoachIQ/GHL charge MAY work — needs a live test before assuming
  it's blocked.
- ⚠️ **UNVERIFIED — billing-portal link.** Platforms creating billing-portal sessions for
  connected accounts is documented/supported ([API ref](https://docs.stripe.com/api/customer_portal/sessions/create)).
  No documented created-by restriction; the portal session acts as the account, so it may
  even allow managing foreign subs. Needs a live test.

So of the 6 PATCH actions: 4 are doc-confirmed blocked on foreign subs (pause, unpause,
cancel, change — anything that writes the sub object); refund + payment-link are
test-before-you-trust.

## The accepted model (no fix needed)

```
Sub created BY the portal      → all 6 buttons work ✅
Sub created in dashboard/import → edit by hand in Stripe 🖐
```

Affected = the migrated/backfilled BAM GTA roster (joined before the portal
created subs). Every NEW signup through the portal is fully managed. Self-heals
over time. Keep manual-for-legacy; do NOT pursue "broaden Connect access."
