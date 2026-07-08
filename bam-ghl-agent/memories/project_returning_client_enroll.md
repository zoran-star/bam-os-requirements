---
name: Returning Client Enroll (Members V2)
description: 2026-07-08 - design SCOPED, not built. Sign an old client (existing Stripe customer on the academy's connected account) straight onto a live offer from the Members tab, skipping public checkout. Full scope + open questions in docs/returning-client-enroll-scope.md.
metadata:
  type: project
---

# Returning Client Enroll (Members V2)

**State 2026-07-08: DESIGN DRAFT awaiting Zoran workshop + approval. Nothing built.**

Canonical doc: [`docs/returning-client-enroll-scope.md`](../docs/returning-client-enroll-scope.md)

## The idea in one breath

Members tab gets a "+ Returning client" button: search the academy's Stripe
customers (name/email/phone), pick a live offer price, confirm, done. Two
doors: saved card -> portal-owned sub created directly; no usable card ->
pending member + `mode:'setup'` card link, sub after card saved.

## Why it's cheap to build

~90% of the primitives exist: customer-by-email lookup (`website/checkout.js`),
saved-card sub creation with trial_end anchor (`sorter/setup-monthly.js` = THE
template), live-price targets (`fix-payment.js buildTargets`), card-setup link
(`members.js actionCardSetupLink`), webhook flip-live, intake idempotency.
Net-new = `enroll` action + `find-customer` search + 3-step drawer wizard +
member-agent tool.

## Open questions for the workshop (answers go in the doc)

Q1 charge timing · Q2 consent before charging saved card · Q3 search scope
(Stripe only vs + cancellations/GHL) · Q4 owner-only vs staff · Q5 athlete
name typed by owner · Q6 auto-notify copy.

## Update this note when

- Zoran approves/changes the design -> record decisions + flip state
- Build starts/ships -> phase status here, details in the doc
