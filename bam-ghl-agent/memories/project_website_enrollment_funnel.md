# Website Enrollment Funnel (parent join → pay → sign)

2026-06-15. The parent-facing "join the program" funnel that lives on the
academy's OWN website (BAM GTA: `bam-client-sites` repo, `clients/bam-gta/enroll.html`,
direct link only — not in the nav). This is "Track A funnel (portal payment)"
from [[project_coachiq_integration]], now built. Offer-driven end to end.

## The 3 steps
1. **Your info** — core parent/athlete fields (name, email, phone) + any extra
   intake questions the offer exposes, each rendered by an **input type inferred
   from its label** (email/tel/date/select/textarea).
2. **Choose plan** — the offer's Membership pricing options, resolved to their
   **Price-Matched routable** Stripe price (see [[project_offer_price_mapping]]).
3. **Sign + pay** — scroll-gated agreement modal with a **draw-to-sign** pad
   (parent + athlete names prefilled) → **Stripe Payment Element** (embedded, no
   redirect).

## Backend (portal, `bam-ghl-agent/bam-portal/api/website/`)
- `offer.js` — `GET /api/website/offer?client_id&offer_id?`. Public, CORS-gated by
  `clients.allowed_domains`. Returns `intake_fields` (builder defaults + selected
  add-ons + custom, typed), `pricing` (offer Membership options → routable
  `pricing_catalog` row by `offer_price_key`; unmatched → `available:false`),
  `agreement_url`, `welcome_video`.
- `checkout.js` — `POST /api/website/checkout`. Public, CORS-gated. Reuses the
  `api/onboarding/checkout.js` Stripe flow (portal-owned sub on the academy's
  **connected** account, `default_incomplete` → Payment Element `client_secret`).
  Differences: price resolved by the offer's matched **`offer_price_key`** (NOT a
  canonical plan alias — amount never trusted from the client); **requires a
  signed agreement**; idempotent on (client_id, parent_email, athlete_name);
  stashes step-1 intake answers in `member_audit_log`.
- `api/_lib/agreement-pdf.js` — renders the signed agreement PDF (`pdf-lib`,
  **sample contract text for now**) with names + drawn signature + timestamp, and
  uploads it.

## Where the signed agreement lives
- Bucket `member-files` (private), path `<client_id>/<member_id>/waiver/<stamp>-enrollment-agreement.pdf`.
- A `member_files` row (kind `waiver`, `signed_at`, `metadata.source='website-enrollment'`)
  is inserted → it **auto-shows in the staff member popup's Documents section**
  (no bespoke UI). `members.agreement_pdf_path` is a denormalized flag that also
  gates re-generation on retries. Migration: `20260615000000_members_agreement_pdf_path.sql`.

## Going live / member creation
- Member is upserted `payment_method_required`. It flips to **live** + GHL
  convert/tag (opportunity → WON) via the EXISTING `invoice.paid` webhook +
  `fireOnboardingActivations` (no new code). So "convert the lead" is the GHL
  workflow, not a portal step.

## Welcome video moved
- `welcome_video` moved from the offer **Onboarding** section to **Sales**
  (training type only; other types unchanged). `api/website/offer-media` now reads
  `sales:welcome_video`, tolerant of legacy `onboarding:welcome_video` + bare
  `welcome_video`.

## Question bank (the "basic questions")
- Training intake defaults are HARDCODED in `_bbStdOnboarding(...)` in
  `client-portal.html`: Parent name, Phone, Email, Emergency contact name,
  Emergency contact phone (+ toggleable add-ons). The richer parent-enrollment
  field list also exists in the `Questions Database` table as the Options of the
  row Place=`Parent Onboarding` ("What information do you want to collect from
  parents at enrollment?"). **Gap:** the offer builder has no per-question
  custom-field builder for onboarding intake yet (sales `info_collect` does).

## BAM GTA state (2026-06-15)
- Training offer `52a6285c-7832-44e1-b531-ab7ef9d8fc21` set **published**. Plans
  left **archived** per Zoran → funnel shows ONLY the live "Summer Unlimited"
  (Monthly $315.27 / 4 weeks, 3 months $850.89). Un-archive the 4 main plans
  (Steady/Accelerate/Elevate/Dominate) in BB → Offers to surface them.
- No agreement file uploaded → funnel uses the built-in sample clauses; checkout
  generates the sample PDF.

## When to update
- New funnel step / field-type inference change → update step list.
- Checkout price-resolution or member-creation change → update Backend.
- Agreement storage/columns change → update "Where the signed agreement lives".
- Real (non-sample) agreement text wired → note it.

Related: [[project_offer_price_mapping]] · [[project_pricing_sorter_wizard]] ·
[[project_website_leads]] · [[project_coachiq_integration]] · [[project_offer_architecture]]
