# Shelved features - built or designed, hidden for a later version

Things we deliberately turned OFF or held back, so nothing gets lost. When
you hide something for later, ADD IT HERE in the same commit. When you bring
one back, delete its row and note it in the relevant project memory.

| Feature | Where | How to bring it back | Shelved | Why |
|---|---|---|---|---|
| Funnel wrench fix badge | `_mmFunnelSvg` in client-portal.html (the circled wrench + dotted stem pointing at the leak, tooltip has the fix text) | Set `window._MM_SHOW_FIX_BADGE = true`, or flip the flag check in the code to ship it on | 2026-07-06 | Cole: hide for now, add later |
| ROI machine (Meta focus) | Marketing machine focus mode, hidden by Zoran (commit `fe0d926` "MM meta focus: hide the ROI machine for now") | Revert that commit's hide | 2026-07-06 | Zoran: not ready |
| Avg Attendance + Fill Rate KPIs | `_HM_KPI_CATALOG` scoreboard picker - selectable but render "-" (no check-in data source yet) | Wire a data source (check-ins), add to `kpiData` in `_hmLoadScoreboard` | 2026-07-06 | No data yet |
| Sales tiles: "Sales - 7 days" + "Trial closing rate" | `_ccMountSales` command center section - render "-" | Wire from `stage_transitions` / kpis when Zoran's sales data settles | 2026-07-05 | Awaiting live KPI wiring (tiles read "sample" on Zoran's classic page too) |
| Archive action on inbox (hover button + mobile swipe-left) | `_hmInboxRow` hover actions (replaced with "Open inbox") and the v15 inbox swipe-left affordance (removed in the 2026-07-06 sweep - it only faded the row) | Build real archive (GHL conversation archive API), restore the button + swipe branch in the touch handler | 2026-07-06 | Was a dead button / fake affordance |
| Creative tile "delete" button | Marketing focus creative tiles - button only toasted internal roadmap copy via `_mmCreativeAction` (function kept, no call sites) | Wire delete into the real creative-request ticket flow, re-add the button next to "replace" | 2026-07-06 | No-op that leaked internal copy |
| Hawkeye hero card on Home | `_hv2HawkPaint`/`_hv2HawkLoad` still exist but the `#hv2-hawk` host was never rendered; the loader call was removed in the sweep (it fired 2 wasted fetches per Home load). Rail-bottom feed is the live Hawkeye surface | Render `<div id="hv2-hawk">` in the `renderHomeV2` hero and re-add the `_hv2HawkLoad()` call | 2026-07-06 | Dead code, host element never shipped |
| Unused `_SFX` sounds | `_SFX` object keeps tick/pop/typeTap/rollClick/chime/sparkle/zip methods with no call sites (5-sound cap) | Re-wire a call site | 2026-07-06 | Cole: cap at 5 impactful sounds |

Brought back:
- Tower (GM agent) boardroom - SHIPPED 2026-07-06 with the rule-based brain (same contract as Shield); swap in the real LLM endpoint later. Lives behind the mobile tab-bar orb (`openGmFocus`). See project_command_center.md.

Related but NOT shelved (decided against, do not revive without a new decision):
- Confirm-tone sound (#13 in the sound list) - never built, Cole declined.
- Per-member pulse dots - replaced by the roster health bar.
- Blueprint-grid focus background + translucent depth stack for marketing - replaced by zoom-through + solid room.
- Random-color avatar palette - replaced by the neutral chip.
