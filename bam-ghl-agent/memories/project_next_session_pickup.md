---
name: Next Session Pickup — 2026-05-30 (after GHL connected)
description: Hand-off note. GHL OAuth is LIVE end-to-end for BAM GTA. Kun Liu/Ryan + John Fu are backfilled. Next: test the 6 PATCH actions end-to-end starting with clicking Cancel on Ryan. Delete this file once Sergio's 4 tickets are cleared.
type: project
---

## TL;DR — state at end of session

```
✅  GHL Marketplace App created · BAM GTA OAuth'd · token in DB
✅  Kun Liu/Ryan + John Fu inserted into members (via GHL contacts API)
⏳  6 PATCH actions (pause/unpause/change/refund/cancel/referred + payment-link) NOT yet tested in production
⏳  Sergio has 6 pending tickets — 1 of them (Cancel Ryan) is what tests Cancel
```

## What to do FIRST in the new session

```
1. Pull latest:  cd /Users/zoransavic/bam-os-requirements && git pull
2. Ask Zoran which button he wants to test first.
3. The order he picked: Cancel Ryan FIRST (clears Sergio's ticket #4).
4. Walk him through:
     Members tab → search "Ryan" → click card → Cancel button → confirm
5. Verify:
     - Stripe sub_1TWoQ0RxInSEtAh8Mt8zPgC9 deleted in Stripe
     - cancellations row inserted (SELECT * FROM cancellations WHERE athlete_name='Ryan Liu')
     - members row 9ab25134-3f08-4353-a3ba-27d270b50d97 deleted
     - member_audit_log entry with action_type='cancel'
6. Then Pause Lucrecia → Tristan Pierre (#1), Amy → Nathan (#2), Christ (#3)
7. Then update each task status as you go.
```

## Sergio's pending tickets (as of 2026-05-30)

```
1.  emily pelleja — Pause                         (newest)
2.  Jamie — Other                                 (??? unclear, ask Zoran)
3.  Christ's mom — Pause                          ← task #3
4.  Kun Liu — Ryan's dad — Cancel                 ← task #4 (Ryan now in roster)
5.  Amy (Nathan's mom) — Pause                    ← task #2
6.  Lucrecia — Pause                              ← task #1
```

## Key state pointers

```
BAM GTA client_id        39875f07-0a4b-4429-a201-2249bc1f24df
BAM GTA Stripe acct      acct_1P7kUCRxInSEtAh8
BAM GTA GHL locationId   Le9phlhqKyjLyd0JTECv
GHL Marketplace App      "FC"  (Zoran renamed from "BAM Business Portal")
GHL OAuth client_id      6a1b6d4148da57158ac6a510-mpsz61td

Kun Liu / Ryan
  members.id             9ab25134-3f08-4353-a3ba-27d270b50d97
  Stripe sub             sub_1TWoQ0RxInSEtAh8Mt8zPgC9 (active, Accelerated $316)
  GHL contact id         U8DTfeKzDBLuQicSGSv0
  Parent: Kun Liu, lkun121@yahoo.com, +16475272083
  Athlete: Ryan Liu (from GHL custom field RqNojS2YaVGQNjMAo4HB)

John Fu
  members.id             ae431da8-9cb7-442f-99c6-3fd578e3268e
  Stripe sub             sub_1TXkQORxInSEtAh8QtnpZKpq (active, Accelerated $316)
  GHL contact id         vtaIgKM5Rs9K445VihDV
  Parent: John Fu, johnfu041810121021@gmail.com, (no phone)
  Athlete: John Fu (NO separate athlete field in his GHL — flag for follow-up)

Buttons guide doc (Zoran's reference)
  /Users/zoransavic/bam-os-requirements/bam-ghl-agent/docs/member-buttons-guide.html
```

## Things that were tricky — DO NOT redo

