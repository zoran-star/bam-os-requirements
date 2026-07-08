# Receipts via Resend - Design Scope (DECISIONS LOCKED 2026-07-08)

**Status:** R1-R8 answered by Zoran 2026-07-08. Not built.
**Where it lives:** backend (Stripe webhook -> Resend) + a receipts surface in the portal
**One-liner:** Stop letting Stripe send its generic automatic payment emails; the portal builds an academy-branded receipt and sends it through Resend on every payment.

---

## 1. The non-technical part

### Today vs after

```
TODAY                                    AFTER
Stripe charges the card                  Stripe charges the card
   │                                        │
   ▼                                        ▼
Stripe emails its own generic            Portal hears about the payment,
receipt (Stripe branding,                builds a branded receipt
no athlete, no academy look,             (academy logo + colors, athlete +
zero control over copy)                  plan named, clean layout)
                                            │
                                            ▼
                                         Sends it from the academy's own
                                         email address via Resend +
                                         keeps a copy in the portal
```

### Why bother

- **It looks like the academy, not like Stripe.** Parents see "BAM GTA" with the logo, the kid's name, and the plan they're paying for - not a gray Stripe template.
- **We control the content**: athlete name, plan, period covered, tax line, a support link back to the academy.
- **Receipts get a home.** Every receipt is stored, so staff can re-send one from the member drawer and parents can be shown their history. Today they live only in the parent's inbox.
- **One email system.** GTA's email already runs on Resend (the email spine); receipts join the same pipe with the same bounce/complaint protection.

### How it behaves

- Payment goes through -> receipt email goes out within a minute, automatically. Nobody clicks anything.
- Refund issued -> a refund receipt goes out the same way.
- Payment fails -> that's NOT a receipt; the existing payment-failed flow handles it.
- Academies not yet on the Resend email spine keep Stripe's emails until they're cut over (per-academy switch, no big bang).

### Decisions (LOCKED 2026-07-08, Zoran)

