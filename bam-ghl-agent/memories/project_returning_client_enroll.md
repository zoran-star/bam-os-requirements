---
name: Returning Client Enroll (Members V2) + companion scopes
description: 2026-07-08 - ALL decisions locked (enroll Q1-Q6, cleanup C1-C4, receipts R1-R8). Build order = enroll -> pilot for client Houssein -> spec V2 member-import placement -> staff-side Stripe-contact cleanup; receipts build independent. Nothing built. Docs in docs/*-scope.md.
metadata:
  type: project
---

# Returning Client Enroll (Members V2)

**State 2026-07-08 (late): ENROLL PHASE 1 CODE-COMPLETE (not live-tested).
Next = apply the migration, deploy, then pilot for client Houssein.**

## Phase 1 build (2026-07-08) - what shipped

- **Migration `20260708190000_returning_client_enroll_grant.sql`** -
  `client_users.can_enroll_members boolean not null default false` (opt-in
  grant, can_train_agent pattern). **NOT YET APPLIED to prod** - run in the
  Supabase SQL editor (project jnojmfmpnsfmtqmwhopz). All reads are
  migration-safe (fallback selects), so deploying before the SQL is safe;
  grantees just need the column.
- **`api/members/enroll.js`** (new) - POST actions: `find-customer` (Stripe
  /customers/search on the connected account, enriched with roster /
  cancellations / contacts matches), `targets` (live offer prices, same rule
  as fix-payment buildTargets), `preview` (price + card check + duplicate
  guard), `enroll` (consent HARD gate; door A saved card -> portal-owned sub,
  `origin=fullcontrol-portal` + `import_silent=1`, charge now or trial_end
  anchor; door B no card -> pending member + mode:'setup' Checkout link,
  re-run completes via the `resumable` row reuse). Member row is created
  BEFORE the sub; status stays payment_method_required and the invoice.paid
  webhook (activatePortalOnboardingMember, import_silent branch) flips live +
  runs access/credit sync. Audit rows: `enroll-returning` /
  `enroll-returning-failed` with consent_confirmed.
- **`api/clients.js`** - set-staff-tabs action now accepts a
  `can_enroll_members` boolean in its patch.
- **`client-portal.html`** - `+ Returning client` gold button in the Members
  toolbar (`_canEnrollReturning()`: BAM staff / owner / grantee, hidden in
  Preview-as); 3-step right-drawer wizard (`openEnrollDrawer`, `_ENROLL`
  state, `_enrollApi`): Find (search + result cards with On roster / Past
  member / Card on file badges) -> Offer+plan (live price cards, athlete
  input prefilled from past-member/contact, Charge now vs Start on a date) ->
  Review (line items + REQUIRED consent checkbox gating Confirm; duplicate
  block). Result screens: charged / scheduled / card_link (copy link +
  suggested SMS). Team section: "Can sign up returning clients" checkbox per
  teammate (`_bbStaffEnrollSave`), owner-only, shown when the academy has the
  Members tab.
- **Coupons (added same day):** Review step has a "Coupon code (optional)"
  input -> `check-coupon` action validates the promotion code on the
  connected account (same rules + guardrails as members.js apply-coupon:
  live/not-expired/not-fully-redeemed, never $0 or negative via
  applyDiscountToCents) and shows the struck-through vs discounted price.
  `enroll` re-validates server-side and attaches
  `discounts[0][promotion_code]` at sub creation, so charge-now bills the
  discounted amount immediately. Card-link door: coupon noted in audit +
  the staff note says to re-enter it on the completing run.
- Checks: node --check on api files, all 8 inline scripts vm-parse clean,
  tour verifier passes, zero em dashes in the diff.

## Before the Houssein pilot (deploy steps)

1. Run migration `20260708190000` in Supabase SQL editor.
2. Merge/deploy (Vercel auto).
3. Houssein pre-flight: `clients.stripe_connect_status='connected'` + at
   least one canonical + is_routable `pricing_catalog` row on a non-archived
   offer (else the wizard's step 2 shows the "confirm prices in Stripe
   Matcher" notice).
4. Pilot: safest first run = a customer WITH a saved card + "Start on a
   date" (no immediate charge), verify the webhook flips the member live.

## Members-agent integration (2026-07-08, after the merge of PR #1288)

The member agent now routes "add / sign up / enroll someone manually" to the
wizard. New `start_returning_signup` tool in `api/members-agent.js` (terminal
UI-action, like open_contact): the agent passes `search_query` from the
message, the server returns `ui_action: { kind: 'open_returning_enroll',
search_query }`, and BOTH front-end consumers handle it -
`magentAsk` (Members command bar) and `_mmaAgentAsk` (focus-mode chat,
elevated z so the drawer sits above the chat). Shared helper
`_enrollOpenFromAgent(q, opts)` checks `_canEnrollReturning()` (says "ask the
owner" if not), opens the drawer, prefills the search, and auto-runs it.
System prompt teaches: find_members-miss + enroll intent -> wizard, never
change/pause/payment-link for brand-new members. `openEnrollDrawer(opts)` now
takes `{elevated}`.

## Still open in later phases

- Phase 2: contact attach prefill beyond athlete name + the missing-info
  mini-form (core custom_field_defs).
- Phase 3: notify SMS + receipt hook (agent tool DONE - see above).
- Door B follow-through: after the card link is used, staff re-run the
  wizard to complete (documented in the result screen). Auto-complete on
  `checkout.session.completed` is a candidate improvement.

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
