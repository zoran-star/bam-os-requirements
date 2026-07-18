# Confirm agent (Scheduled-Trial stage) — the 2nd sales agent

2026-06-25. A second sales agent that works leads AFTER the booking agent books them
— the Training pipeline's **Scheduled Trial** (a.k.a. "Booked Trial") stage. Goals:
confirm they're still coming, help them get to the trial (address/directions/what to
bring), and on "can't make it" **hand off to the booking agent to rebook** (it does
NOT rebook itself).

## Architecture — two agents, one brain
`api/agent/prompt-structure.js` is now **agent-aware**: `assemblePrompt(overrides, agent)`
+ `buildAgentSystem({ ..., agent })`. `AGENT_SPECS = { booking, confirm }`. Both agents
SHARE the same FACT sections (academy_config) + guardrails + boundaries; only role /
instructions / examples differ. Booking output is byte-identical to before (default
`agent="booking"`). Confirm sections keys: `confirm_role, confirm_core_behavior,
confirm_flow, confirm_logistics, confirm_handoff, confirm_followup, confirm_lost,
confirm_examples`. Per-academy SECTION overrides (`agent_prompt_sections`) apply by key;
the confirm agent does NOT load booking lessons/examples (would bleed wrong behavior).

## The handoff (this is the whole point)
"Can't make it" → confirm agent sets `recommend_handoff` + a `handoff_note`. On staff ✓
(`confirm-handoff`): writes the note to **`agent_contact_notes`** (the booking agent reads
it via `contact-memory.js`, so it picks up with full context) + bounces the opportunity
**Scheduled-Trial → Responded** (mirrors the `confirm-ghost` stage-move). Booking agent
then rebooks. Most "can't make it" = handoff, NOT lost. Lost only if they don't want it at all.

## Live wiring
- **`api/agent-confirm.js`** — own endpoint. Actions: list, draft, send, list-ready,
  skip-ready, detect-now, confirm-handoff, confirm-lost; GET `?action=detect` cron.
  Reactive (lead messages back) + proactive opener (reach out first when trial is
  within 3 days). No booking tools — single forced `propose_reply`.
- **`agent_confirm_replies`** table (migration `20260625001106`) — SEPARATE from
  `agent_ready_replies` ON PURPOSE so the booking detector's prune/flush never touches
  confirm cards. kinds: `confirm` / `confirm_handoff` / `confirm_lost`. ⚠️ **migration
  authored, may not be applied to prod yet** — apply before enabling.
- **`api/agent/_stage.js`** — `scheduledTrialStage` (regex `/(schedul|book).*trial/i`),
  `computeConfirmQueue`, `scheduledTrialContactIdSet(+Cached/peek)`.
- **`api/agent/booking.js`** — `nextAppointment(token, contactId)` fetches the booked slot.
- **cron** `7,22,37,52 * * * *` (offset from booking's `*/15`).
- **inbound-webhook** also cancels pending `agent_confirm_replies` on reply.

## Mode / safety
Gated behind its OWN switch `clients.ghl_kpi_config.confirm_agent_mode` (off/hawkeye/
self_drive, **default off** — `confirmAgentMode()` in `_mode.js`). Turning on the booking
agent does NOT start the confirm agent. Self-drive auto-sends only plain confirmations;
handoff + lost ALWAYS wait for a human ✓.

## Frontend (BUILT 2026-06-25)
- **Mode toggle**: `AgentModePanel.jsx` renders a 2nd segmented control per academy
  ("Confirm agent") reading `confirm_mode` / calling `set-confirm-mode`. `agent-config.js`
  returns `confirm_mode` (list/get-mode) + has `set-confirm-mode`.
- **Sandbox/Brain**: `SandboxApp.jsx` has a Booking|Confirm picker; threads `agent` into
  `chat` + `sections`. `agent-sandbox.js` takes `agent`; Brain editor scopes to that
  agent's sections via `sectionKeysForAgent()`. Confirm trains via Brain only (lessons/
  examples stay booking-only).
