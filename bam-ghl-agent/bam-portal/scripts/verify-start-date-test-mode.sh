#!/usr/bin/env bash
# ============================================================================
# Verify the parent-funnel future-start-date billing in Stripe TEST mode.
#
# Uses a Test Clock to prove the model in api/onboarding/checkout.js:
#   1+2  full charge TODAY, exactly one invoice, then trialing (no charge yet)
#   3    recurring invoice fires AT the anchor (start + 1 interval)
#   4    it keeps recurring each interval
#   5    the prod default_incomplete path exposes a PaymentIntent on today's
#        invoice (so the funnel's card element has something to confirm)
#
# Requires: stripe CLI logged into the TEST account (`stripe login`), and jq.
# Safe: runs entirely on the Stripe test account. No real money, no connected
#       account. All objects are deleted on exit.
#
# Usage:  bash bam-portal/scripts/verify-start-date-test-mode.sh
# Exit:   0 = all checks passed, 1 = a check failed (do NOT go live).
# ============================================================================
set -uo pipefail

AMOUNT=10000        # $100.00 test plan (any flat amount works)
CURRENCY=cad
PASS=0; FAIL=0
CLOCK=""; CUS2=""

red(){ printf '\033[31m%s\033[0m\n' "$1"; }
grn(){ printf '\033[32m%s\033[0m\n' "$1"; }
ok(){  grn "  PASS  $1"; PASS=$((PASS+1)); }
no(){  red "  FAIL  $1"; FAIL=$((FAIL+1)); }
die(){ red "ERROR: $1"; exit 1; }

command -v stripe >/dev/null || die "stripe CLI not found (brew install stripe/stripe-cli/stripe)"
command -v jq     >/dev/null || die "jq not found (brew install jq)"

# future unix ts, N days out (BSD/macOS or GNU/Linux date)
future_ts(){ if date -v+1d >/dev/null 2>&1; then date -v+"$1"d +%s; else date -d "+$1 days" +%s; fi; }

# count PAID invoices of exactly $AMOUNT for a customer
count_paid(){ stripe invoices list -d customer="$1" -d limit=20 | jq "[.data[]|select(.total==$AMOUNT and .status==\"paid\")]|length"; }
# retry until the paid count reaches $2 (settles any async payment), echo the count
wait_paid(){ local i=0 c; while [ $i -lt 8 ]; do c=$(count_paid "$1"); [ "$c" = "$2" ] && { echo "$c"; return; }; sleep 2; i=$((i+1)); done; echo "$c"; }

# poll a test clock until it finishes advancing
poll_ready(){ local i=0 st; while [ $i -lt 60 ]; do st=$(stripe test_helpers test_clocks retrieve "$1" 2>/dev/null | jq -r '.status // "err"'); [ "$st" = ready ] && return 0; sleep 3; i=$((i+1)); done; return 1; }

cleanup(){
  echo; echo "Cleaning up test objects..."
  [ -n "$CLOCK" ] && stripe test_helpers test_clocks delete "$CLOCK" >/dev/null 2>&1 && echo "  deleted clock $CLOCK (+ its customer/subs/invoices)"
  [ -n "$CUS2"  ] && stripe customers delete "$CUS2" >/dev/null 2>&1 && echo "  deleted customer $CUS2"
}
trap cleanup EXIT

echo "== Parent-funnel start-date verification (Stripe TEST mode) =="

# ---- setup ----
CLOCK=$(stripe test_helpers test_clocks create -d frozen_time=$(date +%s) -d name=start-date-verify 2>/dev/null | jq -r '.id // empty')
[ -n "$CLOCK" ] || die "couldn't create a test clock - is the Stripe CLI logged into a TEST account? (test clocks don't exist on live)"
[ "$(stripe test_helpers test_clocks retrieve "$CLOCK" | jq -r '.livemode')" = false ] || die "livemode is true - refusing to run on a live account"
echo "clock: $CLOCK (test mode confirmed)"

CUS=$(stripe customers create -d test_clock=$CLOCK -d email=startdate-verify@example.com | jq -r '.id')
stripe payment_methods attach pm_card_visa -d customer=$CUS >/dev/null
stripe customers update $CUS -d "invoice_settings[default_payment_method]=pm_card_visa" >/dev/null

PJSON=$(stripe prices create -d unit_amount=$AMOUNT -d currency=$CURRENCY -d "recurring[interval]=month" -d "product_data[name]=Start-date verify plan")
PRICE=$(echo "$PJSON" | jq -r '.id'); PROD=$(echo "$PJSON" | jq -r '.product')
TRIAL_END=$(future_ts 30)

