# Sales crew — multi-bot guardrails (Zoran's requirements)

2026-06-25. Non-negotiable guardrails for the multi-agent "sales crew" system (Booking ·
Confirm · Closing agents + ghosted/automations). A human must always have visibility +
an off-switch on every bot. Captured from Zoran; some already exist, some are new builds.
Visual: `docs/sales-crew-model.html` (§ Guardrails). Model context: `[[project_confirm_agent]]`.

| # | Guardrail | Status | Notes |
|---|---|---|---|
| 1 | **Notify on ALL inbound messages** | 🔶 partial | Today `ghl/inbound-webhook.js` only SMS-pings on a Responded-stage reply (booking). Want: a notify on EVERY inbound, any stage/bot. |
| 2 | **Pipeline glows → which bot is active** | 🔶 partial | A Responded-stage glow tied to `agent_mode` exists. Want: each pipeline stage lights up by the bot running it. |
| 3 | **Hawkeye approval queue for EVERY bot** | 🔶 partial | Booking (`_apx*` / agent-approvals) ✅ + Confirm (`_acx*` / agent-confirm) ✅. Make it the standard for every new bot — nothing sends without a human ✓ in its own queue. |
| 4 | **Coloured/dashed outline on a conversation tab when a bot is active in it** | 🆕 new | In the inbox convo list, outline a conversation when a bot is live in it; colour = which bot (blue Booking / gold Confirm / purple Closing). |
| 5 | **Turn a bot OFF globally (per bot)** | ✅ have | `AgentModePanel` per-bot off/hawkeye/self_drive (`agent_mode`, `confirm_agent_mode`). |
| 6 | **Turn a bot off for a SPECIFIC convo / card** | 🆕 new | Per-lead + per-card mute ("hands off this one"). Needs a mute flag/table (e.g. `agent_mutes` by client_id+contact_id, optionally per agent) honoured by every detector's draft gate + a per-card "stop bot on this lead" action. |
| 8 | **Client sees inside every automation** | 🆕 new | Client-facing observability: a list of every automation + how many people are in it (total AND per step). Click in → list of those people; click a person → their **contact drawer** opens. (Mock in the doc.) |
| 7 | **First-come-first-serve on Hawkeye cards** | 🆕 new (build later) | Two staff can't both action the same card/lead. Atomic claim: the status transition must be conditional (e.g. `UPDATE ... SET status='sent' WHERE id=$ AND status IN ('pending','approved')`) and check affected-rows = 0 → "already handled by [name]". Prevents double-send / conflicting decisions on send / confirm-handoff / confirm-lost / skip across booking (`_apx*`) + confirm (`_acx*`). |

**Design throughline:** every bot = same shape — own Hawkeye queue, own off-switch, visible state
on the pipeline + inbox. New bots inherit all 6 by construction. Items 1, 4, 6 are net-new
builds; 2 + 3 extend existing patterns; 5 is done.

## Pipeline-stage principle + agents-vs-automations rule (added 2026-06-25)
- **Every bot/automation owns a pipeline stage** so it glows + shows on the board. New stage to add:
  **💔 Lost – Nurture (win-back)** — qualifying Lost leads move here (gated by Lost reason:
  price/time/timing yes; opted-out/invalid no) and the lost-lead nurture automation runs.
- **The one rule that differs between agents and automations = Hawkeye:**
  - **Agents** (Booking·Confirm·Closing) = live conversation → approve **each message**.
  - **Automations** (Ghosted·Lost-nurture) = scheduled one-way nudges → approve the **sequence once**
    (in the Brain step-builder). On reply → lead moves to Booking → normal per-message Hawkeye.
  - Everything else (notify-on-inbound, pipeline glow, global + per-lead/per-card off-switches) is identical.
