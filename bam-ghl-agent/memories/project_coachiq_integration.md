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

## CoachIQ GraphQL API (api-v3) — DIRECT user create, no Zapier (2026-06-02)

`api-v3.coachiq.io/graphql` is a GraphQL API authed by the **same API key**
(`Authorization: Bearer <key>` + `x-group-id`). Introspection is disabled, but
field names were mapped via error "did you mean" suggestions. Query root = `Root`,
mutation root = `Mutation`.

**Auth scope of the API key is LIMITED:**
- ✅ `signUp_V2` works with the key (it's a public self-signup; key not even required)
- ❌ `adminAddUser`, `updateUser`, `deleteUser`, `user` query → "You must be logged
  in to do this" (need a real STAFF session token, not the API key)

**The create-user path = `signUp_V2` (no Zapier needed):**
```
mutation { signUp_V2(input:{
   email:String!  first:String!  last:String!  phone:String!  password:String!
}) { token status } }
```
- Self-signup style → **requires a password** → collect it on the FC onboarding
  form (parent picks it, then logs into the white-labeled app with it).
- Returns `{ token, status }` — **NOT the userId.** Get the userId by: (1) decoding
  the token (likely a JWT w/ the id), (2) calling `user` query with that token, or
  (3) a CoachIQ "New User → Send to External Webhook" automation that posts the id
  to the portal (most robust). ← TODO confirm which.
- **Rate-limited** ("Auth rate limit exceeded", retryAfter ~450s) — fine at normal
  signup volume; only trips under rapid testing.
- Other input shapes seen: `UpdateUserInput{ firstName!, lastName!, email, phone,
  password, tags, avatar }` (used by admin mutations); `SignUp_V2_Input` uses
  `first`/`last` not `firstName`/`lastName`.

⚠️ **CORRECTION (2026-06-02): signUp_V2 alone is NOT enough.** The user it creates
is a **bare CoachIQ login account that is NOT enrolled in the academy's group/
roster** — they don't show in Clients/People, and firing the credit/tag webhook at
their id runs **0 actions** (vs a real member = 1 success). The token DOES decode to
the new userId (`{id, iat}` JWT — userId extraction solved), but the account is
floating/unusable until enrolled.

**To ENROLL a user in the academy group** (so they're creditable/bookable) needs
elevated auth the API key lacks:
- `adminAddUser` → "must be logged in" → needs a STAFF session token.
- Zapier "Create User" → may handle group enrollment (the integration's blessed
  path — possibly why CoachIQ exposes it).
- A CoachIQ product/checkout → but that's CoachIQ taking payment (we don't want).

**LOGIN PATH (tested 2026-06-03):** `emailLogin(input:{ email, password, groupId?,
code? }): { token, success }` works → returns a staff session JWT. The JWT is
`{id, iat}` with **NO exp claim → likely long-lived** ("login once, store token"
is viable). BUT: logging in as `zoran@byanymeansbball.com` and calling
`adminAddUser` returns **"You are not allowed to do this"** — that account is
authenticated but is NOT an admin/owner of the BAM GTA group (719bb0cf). Its
`user`/`profile` queries are self-scoped (return only the active user, null here)
— so it also can't look up the 32 missing members.

**→ Need the actual BAM GTA CoachIQ OWNER/ADMIN account** (likely a "By Any Means
Toronto" login, not the bball.com one), OR grant that account admin on group
719bb0cf in CoachIQ settings. Once an admin token is used: adminAddUser should
create+enroll, and admin read queries should resolve the 32 missing coachiq ids.
Fallback if admin access can't be arranged: Zapier "Create User" (integration
scope may enroll). signUp_V2 alone only makes bare, unenrolled accounts.

**RESOLVED 2026-06-05 — direct-API create+enroll is a DEAD END.** Tested an
admin-dashboard JWT (same user 9c343fbf): `adminAddUser` on api-v3 → "You are not
allowed to do this", and `admin.coachiq.io/graphql` (the host the dashboard uses)
returns **403 — WAF-blocked to server-side requests** even with browser headers
(Origin/Referer/UA) + the token. The dashboard creates users only in-browser
(WAF + session cookies we can't replicate). So the portal CANNOT create+enroll a
CoachIQ user via any token/API we can reach. **Use one of:** (a) Zapier "Create
User" action, or (b) manual creation in the CoachIQ UI. Credit bridge +
(proposed) create-sub are unaffected.

## ✅ CREATE+ENROLL SOLVED — Zapier "Create User" (CONFIRMED 2026-06-05)

The Zapier "Create User" action IS the create+enroll path. Tested live:
- Returned a CoachIQ user id (`2578c9b2-43ec-45da-9c81-31ab263adbd6`)
- The user **appeared in the BAM GTA roster** (= ENROLLED in the group, unlike
  the bare signUp_V2 account)
- The credit webhook fired at that id **succeeded** (add_tag green, tag landed) →
  the user is fully actionable/creditable.

So the engine's create+enroll runs through Zapier (integration scope does what the
API key + user tokens can't). Setup:
- CoachIQ Zapier app is PRIVATE — invite link:
  https://zapier.com/developer/public-invite/208528/e1b120aaaf4d5eb365a91028eb3bcfc2/
- Connect with API key (…53f2) + Group ID 719bb0cf.
- Action "Create User" fields: first, last, email, phone → returns the user id.
- **Capture that id → members.coachiq_member_id.** Then credit via the webhook.

New-member funnel step 2 = trigger Zapier "Create User" (GHL form → Zapier, or
portal → Zapier webhook) → store returned id. ALL FOUR ENGINE COMPONENTS now
proven: #1 create-sub (coded), #2 credits (proven), #3 create+enroll (proven via
Zapier), #4 store id (backfill + Zapier-return). Remaining = wire/deploy + build
Track A funnel + run Track B migration (need sign-off + prereqs).

⚠️ Test cleanup: a few "FCTEST/ZAPTEST DELETEME" test users exist in BAM GTA —
delete them in CoachIQ People when convenient.

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
     { "user": { "id": "<members.coachiq_member_id>" }, "credits": N }
     ↑ user.id = the CoachIQ USER id (NOT email, NOT profile id) — see #1
  → CoachIQ automation: Incoming Webhook, action "Add Credits"
     with Target User = "User from trigger" (resolves from payload user.id)
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
Ways to create one:
- **Zapier "Create User" action** (FC/GHL form → Zapier → CoachIQ) — **the chosen
  path.** No CoachIQ-hosted form is shown to the parent.
- CoachIQ signup form (Login/Signup connection) — works + is no-Zapier, but it's
  CoachIQ-hosted; rejected because Zoran wants signup to live in the FC/GHL funnel.
- Manual create in the CoachIQ UI — Zoran has done this before; same result.

**Login is self-serve (confirmed by Zoran):** a created user has NO password;
on first app open they set a password and log in (matched by email). So a
Zapier/manually-created user works seamlessly — no welcome-email needed.

**Parent USES CoachIQ to book** (decided) → they need a real login, which the
first-open flow gives them. CoachIQ can be **white-labeled** (branded app, custom
domain, themed athlete portal — "your app, not CoachIQ's"), so the parent only
ever sees the academy/FullControl brand, never "CoachIQ".

Automation **actions** seen in the UI: Send Announcement/In-App/SMS, Add/Remove
Product Purchase, Add/Remove Tag, Update Custom Field, Add/Redeem Credits. Each
action has a **Target User** = "User from trigger" with a **Change** option.

DECIDED new-member funnel (Zoran's vision, 2026-06-01):
```
1. FC/GHL-branded FORM (incl. a password field) → contact into GHL + Supabase
     → portal backend calls signUp_V2 DIRECTLY (api-v3 GraphQL, no Zapier)
       to create the CoachIQ user (parent never sees a CoachIQ form)
     → CAPTURE the new CoachIQ user id (decode token / user query / New-User
       outbound-webhook automation) → store in members.coachiq_member_id
       (required — the credit webhook targets by user.id, see #1)
2. Funnel → PORTAL payment page → portal creates the Stripe sub (portal-owned)
3. Payment succeeds → portal POSTs the webhook:
     Automation A: "Add a Product Purchase to a User"
       → grants product + program access + initial credits
       (grants access WITHOUT payment — perfect since they paid in the portal)
4. Each renewal → portal POSTs the webhook:
     Automation B: "Add Credits → Specific Product Bank"  → monthly top-up
5. Post-payment page: "download your app" → white-labeled CoachIQ app;
     parent first-opens it → sets password → books with the pushed credits
6. Pause/cancel → portal stops POSTing
     (optional Automation C: Redeem Credits / Revoke Program Access)
```
Sacred rule: the signup form and payment page are FC/portal — **never put the
payment (Products connection) on a CoachIQ form**, or CoachIQ creates the sub and
billing ownership is lost.

## OPEN QUESTIONS — what's left to figure out

1. ~~User matching from the webhook payload~~ **RESOLVED 2026-06-02 (live-tested).**
   The join key is **`{ "user": { "id": "<CoachIQ user id>" } }`** — nested, key
   literally `id`, value = the CoachIQ **user id** (e.g. Knowl = `0227cc1d-1c0b-
   403f-bda7-aea877fbd5cf`). Verified: that payload → action `success:true`,
   "Tag added to user", and CoachIQ enriched the full user (email/phone/name).
   What does NOT work (all tested live):
   - `{"user":{"email":…}}` — email does NOT resolve, even for a real athlete
   - `{"user":{"userId":…}}` — key must be `id`, not `userId`
   - top-level `userId`/`email` — ignored
   - **profile id ≠ user id** — the `?profile=` id (e.g. `d8016b4e…`/`32d290cf…`)
     is the PROFILE id and does NOT resolve; you need the USER id (`0227cc1d…`).
   "User from trigger" stays EMPTY for an incoming webhook ("user is required");
   "Specific user" is a fixed dropdown (no variables). So the ONLY way to target
   dynamically is sending the real CoachIQ user id as `user.id`.

   **Consequence — the portal must STORE each member's CoachIQ user id**
   (`members.coachiq_member_id`, currently EMPTY):
   - NEW members → Zapier "Create User" returns the id → save it on creation.
   - EXISTING members → BACKFILL from Stripe: CoachIQ stamps `userId` into each
     sub's metadata (confirmed on Knowl's sub: `userId=0227cc1d…`, plus
     `profileId`, `userEmail`, `productId`). Read it off the 68 CoachIQ subs.
2. ~~How parents get a CoachIQ account~~ **RESOLVED 2026-06-01:** FC/GHL form →
   Zapier "Create User" (no CoachIQ form). Parent uses CoachIQ (white-labeled) to
   book; login is self-serve on first app open (set password, matched by email).
   Remaining build: wire GHL→Zapier→Create User + confirm a Zapier-made user can
   first-open-set-password the same as a manually-made one.
3. **Live end-to-end test** — create one "Incoming Webhook → Add Credits"
   automation, grab its automationId, fire a real test credit at a test athlete.
4. **Product/credit modeling** — confirm one product-bank per plan and the
   per-cycle credit counts (e.g. 2/wk → 8/mo) so Automation B tops up correctly.
5. ~~Scope decision~~ **DECIDED 2026-06-02: MIGRATE ALL to portal-owned** — Zoran
   wants the billing buttons (pause/cancel/change/refund) to work for EVERY member,
   and buttons only work on portal-created subs. So the back-book must be migrated.
   **Migration is a risky live cutover — do it LAST, after the bridge is proven.**

   Per-member mechanic: portal creates a NEW sub on the existing customer (reuse
   card), trial_end = OLD sub's next-charge date (no double-charge/gap) → cancel
   the OLD CoachIQ sub → portal now webhooks credits on each new-sub payment
   (existing credits stay; only future top-ups switch to the bridge).

   The 4 "don't mess it up" risks:
   - Timing → anchor new sub trial_end to old current_period_end.
   - Cards → 26/33 reuse silently, 7 need a payment-link re-collect.
   - 🔴 CoachIQ "Subscription Cancelled" trigger may fire on cancel and revoke
     the member's access/credits → CHECK + disable/handle the academy's automations
     before cutover.
   - Credit continuity → the "Add Credits on payment" webhook automation must be
     LIVE + tested BEFORE canceling any CoachIQ sub.

   Build order: (1) backfill coachiq_member_id → (2) #4 product/credit modeling →
   (3) build+test the credit webhook automation (#3) → (4) portal create-sub +
   Stripe-webhook→CoachIQ credit POST → (5) neutralize CoachIQ Subscription-
   Cancelled automations → (6) THEN migrate the 33 live subs per-member.
   Fallback if cutover too risky: keep back-book on CoachIQ, manage those billing
   changes manually in Stripe (the Knowl in-place pattern); new members portal-native.
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
✅ New-member funnel DECIDED (FC/GHL form → Zapier Create User → portal payment →
   webhook adds product/credits → download white-labeled app → first-open login)
✅ #2 RESOLVED (user creation + login self-serve on first app open)
✅ #1 RESOLVED (live-tested): join key = { "user": { "id": "<CoachIQ user id>" } }.
   Email/profile-id do NOT work — must send the real user id. Portal must store
   coachiq_member_id (new = Zapier returns it; existing = backfill from Stripe meta).
✅ #5 scope DECIDED: MIGRATE ALL to portal-owned (buttons must work for everyone);
   cutover done LAST, after the bridge is proven.
⏳ NOT built. Build order: (1) backfill coachiq_member_id from Stripe metadata →
   (2) #4 product/credit modeling → (3) build+test credit webhook automation →
   (4) portal create-sub + Stripe-webhook→credit POST → (5) handle CoachIQ
   Subscription-Cancelled automations → (6) migrate the 33 live subs.
```

**Backfill DONE 2026-06-03:** populated `members.coachiq_member_id` for **22 of 54**
BAM GTA members by matching Stripe `customer`→`metadata.userId` (CoachIQ stamps
userId on every sub it creates; 73 CoachIQ subs / 33 distinct customers / 22 matched
a member row). The other **32 members are missing** because their subs were created
by **GHL or manually, not CoachIQ** — so there's no userId in Stripe metadata for
them. Those 32 need a CoachIQ-side lookup (the `user`/list query, which needs a
STAFF session token) OR confirmation they're even CoachIQ users. Note: siblings can
share one CoachIQ user/customer (e.g. Joey + Penelope → same userId).

Immediate next step: #4 product/credit modeling + the emailLogin→staff-token path
(unblocks both user create+enroll AND the 32 missing coachiq ids).

## BUILD PLAN — execution-ready (2026-06-03)

Code so far: **`bam-portal/api/coachiq.js`** (PR #49) — proven `addCoachiqCredits()`
+ `triggerCoachiqAutomation()` helper; `createCoachiqUser()` is a stub (blocked).

ENGINE (remaining):
1. **Portal create-sub** (`api/members.js` new action `create-sub` or a dedicated
   fn): platform key + `Stripe-Account: <connected acct>` → create subscription on
   the academy's connected account so the PORTAL owns it. Reuse the customer's
   default payment method; set `trial_end = <next charge>`; stamp
   `metadata: { member_id, coachiq_user_id }`. New members: fresh customer+sub.
   Migration: anchor `trial_end` to the OLD sub's `current_period_end`.
   PRICE SOURCE READY: `pricing_catalog` (client 39875f07…) has the full plan→price
   map; pick the `tier='canonical'` row per `canonical_plan` (1/wk→plan_ToNwa96lQ5I1Bs,
   2/wk→plan_ThYK86w2Zd8fp3, 3/wk→plan_U3CUUJkzgyTjel, unlmtd→plan_U3CFSoR1LdyGlb,
   + 3mo/6mo canonical variants). So create-sub doesn't need new price config.
2. **Wire credits**: in `api/stripe/webhook.js` `handleInvoiceSucceeded`, for
   PORTAL-OWNED subs only (e.g. `metadata.coachiq_user_id` present), call
   `addCoachiqCredits(metadata.coachiq_user_id, { plan, amount })`. Never fire for
   CoachIQ-owned subs (they credit natively) → no double-credit.
3. **Per-academy config**: add `clients.coachiq_group_id`,
   `clients.coachiq_credit_automation_id` (+ key ref). Env fallback for BAM GTA.
4. **Create+enroll user** (BLOCKED): finish via admin token (api-v3/graphql
   `adminAddUser`) or Zapier "Create User"; capture id → `coachiq_member_id`.

PRODUCT/CREDIT MODEL (#4) — Master Credits. **CORRECTION 2026-06-05: the
   "Add Credits"/"Redeem" "Number of Credits" field is a FIXED number stepper — it
   does NOT accept {{payload.credits}} (variables/Insert Field don't work there).**
   So we can't send a dynamic amount. Instead: **one automation PER credit amount**,
   and the PORTAL calls the matching automationId for the member's plan.
     - v1 (4-week billing): build 4 automations → Add 4 / Add 8 / Add 12 / Add 48
       (each: Incoming Webhook → Add Credits → Master → fixed N).
     - term plans add more amounts later (24/36/48/72/144/288) — or only support
       monthly billing in v1.
   Portal stores an amount→automationId map (env or clients row) and POSTs
   {user:{id}} to the right one. No per-product banks, no CoachIQ products.
   Expiry (reset-then-add) ALSO blocked by the same fixed-number limit on Redeem →
   ship v1 WITHOUT expiry (credits roll over; revisit later).
   Trade-off accepted: parents don't see their plan in CoachIQ (it's in the FC portal
   / ask a coach).
   FINAL NUMBERS (Zoran, 2026-06-05): monthly credits per plan = 1/wk:4, 2/wk:8,
   3/wk:12, unlmtd:48 (48 = "effectively unlimited", big-grant approach). Per
   payment grant = monthly × months-in-cycle (4-wk→×1, 3mo→×3, 6mo→×6), e.g.
   2/wk 3-month = 24, unlmtd 6-month = 288. **Credits EXPIRE at end of each billing
   cycle**. NOTE (2026-06-05): the "Add Credits" action has NO expiry field. Expiry
   is done via **RESET-THEN-ADD** in the single Incoming Webhook automation:
     (1) Data Source "Get User Credits" → current Master balance
     (2) Action "Redeem Credits from a User" → amount = that balance (zeroes it)
     (3) Action "Add Credits → Master" → {{payload.credits}}
   Each payment SETS the balance to the new cycle's amount → unused credits don't
   roll over = effective cycle-end expiry. Plan tiers ARE enforced by credit count;
   unlmtd is just a high number (48).

TRACK A (new customers): GHL/FC form → createCoachiqUser (capture id) → PORTAL
   Stripe Checkout (portal-owned sub) → webhook → addCoachiqCredits → app-download
   page. Payment NEVER on CoachIQ/GHL.

TRACK B (migrate 68): prereqs first — backfill ids ✅(22/54; 32 need admin lookup),
   credit automation LIVE + tested, DISABLE CoachIQ "Subscription Cancelled"
   automation. Then per member: create portal sub (anchored) → cancel CoachIQ sub →
   credits now via webhook. 26/33 silent, 7 need card re-collect.

EXTERNAL INPUTS STILL NEEDED FROM ZORAN:
   • admin-scoped CoachIQ token (or Zapier) → unblock create+enroll + the 32 ids
   • credits-per-plan numbers → product/credit model
   • go-ahead to wire + deploy portal code (PR #49 onward)

## TRACK A — new-customer onboarding funnel (build-ready design, 2026-06-04)

Goal: a new athlete signs up entirely in FullControl-branded surfaces; CoachIQ is
invisible until the (white-labeled) app download. Portal owns billing day one.

```
STEP            SURFACE              MECHANICS
─────────────────────────────────────────────────────────────────────
1 Capture       GHL/FC form          Fields: parent first/last/email/phone,
                (FC-branded)         athlete first/last, plan (1/wk·2/wk·3/wk·
                                     unlmtd), term (4wk·3mo·6mo). On submit →
                                     GHL contact + Supabase members row
                                     (status='payment_method_required').
2 Create CoachIQ  portal backend     Create the CoachIQ user + ENROLL in group →
  user            (server)           capture CoachIQ userId → members.coachiq_member_id.
                                     PATH PENDING #3: admin-token adminAddUser OR
                                     Zapier "Create User". (signUp_V2 alone = bare,
                                     not enrolled — do NOT use.)
3 Pay           PORTAL payment page  Stripe Checkout/Elements on the academy's
                (NOT CoachIQ/GHL)    CONNECTED account via platform key →
                                     createPortalSub(price from pricing_catalog
                                     canonical row for the chosen plan+term).
                                     → sub is PORTAL-OWNED → buttons work.
4 Credit        Stripe webhook       invoice.paid on a portal-owned sub →
                → CoachIQ            addCoachiqCredits(coachiq_member_id, {plan})
                                     → CoachIQ adds the cycle's credits.
5 Activate      FC "you're in" page  Instructions to download the white-labeled
                                     CoachIQ app; first open → set password
                                     (matched by email) → book with credits.
─────────────────────────────────────────────────────────────────────
```

Edge cases: returning parent (email already a CoachIQ user → find-or-create, reuse
id); multiple athletes per parent (one CoachIQ user/customer can hold both — see
Joey+Penelope); card declined at step 3 → member stays
payment_method_required, no CoachIQ credit fired. SACRED: payment only on the
portal; never add a Products/payment connection to a CoachIQ form or use GHL checkout.

Blockers to ship Track A: #3 (create+enroll) + the credit automation/numbers +
deploy sign-off. Everything else (form, payment page, webhook wiring) is specced
and the helper code exists (api/coachiq.js, api/coachiq-billing.js).
