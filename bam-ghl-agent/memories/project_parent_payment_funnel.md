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
  📇 GHL      portal → GHL API: upsert CONTACT (email+phone; GHL de-dupes on email
              OR phone → free phone fallback) + add tag "paid-signup".
              The tag triggers a GHL WORKFLOW:
                 Find Opportunity (native action, for this contact)
                    ├ FOUND     → Update Opportunity → status WON
                    └ NOT FOUND → "Opportunity Not Found" branch → flag staff
                                  (+ portal Pipelines-page banner: pick card / New Client)
              Save ghl_contact_id (+ opportunity_id on win) on the member.
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

## Find-and-win = GHL-native (decided 2026-06-06)

Rather than the portal searching+matching+marking-won via API, GHL's **"Find
Opportunity" workflow action** does it (matches the opportunity linked to the contact;
multiple → earliest/latest; none → "Opportunity Not Found" branch). So the portal only
upserts the contact + adds a tag; the GHL workflow does Find Opportunity → Update →
Won. Phone fallback is handled by GHL's contact de-dupe (email OR phone). No-match →
staff flag (GHL branch and/or the Pipelines-page banner). Match auto-Win on email OR
phone (Zoran: "phone is enough").

## The member row is the glue

`members`: `stripe_subscription_id` · `ghl_contact_id` · `opportunity_id` ·
`coachiq_member_id`.

## What exists vs what's new

```
✅ EXISTS    createPortalSub (PR #52) · GHL stage-move + send-message (api/ghl/*)
             · ghl_contact_id link / convert flow · CoachIQ user-create (Zapier) +
             product automation (proven) · Stripe connected + pricing_catalog
🔨 NEW       parent funnel pages (Claude design) · /api/onboarding/checkout (first-
             time card capture — the "missing bit") · GHL contact upsert + tag · GHL
             "Find Opportunity → Won" workflow · staff CoachIQ config screen ·
             unmatched-signup banner on the Pipelines page · save opportunity_id
🔑 ZORAN     CoachIQ per-product automations + IDs · Zapier connect · rotate+supply
             API key (Vercel env) · build the GHL workflow · CoachIQ product cleanup
```

## GHL connection — grounded in existing code

The portal holds each academy's GHL API keys (per-location V1+V2) and talks over the
GHL REST API (`bam-portal/api/ghl.js` + `api/ghl/*`). Already built: read
contacts/conversations/pipelines, **move opportunity stage** (`ghl/pipelines.js` PUT
/opportunities), **send SMS/email** (`ghl/send-message.js`), store `ghl_contact_id` +
convert-opportunity→member. New, small: contact upsert + tag-add + set status=won
(or just trigger the GHL workflow via the tag). Automations fire the GHL-native way
(on contact-created / tag-added / stage-changed) — the portal trips the trigger, your
existing workflows react.
