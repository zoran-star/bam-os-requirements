---
name: CoachIQ integration — billing ownership + credits webhook bridge
description: Strategic — connect CoachIQ to the FullControl portal so BAM can SELL FullControl to academies already on CoachIQ. Covers how BAM GTA billing splits across CoachIQ/GHL/manual, why the portal can't write to those Stripe subs, the CONFIRMED webhook bridge (api-v3.coachiq.io Incoming Webhook → Add Credits), the new-user onboarding flow, and the open questions left. Investigated 2026-06-01.
metadata:
  type: project
---

# CoachIQ integration

## Why this matters (the strategic goal)

**The point of all this: figure out how to connect CoachIQ to the FullControl
portal so BAM can sell FullControl to academies that are ALREADY on CoachIQ.**

CoachIQ has a large base of sports academies. If FullControl can sit on top of a
CoachIQ account — portal owns billing/CRM/marketing, CoachIQ keeps doing
credits/scheduling — then every CoachIQ academy is a sellable FullControl lead
without forcing them to rip out the tool they already use. The Incoming Webhook
bridge (below) is the technical wedge that makes this possible.

This started from a concrete case (pausing Knowl Beharie on BAM GTA) and grew
into the general integration model.

## What CoachIQ is to academies

CoachIQ is the **credits + scheduling engine** BAM GTA uses. Athletes get
training "credits"; CoachIQ grants them when a CoachIQ product is purchased and
redeems them on booking. The `members.coachiq_member_id` column is the CoachIQ
user id for each athlete.

## Who created BAM GTA's Stripe subscriptions (the `application` stamp)

Every Stripe sub carries an `application` id = the Connect app that created it.
For BAM GTA (`acct_1P7kUCRxInSEtAh8`, a **Standard** connected account):

```
ca_G3zgR3Ix46909q9NDX3KlZjURzBW8TsK = CoachIQ          ~68 subs (the bulk)
ca_D5Mpe2emSMW6EZeofhNaydC4Kq5zGxQo = GoHighLevel       ~9 subs (altId = GHL loc)
NULL                                = Stripe dashboard ~23 subs (manual)
BAM portal                          = 0 subs
```

Live (active+trialing) ≈ 33: CoachIQ 18, manual 13, GHL 2.

## Why the portal can't manage these subs

