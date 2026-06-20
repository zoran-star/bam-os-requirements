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

## Shipped 2026-06-20 (rounds 2 & 3 — ALL deployed; the above round-1 + these)
- ⚙ **Billing menu** on every cleanup row: 🔄 Change sub · 🏷 Change offer (keep price) ·
  ⏸ Mark paused (indefinite OR next-payment+pause-end dates) · ✕ Mark cancelled (date). Plus
  member-card `pause-date-fix` (DB-only dated pause) + 🟦 Set up CoachIQ + 💳 Get card link.
- **Styled popups everywhere** — `_sorterConfirmModal` (+ optional date field) + `_sorterNotice`
  (+ optional link button) replaced all native confirm()/alert() in the sorter flow.
- **Double-bill guard:** cancel→Action Item is `🔴 Cancel old Stripe sub — {name}` (urgent,
  due_date = old sub's next charge). members.js GET returns `subs_to_cancel`; red "N old subs
  still need cancelling" banner in Members + import Finish. **verify-cancel now COMPLETES the
  matching action item** (matched by sub-id in description) → banner drops in sync.
- **CoachIQ:** sub-id paste moved to FINISH (post-billing, `coachiq-sync` returns FINAL sub_id).
  "CoachIQ ↗" → academy client list `admin.coachiq.io/<slug>/athletes/people/clients` (no
  per-member deep link possible — profile id ≠ user id; webhook only gives user.id). No-account
  flow: "not on CoachIQ" (N/A) vs "supposed to be on it" → invite (signup URL + email, copy+show).
  `clients.coachiq_signup_url` column added, GTA seeded `app.coachiq.io/bam-gta/athletes`.
- **🏷 Change offer (keep price)** — the Stripe-vs-CSV-conflict fix (Bradley/Christine Choi:
  CSV 2/wk Accelerate but actually paying Summer Unlimited). Reassigns offer_price_key/offer_id
  WITHOUT touching the Stripe sub + sets `offer_overridden` flag; optional "also map this Stripe
  price → this offer" (pricing_catalog). New cleanup `change-offer` action.
- **Remove-with-live-sub** → confirm + cancel Action Item + opens Stripe, then removes.
- Polish: pause no longer logs a cancel action item (pause keeps their sub); "Switch to" list =
  LIVE offer-prices only (buildTargets reads routable-canonical pricing_catalog, not config);
  interval "/week"→"/4 weeks" (includes interval_count); "Sub switched" card has a cancel button.

### ✅ The 4 RED bugs — ALL FIXED 2026-06-20 (root cause: divergent portal-owned markers)
- **Marker standardized:** portal-owned = `metadata.origin ∈ {fullcontrol-portal,
  fullcontrol-website-enrollment}` (webhook.js + members.js sets now identical). **setup-monthly
  now stamps `origin=fullcontrol-portal` + `import_silent=1`** (was `source` → never activated).
- Cron Phase B no longer flips a NO-SUB paused member to 'live'. verify-cancel was also 400ing
  (member_id check ran first) — fixed. "✓ set up" badge tooltip no longer falsely claims "billing
  on the portal" (list can't verify; popup's can_manage is the source of truth).
- Sabeen "No subscriptions" bug: customer-detail sub query now has the deep→light→bare expand
  fallback (deep price.product expand threw on legacy prices → silently empty list).

## 📄 Published doc
Flowchart of all flows + edge cases: **portal.byanymeansbusiness.com/member-import-flows.html**
(`public/member-import-flows.html`, mermaid). Gap grid shows the 4 reds as ✅ fixed.

## PENDING — pick up here
1. **AUTO CONFLICT-SCAN (offered, not built)** — flag cleanup rows where the live Stripe sub's
   price ≠ the CSV-implied offer (the Bradley root cause). Today the auto-match trusts the CSV
   plan; the 🏷 Change-offer fix is the manual cure. Plug a price-vs-offer check into the cleanup
   `check` → surface a ⚠️ + offer the Change-offer fix. **Zoran was deciding whether to build this.**
2. **BB card to EDIT the CoachIQ signup URL** per academy (GTA seeded so it works now; other
   academies need a UI). `clients.coachiq_signup_url` exists; clients.js update-fields must
   whitelist it; add the card where CoachIQ config lives (BB → Offers, near `openCoachiqLinks`).
3. **Medium gaps** (from the gap-scan, still open): commitment terms lost on take-over/change-sub
   (setup-monthly bills monthly only); CoachIQ "supposed to be on it" invite writes nothing
   (no tracking if they never sign up); change-plan `PLAN_TO_PRICE` + currency `'cad'` + HST `1.13`
   GTA-hardcoded (multi-tenant); coachiq-sync at Finish omits members who SHOULD be on CoachIQ but
   were never linked; promote silently drops duplicate/nameless rows; GHL step (4) runs before
   promote → can find "0 to link".

## Gotchas / schema
- New columns: `clients.coachiq_signup_url`, `members_staging.offer_overridden`,
  `members.offer_overridden` (added via supabase MCP migrations 2026-06-20).
- Cleanup actions added: `coachiq-sync`, `change-offer`. fix-payment: `pause_member` (dated),
  `mark_cancellation` (no live-sub block; cancellations.member_id nullable, offer in `reason`).
- `currency:'cad'` + HST `1.13` hardcoded (all academies CAD now); multi-tenant TODO.
- buildTargets (fix-payment.js) now returns LIVE routable-canonical offer-prices only (+ offer_id).
