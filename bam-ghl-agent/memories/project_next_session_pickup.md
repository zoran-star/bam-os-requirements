---
name: Next Session Pickup — 2026-05-30
description: Hand-off note. Zoran is mid-setup on the GHL Marketplace App. When he comes back, do these in order. Delete this file once the work below is done.
type: project
---

## What Zoran is doing right now

Creating BAM Business Portal as a **Sub-Account-type Marketplace App**
inside `app.gohighlevel.com` (his agency dashboard sidebar → Marketplace).

He'll come back with one of:
- A) `"connected"` / `"test SMS arrived"` → GHL is wired, do step 1 below
- B) `"stuck on step X"` → walk him through that step (full walkthrough is
     in the description line of [[project_member_management_portal]] Session 6)
- C) `"error message Y"` → diagnose from Y

## When GHL is verified (step A)

```
1. Backfill Kun Liu/Ryan + John Fu from GHL contact form data.
   They're orphan Stripe subs (cus_UVq5pKmKTHcKHg + cus_UWo0Cw0OB5BiZ3)
   that filled out the GHL form pre-2026-05-24 (before intake webhook
   was wired). Form data lives in GHL custom fields.

   Approach:
   - Use the now-active OAuth token (clients.ghl_access_token) for BAM GTA
   - GET /contacts/?locationId=Le9phlhqKyjLyd0JTECv&query=Kun+Liu
   - Pull contactId → GET /contacts/{contactId} → grab custom fields
     (athlete_name, plan, parent_email, parent_phone, etc.)
   - INSERT row into members scoped to BAM GTA client_id
   - Repeat for John Fu (query=John+Fu)

2. Cancel Kun Liu's sub via portal Cancel action.
   - Sub: sub_1TWoQ0RxInSEtAh8Mt8zPgC9
   - The portal Cancel action will:
     - DELETE the Stripe sub
     - INSERT a cancellations row (denormalized)
     - DELETE the members row
   - This clears Sergio's pending Cancel ticket.

3. John Fu stays as live member (no cancel needed).

4. Update [[project_member_management_portal]] Session 6 section:
   - mark Kun Liu + John Fu as backfilled
   - mark Sergio's Cancel ticket as resolved
   - mark task #4 + #6 complete

5. Unpark the onboarding wizard:
   - update [[project_onboarding_wizard_parked]] from PARKED → ACTIVE
   - kick off Phase 1 of the wizard build (see that note for details)

## The 3 original pause tickets (still open)

Lucrecia / Amy / Christ's mom — Sergio's pause tickets from session 1.
After backfilling Ryan + John Fu, ask Zoran if he wants to run the
3 pauses now (drive him through the portal Pause action on each)
or save for later.

Subs:
- Tristan Pierre  (Lucrecia)   sub_1TR9KkRxInSEtAh8cGQPHc7O
- Nathan          (Amy)        sub_1SQKAmRxInSEtAh80faMUh1C
- Christ          (Christ's mom) sub_1THXifRxInSEtAh8nEMFdMD8

## What NOT to do

- Don't re-explain the GHL OAuth setup — he's been through the walkthrough
  multiple times this session. Reference Session 6 of
  [[project_member_management_portal]] if he asks again.
- Don't rebuild any of the views (Pipelines/Inbox/Pricing/Members/Payment-
  link modal) — they're shipped. If he reports a bug, fix the specific bug.
- Don't touch the Stripe Connect flow (it's already wired and working).
- Don't ask him to look at GHL_LOCATIONS_JSON — that's the legacy fallback.
  The OAuth path is the new path and what we want him on.

## Quick state lookups

```sql
-- BAM GTA's GHL connection state
SELECT business_name, ghl_connect_status, ghl_location_id,
       (ghl_access_token IS NOT NULL) AS has_token,
       ghl_token_expires_at
FROM clients
WHERE id = '39875f07-0a4b-4429-a201-2249bc1f24df';

-- Members with orphan Stripe (Kun Liu + John Fu before backfill)
SELECT stripe_customer_id, stripe_subscription_id
FROM stripe_orphan_check  -- not a real table; do reverse sync if needed
```

## Context budget at session end

~69% (692k of 1M). Next session can start fresh and pull this note in
plus [[project_member_management_portal]] Session 6 to get oriented.