# same subscription shape checkout.js sends for a future start (default_payment_method
# used here so the immediate invoice auto-charges and we can observe it)
SUB=$(stripe subscriptions create \
  -d customer=$CUS \
  -d "items[0][price]=$PRICE" \
  -d default_payment_method=pm_card_visa \
  -d "payment_settings[save_default_payment_method]=on_subscription" \
  -d trial_end=$TRIAL_END \
  -d "add_invoice_items[0][price_data][currency]=$CURRENCY" \
  -d "add_invoice_items[0][price_data][product]=$PROD" \
  -d "add_invoice_items[0][price_data][unit_amount]=$AMOUNT" \
  -d "expand[0]=latest_invoice")
echo "$SUB" | jq -e '.id' >/dev/null 2>&1 || die "subscription create rejected: $(echo "$SUB" | jq -r '.error.message // .')"
SUB_STATUS=$(echo "$SUB" | jq -r '.status'); SUB_TRIAL=$(echo "$SUB" | jq -r '.trial_end')

echo; echo "-- Checks 1+2: charge today + trialing (no advance) --"
TOTAL=$(stripe invoices list -d customer=$CUS -d limit=20 | jq '.data|length')
PAID=$(wait_paid $CUS 1)
{ [ "$TOTAL" = 1 ] && [ "$PAID" = 1 ]; } \
  && ok "exactly one paid \$$((AMOUNT/100)) invoice today (charged now, not deferred, no double)" \
  || no "expected 1 invoice, paid, \$$((AMOUNT/100)); got total=$TOTAL paid=$PAID"
{ [ "$SUB_STATUS" = trialing ] && [ "$SUB_TRIAL" = "$TRIAL_END" ]; } \
  && ok "subscription trialing until the anchor (nothing recurring bills until then)" \
  || no "expected trialing with trial_end=$TRIAL_END; got status=$SUB_STATUS trial_end=$SUB_TRIAL"

echo; echo "-- Check 3: advance to the anchor (recurring should fire) --"
stripe test_helpers test_clocks advance $CLOCK -d frozen_time=$((TRIAL_END + 86400)) >/dev/null
poll_ready "$CLOCK" || die "test clock did not finish advancing"
PAID=$(wait_paid $CUS 2)
[ "$PAID" = 2 ] && ok "second \$$((AMOUNT/100)) invoice at the anchor (recurring anchored correctly)" \
                || no "expected 2 paid invoices after the anchor; got $PAID"

echo; echo "-- Check 4: advance one more interval (keeps recurring) --"
stripe test_helpers test_clocks advance $CLOCK -d frozen_time=$((TRIAL_END + 40*86400)) >/dev/null
poll_ready "$CLOCK" || die "test clock did not finish advancing"
PAID=$(wait_paid $CUS 3)
[ "$PAID" = 3 ] && ok "third \$$((AMOUNT/100)) invoice one interval later (recurs each cycle)" \
                || no "expected 3 paid invoices; got $PAID"

echo; echo "-- Check 5: prod path (default_incomplete exposes a PaymentIntent) --"
CUS2=$(stripe customers create -d email=pi-check@example.com | jq -r '.id')
PI=$(stripe subscriptions create \
  -d customer=$CUS2 \
  -d "items[0][price]=$PRICE" \
  -d payment_behavior=default_incomplete \
  -d "payment_settings[save_default_payment_method]=on_subscription" \
  -d trial_end=$(future_ts 30) \
  -d "add_invoice_items[0][price_data][currency]=$CURRENCY" \
  -d "add_invoice_items[0][price_data][product]=$PROD" \
  -d "add_invoice_items[0][price_data][unit_amount]=$AMOUNT" \
  -d "expand[0]=latest_invoice.payment_intent")
ST=$(echo "$PI" | jq -r '.status'); DUE=$(echo "$PI" | jq -r '.latest_invoice.amount_due')
SECRET=$(echo "$PI" | jq -r '.latest_invoice.payment_intent.client_secret // empty')
{ [ "$ST" = incomplete ] && [ "$DUE" = "$AMOUNT" ] && [ -n "$SECRET" ]; } \
  && ok "today's invoice = \$$((AMOUNT/100)) with a PaymentIntent the card element can confirm" \
  || no "expected incomplete + amount_due=$AMOUNT + a client_secret; got status=$ST amount_due=$DUE secret=$([ -n "$SECRET" ] && echo yes || echo no)"

echo; echo "================================"
if [ "$FAIL" = 0 ]; then grn "ALL $PASS CHECKS PASSED - the future-start model behaves correctly."
else red "$FAIL check(s) FAILED, $PASS passed - do NOT enable live checkout."; fi
echo "================================"
[ "$FAIL" = 0 ]
