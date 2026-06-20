---
name: Member Import + CoachIQ + Summer billing — RESUME STATE (2026-06-19)
description: Full pickup for the GTA member-import / CoachIQ-linking / commitment-billing work. What's shipped + live, the 4 remaining builds, the confirmed Summer billing spec, env/secrets, and gotchas. Read this first to continue.
metadata:
  type: project
---

# Member Import + CoachIQ + Summer billing — resume here (2026-06-19)

Big session. Everything below is **merged to main + deployed to prod** unless marked.

## ✅ Shipped + live

**Enrollment → GHL + CoachIQ (new signups):**
- GTA funnel (`bam-gta.vercel.app/enroll`, also byanymeanstoronto.ca) → pay → `invoice.paid`
  webhook → member LIVE → `fireOnboardingActivations` (`api/onboarding/activations.js`):
  GHL = **direct workflow enrollment by ID** (`GHL_ONBOARDING_WORKFLOW_ID` = `5a90b9fd-…`,
  the "Coach IQ New payment submitted" workflow) + staff SMS to +14165733718.
- Confirmation page "Set up your athlete app" card (bam-client-sites `enroll.jsx`, v20):
  create CoachIQ account (same email) → password → book → credits. Brand-compliant.
  Preview: `/enroll?preview=done`.
