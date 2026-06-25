# Plan — move ALL automations into the portal (GHL as pipe, Resend email)

2026-06-25. Strategic plan (NOT built). Visual artifact: `docs/portal-automations-plan.html`
(styled like the confirm-agent explainer). Extends `[[project_automation_agent_roadmap]]`.

## Locked decisions (Zoran)
1. **End state = portal owns the LOGIC, GHL stays the PIPE** (CRM mirror + SMS send). Lowest risk.
2. **Email → Resend** (own domain, templates, delivery logs). Resend is ALREADY wired for
   password-reset emails, so the account exists — we extend it.
3. **First target = Ghosted / nurture sequence** (shortest path to a complete example that
   retires a real GHL workflow).

## Inventory snapshot
**Already portal-owned:** booking agent (`agent-approvals.js`), confirm agent (`agent-confirm.js`),
ghost detector (`agent-followups.js`), owner SMS (`_notify-owners.js`), post-trial escalation
(`ghl/cron-post-trial-escalate.js`), mass send (`mass-send.js` — already a throttled job+recipients
queue), scheduled pauses/invite-resends/digests.

**Still in GHL workflows (migrate):** ghosted nurture (portal enrolls `offers.data.ghosted_workflow`),
booked-trial confirmation (GHL native — confirm agent half-replaces it), missed-trial
(`offers.data.ghl_workflow`), lost-lead nurture (GHL Opportunity→Lost trigger), failed-payment dunning
(portal only flags `members.status='payment_failed'` in `stripe/webhook.js`; outreach is GHL/manual),
onboarding drips (`website/onboarding.js` + `onboarding/activations.js` enroll GHL), email blasts.

**Email today = GHL** (`type:"Email"` in `ghl/send-message.js` + `mass-send.js`).

## Target architecture — the reusable pattern
trigger (cron / inbound-webhook / event) → decide in code (DB+Stripe+AI) → schedule (generic queue
+ quiet hours + dedupe) → send (GHL SMS / Resend email, skip DND/suppressed) → log + optional
Hawkeye-style approval.

**Existing primitives to reuse:** vercel crons; `agent_followups` + `send_after`; `mass_send_jobs/_recipients`;
`_quiet.js` (8am–9:30pm Toronto); `ghl/_core.js sendSms`; `inbound-webhook.js` (event ingest +
cancel-pending-on-reply); `_notify-owners.js` (channel routing); the approval-card UI.

**What's MISSING (Phase 0 foundations):**
- `automation_jobs` — generic "send X to Y at time T" queue (client_id, contact_id, automation, step,
  channel, template, payload, run_after, status, **dedupe_key**, attempts) + one worker cron. Generalizes
  the per-feature tables.
- `automation_events` — normalized "X happened" log automations subscribe to.
- `api/_email.js` — Resend `sendEmail()` paralleling `sendSms()`; + `_send.js` unified sender
  (channel pick + quiet hours + suppression).
- `automation_templates` — subject/body with `{{vars}}`, portal-editable.
- `email_events` + suppression list (hard bounces + unsubscribes); `api/resend/webhook.js`.

## Resend manual steps (Zoran)
Open/confirm Resend acct → verify sending domain (e.g. `mail.byanymeansbusiness.com`) → paste DNS
SPF(TXT)+DKIM(Resend CNAMEs)+DMARC(TXT) at registrar → add `RESEND_API_KEY` to Vercel → pick From
identity (single BAM domain now; per-academy later). Warm up: transactional first, then ramp drips.

## Phased roadmap
- **P0 Foundations** (~1 cycle): the queue + events + `_email.js`/`_send.js` + templates + domain verified.
- **P1 Ghosted/nurture** (~1 cycle): build on the spine, run parallel to GHL (no double-send), prove,
  then turn off `ghosted_workflow` per academy. = the template for everything after.
- **P2+** (1 per cycle, leverage order): failed-payment dunning → onboarding drips → lost-lead nurture →
  booked-trial confirmation (fold into confirm agent) → email blasts. Each retires its GHL workflow on go-live.
- **SMS stays on GHL** for now (good deliverability, wired). Twilio only if GHL becomes a limit — out of scope.

## Risks
Double-send vs GHL native triggers (turn the GHL workflow OFF when the portal version ships — we've hit
this with ghosted) · email deliverability/warmup · idempotency (dedupe_key + claim-before-send) ·
observability (one message_log view) · From-domain single-vs-per-academy.

## Status
PLAN ONLY. Next concrete step = Phase 0 once Zoran does the Resend/DNS checklist.
