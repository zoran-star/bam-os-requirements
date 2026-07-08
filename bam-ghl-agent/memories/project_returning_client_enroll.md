---
name: Returning Client Enroll (Members V2) + companion scopes
description: 2026-07-08 - ALL decisions locked (enroll Q1-Q6, cleanup C1-C4, receipts R1-R8). Build order = enroll -> pilot for client Houssein -> spec V2 member-import placement -> staff-side Stripe-contact cleanup; receipts build independent. Nothing built. Docs in docs/*-scope.md.
metadata:
  type: project
---

# Returning Client Enroll (Members V2)

**State 2026-07-08 (end of day): ALL THREE SCOPES DECISION-LOCKED. Nothing
built. Next = build enroll Phase 1, then pilot for client Houssein.**

Canonical docs (all decisions written in):
- [`docs/returning-client-enroll-scope.md`](../docs/returning-client-enroll-scope.md)
- [`docs/stripe-contact-cleanup-scope.md`](../docs/stripe-contact-cleanup-scope.md)
- [`docs/resend-receipts-scope.md`](../docs/resend-receipts-scope.md)

## Build order (locked via C1)

```
enroll build -> pilot: add Stripe-existing member for client HOUSSEIN
-> spec V2 member-import placement -> staff-side Stripe-contact cleanup
(receipts track runs independently; starts with the fees-section tax rework)
```

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

## Companion scope decisions (locked 2026-07-08)

- **Stripe-contact cleanup (STAFF side, at the GHL contact import - C1):**
  member import (Matcher/sorter) keeps matching members only. Sweep
  connected-account Stripe customers -> `contacts.stripe_customer_id`;
  exact-email auto-link silent (C2); orphans auto-create contacts,
  `source='stripe-import'` (C3); duplicate contacts get a MERGE tool (C4:
  repoint contact_id FKs + values, union tags, archive loser). Keep-clean via
  `customer.created` webhook + write-path stamps.
- **Resend receipts:** PORTAL-CREATED charges only (R1, gate on
  metadata.origin='fullcontrol-portal'). Tax line only for academies with tax;
  fees section gets structured tax profile (clients.tax_enabled/label/rate_bp/
  tax_number) replacing free-text-only added_fees, end-to-end to the receipt
  breakdown (R2 - onboarding data point: GST/HST number). Branding from
  Business Blueprint (R3). From-address = academy input in Settings email
  domain connection (R4, e.g. clients.receipt_from_email). Stripe's own
  receipt emails OFF via guided manual dashboard step (R5). No refund receipts
  in v1 (R6). Receipts delivered THROUGH THE CONVERSATION - email spine logs
  to email_threads/email_messages so they show in the Inbox thread; member
  drawer gets list + re-send (R7). Sequential numbering RCP-YYYY-NNNN (R8).

## Update this note when

- Enroll Phase 1 / Houssein pilot / cleanup / receipts phases start or ship
- The V2 member-import placement spec lands (new doc or section)