- CoachIQ = **self-signup model, NO Zapier**: parent signs up at
  `app.coachiq.io/bam-gta/athletes` (enrolled) → CoachIQ **"New User"** automation →
  `POST /api/coachiq/user-created` (match by email) → grant product. Product per price via
  `pricing_catalog.coachiq_automation_url` (editable in BB → Offers → Pricing → "🔗 CoachIQ
  Links" green strip). Summer prefilled with automation `18c05158-…`.

**Member Import (Pricing Sorter, members mode) = 5 steps** (client-portal.html):
`Import → Stripe → CoachIQ → GHL → Finish(promote)`, 1-based dot numbers (internal step
index is 2..6 since step 1 = Price Match's Match). Launched from Members tab strip
(`_membersImportStrip`).
- **CoachIQ step = "listening session"**: polls `cleanup?action=coachiq-status` every 4s;
  CoachIQ **"User Tag Added"** automation ("intro tag added", **ACTIVE**) → `POST
  /api/coachiq/link-user?secret=…` (match by email across members_staging + members, stamp
  `coachiq_member_id`, NO product grant, logs `coachiq_link_events`). **VERIFIED the tag
  webhook carries the real user id.** Listening/Connected status banner (green=webhook in
  last 15m). Per member: paste user id · "not on CoachIQ" · (linked) copy sub_id + CoachIQ
  link for the renewal sub-link. Auto-link from Stripe `metadata.userId` in cleanup
  `link-customer`. promote carries `coachiq_member_id` → members.
- Stripe step: setup-monthly now a **styled modal with an editable first-charge date**
  (`first_charge_date` override in `api/sorter/setup-monthly.js`).
- TO DO column: deny buttons show real labels ("Not a duplicate" / "Wrong person").

**Schema:** `clients.coachiq_enabled` (GTA=true), `members_staging.coachiq_member_id` +
`coachiq_not_applicable`, `pricing_catalog.coachiq_automation_url`, `coachiq_link_events` table.

**Prod env:** `COACHIQ_API_KEY` (…53f2 — **ROTATE**), `COACHIQ_GROUP_ID`
`719bb0cf-5a17-4172-ac55-c28e19238824`, `COACHIQ_PRODUCT_AUTOMATION_ID`
`18c05158-d981-4429-b568-495479428d26`, `COACHIQ_WEBHOOK_SECRET`
`99b8c3fab16ea75bb0b2027ad90b9216`, `COACHIQ_CREATE_USER_WEBHOOK_URL` (Zapier — unused),
`GHL_ONBOARDING_WORKFLOW_ID` `5a90b9fd-…`.

## 💳 Summer billing spec — ✅ BUILT 2026-06-19 (code merged? see below; NOT yet deployed/tested)
- Summer Unlimited: monthly **$315.27 / 4 weeks** (`price_1Ti6PCRxInSEtAh89gUsOSFj`);
  3-month **$850.89 / 3 months** (`price_1Ti6PLRxInSEtAh8OprQcH9Q`); offer commitment
  `after = "Goes back to monthly"` (training offer `52a6285c-7832-44e1-b531-ab7ef9d8fc21`).
- **CONFIRMED behavior (Zoran):** upfront → revert. Charge the full commitment price ONCE,
  cover the term, then drop to the plan's monthly price ongoing. (Not installments.)
- **How it's built (2-file split, lowest risk for live money):**
  - `api/website/checkout.js` — payment collection UNCHANGED. New `resolveCommitmentRevert()`:
    if term ∈ {3_months,6_months} AND the offer's matching commitment `after==="Goes back to
    monthly"` AND a canonical `{plan}|monthly` pricing_catalog row exists → stamps
    `metadata.commitment_reverts=monthly` + `metadata.revert_to_price=<monthly price id>` on the
    sub. Live only (test mode skips). Any uncertainty → null → plain sub (today's behavior).
  - `api/stripe/webhook.js` — in `handleInvoiceSucceeded` portal-owned block, AFTER first
    invoice paid, `maybeAttachCommitmentSchedule()`: `from_subscription` (adopts the paid sub,
    no re-charge) → update phases: phase0 committed ×1 iteration → phase1 monthly, `end_behavior:
    release`, `proration_behavior: none`. Idempotent (skips if `sub.schedule` already set).
    Non-fatal. Logged in the `onboarding-activated` audit row as `commitment_schedule`.
  - Stripe pattern verified vs docs (from_subscription + iterations:1 on both phases + release).
  - Offer length-match handles messy strings ("3 Months", "12 Weeks (3 Months)", "24 Weeks
    (6 Months)"). All 5 commitment plans (Steady/Accelerate/Elevate/Dominate/Summer) have a
    canonical `{plan}|monthly` row, all say "Goes back to monthly".
- ⚠️ NOT handled (out of scope): commitments with `after` = "Ends" (would need cancel_at) or
  "Renews same length" (= today's plain sub, re-bills every N — correct already).
- ⏳ TODO: deploy (`vercel deploy --prod`, bam-portal doesn't auto-deploy) + a real test
  payment on a commitment term + refund to prove the schedule attaches (this IS "Test A").

## ⏳ REMAINING (Zoran renumbered to 1/2/3 on 2026-06-19)
1. ✅ **member-detail popup** "Next payment" — BUILT 2026-06-19, pushed
   `feat/member-popup-next-payment` (not yet merged/deployed). `_sorterOpenInfo` popup
   now shows a Next-payment line in the Stripe column, fed by a new `next_payment`
   field on `cleanup.js` member-detail (reuses `computeNextPayment`, same as the table
   column). mapSub now carries current_period_end/trial_end/cancel_at/paused.
   ✅ **Billing schedule** on website checkout — BUILT + DEPLOYED 2026-06-19 (PR #526). See
   Summer billing spec above. Pending only the live test payment.
3. **CoachIQ staff toggle** in the **staff portal** (bam-portal React) → writes
   `clients.coachiq_enabled` (currently DB-only). "make coachiq a staff selection."
4. **Move Member Import into the Training Offer setup** wizard (`_bbOfferConfigs.training`
   + `_bbWizardSections`): add an "Import Roster" step that launches the 5-step import —
   "do all the training offer in one place." Connections (Stripe/GHL/CoachIQ) already in V2.

## 🆕 PLANNED: "Take over billing" import step (designed 2026-06-19, not built)
Goal: end every imported member on ONE **portal-owned** Stripe sub so the portal can
manage + automate it. KEY CONSTRAINT (doc-verified [[project_stripe_app_created_subs]]):
on a Standard connected account the portal can ONLY write to subs it created → it
**cannot cancel** CoachIQ/GHL/dashboard subs. So a "move to portal" = portal CREATES the
new sub (it can), but the staff must CANCEL the old one by hand (portal gives a deep link;
portal then READS Stripe to confirm it's gone and auto-greens the row).
- **Placement:** new step right before Finish → `Import → Stripe → CoachIQ → GHL →
  💳 Take over billing → Finish`.
- **AI-driven (reuse `fix-payment.js` diagnose+Claude pattern):** AI reads the offer pricing
  + what the member has paid + their sub, tags each member: ✅ fine/already-portal · 🔁 move
  to portal · ⚠️ needs card. Click a member → **AI chat modal** (interactive) recommending
  the action + explaining; staff can ask why / override price / "leave him" / "go". On "go"
  AI makes the new portal sub (first charge anchored to their **next-payment date** = build #1)
  and hands the cancel link.
- **Scope split:** wrong-price / failing / no-sub problems are the EXISTING **Cleanup** step's
  job — this step is ONLY ownership (fine / move / needs-card). The remake itself fixes wrong
  price (new sub = correct offer price).
- **ACTION ITEM (its own task):** "no usable card" → mark member status **collecting payment**
  (reuse `payment_method_required`); add a **[Get card link]** button on the member card that
  calls the existing `fix-payment.js card_link` (Stripe **setup-mode** Checkout = STANDALONE
  card capture, NOT tied to a sub — saves card to the customer). Parent inputs card → webhook
  `payment_method.attached` (already handled) → portal makes the sub → row greens. New build =
  button + status wiring only; link/card-page/auto-detect already exist.

## Also pending
- **Test A**: a REAL test payment on /enroll + refund — proves the live chain end-to-end.
  Never run on a real `invoice.paid` yet (16 checkouts created, 0 activated). Deferred to LAST.
- 🔑 Rotate `COACHIQ_API_KEY`. 🗑️ Delete test CoachIQ users (testy sdsfs, `2578c9b2`, `0b44f330`).
- AI pricing-change assistant — future, see [[project_ai_pricing_changes]].

## Gotchas
- CoachIQ admin URL (`admin.coachiq.io/…?profile=`) = **profile id, NOT user id**. The user
  id (needed for grants) only comes from Stripe sub `metadata.userId` or the tag webhook.
- The CoachIQ tag automation fires on **ANY tag** (can't scope to one) → the listening
  banner is how staff know it's connected.
- client-portal.html: after edits run `node bam-portal/scripts/verify-client-portal-ui.mjs`;
  syntax-check by extracting the main `<script>` block and `node --check`.
- Deploy: bam-portal does NOT auto-deploy → `vercel deploy --prod` from a worktree with
  `.vercel` copied to repo root. bam-gta site: `cd clients/bam-gta && npx vercel deploy
  --prod --scope zoran-stars-projects` + bump `?v=` in enroll.html.

Related: [[project_coachiq_integration]] · [[project_website_enrollment_funnel]] ·
[[project_website_leads]] · [[project_pricing_sorter_wizard]] · [[project_ai_pricing_changes]]
