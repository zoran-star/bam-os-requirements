# Verify the parent-funnel start date in Stripe TEST mode

Gate before enabling live checkout for the future-start-date flow
(`api/onboarding/checkout.js` + `public/funnel/`).

## What we're proving

The future-start model charges the **full first period today** and anchors
recurring billing to `start_date + 1 interval` using a **trial + a one-time
`add_invoice_items` line**. This pattern is new to the codebase, so confirm on
the Stripe **test** account:

| # | Claim to prove |
|---|---|
| 1 | Exactly **one** invoice today, for the **full** first-period amount, **paid**. |
| 2 | **No** charge between today and the anchor (sub is `trialing`). |
| 3 | Recurring invoice fires **at the anchor** (`start + interval`), full amount. |
| 4 | It keeps recurring each interval after that. |
| 5 | (Prod path) `default_incomplete` exposes a **PaymentIntent** on today's invoice. |

Checks 1-4 need a **Test Clock**. Check 5 is a one-shot API call.

---

## Part A - Test Clock behavior proof (authoritative)

Prereqs: Stripe CLI logged into the BAM **test** account (`stripe login`), `jq`.
Everything below stays in test mode; no real money, no connected account.

```bash
# 1. Clock frozen at "now"
NOW=$(date +%s)
CLOCK=$(stripe test_helpers test_clocks create -d frozen_time=$NOW -d name=start-date-test | jq -r '.id')

# 2. Customer ON the clock, with a default test card
CUS=$(stripe customers create -d test_clock=$CLOCK -d email=startdate-test@example.com | jq -r '.id')
stripe payment_methods attach pm_card_visa -d customer=$CUS >/dev/null
stripe customers update $CUS -d "invoice_settings[default_payment_method]=pm_card_visa" >/dev/null

# 3. A recurring price ($100/mo) + capture its product
PJSON=$(stripe prices create -d unit_amount=10000 -d currency=cad \
  -d "recurring[interval]=month" -d "product_data[name]=Start-date test plan")
PRICE=$(echo "$PJSON" | jq -r '.id'); PROD=$(echo "$PJSON" | jq -r '.product')

# 4. Anchor = 30 days out  (mirrors "start_date + 1 interval")
TRIAL_END=$(date -v+30d +%s)     # macOS. Linux: date -d '+30 days' +%s

# 5. Create the subscription with the SAME shape checkout.js sends
stripe subscriptions create \
  -d customer=$CUS \
  -d "items[0][price]=$PRICE" \
  -d default_payment_method=pm_card_visa \
  -d "payment_settings[save_default_payment_method]=on_subscription" \
  -d trial_end=$TRIAL_END \
  -d "add_invoice_items[0][price_data][currency]=cad" \
  -d "add_invoice_items[0][price_data][product]=$PROD" \
  -d "add_invoice_items[0][price_data][unit_amount]=10000" \
  -d "expand[0]=latest_invoice" | jq '{status, trial_end, latest_invoice: .latest_invoice.total}'
```

> Note: this uses `default_payment_method` so the first invoice auto-charges,
> which is the clearest way to *see* the immediate charge. Production instead
> uses `payment_behavior=default_incomplete` and the card element confirms it -
> the immediate invoice is generated the same way (Part B, check 5, proves that).

### ✅ Checkpoint 1+2 (immediately, no advance)

```bash
stripe invoices list -d customer=$CUS | jq '.data[] | {total, status, created}'
stripe subscriptions list -d customer=$CUS | jq '.data[] | {status, trial_end}'
```

PASS if:
- **Exactly one** invoice, `total: 10000`, `status: "paid"`, `created` ≈ now.
- Subscription `status: "trialing"`, `trial_end` = your anchor.

FAIL signs: a `$0` invoice today (deferred - money not taken), **two** invoices
today (double charge), or `status: "active"` with no trial (recurring not anchored).

### ✅ Checkpoint 3 (advance to the anchor)

