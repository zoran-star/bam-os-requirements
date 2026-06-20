---
name: Member-import / cleanup flow — UX standards + pending polish
description: Zoran's UX directives for the Pricing-Sorter member-import + cleanup/fix flow (client-portal.html). Standing rule on styled popups + the live-test polish backlog.
metadata:
  type: feedback
---

# Member-import / cleanup UX — standards + backlog

Captured during live testing of the member-import "take over billing" + cleanup
flow (2026-06-20). See [[project_member_import_coachiq_state]] and
[[project_pricing_sorter_wizard]] for the feature itself.

## STANDING RULE — no native browser dialogs
**Why:** native `alert()` / `confirm()` / `prompt()` look unbranded + jarring.
**How to apply:** in the member-import / cleanup / fix-payment flows, use STYLED
in-app modals instead — model them on `_sorterFixSuccess(heading, body, stripeUrl)`
(the green success card) in `client-portal.html`. Applies to confirmations
(mark-cancellation, pause, remove) and errors too. Build any NEW popup styled.

## Shipped (2026-06-20, all deployed)
- Take-over billing step + AI verdict/chat + silent mode (the big feature).
- Cleanup fixes: canceled-sub past-date bug, "no next payment" label, offer-price
  dropdown + date + Pause-indefinitely, Mark-as-cancellation (no-live-sub only),
  Set-to-collecting-payment, Remove→action-item, success card, no-reload optimistic
  updates, dup-survivor un-flag, undo snapshot (no re-check), setup-mode `currency:'cad'`
  fix, Add-from-Stripe no-vanish.

## PENDING polish (Zoran live-test backlog, not yet built)
1. **Styled popups everywhere** — replace the remaining `confirm()`/`alert()` in the
   sorter flow (_sorterFixPauseMember, _sorterFixMarkCancellation, _sorterFixRemoveMember,
   error alerts) with the styled modal. STANDING (see rule above).
2. **"Not a member" → cancellation popup** — on a STRIPE-ONLY row, clicking "Not a member"
   should, IF they have an active Stripe sub, open the full Stripe-cancellation popup
   (cancel link + action item), not just dismiss.
3. **"Not a member" button placement** — move it into the TO-DO column (stripe-only rows
   `subTr`/`oneTimeTr` have only 4 tds → misaligned; add an empty Next-payment td).
4. **Adjustable cancellation date** — Mark-as-cancellation should let staff pick the
   cancel date (currently hardcoded today in fix-payment.js mark_cancellation).

## Gotchas
- `currency:'cad'` is hardcoded on setup-mode Checkout (all academies are CAD now);
  multi-tenant should derive it later.
- Mark-as-cancellation inserts a `cancellations` row with `member_id` null (allowed);
  no `offer_id` column on cancellations → offer recorded in `reason`.
