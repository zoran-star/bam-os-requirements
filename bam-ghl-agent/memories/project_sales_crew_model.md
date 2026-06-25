# Sales crew — the model (agents + automations + terminal taxonomy)

2026-06-25. The "sales crew" design Zoran is shaping (planning, NOT built). Visual + live
notes: `docs/sales-crew-model.html`. Pairs with `[[project_sales_crew_guardrails]]` +
`[[project_confirm_agent]]`.

## The spine (pipeline stages, top → down)
👻 Ghosted → 💔 Lead Nurture → 📞 Booking → ✅ Confirm → 🎯 Closing → 🎉 Member.
New leads enter at Booking. Each agent/automation OWNS a pipeline stage (so it glows + is visible).

## Agents (live conversation — Hawkeye = approve each message)
- **📞 Booking** (Responded) — books the free trial. Also re-receives EVERY re-entry WITH context so it
  never opens cold: can't-make-it · no-show · ghosted-reply · nurture-reply ("won back").
- **✅ Confirm** (Scheduled Trial) — confirm + help them get to the trial; can't-make-it → Booking. LIVE today.
- **🎯 Closing** (Attended/Done Trial, LATER) — convert good-fit attendee → member.

## Automations (one-way nudges — Hawkeye = approve the SEQUENCE once)
- **👻 Ghosted** — AGGRESSIVE + short (e.g. day 1/3/7). Reply → Booking. Still silent → 💔 Lead Nurture.
- **💔 Lead Nurture** — SPARSE + long-term, mixes **email + text**. The catch-all (see taxonomy). Reply →
  Booking with context. **Cadence: Zoran will spec the first one** (don't assume).

## Initial automation per agent (2026-06-25)
The scheduled-trial (Confirm) and Closing agents each have a **fixed initial automation attached**: the
same templated first touch fires for everyone (e.g. Confirm = the same confirmation texts/emails on
booking; Closing = a fixed post-trial follow-up), THEN the live agent takes over for replies/objections.
So those stages are hybrid: automation (consistent first touch) → agent (live conversation).

## Visual scheme (sales-crew-model.html)
Lead temperature by colour: 💔 Lead Nurture = **cold / deep blue** · 👻 Ghosted = **warm / yellow** ·
✅ Confirm = **hot / green** · 🎉 Member = **pink**. Booking = blue, Closing = purple, 🚫 Unqualified = orange.
Dashed outline = automation; thick glowing solid = agent.

## Terminal taxonomy (REVISED 2026-06-25 — Zoran's call)
Only ONE true dead end now:
- **🚫 Unqualified** = the dead end. opt-out · invalid · spam · hard no · clearly not-a-fit. Silent removal, no nurture. (Replaces the old "Abandoned".)
- **💔 Lead Nurture** = EVERYONE ELSE marked Lost at ANY stage (Booking/Confirm/Closing) + ghosted-out.
  i.e. "Lost" is no longer terminal — it flows INTO Lead Nurture unless the lead is Unqualified.

## Build implications (the redesign)
- New `unqualified` tag/status.
- Redesign each agent's "end the lead" step: choose **Unqualified** (dead) vs **Lead Nurture** (keep), not just "Lost".
- Route non-unqualified Lost (any stage) + ghosted-out into the Lead Nurture stage.
- Build the Lead Nurture automation (cadence TBD by Zoran).
- (Already separately needed) no-show detector cron + a Booking-brain "no-showed before" note.

## GTA specifics + GHL mirroring (2026-06-25)
- **GTA qualification:** qualified lead = lives near Oakville **and** athlete age 9+. Unqualified = fails
  that (too far / under 9) or opt-out / invalid / spam. This is the GTA definition of the `unqualified` tag.
- **GHL pipeline mirror:** when built for GTA it must tie into GTA's existing **GoHighLevel pipeline**. The
  agents already operate on the real GHL pipeline (read stages + move opportunities via GHL API — e.g.
  `respondedStage` / `scheduledTrialStage` in `_stage.js`). To add this model: create the **💔 Lead Nurture**
  stage + `unqualified` tag **in GHL**, the portal maps to them by name, and portal ↔ GHL stay in sync both
  ways. Zoran may add the nurture stage to GHL himself.

## Rule throughline
agents = approve each message · automations = approve the sequence once · every bot/automation owns a
pipeline stage. Conversational = agent; one-way nudges = automation. Reply to any automation → Booking.

## BUILD PLAN — sequenced + decided 2026-06-25 (Zoran)
Decisions: **whole crew, sequenced** · **email + text** (build Resend) · **GTA-first, product-shaped** ·
**Zoran adds the Lead Nurture stage + `unqualified` tag in GHL**, portal maps by name. Goal = **run sales
touching ONLY Hawkeye**. ALL agents = hawkeye mode (Zoran's rule).

Phase order:
- **P0** — ✅ DONE 2026-06-25: BAM GTA `confirm_agent_mode`='hawkeye' (booking already hawkeye). Confirm
  detector cron now drafts into the `_acx` queue; nothing auto-sends.
- **P1** — 🚫 Unqualified taxonomy. nurture stage named **`Lead Nurture`** in GHL (anchor `/nurtur/i`);
  Unqualified = a GHL **`unqualified` tag** mirrored by a portal switch (bidirectional). ✅ SHIPPED
  (branch `session/sales-crew`):
  - `api/agent/_tags.js` (NEW) — `UNQUALIFIED_TAG`, add/remove contact tags (`POST`/`DELETE /contacts/{id}/tags`),
    `markUnqualified`/`unmarkUnqualified`/`isUnqualified`.
  - `api/agent/_stage.js` — `nurtureStage()` finder (`/nurtur/i`); null until Zoran makes the stage (dormant, no error).
  - `api/agent-approvals.js` — `confirm-abandoned` now ALSO stamps the `unqualified` tag (best-effort);
    NEW `set-qualification` action toggles the tag (portal ⟷ GHL).
  - `client-portal.html` — drawer "Abandoned" button → **🚫 Unqualified** (`_plMarkUnqualified` → GHL
    `abandoned` + stamps tag via `_plStampUnqualified`). Plain abandon / duplicate-cleanup does NOT tag.
  - ⏸ DEFERRED to P6 (deliberate): do NOT reroute live "Lost" into the Nurture stage yet — nurture automation
    doesn't exist; Lost keeps current behavior until P6.
- **P2a** — ✅ SHIPPED (branch `session/sales-crew`): 🎯 Closing agent, mirror of Confirm, on the Done-Trial
  stage. Backend: `api/agent-closing.js` (list/draft/send/list-ready/skip-ready/detect-now/**confirm-enroll**/
  confirm-lost), `closingAgentMode` (`closing_agent_mode`, default off), `doneTrialStage`+`computeClosingQueue`
  in `_stage.js`, 7 `closing_*` brain sections + `AGENT_SPECS.closing`, table `agent_closing_replies`
  (migration 20260625210000, **APPLIED to prod**), cron `3,18,33,48`. Frontend: AgentModePanel 3rd control,
  SandboxApp 🎯 Closing trainer tab, `_aclx*` Hawkeye queue in client-portal.html (kinds closing/closing_enroll/
  closing_lost). `confirm-enroll` = send offer `signup_url` + mark opp won (the close). INERT until
  `closing_agent_mode` set to hawkeye.
- **P2b** — ✅ CORE SHIPPED (branch `session/sales-crew`). KEY FINDING: the enroll→pay→member→WON machinery
  ALREADY EXISTS. GTA's `signup_url` = `byanymeanstoronto.ca/enroll`, whose page calls the portal checkout
  (`api/website/checkout.js`) → creates the member (status `payment_method_required`) → on real payment the
  Stripe webhook (`invoice.paid` → `fireOnboardingActivations`) flips member live + **marks the opp WON** +
  CoachIQ + welcome. So `confirm-enroll` must NOT mark won itself (P2a did, prematurely — before payment).
  Fixed: `confirm-enroll` now just sends the enroll link (with `client_id`/`contact_id`/`opp_id` query params
  appended, forward-compat) + writes an `agent_contact_notes` "link sent, awaiting payment" + logs
  `pipeline_outcomes status='enroll_link_sent'`; NO won PUT. Frontend relabeled "Send sign-up link & mark won"
  → "Send enroll link" (won lands on payment). The win is owned by the webhook on real payment.
  ⬜ **P2b-plus (deferred, CROSS-REPO + live checkout):** make the GTA enroll page (`bam-client-sites/clients/
  bam-gta/gta/enroll.jsx`, which already calls `/api/website/checkout`) READ the `contact_id`/`opp_id` params
  and pass them to checkout → store `ghl_contact_id` + `ghl_opportunity_id` on the member row + sub metadata →
  `fireOnboardingActivations` marks THAT exact opp won + links member↔contact at creation (instead of the
  current `parent_email` match in `api/onboarding/activations.js`). Today the email-match works for GTA's happy
  path; P2b-plus hardens multi-opp / email-mismatch cases. See `[[project_stripe_app_created_subs]]` +
  `[[project_offer_price_mapping]]`.
- **P2.5** — ⏸ REORDERED to after P3/P4 (polish, blocks nothing). 📋 post-trial form → a card in the unified
  approval inbox. GOTCHA found: `_plPostTrialForm(oppId)` is COUPLED to loaded board state (`_PL_DATA`, line
  ~22014) — surfacing it in the inbox needs `switchView('pipelines')` first (like `_hv2OpenHawkeye`) or
  decoupling the form to fetch the opp by id. Detection already exists in `api/ghl/cron-post-trial-escalate.js`
  (trials ended 15min+ ago with no `post_trial_reviews` row).
- **P3** — ✅ SHIPPED (branch `session/sales-crew`). ✉️ Resend foundation. Resend was ALREADY wired (raw fetch
  in `api/clients.js` for invite/reset — LEFT UNTOUCHED). New:
  - `api/_email.js` (NEW) — `sendEmail({to,subject,html,text,from,replyTo,tags,clientId})` + `isSuppressed()`.
    Suppression gate before every send; best-effort `email_events` audit; throws on Resend error. Default
    **FROM = `RESEND_FROM` || `"BAM Toronto <info@byanymeanstoronto.com>"`**.
  - `api/resend/webhook.js` (NEW) — Svix-verified (`RESEND_WEBHOOK_SECRET`, `whsec_`); logs `email_events`,
    upserts `email_suppressions` on hard bounce / complaint / unsubscribe. Unset secret → accept+warn; set+bad → 401.
  - tables `email_events` + `email_suppressions` (migration 20260625220000, **APPLIED to prod**).
  - ⚠️ INERT until Zoran (a) DNS-verifies **`byanymeanstoronto.com`** in Resend (the live key only authorizes
    `byanymeansbball.com` today, so sends 403 until then) and (b) sets `RESEND_WEBHOOK_SECRET` + points a Resend
    webhook at `/api/resend/webhook`. Suppression/audit/webhook all work regardless of the domain.
  - **Email templates LIVE IN THE PORTAL**, designed by Zoran + Claude — NOT in bam-client-sites. Brand tokens
    INLINED (gold `#E2DD9F`, black, Anton + Inter Tight). (Template authoring = part of P4/the import session.)
- **P4** — ✅ SHIPPED (branch `session/sales-crew`). 🧱 Automation engine + step-builder, built EMPTY + inert.
  - **P4a runtime:** 5 tables (`automations`, `automation_steps`, `automation_enrollments`, `automation_jobs`,
    `automation_events`; migration 20260625230000, **APPLIED to prod**). `api/_send.js` (sms→GHL
    `/conversations/messages` by contactId; email→`_email.js`). `api/automations.js` = exported
    `enrollContact`/`exitEnrollment` (P6 triggers call these) + `GET ?action=work` worker cron (`* * * * *`,
    in vercel.json) + staff CRUD (list/upsert-automation/upsert-step/delete-step/reorder/set-enabled/
    set-approved). IDEMPOTENCY: `dedupe_key`=`enrollment_id:step_id` unique + atomic claim (conditional PATCH
    pending→sending, 0 rows = lost race). Quiet-hours clamp on schedule + re-check at send. Worker re-checks
    automation enabled+approved + enrollment active before sending. Approve-sequence-once = `automations.approved`.
  - **P4b step-builder UI:** new **👻 Automations** sub-tab in the Train Agent view (`client-portal.html`,
    `_taRenderAutomations`/`_autoApi`/`_autoCardHtml`/`_autoStepHtml`/`_autoSaveStep`/`_autoAddStep`/`_autoMove`/
    `_autoToggle`). Seeds `ghosted`+`nurture` if missing → both always render EMPTY. Each step row = ⏱ wait
    [amt][unit] · 💬SMS/📧Email · subject(email only) · body · Save/Delete · ↑↓ reorder. Per-card On/Off +
    Approve-sequence toggles. Empty state nudges the import session. Visible to staff or `can_train_agent` members.
  - NOTE: dropped `automation_templates` from the original plan — step bodies hold the message inline
    (simpler; email templates/shells are a separate portal+Claude design task per P3).
- **P5** — 📥 IMPORT SESSION. STRICT ORDER: P3+P4 built FIRST so the UI shows EMPTY automations, THEN Zoran
  pastes GHL text/email screenshots → AI extracts {text, channel, timing} → POPULATES content/sequences.
  Import populates; it does NOT design emails (that's a separate portal+Claude task). Screenshots = the cadence spec.
- **P6** — 👻 Ghosted (retire GHL workflow) + 💔 Lead Nurture go live; flip "Lost" → Nurture stage here.
- **P7** — 🛡️ guardrails + observability (see `[[project_sales_crew_guardrails]]`).

## Hawkeye-only verdict (end-to-end code trace 2026-06-25)
Today TWO things force Zoran out of Hawkeye regularly: (1) **post-trial form** — a human must mark
showed-up/good-fit after EVERY trial; NO auto attendance detection (only a 15-min reminder SMS via
`cron-post-trial-escalate`). (2) **the close = payment** — the "Won" button is a STUB (status flip; no member
link, no Stripe). P2 + P2.5 fold BOTH into Hawkeye. Edge cases left manual: merging duplicate GHL contacts;
a social (IG/FB) lead past Meta's 24h window (agents are SMS-only — hard-coded `type:"SMS"`).

## Notify-on-inbound (guardrail #1) — basically DONE
`api/ghl/inbound-webhook.js`: (A) `notifyOwners(inbox_message)` fires on ALL inbound, any stage (V1.5/V2),
gated only on a recipient subscribed to `inbox_message` in `clients.notification_prefs`. (B) the
"🤖 new chat to approve" SMS is the EXTRA nudge, gated to Responded + agent on + `agent_notify_phone`.