Standard connected account → the platform can READ everything but can only
WRITE to subs **it created**. The portal created none, so pause/unpause/change/
cancel/referred all fail with *"can't make changes on a subscription that was
not created by your application."* See [[project_stripe_app_created_subs]] for
the full Stripe-side detail. In-place manual edits in Stripe keep the same
sub_id, so CoachIQ stays synced (that's why the Knowl manual pause was correct).

## The CoachIQ API — what the key can do

There are no public API docs. The main app (`admin.coachiq.io`, Apollo GraphQL)
is session-authed + WAF-locked — the API key does NOT open it.

The public API key (org id + group id + key, from CoachIQ Settings → API keys)
works in two places:

1. **Zapier integration** — limited: ACTIONS = Create User, Send Email/SMS/
   In-App/Announcement. TRIGGERS (outbound) = New User/Purchase/Booking/Form.
   No "add credits" action here.
2. **Automation Incoming Webhook trigger** — the useful one (below).

## CONFIRMED: Incoming Webhook automation trigger

CoachIQ automations can be triggered by an inbound webhook (the help docs omit
this, but the product UI has it). Confirmed working live on 2026-06-01.

```
ENDPOINT  POST https://api-v3.coachiq.io/hook/automation/trigger/{automationId}
AUTH      Authorization: Bearer <API_KEY>
          x-group-id: <GROUP_ID>
BODY      arbitrary JSON; referenced in automation actions as {{payload.key}}
          (nested {{payload.user.email}}, arrays {{payload.items.0.id}})
```

Auth test results (dummy automationId):
- no header → 401 "Missing Authorization header"
- wrong key → 401 "Invalid API key"
- valid key + x-group-id → 404 "Automation not found" = **auth passed** ✅

Real API host is **api-v3.coachiq.io** (not api.coachiq.io, which doesn't
resolve). DNS → 44.233.29.64.

Automation ACTIONS available (internal): Add/Redeem Credits, Add/Remove Tag,
Add/Remove Product Purchase, Grant/Revoke Program Access, messaging, Wait,
Send to External Webhook (outbound). TRIGGERS: New User, New Purchase, New
Booking, New Form, New/Removed Tag Connection, Booking Created/Started/Ended/
Cancelled/Completed, Subscription Cancelled, Scheduled Check, **Incoming Webhook**.

## The bridge architecture (lets the portal own billing)

```
Portal owns Stripe sub (all buttons work)
  → Stripe payment webhook → portal handler
  → POST api-v3.coachiq.io/hook/automation/trigger/<creditAutomationId>
     Bearer <key> · x-group-id <group>
     { "userId": <members.coachiq_member_id>, "credits": N, "plan": "2/wk" }
  → CoachIQ automation: Incoming Webhook → "Add Credits to {{payload.userId}}"
Pause/cancel → portal simply stops POSTing (or fires a redeem/revoke automation).
```

This decouples credits from CoachIQ's sub_id, so #3 (portal-created new subs) and
#4 (migrate the 33 live subs to portal-owned) both become viable without breaking
credits. Migration card-reuse check: 26/33 have a reusable default PM, 7 need a
re-collect (payment link).

## Creating new users + the onboarding flow

`api-v3.coachiq.io` is **webhook-only** — it exposes just
`/hook/automation/trigger/{automationId}`. Every other path (users, products,
etc.) returns 404. **There is no REST endpoint to create a CoachIQ user.**

So a CoachIQ user must exist BEFORE the portal can grant them credits/products.
Two ways to create one:
- **A. Parent self-signs-up in CoachIQ** (build it into the onboarding funnel)
- **B. Zapier "Create User" action** (portal → Zapier → CoachIQ) — the only
  programmatic path. (An automation itself has no "Create User" action.)

Automation **actions** seen in the UI: Send Announcement/In-App/SMS, Add/Remove
Product Purchase, Add/Remove Tag, Update Custom Field, Add/Redeem Credits. Each
action has a **Target User** = "User from trigger" with a **Change** option.

Proposed new-member flow:
```
1. Onboarding funnel → parent gets a CoachIQ account (A or B)
2. Parent pays → PORTAL creates the Stripe sub (portal-owned)
3. Payment succeeds → portal POSTs the webhook:
     Automation A: "Add a Product Purchase to a User"
       → grants product + program access + initial credits
       (grants access WITHOUT payment — perfect since they paid in the portal)
4. Each renewal → portal POSTs the webhook:
     Automation B: "Add Credits → Specific Product Bank"  → monthly top-up
5. Pause/cancel → portal stops POSTing
     (optional Automation C: Redeem Credits / Revoke Program Access)
```

## OPEN QUESTIONS — what's left to figure out

1. **User matching from the webhook payload.** The action's Target User
   ("User from trigger" → Change) — can it resolve a user by **email**
   (`{{payload.email}}`)? If yes, email is the join key and the portal never
   needs to store `coachiq_member_id`. If id-only, the portal must capture each
   athlete's CoachIQ id during signup (e.g. a "New User → Send to External
   Webhook" automation posting the id back). **Need a screenshot of the Change
   options to decide.**
2. **How parents get a CoachIQ account in onboarding** — self-signup (UX detour)
   vs Zapier Create User (seamless, needs a Zap). Pick one.
3. **Live end-to-end test** — create one "Incoming Webhook → Add Credits"
   automation, grab its automationId, fire a real test credit at a test athlete.
4. **Product/credit modeling** — confirm one product-bank per plan and the
   per-cycle credit counts (e.g. 2/wk → 8/mo) so Automation B tops up correctly.
5. **Scope decision** — bridge for NEW members only (#3) vs also migrate the 33
   live BAM GTA subs to portal-owned (#4: 26 auto, 7 re-collect).
6. **Sales motion** — once proven on BAM GTA, package this as the "keep CoachIQ,
   add FullControl" offer for other CoachIQ academies (the strategic goal).

## Secrets

The API key, org id, and group id are NOT stored in this repo. They belong in
Vercel env when the bridge is built. The key Zoran pasted in chat on 2026-06-01
should be rotated.

## Status (as of 2026-06-01)

```
✅ Bridge endpoint + auth CONFIRMED LIVE (api-v3 webhook, Bearer + x-group-id)
✅ Architecture proven: portal owns billing, CoachIQ does credits via webhook
✅ New-member flow drafted (create user → pay → Add Product Purchase → top-ups)
⏳ NOT built. Blocked on the 6 open questions above (esp. #1 user matching + #3 test)
```

Immediate next step: get the **Target User → Change** screenshot (open question #1),
then create the test automation and fire a live credit (#3).
