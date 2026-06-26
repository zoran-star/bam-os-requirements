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
- **P6** — ✅ TRIGGERS WIRED (branch `session/sales-crew`). Every trigger BRANCHES on `isAutomationLive(clientId,
  key)` (enabled+approved+≥1 enabled step; **fails CLOSED** on DB error) so TODAY's behavior is byte-identical
  until an academy approves a portal sequence — then it auto-switches (and they turn the GHL workflow off). No
  double-send, no gap. Wiring:
  - `api/automations.js`: + exported `isAutomationLive`. Worker "completed" branch: a finished `ghosted`
    enrollment + nurture live → `enrollContact('nurture')` + move opp to nurture stage (ghosted ran out → nurture).
  - `confirm-ghost` (agent-approvals): nurture... ghosted live → `enrollContact('ghosted')` (skip GHL workflow);
    else existing GHL ghosted workflow. Interested move shared.
  - `confirm-lost` (ALL 3 agents — approvals/confirm/closing): nurture live + `nurtureStage` exists → move opp to
    Lead Nurture stage (kept OPEN) + `enrollContact('nurture')` + outcome 'nurture'; ELSE existing `status=lost`
    (GHL-native). Falls back to status=lost if no nurture stage. 🚫 Unqualified (`confirm-abandoned`) unchanged.
  - `inbound-webhook`: on reply → `exitEnrollment(reason:'replied')`; if it exited ≥1 enrollment, move opp to
    Responded (booking picks them up warm). Best-effort.
  - ⬜ STILL NEEDS (Zoran, per academy, when ready): populate + approve the portal Ghosted/Nurture sequences
    (P5 import does the populate), create the Lead Nurture GHL stage, then turn OFF the matching GHL workflows.
- **P5** — ⬜ NEXT (INTERACTIVE — needs Zoran + screenshots). The empty step-builder (P4b) is ready. Build the
  AI screenshot→steps parser that fills `automation_steps` via `upsert-step`.
