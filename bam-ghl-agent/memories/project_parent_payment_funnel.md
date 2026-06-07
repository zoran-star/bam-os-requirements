---
name: Parent payment funnel — Vercel-hosted, fans out to Stripe + GHL + CoachIQ
description: The end-to-end parent signup+payment funnel for BAM GTA (and reusable for other academies). Hosted on Vercel (NOT GHL). On a paid signup it creates a portal-OWNED Stripe sub, upserts the GHL contact + tag (GHL workflow finds the opportunity and marks it Won), and (if CoachIQ is on) auto-creates the CoachIQ user + allocates the product. Settled 2026-06-06.
metadata:
  type: project
---

# Parent payment funnel (end-to-end)

The core product: a parent signs their kid up for BAM GTA training and pays — all
self-serve. This is the universal funnel; CoachIQ is an optional add-on per academy.
See [[project_coachiq_integration]] for the CoachIQ specifics and [[project_pause_lifecycle]]
for pause/cancel.

## Hosting decision (Zoran, 2026-06-06)

**Hosted on VERCEL, not GoHighLevel.** GHL's code-input/page-builder is too painful;
the payment ENGINE already lives on Vercel (bam-portal `/api/`, Stripe keys,
`createPortalSub`, `coachiq.js`). So the funnel lives in the bam-portal Vercel project
and calls the existing `/api` backend. **GHL is NOT removed** — it stays the CRM /
automations / pipelines / contacts / messaging hub; the funnel FEEDS it via the GHL
API instead of being a GHL-hosted form. The front end is designed in Claude design →
pasted back → wired + shipped here.

## The full flow

```
STEP 1 — PARENT FUNNEL (Vercel; pages from Claude design)
  1. Input info     parent + athlete details
  2. Choose offer   plan (Steady 1× / Accelerated 2× / Elevate 3× / Dominate unltd)
                    × term (Monthly / 3mo / 6mo)   [prices: see project_coachiq_integration / pricing_catalog]
  3. Sign + pay     Stripe Payment Element → /api/onboarding/checkout creates a
                    customer + PORTAL-OWNED sub on BAM GTA's connected account
                    (portal-owned = pause/cancel/refund/change buttons work)

STEP 2 — ON PAYMENT SUCCESS → fan out to 3 systems
  💳 STRIPE   sub created + owned → save stripe_subscription_id on the member
  📇 GHL      portal POSTs an EXISTING GHL inbound-webhook workflow with
              `{ details: { user: { email }, product: { id } } }` (the CoachIQ-shaped
              payload the workflow already expects). That workflow is ALREADY BUILT
              (Zoran, 2026-06-06) and does it all:
                 • Condition "GHL Membership Plan" → branches by product id
                   (20 segments = product→plan already mapped)
                 • Find Contact (by email) → found / not-found → Create Contact
                 • tag active member ("liveclient")
                 • mark the pipeline opportunity WON (step below the screenshot)
                 • send the emails + more
              → So there is NO new GHL build in the portal — just fire the webhook
                with the member's email + the product id for their plan×term.
              Save ghl_contact_id on the member.
              ⚠️ Avoid double-fire: this webhook is currently fired BY CoachIQ too —
              pick ONE trigger (the portal) so contacts/emails don't run twice.
  🏀 COACHIQ  (only if academy toggle ON):
                 Zapier "Create User" → CoachIQ user (enrolled), returns id →
                   save coachiq_member_id
                 Webhook → POST {user:{id}} to the automation id mapped to the
                   member's PLAN×TERM (staff config) → "Add a Product Purchase to a
                   User" → product + access + credits granted immediately.

STEP 3 — ACTIVATION
  Success page ("You're in" + download branded app) + welcome email (custom or GHL).
  Parent opens app → logs in with same email → sets password → sees credits → books
  first session.

STEP 4 — ONGOING
  Renewals: portal charges (owns sub); CoachIQ credit top-up = systems-team TICKET
    for now (productize later). Pause/cancel/refund/change = portal buttons (work
    because portal owns the sub). GHL pipeline now shows Won; comms run in GHL.
```

## Find-and-win = REUSE the existing GHL workflow (decided 2026-06-06)

UPDATE: Zoran already has a GHL workflow (inbound-webhook triggered) that finds/creates
the contact by email, branches by product id (20 plan segments), tags active member,
**marks the opportunity WON**, and sends emails. So we DON'T build new GHL contact/
find-opportunity logic in the portal — the portal just **fires that existing webhook**
after payment with `{details:{user:{email}, product:{id}}}` and the workflow does
everything. (GHL's Find Contact de-dupes on email; the "find opportunity → won" lives
in the workflow below the visible screenshot.) Only open item: ensure ONE trigger
(portal vs the current CoachIQ trigger) to avoid double contacts/emails.

## The member row is the glue

`members`: `stripe_subscription_id` · `ghl_contact_id` · `opportunity_id` ·
`coachiq_member_id`.

## What exists vs what's new

```
✅ EXISTS    createPortalSub (PR #52) · CoachIQ user-create (Zapier) + product
             automation (proven) · Stripe connected + pricing_catalog
             · GHL: the whole contact+plan+tag+WON+emails WORKFLOW is already built
               (inbound-webhook triggered) → portal just fires it, no new GHL code
🔨 NEW       parent funnel pages (Claude design) · /api/onboarding/checkout (first-
             time card capture — the "missing bit") · portal POSTs the GHL webhook
             ({user.email, product.id}) · staff CoachIQ config screen
🔑 ZORAN     CoachIQ per-product automations + IDs · Zapier connect · rotate+supply
             API key (Vercel env) · CoachIQ product cleanup · de-dup the GHL webhook
             trigger (portal vs CoachIQ) so it doesn't fire twice
```
(The earlier "GHL contact upsert + tag + build Find-Opportunity workflow + unmatched
banner" items are DROPPED — the existing workflow already covers find/create/win.)

## GHL connection — grounded in existing code

The portal holds each academy's GHL API keys (per-location V1+V2) and talks over the
GHL REST API (`bam-portal/api/ghl.js` + `api/ghl/*`). Already built: read
contacts/conversations/pipelines, **move opportunity stage** (`ghl/pipelines.js` PUT
/opportunities), **send SMS/email** (`ghl/send-message.js`), store `ghl_contact_id` +
convert-opportunity→member. New, small: contact upsert + tag-add + set status=won
(or just trigger the GHL workflow via the tag). Automations fire the GHL-native way
(on contact-created / tag-added / stage-changed) — the portal trips the trigger, your
existing workflows react.
