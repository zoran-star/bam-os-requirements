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

## 💳 Summer billing spec — CONFIRMED, ready to build (not built)
- Summer Unlimited: monthly **$315.27 / 4 weeks** (`price_1Ti6PCRxInSEtAh89gUsOSFj`);
  3-month **$850.89 / 3 months** (`price_1Ti6PLRxInSEtAh8OprQcH9Q`); offer commitment
  `after = "Goes back to monthly"` (training offer `52a6285c-…`).
- BUILD: `api/website/checkout.js` currently makes a plain `interval_count=N` sub (3-month
  just re-bills every 3 mo, no revert). Change: when the chosen price is a commitment term
  AND the offer commitment `after === "Goes back to monthly"`, create a Stripe
  **subscription_schedule**: phase1 = committed price ×1 iteration → phase2 = the plan's
  monthly price ongoing. Else plain sub. (Pattern designed in
  [[project_coachiq_integration]] create-sub; not yet on the website funnel.)

## ⏳ REMAINING (4 builds — Zoran to pick order)
1. **member-detail popup** (`_sorterOpenInfo` in client-portal.html) → show "Next payment".
2. **Billing schedule** on website checkout (spec above). LIVE money — careful.
3. **CoachIQ staff toggle** in the **staff portal** (bam-portal React) → writes
   `clients.coachiq_enabled` (currently DB-only). "make coachiq a staff selection."
4. **Move Member Import into the Training Offer setup** wizard (`_bbOfferConfigs.training`
   + `_bbWizardSections`): add an "Import Roster" step that launches the 5-step import —
   "do all the training offer in one place." Connections (Stripe/GHL/CoachIQ) already in V2.

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