- **P7** — 🛡️ guardrails. SHIPPED so far (branch `session/sales-crew`):
  - ✅ **P7a per-lead bot mute** (#6): `agent_mutes` table (migration 20260625240000, APPLIED), `api/agent/
    _mutes.js` (`isMuted`/`mutedContactIdSet`, fail-open), gated in the 3 agent detectors + draft actions,
    `api/agent-mutes.js` (list/set/clear; global mute also exits automations), "Stop bot on this lead" drawer
    toggle (`#pl-mute-btn`/`_plToggleMute`). Send paths NOT gated (human can always send).
  - ✅ **P7b observability** (#8): `api/automations.js` `overview` + `people` actions; Automations sub-tab
    shows per-step live counts → people list → reuses `_contactsOpenDrawer`.
  - ✅ #1 notify-all-inbound already done (see below). ✅ #3 Hawkeye-per-bot done (each agent's queue). ✅ #5
    global off-switch (modes).
  - ⬜ DEFERRED: #7 atomic first-come claim on Hawkeye sends (the guardrails doc itself marks this "build
    later"; low real-world risk - cards are usually actioned by one person). #4 coloured/dashed convo-tab
    outline + #2 per-stage pipeline glow = minor UI polish.
- **P2.5** — ⬜ post-trial form → unified inbox (polish; `_plPostTrialForm` coupled to board state — see note above).

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

## ⭐ CURRENT STATE + WHAT'S LEFT (end of build session 2026-06-26) — READ THIS FIRST next time
The next chat is **finalizing the GTA sales system.** GTA `client_id = 39875f07-0a4b-4429-a201-2249bc1f24df`.
Everything below is MERGED to `main` + deployed (portal auto-deploys on merge). Work happened in worktree
`~/bam-os-worktrees/sales-crew` (branch `session/sales-crew`) → PR → merge → main.

### LIVE for GTA right now (all in Hawkeye = draft-only, nothing auto-sends)
- 📞 Booking, ✅ Confirm, 🎯 Closing agents = all `hawkeye` (`agent_mode`/`confirm_agent_mode`/`closing_agent_mode`).
- 💔 Lead Nurture automation = **enabled + approved**, 4 email steps live (cadence 1wk→1wk→3wk→3wk). Routes
  non-Unqualified Lost leads in (P6 trigger). **BUT emails can't send until the Resend key is fixed (below).**
- 🚫 Unqualified tag/switch, per-lead 🔇 mute, 👁 automation observability, stage-colour borders — all live.

### Built this session (full list)
P0 confirm-on · P1 unqualified · P2a closing agent · P2b close→enroll-flow · P3 Resend foundation ·
P4a automation engine + P4b step-builder · P6 triggers · P7a per-lead mute · P7b observability. PLUS:
- **Train Agent picker** (`client-portal.html`): pick Booking/Confirm/Closing/Ghosted/Nurture → Test/Lessons/
  Knowledge/Autonomy scope to it; automations open their step-builder. `_TA.target`, `_taPick`, `_taIsAgent`.
- **Per-agent Lessons**: `agent_lessons.agent` column (migration 20260625250000, APPLIED). Each detector
  loads `agent=eq.<its agent>` lessons. `agent_examples` still booking-only.
- **Sales board colour-coding**: `_plStageBot(name)` → per-bot colour on the WHOLE stage column border
  (agents solid+glow, automations DASHED, terminal solid). Pipeline selector HIDDEN for V2 (snaps to Training).

### 📧 EMAIL ARCHITECTURE (important — non-obvious)
- Emails are **LIGHT** (white body, black header/footer bars, gold rules+buttons). We TRIED forced-dark; Gmail
  mobile auto-dark-mode inverts it inconsistently and is unfightable → went light (renders the same everywhere).
  The dark-mode lock was REMOVED from `renderEmail`; `color-scheme: light`.
- Design source = `bam-client-sites/emails/nurture/{1-recognition,2-new-era,3-testimonials,4-dont-miss}.html`
  (refined in Claude Design). Vendored into the portal as `api/email-templates/nurture-emails.js` (GENERATED
  from those files — re-run the generator if they change). DB `automation_steps.body = "template:nurture-N"`
  (a short ref, NOT the HTML); `renderEmail` resolves `template:<key>` → the vendored HTML.
- `api/email-shells.js`: `renderEmail({clientId,subject,body,vars})` — resolves template refs, fills the light
  FRAME (for plain-text bodies) OR passes a full HTML doc through, resolves GHL merge tokens
  ({{contact.first_name}}→vars.first_name||'there', {{location.city}}→'Oakville', {{location_owner.first_name}}
  →'Zoran', {{contact.athletes_full_name}}), FROM = `info@byanymeanstoronto.com`. `api/_send.js` calls it.
- Email 1 has the real YouTube video (`2ftv0lHDofo`) + thumbnail. Coach handles in #1: @byanymeanszoran, @byanymeansadrian, @byanymeansgta.
- ⚠️ Real first-name/athlete NOT yet threaded from the live contact at send time (falls back to "there"/"your
  athlete"). The worker (`api/automations.js` resolveContactInfo) would need to also fetch + pass first name/athlete.

### 🔧 GOTCHAS (will bite next session)
- **`vercel env pull` returns an INVALID `SUPABASE_SERVICE_KEY`** (REST writes 401). The real service_role key
  is a Vercel "sensitive" var not returned by pull. → Do DB writes via the **Supabase MCP** (works), not a node
  REST script. The pulled `RESEND_API_KEY` DOES work but is scoped to **byanymeansbball.com only**.
- To send a test/preview email NOW, send from `gta@byanymeansbball.com` (works) to a real inbox.
- Storing big HTML in the DB = pain (re-emit via MCP). The `template:<key>` ref pattern avoids it — keep using it.

### ✅ DONE 2026-06-26 (PM session): finalize batch (PRs #807/#809/#819/#822/#823, all merged)
- **✉️ Resend LIVE.** Sender fixed `.com`→`.ca` (only `byanymeanstoronto.ca` is DNS-verified; `.com` 403s). Code:
  `_email.js` DEFAULT_FROM + `email-shells.js` footer + 4 template mailto links → `.ca` (#807); source in
  `bam-client-sites/emails/*` too (PR #37 there). Real Resend key (`re_…8NW`, covers .ca/business/bball/coaches)
  set in Vercel `RESEND_API_KEY` (prod) + redeployed. Live test send delivered. ⬜ optional: `RESEND_WEBHOOK_SECRET`
  for bounce auto-suppression not set yet (sending works without it).
- **🎚 Agent toggle in the CLIENT portal, per agent (#809).** Train Agent → 🎚 Autonomy now shows for the academy
  owner (not just staff) and is per-agent (booking/confirm/closing via `_TA_MODE_FIELD`/`_TA_MODE_ACTION`).
  `agent-config.js` set-*-mode authorize via `resolveAgentActor.canActOn` (own academy) not requireStaff; `list`
  stays staff-only. self_drive still staff-only + globally blocked → academy only gets Off / 👁 Hawkeye.
- **📧 Email step PREVIEW modal (#819).** Step-builder email steps have a 👁 Preview button → `automations.js`
  `preview-email` action → `renderEmail` (template refs + brand frame + sample tokens Alex/Jordan) → iframe modal.
- **👁 Hawkeye per agent + 🔄 Scan top-left (#822).** Sales board: each agent stage (Responded/Sched Trial/Done
  Trial) has its own Hawkeye button (`_apxOpen`/`_acxOpen`/`_aclxOpen`, colour-matched); Scan moved out of the
  Responded column to the board's top-left (one scan for the board).
- **🌐 GLOBAL brain editing — GTA edits the shared sections for ALL academies (#823).** The locked "MANAGED BY
  BAM (global)" sections (general+goal layers) now live in a shared store `agent_global_sections` (migration
  20260626170000, APPLIED; separate table b/c agent_prompt_sections.client_id has a NOT-NULL FK). NEW
  `api/agent/_sections.js` = the split's source of truth: `isGlobalSection` (general/goal=global, location/offer=
  local), `canEditGlobalBrain` (staff OR `GLOBAL_BRAIN_EDITOR_CLIENT_IDS=[GTA]`), `loadMergedOverrides` (global
  brain UNDER the academy's own), `set/deleteGlobalSection`. ALL agents (approvals/confirm/closing/sandbox/train)
  build from the merge. `agent-train` returns global sections editable+`scope:'global'` for a global editor; writes
  route to the global store. Client-portal Knowledge tab badges them `🌐 GLOBAL · all academies` + confirms on save.
  **Empty store = byte-identical to old behavior;** other academies still see them locked. ⚠️ blast radius: a GTA
  edit changes EVERY academy's agent prompt.
- ✅ DONE **📊 campaign-tracking cards (#826).** Each ad-report campaign card now: 💰 Monthly budget pill (auto from
  Meta `budget_display` via `/api/meta/campaigns`; blank for ad-set-level budgets) + 📅 per-campaign date range
  (independent per card, default MTD, fetches via the EXISTING `window=range` endpoint - `handleMetaReport` already
  supported `since`/`until`, the scout missed it) + Spend/Leads/CPL tiles. Frontend-only (`_reportCardHTML` +
  `_reportCardApply`/`_reportCardReset`/`_reportCardToggleRange`, state `_reportBudgets`/`_reportCardRanges`).

### ✅ DONE 2026-06-26: self-drive globally blocked + per-agent Autonomy (PR #805, merged)
- **🔒 Self-drive is OFF for everyone right now.** One flag `SELF_DRIVE_GLOBALLY_DISABLED=true` in
  `api/agent/_mode.js`. While true: `shouldAutoSend()` always returns false (deepest net - no agent auto-sends
  even if a row somehow = self_drive); `agent-config.js` rejects set-*-mode = self_drive (403) + returns
  `self_drive_enabled:false` on list/get-mode; staff AgentModePanel + client-portal Autonomy hide the 🚀 button.
  `agent-followups.js` was rolling its OWN self-drive check (bypassed the switch) - now routes through
  shouldAutoSend too. **Re-enable = flip that one flag to false** (per-academy opt-in still applies).
- **🎚 Client-portal Autonomy is now per-agent.** Train Agent → Autonomy used to set ONLY booking regardless of
  the picked agent; now respects `_TA.target` (booking/confirm/closing) via `_TA_MODE_FIELD`/`_TA_MODE_ACTION`,
  matching the staff portal. Mode-setting is still BAM-staff-only (server `requireStaff`).
- DB at ship: only BAM GTA has modes, all three = hawkeye. No behavior change today; the cap is just enforced now.

### ✅ DONE 2026-06-26 (PM): 👻 Ghosted built + name personalization fixed
- **👻 Ghosted sequence POPULATED** (GTA `ghosted` id `7361fd83-5f60-44b7-b124-9454fd5b3315`, 3 steps, all 1 day
  apart): #0 SMS check-in (`{{contact.first_name}}` + byanymeanstoronto.ca), #1 SMS "did my msg go through" +
  free-trial link (`{{contact.fullName}}`), #2 email "Try a session free" (coach/location tokens + hardcoded
  free-trial URL on its own line → renders as the gold CTA button via `bodyToHtml`). Imported from Zoran's GTA
  GHL screenshots. **Still enabled=false, approved=false** — Zoran flips On + Approve in the portal himself.
  Step 4 ("marked Lost → Lead Nurture") is NOT a step: handoff is automatic on ghosted completion (P6), but only
  fires once **nurture is also enabled** (currently off) + a nurture GHL stage exists.
- **✅ Name personalization FIXED (PR #833, merged).** GHL does NOT fill merge tokens on raw
  `/conversations/messages` sends, so SMS tokens were going out literal. Now resolved at send time:
  `email-shells.js` exports `resolveMergeVars`+`locFor`, token map gained `contact.fullName`/`.full_name`/`.name`
  + `location.website`; `automations.js resolveContactInfo` returns firstName+fullName, worker passes
  `vars:{first_name,full_name}` into `sendOn`; `_send.js sendOn` resolves SMS body + email subject + threads vars
  into `renderEmail`. Benefits nurture too. ⚠️ `athlete` token still not threaded (no athlete on contact fetch).

### ⬜ TO FINALIZE GTA SALES (next chat)
1. **👻 Ghosted — built, NOT live.** Zoran reviews the 3 steps in the portal (Train Agent → 👻 Automations) then
   flips **On + Approve**. To get the auto-handoff into Nurture, also enable Nurture + create the Lead Nurture
   GHL stage.
2. **🔑 Resend key (ZORAN'S task):** create a Full-Access (or all-domains) key in Resend that covers
   `byanymeanstoronto.com`, put it in Vercel `RESEND_API_KEY`, redeploy. THEN re-test info@byanymeanstoronto.com.
   Until then ALL nurture emails fail to send (1-week buffer before the first one). (Ghosted email = step #2, day 3.)
4. Deferred polish: **P2.5** post-trial form → unified inbox · **P2b-plus** opp_id threading through checkout ·
   atomic first-come claim on Hawkeye · convo-tab coloured outline · per-stage pipeline glow tied to on/off.
5. Per-agent **examples** (save-a-perfect-reply) for confirm/closing (currently booking-only).
6. Email **fonts**: Anton/Inter Tight don't load in Gmail → Arial Black fallback (Zoran OK'd this; image
   headlines only if he changes his mind).

### HARD RULE reminder
NO em dashes (U+2014) in ANYTHING person-facing, EVERY repo, always (now in all 3 CLAUDE.md + memory). Use hyphens.