- **Approval inbox**: sibling `_acx*` module in `client-portal.html` (mirrors `_apx*`,
  reuses `_apxPost`/`_apxToast`/`_apxOpenThread`). "✅ Confirm" button + count next to both
  Hawkeye buttons (`#acx-approve-btn`, `#v15acx-approve-btn`). 3 kinds: confirm (→`send`),
  confirm_handoff (→`confirm-handoff`), confirm_lost (→`confirm-lost`). Hidden until the
  confirm API authorizes. ⚠️ `_acx*` is a SEPARATE set from `_apx*` (don't merge `_APX_DATA`).

## ✅ Migration APPLIED to prod (jnojmfmpnsfmtqmwhopz) 2026-06-25.

## Initial automations (scripted first-touch sequence) — BUILT 2026-06-26 (branch feat/confirm-initial-automations)
The proactive side is now a SCRIPTED, scheduled sequence (hybrid: scripted outbound +
AI for any reply). When a Scheduled-Trial lead hasn't replied, the detector fires the
next-due scripted step instead of the old single AI opener.
- **2 steps** (reworked PORTAL-NATIVE 2026-06-26, PR #839): `confirm` (immediate booking
  confirmation, **SMS + matching EMAIL**) and `same_day` (morning-of check-in, SMS).
  Day-before removed. Calendar-based due logic in `api/agent/confirm-automations.js`.
- Copy is BAM GTA's real wording (in `DEFAULT_CONFIRM_AUTOMATIONS`). **PORTAL-NATIVE = no
  GHL tokens**: we resolve `{{appointment.start_time / only_start_time / only_start_date /
  meeting_location}}` ourselves from the appointment, and GENERATE the calendar links -
  Google Calendar URL inline + a hosted `.ics` via **new `GET /api/ical`** (`api/ical.js`).
  `{{contact.first_name}}` is resolved by the send engine (`sendOn` → `resolveMergeVars`
  in `_send.js`/`email-shells.js`). `nextAppointment` (booking.js) now returns endTime +
  address; `resolveContactInfo` exported from `automations.js`.
- EMAIL rides the SAME approval card as the SMS (new cols `email_subject`/`email_body`,
  migration `20260626140000`). Approving the touch sends both; email via `sendOn`→Resend
  (suppression + email_events free). Email is NOT quiet-gated; SMS is. `fireScriptedStep`
  resolves everything at card-creation so the stored draft is final text (clean inbox + the
  quiet-hours flush can send it raw).
- Per-academy overrides in `clients.ghl_kpi_config.confirm_initial_automations`
  (`{enabled, approved, steps:[{key,enabled,template}]}`); fixed fields (when/channel/email/
  email_subject) always from defaults. GTA's stale pre-portal override was cleared so the
  new copy shows.
- Detector (`agent-confirm.js` `fireScriptedStep`): one step per run; dedupes by `step_key`;
  STOPS scripting the moment any AI `confirm/handoff/lost` card exists or the lead replies
  (AI agent then owns it). Falls back to the old AI proactive opener when the sequence isn't
  live+approved (backward-compatible).
- Send mode reuses `confirm_agent_mode` via `shouldAutoSend`: Hawkeye = each scripted touch
  QUEUES for ✓; Self-drive = auto-fires (currently held by `SELF_DRIVE_GLOBALLY_DISABLED`,
  so everything queues right now). Quiet-hours respected.
- Cards ride `agent_confirm_replies` as **kind `confirm_auto`** + new **`step_key`** column
  (migration `20260626120000`, APPLIED to prod). Inbox renders them as a normal editable
  reply card (`_acxReplyCard`/`_acxSend` → action `send`) with an "automated reminder" pill.
- Editor: **Train Agent → Knowledge tab → "📨 Initial automations" card** (confirm agent
  only, `_confirmAutos*` in client-portal.html). API actions `automations-get`/`automations-set`
  on `/api/agent-confirm`.
- **To turn ON for an academy:** edit/approve the sequence in Knowledge + set confirm_agent_mode.
  Gated to v2_access (detector) so V1 untouched.

## Closing agent initial automations — BUILT 2026-06-26 (PR #842), mirrors confirm
The CLOSING agent (Done-Trial stage) now has its own scripted post-trial sequence
(`api/agent/closing-automations.js`, wired in `agent-closing.js` exactly like confirm):
- **3 SMS steps**: `post_trial` (immediate) → `nudge` (+2 days) → `closeout` (+4 days).
  Timing is relative to **sequence start** (first card's created_at), not an appointment.
- SMS-only, only token `{{contact.first_name}}` (resolved by the send engine). No
  appointment/calendar/email - trial already happened. Warm door-openers; the AI closing
  agent sends the actual sign-up link once the lead engages.
- Cards ride `agent_closing_replies` as kind **`closing_auto`** + `step_key` (migration
  `20260626160000`, APPLIED). Inbox = editable reply card + "automated reminder" pill.
- Override store: `clients.ghl_kpi_config.closing_initial_automations`. Actions
  `automations-get`/`automations-set` on `/api/agent-closing`. Gated by `closing_agent_mode`.
- **Knowledge editor is now AGENT-AWARE** (`_confirmAutos*`/`_CA` in client-portal.html):
  same card serves confirm + closing, endpoint `/api/agent-<agent>`, per-agent copy/token
  hints. Shown when `_TA.target` is confirm OR closing.
- **To turn ON:** Closing → Knowledge → 📨 Initial automations (edit/approve) + set
  closing_agent_mode. Default copy is generic post-trial; edit per academy.

## ⚠️ Still TODO
- `{athlete}` token falls back to "your athlete" (name not yet pulled from contact memory in
  the scripted render).
- Optional: instant SMS notify when a Scheduled-Trial lead replies (booking has this for
  Responded; confirm relies on the 15-min cron).

Spec mirrors: `sales-conversation-agents/conversation-ai-confirm-agent{,-bam-gta}.txt`
(generated from the brain). See `[[project_client_agent_training]]` + `[[project_automation_agent_roadmap]]`.

## Gotchas found in the 2026-07-01 live audit (all fixed)
- **Conversation-seeded queue blind spot (FIXED #1017):** `computeConfirmQueue` only
  queued Scheduled-Trial contacts that had a GHL conversation - a lead who booked
  straight off the calendar (never texted) was INVISIBLE and got zero touches.
  Now bare no-conversation contacts are appended to the queue; the scripted send
  opens the thread. `computeClosingQueue` still has the old pattern (follow-up).
- **Stuck pending cards block re-fire:** any pending/approved card makes
  `fireScriptedStep` return "already has an active card". Pre-Jun-30 (pre-autosend)
  confirm_auto cards sat pending forever AND blocked the new auto-send. Cure: cancel
  the stale card; the next 30-min scan re-drafts + auto-sends.
- **No-phone contacts loop silently:** the quiet-hours flusher swallows send errors
  (`catch (_)`) without writing send_error or changing status - a held card for a
  phone-less contact retries forever. Also: the scripted "Your free trial is
  booked!" can fire for leads who never actually booked (no appointment = tokens
  render empty). Detect: `opportunities.contact_phone IS NULL` + no trial date on card.
- **Policy (Zoran, 2026-07-01): scripted/templated automations are NEVER Hawkeye-gated**
  - they auto-send whenever the agent is on (shouldAutoSendScripted). Only AI-written
  drafts queue for approval. AI drafts CAN still rot in the queue (2 trials were burned
  by unapproved confirm drafts) - no alerting exists yet.
- **Suspected calendar bug:** multiple leads (Tunde, Monica, Yvette) completed the
  trial form but never got past the calendar's "Confirm your Spot" step - they land in
  Scheduled Trial with no appointment, no phone-based follow-up possible. Untested.
- Post-trial good-fit submit fires the closing `post_trial` scripted step IMMEDIATELY -
  if the form is filled courtside mid-trial, the parent gets "hope you had a great
  time" while the athlete is still playing. No delay option yet.

## Trial-confirmation "Location:" fix (2026-07-02)

Zoran caught the booking-confirmation automation sending "Location:" with an
empty value. Cause: GTA's calendar moved to the portal spine that day and
`schedule_slots.location_label` is NOT set by the slot-creation flow, so
`nextAppointment()` returns `address:null`; the Brain business_info "Location:"
line fallback was also blank. Fixes (PR same day):
- `agent-confirm.js` address chain is now slot `location_label` -> Brain
  business_info "Location:" line -> **`clients.address`** (the required BB
  General field, added to both client selects).
- `resolveApptTokens` (confirm-automations.js) strips any dangling label line
  (Location/Date & Time/Date/Time/Apple/Google) whose token resolved empty, so
  a missing value never ships as a bare label again.
⬜ Nice-to-have: set `location_label` when generating GTA slots (Luka's spine,
RPC-only rule applies).

## Closing follow-up loop (2026-07-02, Zoran's design)
- After the scripted closing sequence has nothing due (or the AI already owns the
  thread) and a Done-Trial lead is quiet 2+ days, `maybeFollowUpOrNurture` in
  `api/agent-closing.js` drafts ONE fresh follow-up at a time (re-reads thread +
  coach's post-trial notes via contact_memory). Rows: kind `closing`, step_key
  `followup_1..3`, always status `pending` (AI-written → Hawkeye, never auto).
  reply via rows' last_lead_at), the lead auto-moves to the NURTURE stage +
  enrolls in the Lead Nurture automation (same routing as Mark-as-lost).
- BAM GTA's scripted nudge/closeout steps are DISABLED via
  clients.ghl_kpi_config.closing_initial_automations.steps so the AI loop owns
  everything after the immediate post_trial text.

## Follow-up loop v2 (2026-07-02 evening, Zoran's refinements)
- Cadence: NEXT DAY (FOLLOWUP_GAP_DAYS=1), EXCEPT when the lead names a decision
  date - the agent extracts it (REPLY_TOOL followup_on, YYYY-MM-DD) and every row
  stamps agent_closing_replies.followup_not_before; the loop holds until then.
- 3 strikes now RECOMMENDS instead of silently moving: a closing_lost card
  (created_by 'followup-loop', reason 'Not locked in') queues in Hawkeye; the
  human's ✓ marks Lost + auto-routes to Nurture stage + Lead Nurture automation.
  One human SKIP of that card = permanent snooze for the lead.
- Lost is still a thing post-GHL: portal-native (opportunities.status +
  pipeline_outcomes), and Lost auto-routes to Nurture when the automation is live.
- Hawkeye closing cards (client-portal.html _aclx*) now show team notes + an
  'Add note' input per card -> /api/agent-contact-notes -> feeds contact_memory,
  so notes shape the agent's NEXT drafts. Follow-up cards badge 'follow-up N of 3'.
- Staff edits to a draft need no special handling: each next follow-up is drafted
  fresh from the REAL thread, so the edited text is what the agent re-reads.

## Follow-up loop v3: PLAN mode (2026-07-02 late)
- The loop now drafts the WHOLE remaining plan in one pass (PLAN_TOOL ->
  followup_1..3) instead of one message per day-with-approval. All plan rows
  insert as pending (created_by 'followup-plan'); Hawkeye groups a contact's
  pending followup_N rows into ONE plan card (each message editable, empty box
  = drop that step) with a single '✓ Approve plan' -> action 'approve-plan'
  staggers send_after 1 DAY APART; the detector's flush delivers each when due.
- A reply cancels remaining plan rows in TWO places: the flush (never send on
  top of a fresh inbound) and the reactive branch (cancels then answers).
- Paying member found in Done Trial -> auto-marked WON + cards cleared (they
  should never sit in the stage).
- Edit the templated 'thanks for coming out' copy: Train tab -> Closing ->
  📨 Initial automations.

## Session handoff 2026-07-03 (~9:30 PM) - follow-up plans: ONE BLOCKER LEFT
State: plan cards UI, Scan-all-agents button, approve-plan API, next-day cadence,
decision-date holds, Lost recommendations, Hawkeye notes, member auto-won - ALL
merged + deployed (#1058 #1065 #1067 #1072 #1074 #1075).

**BLOCKER (next session's first job):** the plan drafter inserts 2-3 PENDING rows
per contact, but the DB has
  `agent_closing_replies_one_active_per_contact` UNIQUE (client_id, ghl_contact_id)
  WHERE status IN ('pending','approved')
so multi-row plans 409. Latest detect summary (automation_events type
'closing_detect_summary') shows Tunde/Noora/Dhananjay failing on exactly this.
Fix options: (a) relax the partial index to exclude step_key LIKE 'followup_%'
(new migration + keep one-active semantics per step), or (b) single plan row with
a plan_steps jsonb + approve-plan materializes the approved rows. (a) is simpler;
approve-plan also creates multiple 'approved' rows so the index must allow those too.

Bugs fixed this session (all Twilio-cutover fallout):
- conversationId scoped inside the non-Twilio branch crashed EVERY AI draft on
  Twilio academies (confirm + closing) - hoisted (#1074).
- Queue recency: GHL conversations freeze at cutover -> overlayPortalSmsRecency
  in agent/_stage.js merges sms_threads into confirm+closing queues (#1060).
- Board's red '!' + 💬 recency: _plLoadLastMessages was last-write-wins across a
  contact's MULTIPLE threads (old email thread clobbered fresh SMS) - newest
  wins now (#1075). Also fixed _plV2 out-of-scope crash in _renderPipelineTabs.
- Detect run summaries now persist to automation_events (type
  'closing_detect_summary') - read the latest to debug the closing detector.

Open loops (human/next session):
- Monica Kapoor + Yvette Coetzee: filled trial form, never picked a slot, NO
  phone - need manual outreach; SUSPECTED calendar bug at "Confirm your Spot"
  (Tunde reported the click not working Jun 25) - UNTESTED.
- computeClosingQueue got the recency overlay; the closing agent still caps
  DETECT_CAP=10/run.
- Reactivation cohort (8 texted Jul 2 ~5:18 PM): watch for replies in Hawkeye.

## 2026-07-18 - overdue "did they show up?" nag was blind to portal rebookings
Meg Pappas (GTA): her Hawkeye card said "Trial on Tue, Jul 7 4:00 PM has passed
with no review logged" while the real session was Wed Jul 22 8pm. Cause: the
overdue-detector + prune in `api/agent-confirm.js` check future trials via
`trialAppts()` (GHL appointments ONLY), but Book-it on a portal-provider academy
books via `bookPortalTrial` (trial_bookings, NO GHL appointment) - so a rebooked
lead still looked stranded and the stale nag sat pending quoting the old date.
Fixed (V2-only, detect loads v2_access clients):
- detect: `upcomingBookedContactIds` (portal spine) now skips rebooked leads
  before the GHL appts check.
- prune: pending `created_by='overdue-detector'` cards cancel when the lead has
  an upcoming portal slot OR a future GHL appt ("rebooked - a future trial is
  scheduled").
- list-ready: read-time gate hides those stale nags instantly (cron cancels for
  real).
- "never nag twice" is now scoped per trial via `trial_at` (>= lastPast blocks),
  so a lead who rebooks and no-shows AGAIN gets a fresh, correctly-dated nag;
  dateless legacy cards still block forever.
