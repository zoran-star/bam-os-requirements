---
name: Returning Client Enroll (Members V2) + companion scopes
description: 2026-07-08 - enroll design DECISIONS LOCKED (Q1-Q6 answered by Zoran); spawned two companion scopes awaiting workshop - Stripe-contact cleanup (C1-C4 open) and Resend receipts (R1-R8 open). Nothing built. Docs in docs/*-scope.md.
metadata:
  type: project
---

# Returning Client Enroll (Members V2)

**State 2026-07-08 (later same day): enroll decisions LOCKED. Two companion
scopes drafted, open questions pending Zoran. Nothing built.**

Canonical docs:
- [`docs/returning-client-enroll-scope.md`](../docs/returning-client-enroll-scope.md) - DECISIONS LOCKED
- [`docs/stripe-contact-cleanup-scope.md`](../docs/stripe-contact-cleanup-scope.md) - DRAFT, questions C1-C4 open
- [`docs/resend-receipts-scope.md`](../docs/resend-receipts-scope.md) - DRAFT, questions R1-R8 open

## Enroll in one breath

Members tab gets a "+ Returning client" button: search the academy's Stripe
customers (name/email/phone), pick a live offer price, confirm, done. Two
doors: saved card -> portal-owned sub created directly; no usable card ->
pending member + `mode:'setup'` card link, sub after card saved.

## Locked decisions (Zoran 2026-07-08)

- **Q1 charge timing:** owner option per enroll - Charge now vs Start on date (trial_end anchor)
- **Q2 consent:** required checkbox "I confirm the parent agreed" gates the Confirm button; logged in audit
- **Q3 search:** Stripe only; results enriched by the linked contact record (GHL import) -> cleanup scope
- **Q4 access:** owner-configurable per staff: new `client_users.can_enroll_members` (can_train_agent pattern), Team section UI
- **Q5 missing info:** owner types athlete name + a "missing info" mini-form for core `custom_field_defs` the contact lacks; prefilled fields read-only
- **Q6 receipts:** move off Stripe auto-emails onto Resend -> receipts scope

## Why it's cheap to build

~90% of the primitives exist: customer-by-email lookup (`website/checkout.js`),
saved-card sub creation with trial_end anchor (`sorter/setup-monthly.js` = THE
template), live-price targets (`fix-payment.js buildTargets`), card-setup link
(`members.js actionCardSetupLink`), webhook flip-live, intake idempotency.
Net-new = `enroll` action + `find-customer` search + 3-step drawer wizard +
staff grant + member-agent tool.

## Companion scope gists

- **Stripe-contact cleanup:** sweep connected-account Stripe customers, link to
  `contacts` (fills the existing `contacts.stripe_customer_id`), exact
  email/phone auto-link, ambiguous -> Matcher-style review UI, orphans ->
  contact created (`source='stripe-import'`), keep-clean via `customer.created`
  webhook + write-path stamps. Open: C1 surface, C2 threshold, C3 orphans, C4 merge tool.
- **Resend receipts:** new `receipts` table + `invoice.paid`/`charge.succeeded`
  handlers in `api/stripe/webhook.js` -> branded template -> `sendEmail()`
  (email spine), per-academy `clients.receipt_provider` gate, guided manual
  step to turn OFF Stripe's own receipt emails (Standard Connect = owner's
  dashboard setting, not API-flippable). Open: R1 coverage, R2 HST + GST number
  (onboarding data point!), R3 branding source, R4 from-address, R5 manual
  cutover ok, R6 refunds, R7 surfaces, R8 numbering.

## Update this note when

- Zoran answers C1-C4 / R1-R8 -> record + flip the doc statuses
- Build starts/ships -> phase status here, details in the docs
