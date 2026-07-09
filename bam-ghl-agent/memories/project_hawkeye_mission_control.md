---
name: hawkeye-mission-control
description: 2026-07-08 V2 design LOCKED via clickable mockup - Sales simple view (strip, click-to-cascade, pill morphs to gear) + Tinder-style Hawkeye deck + popup modal, no Skip anywhere. Handoff doc + build order in docs/. NOT built yet.
type: project
---

# Hawkeye V2 + Sales simple view - DESIGN LOCKED 2026-07-08, not built

**SOURCE OF TRUTH = [`docs/hawkeye-simple-view-handoff.md`](../docs/hawkeye-simple-view-handoff.md)**
(full spec, decision log, build order, next-session prompt). Clickable mockup:
[`docs/hawkeye-simple-view-mockup.html`](../docs/hawkeye-simple-view-mockup.html) +
hosted at https://claude.ai/code/artifact/7a9a5268-048a-4dda-9750-62d9f69a4150

## The design in 6 lines
1. **Simple view** = pipeline strip ONLY (no cards). Click a stage -> cards CASCADE down;
   the pill morphs to a solid-colour gear button -> existing focus-mode config page.
2. Cascade shape by ENGINE: agent stages = cards left + Hawkeye action right per card;
   automation/human stages = single column.
3. **Hawkeye page** (gold button) = TINDER DECK: 3 agent tabs span the top (Booking/Confirm/
   Closing, gear on active), ONE card at a time, next peeks behind, approve flies right,
   move flies left, swipe on mobile, buttons on desktop. Automations never appear here.
4. **Popup modal RETIRED (2026-07-08 later)**: the cascade shows highlight rows only (no
   actions); clicking a glowing lead opens the Hawkeye PAGE on that lead's card. The deck
   is the single Hawkeye surface.
5. **NO SKIP anywhere** - every Hawkeye action must be resolved (approve or move).
6. Configure page = the LIVE focus mode (Entry->Engine->Exit, PR #1178) - reuse, don't rebuild.

## Replaces
`_apx`/`_acx`/`_aclx` Hawkeye overlay buttons · Train Agent picker as a destination ·
scattered autonomy/config entry points. KEEPS: inline drawer suggestion on lead cards.

## Action model revision (Zoran 2026-07-08) - SHIPPED end to end
- "Abandon" -> "Unqualified" on every Hawkeye button (overlays updated).
- Booking follow-up nudges RETIRED: Follow-ups tab removed from the _apx overlay;
  nothing creates agent_followups rows (quiet lead = "Send to Ghosted" proposal).
- Confirm reminders = step config only (approved templates self-send; never Hawkeye).
- Reschedule approve = handoff + Booking rebook opener queues (Entry: Rebook note).
- Done Trial: NO automations. agent-closing.js scripted sequence + automations-get/set
  + focus-mode editor REMOVED; post-trial form (trainer msg + optional link + coach
  notes) is the only preplanned touch. Proactive path restructured: opener (A6-guarded)
  -> follow-up loop for ANY engaged lead (incl. form-opened) -> Lost card after 3
  unanswered. Prompt told: silence alone is never lost.
- Enroll = reply with the sign-up link EMBEDDED in the draft (buildEnrollUrl at detect
  time; confirm-enroll appends only if the edited draft lost the link).
- Closing deck order: Reply -> Follow-up plan (stacked next) -> Suggested Lost.
- EVERY agent can mark Unqualified: `confirm-abandoned` now exists on /api/agent-confirm
  and /api/agent-closing too (mirrors agent-approvals': setStatus abandoned+role
  unqualified, markUnqualified tag, pipeline_outcomes, clears that agent's cards).
  UI: Unqualified button on all Confirm/Closing cards (_acxUnqualified/_aclxUnqualified/
  _aclxUnqualifiedPlan), 6s undo via _hawkDefer.
- Reference page: bam-portal/public/hawkeye-actions.html (+ claude.ai artifact).
- Mockup REBUILT to v2 (same file + same artifact URL): kind-aware deck cards, per-agent
  move rows incl. Unqualified, stacked Closing cadence, config screen notes per agent.
- Deck card footer LOCKED (2026-07-08): two buttons - "Other" (left, cascades up to the
  move options) + confirm (right, flips to "Confirm edits and ..." on any edit). Book-it
  cards = Calendar picker (offer-tied calendars only) + Slot picker (open slots with
  spots-left); switching either = edit. Teach-why note
  is MANDATORY on any change away from the agent's guess (confirm blocked until filled).
  Pill morph = up arrow center (collapse) + 3-line config icon top-right.
⚠️ NOT prod-verified on GTA yet (live behavior change if GTA had closing autos approved).

## Open item (ask Zoran before building)
Swipe RIGHT commits the card's main action (can SEND) - confirm it's instant-commit.
Swipe LEFT destinations differ per agent: Booking Ghosted/Nurture/Unqualified ·
Confirm Rebook/Nurture · Closing Nurture. Pop options vs default+undo vs buttons-only.

## See also
[[project_sales_focus_mode]] (focus mode + engines model + router, what's already live) ·
[[project_sales_crew_model]] (the crew) · [[project_sales_crew_guardrails]] (solid vs dashed
visual language) · [[project_v2_sales_board]] (board surfaces being replaced/kept).
