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

## ⚠️ Still TODO
- Day-of reminder cadence (detector creates ONE proactive opener; reminders are in the
  prompt but not yet scheduled as separate cards).
- Optional: instant SMS notify when a Scheduled-Trial lead replies (booking has this for
  Responded; confirm relies on the 15-min cron).
- **To turn on for an academy:** AgentModePanel → Confirm agent → Hawkeye.

Spec mirrors: `sales-conversation-agents/conversation-ai-confirm-agent{,-bam-gta}.txt`
(generated from the brain). See `[[project_client_agent_training]]` + `[[project_automation_agent_roadmap]]`.
