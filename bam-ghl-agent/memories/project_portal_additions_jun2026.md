---
name: Portal additions (late June 2026)
description: Digest of V1.5/V2 portal features shipped 2026-06-23/24 + the new tables/columns, so the next session knows they exist.
metadata:
  type: project
---

# Portal additions — late June 2026

Cluster of client-portal (client-portal.html) + staff-portal (src/) + api/ features shipped 2026-06-23/24. All V1.5/V2-gated; V1 untouched.

## Features
- **Onboarding feedback form** (staff-triggered, hard-blocking). Staff request it from the client **Overview** tab; the client portal hard-blocks (full-screen, no dismiss) until they submit every field. Table `onboarding_feedback`; flags `clients.onboarding_feedback_requested_at` / `_submitted_at`. On submit it also writes the answers into `client_notes` (staff see them in Overview → Notes). Client fn `_openOnbFeedback`; API actions `update-fields {onboarding_feedback_requested}` + public `submit-onboarding-feedback`.
- **Contact tags** (Contacts drawer + Inbox conversation): view chips + add/remove from a dropdown of the academy's live GHL tags (`_bbLoadTags`/`_bbTagList`). Reusable widget `_renderTagEditor`/`_tagEditorHtml`. API: `POST /api/contacts?action=add-tag|remove-tag` → GHL `/contacts/{id}/tags` then refreshes the `ghl_contacts` mirror.
- **Stripe-on-any-contact**: `/api/stripe/contact` now matches by member link → email → **phone**, caches the resolved id on `ghl_contacts.stripe_customer_id`. (Also fixed a 5-level Stripe expand that 400'd the whole lookup.)
- **Member-management modals**: all member actions (Cancel/Pause/Refund/Change plan/Referred/etc.) use a styled `_mmModal` + `_plToast` instead of native confirm/prompt/alert.
- **KPIs → Trends** (V1.5/V2): a 📈 Trends button beside Setup → month-range line charts (gross/net/payouts/ad-spend + leads/pipelines/bookings/new-payments), togglable, click a month → that month's KPIs. Inline SVG; reuses `/api/kpis-v15` per month. Skeleton loaders while loading.
- **Mandatory fields + buildout gate** (Business Blueprint, V1.5): required offer fields are enforced (offer can't be "marked done" until valid; lists what's missing). EIN + Address required on General. Server gate: `trigger_buildout` (api/action-items.js) refuses unless EIN + address + offers_marked_done_at. Sales: trial duration required, info-to-collect optional. Schedule: season dates required when Seasonal.
- **V1.5 pipelines = plain GHL mirror**: V2-funnel UI (Special/Ghosted/post-trial/Mark won/Journey/Hawkeye/trial glows/stage-name behaviors) gated behind `_plIsV2()`; V1.5 shows stages/cards/drag/contact/messages only. Interested "red card" test removed for ALL tiers. V2 Scheduled Trial: squiggle divider between today and past (plus the existing upcoming one).
- **Teammate phone + edit-anytime** (Blueprint → Staff): invite collects phone; owner can edit a teammate's email/phone any time (`update-teammate` syncs the login email when invited). `client_users.phone` powers the owner-SMS recipients — see [[project_owner_notifications]].
- **portal_feedback** now records `client_id` + `submitter_phone`; staff Feedback view shows a 🏠 academy chip; resolving a feedback texts the submitter from their academy's GHL number.
- **Systems buildout ticket** shows the owner name + email in the header.
- **V1.5 nav restructure**: Support accordion (groups Systems + Marketing), Contacts moved to a button in the Inbox header, Assets moved into the Business Blueprint. First-login onboarding tour disabled for all clients.

## New tables / columns this cluster
`onboarding_feedback`; `post_trial_escalations`; `clients.notification_prefs`, `.onboarding_feedback_requested_at`, `.onboarding_feedback_submitted_at`, `.scheduling_app`; `ghl_contacts.stripe_customer_id`; `portal_feedback.client_id`, `.submitter_phone`; `client_users.phone` (already existed, now used).

## Gotchas
- **Stale duplicate** `~/bam-ghl-agent/bam-portal` exists (NOT the git repo) — canonical is `~/bam-os-requirements/bam-ghl-agent/bam-portal`. Edit only the latter (use worktrees per repo CLAUDE.md).
- bam-portal auto-deploys from main (see [[project_bam_portal_deploy]]). `bam-client-sites` (GTA site) does NOT — manual `vercel deploy --prod --scope zoran-stars-projects` from `clients/bam-gta`.

See [[project_owner_notifications]], [[project_coachiq_integration]], [[project_sales_comms]].