```bash
stripe test_helpers test_clocks advance $CLOCK -d frozen_time=$(date -v+31d +%s)
# advance is async - poll until ready:
until [ "$(stripe test_helpers test_clocks retrieve $CLOCK | jq -r .status)" = ready ]; do sleep 2; done
stripe invoices list -d customer=$CUS | jq '.data[] | {total, status, created}'
```

PASS if: now **two** invoices, both `10000` / `paid` - today's + a new one at the
anchor. Nothing was billed in between.

### ✅ Checkpoint 4 (one more interval)

```bash
stripe test_helpers test_clocks advance $CLOCK -d frozen_time=$(date -v+61d +%s)
until [ "$(stripe test_helpers test_clocks retrieve $CLOCK | jq -r .status)" = ready ]; do sleep 2; done
stripe invoices list -d customer=$CUS | jq '.data | length'   # expect 3
```

PASS if: **three** invoices total, all `$100`, all paid.

### Cleanup

```bash
stripe test_helpers test_clocks delete $CLOCK   # deletes the clock + its customer/subs/invoices
```

---

## Part B - Prod-path sanity check (check 5)

Confirms the funnel's real path (`default_incomplete`) puts a **PaymentIntent** on
today's invoice, so the card element has something to confirm. One call, no clock:

```bash
CUS2=$(stripe customers create -d email=pi-check@example.com | jq -r '.id')
stripe subscriptions create \
  -d customer=$CUS2 \
  -d "items[0][price]=$PRICE" \
  -d payment_behavior=default_incomplete \
  -d "payment_settings[save_default_payment_method]=on_subscription" \
  -d trial_end=$(date -v+30d +%s) \
  -d "add_invoice_items[0][price_data][currency]=cad" \
  -d "add_invoice_items[0][price_data][product]=$PROD" \
  -d "add_invoice_items[0][price_data][unit_amount]=10000" \
  -d "expand[0]=latest_invoice.payment_intent" \
  | jq '{status, amount_due: .latest_invoice.amount_due, has_secret: (.latest_invoice.payment_intent.client_secret != null)}'
```

PASS if: `status: "incomplete"`, `amount_due: 10000`, `has_secret: true`.
(If `amount_due` is `0` or there's no `payment_intent`, the funnel would fall back
to demo - the model would be wrong.)

```bash
stripe customers delete $CUS2   # cleanup
```

---

## Part C - Full funnel end-to-end (optional, real UI)

Verifies the actual signup UI charges today. Test Clocks can't attach to
funnel-created customers, so this proves the **immediate** charge + setup, not the
future recurring (Part A covers that).

1. On a **preview** deployment (never production), set:
   - `ONBOARDING_STRIPE_SECRET_KEY = sk_test_...`  ← flips onboarding to test mode
   - `STRIPE_PUBLISHABLE_KEY = pk_test_...`
   (Or run `vercel dev` locally with those in `.env`.)
2. Open the funnel in live mode: `https://<preview>/funnel/?live=1`
3. Step 1 details → Step 2 **pick a future start date** → Step 3 pay with
   `4242 4242 4242 4242`, any future expiry/CVC.
4. In the Stripe **TEST** dashboard:
   - **Payments**: one payment **today** for the full amount.
   - **Subscriptions**: `trialing`, `trial_end` = your start + interval.
   - **Invoices**: one paid today; next upcoming dated at the anchor.

> `ONBOARDING_STRIPE_SECRET_KEY = sk_test_...` makes onboarding on that deployment
> take **no real money** - so use a preview/branch, and remove it before that
> deployment serves real signups.

---

## Go-live

Only after checks 1-5 pass: set `LIVE_CHECKOUT = true` (or use `?live=1` /
`window.FUNNEL_LIVE`) with the **live** `STRIPE_PUBLISHABLE_KEY`, and ensure
`ONBOARDING_STRIPE_SECRET_KEY` is unset (or a live key) so onboarding runs on the
real connected account.
