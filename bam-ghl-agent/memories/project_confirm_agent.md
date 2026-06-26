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
- **3 steps**: `confirm` (immediate booking confirmation) → `day_before` → `morning_of`.
  Calendar-based due logic in `api/agent/confirm-automations.js` (immediate always due;
  day_before = trial is tomorrow in TZ; morning_of = trial today & now<trial).
- Templates = academy-agnostic defaults (`DEFAULT_CONFIRM_AUTOMATIONS`) + per-academy
  copy/enable overrides in `clients.ghl_kpi_config.confirm_initial_automations`
  (`{enabled, approved, steps:[{key,enabled,template}]}`). Timing (`when`) is fixed, not
  client-editable. Tokens: `{first_name} {day} {time} {address}` (address best-effort from
  business_info "Location:" line).
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

## ⚠️ Still TODO
- Closing agent has the SAME gap (one AI proactive opener; no scripted post-trial sequence) —
  mirror this build for closing if wanted.
- `{athlete}` token falls back to "your athlete" (name not yet pulled from contact memory in
  the scripted render).
- Optional: instant SMS notify when a Scheduled-Trial lead replies (booking has this for
  Responded; confirm relies on the 15-min cron).

Spec mirrors: `sales-conversation-agents/conversation-ai-confirm-agent{,-bam-gta}.txt`
(generated from the brain). See `[[project_client_agent_training]]` + `[[project_automation_agent_roadmap]]`.