| # | Question | Decision |
|---|---|---|
| R1 | **Coverage** | **Portal-created charges only.** Legacy/CoachIQ/hand-made subs keep whatever they have today. |
| R2 | **Tax line** | **Yes, but only for academies that have tax.** Tax must be **properly asked in the fees section** (today it's a free-text "Added fees" field like "+13% HST" in the offer wizard Pricing step) and flow **end to end** into the receipt: structured tax setup -> price -> charge -> receipt breakdown + GST/HST number. |
| R3 | **Branding source** | Logo + brand come from the **Business Blueprint**. |
| R4 | **From + reply-to** | Inputted by the academy in **Settings, inside the email domain connection** area (new from-address field there). |
| R5 | **Stripe's own receipts OFF** | **Yes** - guided manual step at cutover (owner flips it in their Stripe dashboard). |
| R6 | **Refund receipts** | **Not in v1** - later version. |
| R7 | **Where parents get them** | **Sent through the conversation** - the receipt email goes out via the email spine and is logged into the parent's conversation thread (`email_threads`/`email_messages`), so it shows in the academy's Inbox history. Staff also get the member drawer list + re-send. |
| R8 | **Numbering** | **Sequential** per academy (RCP-2026-0001 style). |

---

## 2. Technical design

### What already exists (most of the pipe)

| Piece | Where |
|---|---|
| Webhook already receives `invoice.paid` / `invoice.payment_succeeded` / `charge.*` per connected account | `api/stripe/webhook.js` (65KB, handlers + always-200 pattern) |
| Resend outbound with suppression gate + `email_events` audit | `api/_email.js sendEmail()` |
| Per-academy verified sending domain + provider toggle | `clients.email_provider` ('ghl'/'resend') + `clients.email_domain` (email spine, GTA live) |
| Merge vars / email shells | `api/email-shells.js` (`{{athletes_full_name}}` etc.) |
| Member + plan context for the receipt body | `members` (athlete, plan, price id) + `pricing_catalog` (display name, amount, interval, hst_mode) |
| Bounce/complaint handling | `api/resend/webhook.js` -> `email_suppressions` |

### Net-new

**A. `receipts` table**

```
receipts
  id, client_id, member_id (nullable), contact_id (nullable)
  stripe_charge_id / stripe_invoice_id (unique per client - idempotency)
  kind             'payment' | 'refund'
  receipt_number   text (per-academy sequence, if R8 = sequential)
  amount_cents, currency, tax_cents (nullable), description
  parent_email, sent_via ('resend'), resend_id, sent_at, status
  raw jsonb
```

**B. Webhook handlers** - in `api/stripe/webhook.js`:
- `invoice.paid` (subs) + `charge.succeeded` (one-time, skip if invoice-backed to avoid doubles) -> build + send
- **R1 gate: portal-created only** - sub/charge `metadata.origin === 'fullcontrol-portal'` (every portal write path already stamps it); everything else skipped.
- Provider gate: `clients.receipt_provider` ('stripe' default | 'resend'). Requires `email_domain` verified + a receipts from-address set. Idempotent on charge/invoice id.
- Resolve member by `stripe_customer_id`/subscription; fall back to contact link ([stripe-contact-cleanup](stripe-contact-cleanup-scope.md)) then bare Stripe email.
- Receipt number: per-academy Postgres sequence/counter -> `RCP-{YYYY}-{0001}` (R8).

**C. Fees section rework (R2 - the end-to-end tax chain)**

Today tax hides inside the free-text `added_fees` field ("+13% HST") parsed by
`api/_fees.js` / `_bbApplyFee`. For receipts to show a correct breakdown:

```
1. Academy-level tax profile (asked ONCE, surfaced in the fees section):
   clients.tax_enabled bool · tax_label ("HST") · tax_rate_bp (1300 = 13%)
   · tax_number ("123456789 RT0001")
2. Offer wizard Pricing step: "Added fees" gains a structured choice:
   [ No tax ] [ Sales tax {label} {rate}% ] [ Other fee: ___ ]
   (free-text stays for non-tax fees; existing offers migrate by parsing)
3. pricing_catalog.hst_mode (all_in | pre_tax) already stores how the
   price carries tax -> receipt math:
     pre_tax: subtotal = price,        tax = price * rate
     all_in:  subtotal = price/(1+r),  tax = price - subtotal
4. Receipt renders subtotal / {label} {rate}% / total + tax_number.
   tax_enabled=false -> single total line, no tax anywhere.
```

**D. Receipt template** - one shell in `email-shells.js` style: academy logo + name (**from Business Blueprint**, R3), receipt number + date, athlete + plan/description, amount + tax breakdown (section C), card brand + last4, period covered for subs, support/contact footer. Plain, print-friendly HTML. No emojis, no em dashes.

**E. Delivery through the conversation (R7)** - send via the email spine so the receipt lands in the parent's thread: `maybeSendEmailViaResend`-style path that records into `email_threads` + `email_messages` (same as any outbound email), then stamps `receipts.resend_id`. Staff see it in the Inbox thread AND the member drawer Billing list (+ re-send button).

**F. From-address setting (R4)** - the Settings email-domain connection UI gets a "Receipts send from" input (e.g. `receipts@byanymeanstoronto.ca`), stored per academy (e.g. `clients.receipt_from_email`), validated against the verified `email_domain`.

**G. Cutover per academy** - checklist: `email_domain` verified -> from-address set -> tax profile confirmed (or explicitly "no tax") -> flip `receipt_provider='resend'` -> guided step: owner turns OFF "Successful payments" emails in their Stripe dashboard (Settings -> Emails). Until flipped, nothing changes.

### Guards

- Idempotency on stripe_charge_id/invoice_id (webhook retries must not double-send).
- Suppressed addresses (bounces) skip send but still store the receipt row.
- Dynamic GHL-era invoice prices may not be in `pricing_catalog` -> fall back to Stripe line description for the plan name (same fallback the credit engine uses).
- Always return 200 to Stripe; failures logged + retryable via re-send button.
- V1 academies unaffected (default 'stripe').

### Onboarding data points (add to the Onboarding Data Points DB)

- **Tax profile**: has tax? + tax label + rate + **GST/HST number** - Category: Settings, Phase: Onboarding (asked in the fees section)
- **Receipts from-address** - Category: Settings, Phase: Settings (email domain connection UI)
- Logo/brand already collected via Business Blueprint (no new point)

### Build phases

| Phase | What | Size |
|---|---|---|
| 1 | Fees-section tax profile (structured capture + migrate free-text) | ~half session |
| 2 | `receipts` table + sequence + webhook handlers (portal-only gate) + template | ~1 session |
| 3 | Conversation delivery (email spine logging) + member drawer list + re-send + from-address setting | ~half session |
| 4 | GTA cutover (incl. guided Stripe-emails-off step) | small |
| Later | Refund receipts (R6), parent-app history | v2 |

---

*Decisions locked 2026-07-08. Ready to sequence for build.*