```
1. The OAuth redirect URI path can't contain "ghl"
   → We moved api/ghl/connect.js → api/messaging/connect.js
   → If future-you sees /api/ghl/connect referenced anywhere, that's stale.

2. Bash `echo "..." | vercel env add` adds trailing \n
   → All GHL OAuth code paths read env vars via (process.env.X || "").trim()
   → Don't remove that pattern.

3. 4 scopes are Agency-only (not Sub-Account):
     snapshots.readonly
     socialplanner/medialibrary.readonly
     blogs.readonly · blogs.write
   → These are commented out in api/messaging/connect.js SCOPES list.
   → If GHL ever exposes them to Sub-Account apps, uncomment + tick in
     the Marketplace app config.

4. GHL "Submit for review" ≠ "Publish version"
   → Private apps only need Publish (skip Submit for Review).
   → Even Private apps need at least 1 published version for OAuth to work.

5. GHL has THREE different "secrets" with similar names:
     - Client Secret              ← OAuth (GHL_OAUTH_CLIENT_SECRET)
     - Webhook Shared Secret      ← for future webhook signature verify
     - App Shared Secret          ← yet another thing, not used yet
   Zoran pasted the "shared secret key" first by mistake — it's the
   webhook one. Make sure you're getting the OAuth Client Secret.

6. App type MUST be "Sub-Account" (not "Agency")
   → location-scoped tokens; tokens for one location work for that location only

7. The persistent GHL banner uses isNativeApp() (NOT _isNativeApp)
   → typeof guarded; if you add another boot ping, use the same guard.

8. URL structure:
   /                        → React app's index.html (SPA fallback rewrite)
   /client-portal.html      → standalone HTML file (the client portal)
   /api/*                   → serverless functions
   staff.byanymeansbusiness.com   → React staff portal
   portal.byanymeansbusiness.com  → /client-portal.html is the canonical client URL
```

## Files Zoran touched but YOU may not know about

```
docs/member-buttons-guide.html         Zoran's explainer of the 8 PATCH actions.
                                       If he asks to "see the doc" — that's the one.
                                       Open with: open <path>
```

## Env vars currently set in Vercel for this work

```
GHL_OAUTH_CLIENT_ID         …61td
GHL_OAUTH_CLIENT_SECRET     …e5a6
GHL_OAUTH_STATE_SECRET      …b3fb  (auto-generated this session)
GHL_LOCATIONS_JSON          (legacy — still set, used as fallback)
GHL_INTAKE_WEBHOOK_SECRET   (older — used by intake form webhook)
STRIPE_CONNECT_SECRET_KEY   (the platform key for Connect)
STRIPE_WEBHOOK_SECRET       (Stripe webhook signature)
SUPABASE_SERVICE_ROLE_KEY
```

## After the 6 PATCH actions are verified

```
1. Mark Sergio's tickets cleared in his queue.
2. UNPARK the onboarding wizard:
     - Update [[project_onboarding_wizard_parked]]
     - Kick off Phase 1 build (~half day for wizard component +
       Stripe-to-members auto-import).
3. Refactor task #10 + #11 + #13 (catalog refactor — separate thread,
   independent of GHL).
4. Delete this file.
```

## Quick health checks if anything looks wrong

```sql
-- BAM GTA's GHL OAuth state
SELECT business_name, ghl_connect_status, ghl_location_id,
       (ghl_access_token IS NOT NULL) AS has_token,
       ghl_token_expires_at
FROM clients WHERE id = '39875f07-0a4b-4429-a201-2249bc1f24df';

-- Ryan + John Fu rows
SELECT id, athlete_name, parent_name, status::text, stripe_subscription_id
FROM members
WHERE id IN ('9ab25134-3f08-4353-a3ba-27d270b50d97',
             'ae431da8-9cb7-442f-99c6-3fd578e3268e');

-- Recent audit trail
SELECT created_at, athlete_name, action_type, performed_by_name
FROM member_audit_log mal
LEFT JOIN members m ON m.id = mal.member_id
WHERE mal.client_id = '39875f07-0a4b-4429-a201-2249bc1f24df'
ORDER BY mal.created_at DESC LIMIT 20;
```
