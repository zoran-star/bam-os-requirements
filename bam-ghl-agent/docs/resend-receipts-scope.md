# Receipts via Resend - Design Scope (DRAFT, for workshop)

**Status:** PROPOSED - not built. Came out of the Returning Client Enroll workshop (Q6, 2026-07-08).
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

### Questions to workshop (Zoran - need these before build)

| # | Question | Options / notes |
|---|---|---|
| R1 | **Coverage** | Every successful charge in the academy's Stripe account (incl. legacy/CoachIQ-era subs - the webhook sees them all) vs only portal-owned subscriptions? Recommend: every charge, one consistent experience. |
| R2 | **Tax line** | Do receipts show an HST breakdown? `pricing_catalog.hst_mode` knows all_in vs pre_tax. If tax is shown, CRA-style receipts want the academy's **GST/HST number** on them - do we collect that per academy? (-> onboarding data point) |
| R3 | **Branding source** | Logo + accent color per academy - pull from where? (assets library / a new field on `clients` / offer branding) |
| R4 | **From + reply-to** | `receipts@{academy domain}` with reply-to = owner email? Or the academy's main sending address? |
| R5 | **Stripe's own receipts OFF** | Standard Connect = the academy controls that setting in THEIR Stripe dashboard (we can't flip it by API). OK to make "turn off Stripe receipt emails" a guided manual step at cutover? |
| R6 | **Refund receipts** | In scope for v1, or payments only first? |
| R7 | **Where people see them** | Staff: member drawer Billing section (re-send button). Parents: parent app later? Both? |
| R8 | **Receipt numbering** | Per-academy sequential (RCP-2026-0001 style) or just Stripe's charge id? Sequential looks pro but needs a counter. |

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
- `charge.refunded` -> refund receipt (if R6 yes)
- Gate: `receiptProvider(client)` = 'stripe' unless `clients.receipt_provider='resend'` (new column, default 'stripe'). Requires `email_domain` verified. Idempotent on charge/invoice id.
- Resolve member by `stripe_customer_id`/subscription; fall back to contact link ([stripe-contact-cleanup](stripe-contact-cleanup-scope.md)) then bare Stripe email.

**C. Receipt template** - one shell in `email-shells.js` style: academy logo + name, receipt number + date, athlete + plan/description, amount (+ tax line per `hst_mode` + academy GST/HST number if R2 yes), card brand + last4, period covered for subs, support/contact footer. Plain, print-friendly HTML. No emojis, no em dashes.

**D. Surfaces** - member drawer Billing section: receipt list + "Re-send" (POST resends by receipt id). Parent-app exposure later per R7.

**E. Cutover per academy** - checklist: `email_domain` verified -> flip `receipt_provider='resend'` -> guided step: owner turns OFF "Successful payments" emails in their Stripe dashboard (Settings -> Emails). Until flipped, nothing changes.

### Guards

- Idempotency on stripe_charge_id/invoice_id (webhook retries must not double-send).
- Suppressed addresses (bounces) skip send but still store the receipt row.
- Dynamic GHL-era invoice prices may not be in `pricing_catalog` -> fall back to Stripe line description for the plan name (same fallback the credit engine uses).
- Always return 200 to Stripe; failures logged + retryable via re-send button.
- V1 academies unaffected (default 'stripe').

### Onboarding data points (if approved)

- **GST/HST number** (if R2 = show tax) - Category: Settings, Phase: Onboarding
- **Receipt from-address / reply-to** - Category: Settings
- **Logo / accent color** (if R3 = new field) - Category: Brand

### Build phases (post-approval)

| Phase | What | Size |
|---|---|---|
| 1 | `receipts` table + webhook handlers + template + `receipt_provider` gate | ~1 session |
| 2 | Member drawer receipt list + re-send | small |
| 3 | Refund receipts + GTA cutover (incl. Stripe-emails-off step) | small |
| 4 | Parent-facing history | later |

---

*Draft 2026-07-08. Answer R1-R8, then update this doc before building.*
