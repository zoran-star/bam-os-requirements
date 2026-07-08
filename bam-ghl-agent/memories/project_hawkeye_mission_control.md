---
name: hawkeye-mission-control
description: 2026-07-07 V2 design decision - one Hawkeye mission control screen (all agents + automations by pipeline stage, per-row configure drawer). Replaces the 3 board buttons + Train Agent picker. NOT built yet.
type: project
---

# Hawkeye mission control (V2 redesign) - DESIGN LOCKED 2026-07-07, not built

Zoran's call: Hawkeye is scattered across 5 surfaces (3 per-stage board buttons, Train Agent
picker, Automations sub-tab, autonomy toggles, staff AgentModePanel). V2 gets ONE screen.

## The screen (mission control)
One view listing the whole sales crew **organized by the lead journey**:

- **Main path** (agents, solid left border): Booking (Responded) -> Confirm (Scheduled Trial)
  -> Closing (Done Trial). Each row: name + type pill + stage one-liner + red "N waiting"
  count + mode label + gear.
- **Recovery loop** (automations, DASHED left border): Ghosted, Lead Nurture. Each row:
  step/cadence summary + "N enrolled" count + On/approved state + gear.
- Rows with waiting actions expand INLINE to their queue: lead's last message + editable
  draft + Approve-and-send / Edit / Skip. **Queue is grouped by stage** (decision), not one
  mixed feed.
- Header: total actions pill + one Scan button (board top-left Scan moves here).

## Configure drawer (the gear) - same shape for every row
- Agents: Autonomy · Brain (Knowledge) · Lessons · Test chat
- Automations: Autonomy(On/Off) · Steps + approve-sequence (replaces Lessons/Test)
- This ABSORBS the Train Agent picker navigation (picker UI goes away; the underlying
  `_TA` machinery/tabs get reused inside the drawer).

## Decisions (Zoran, 2026-07-07)
1. **Replace** the 3 per-stage Hawkeye buttons on the sales board - one Hawkeye button
   opens mission control scrolled to that stage. One mental model.
2. Queue **grouped by stage** under each agent row (matches pipeline mental model).
3. Inline drawer suggestion on a lead card stays as-is (good for working one lead).

## Consolidates (5 -> 1)
`_apxOpen`/`_acxOpen`/`_aclxOpen` overlays · Train Agent picker (`_taPick`) · Automations
sub-tab (`_taRenderAutomations`) · per-agent Autonomy controls · board Scan button.

## Visual language kept
Agent = solid border, automation = dashed (matches board stage-colour borders,
[[project_sales_crew_guardrails]]). Design system: `bam-portal/design-system/DESIGN.md`
(gold #D4B65C, no emojis - SVG icons, radius scale).

## See also
[[project_sales_crew_model]] (the crew + what's live) · [[project_v2_sales_board]] (board
surfaces being replaced/kept).
