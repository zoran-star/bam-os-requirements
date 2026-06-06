---
name: BAM GTA billing hygiene — dead subs marked live + prepay members with no saved card
description: Data-quality issues found 2026-06-05 while scoping the CoachIQ migration. Some members are "live" in our DB but their Stripe sub is dead/incomplete; several prepaid via one-time charges that never SAVED a card, so their renewals will silently fail. Names in our DB (athlete) differ from Stripe (parent).
metadata:
  type: project
---

# BAM GTA billing hygiene (found 2026-06-05)

Surfaced while building the migration worklist (~50 BAM GTA subs). These are
revenue/accuracy issues independent of the CoachIQ work — worth fixing.

## 1. "live" in our DB but DEAD in Stripe
- **Ebaad Wahid** (parent **Syed Zaidi**, syed.wahid@gmail.com, (647) 896-7632):
  members.status = `live`, but Stripe sub `sub_1TdE3TRxInSEtAh8oUmQtFji` is
  **incomplete_expired** — the initial charge never completed, no card. He's NOT
  actually paying. Customer `cus_UcSyEXXN1Svser`. CoachIQ user 8dd9a747.
  → I generated a fresh subscription Checkout link (cs_live_…) to restart him as
    a PORTAL-OWNED 2/wk sub. Fix his DB status too.

## 2. Prepay members with NO saved card → renewals WILL FAIL
Several members paid a one-time "X months" charge that did **not** save the card
(Stripe one-time payments don't retain the card unless setup_future_usage is set).
The card processes the charge then **detaches** — so the next renewal has nothing
to bill. Example:
- **Luke Newton** (parent **Jim Newton**, jimmnewton@gmail.com): paid **$854.28**
  one-time "Accelerated – 3 Months" on Apr 16 with Mastercard •3983, but the card
  was NOT saved (now detached). Sub `sub_1TXDNmRxInSEtAh8yZ8E0rxN` is **trialing
  until Jul 8** (the prepaid period burning down), then bills $316.39/4wk with **no
  card** → **Jul 8 charge will fail.** Needs a card-collection link before Jul 8.
  Customer `cus_ULLpLWXf8ld5hh`.

**The 4 members with no reusable card** (from the ~50 migration set): Ebaad Wahid
(dead sub), **Krishay**, **Luke Newton**, **Syed Faiz** (paused). Krishay/Luke/Syed
are trialing with no card. The other 46/50 have a saved card → migrate silently.

## 3. Link type depends on the member's state (don't mix them up)
- Dead / no active sub (e.g. Ebaad) → **subscription Checkout** (start a new sub).
- Active sub but no card (e.g. Luke) → **card-collection link** (Checkout mode=setup
  / billing portal) — do NOT send a subscription checkout or you create a 2nd sub.

## 4. Name mismatches (DB athlete vs Stripe parent)
Our `members.athlete_name` is the kid; the Stripe customer name is the parent, and
they don't always line up cleanly:
- Ebaad Wahid (athlete) ↔ Stripe "Syed Zaidi" / email syed.wahid@ (mixed)
- Luke Newton (athlete) ↔ Stripe "Jim Newton" / jimmnewton@
Worth a cleanup pass so staff/CoachIQ/Stripe records reconcile.

## How to check a member's card (repeatable)
For a customer: list `/payment_methods?customer=X&type=card` (empty = none), check
`customer.invoice_settings.default_payment_method`, and the sub's
`default_payment_method`. Also inspect the original charge — `setup_future_usage`
null + the PM's `customer` now null = it was a one-time charge, card not saved.
