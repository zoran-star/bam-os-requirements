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
4. **Popup modal** (glowing card in cascade): contact info left, chat + editable suggested
   reply + teach-why + move-lead right. Approve auto-advances through the queue.
5. **NO SKIP anywhere** - every Hawkeye action must be resolved (approve or move).
6. Configure page = the LIVE focus mode (Entry->Engine->Exit, PR #1178) - reuse, don't rebuild.

## Replaces
`_apx`/`_acx`/`_aclx` Hawkeye overlay buttons · Train Agent picker as a destination ·
scattered autonomy/config entry points. KEEPS: inline drawer suggestion on lead cards.

## Open item (ask Zoran before building)
Mobile swipe-left has 3 destinations (Ghosted/Nurture/Unqualified) - should pop a 3-option
choice before committing, not fly away blind. Confirm exact behavior.

## See also
[[project_sales_focus_mode]] (focus mode + engines model + router, what's already live) ·
[[project_sales_crew_model]] (the crew) · [[project_sales_crew_guardrails]] (solid vs dashed
visual language) · [[project_v2_sales_board]] (board surfaces being replaced/kept).
