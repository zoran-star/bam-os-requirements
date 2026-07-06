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
| Archive action on home inbox rows | `_hmInboxRow` hover actions - the old no-op Archive button was replaced with "Open inbox" | Build real archive (GHL conversation archive API) and restore the button | 2026-07-06 | Was a dead button |
| Unused `_SFX` sounds | `_SFX` object keeps tick/pop/typeTap/rollClick/chime/sparkle/zip methods with no call sites (5-sound cap) | Re-wire a call site | 2026-07-06 | Cole: cap at 5 impactful sounds |

Related but NOT shelved (decided against, do not revive without a new decision):
- Confirm-tone sound (#13 in the sound list) - never built, Cole declined.
- Per-member pulse dots - replaced by the roster health bar.
- Blueprint-grid focus background + translucent depth stack for marketing - replaced by zoom-through + solid room.
- Random-color avatar palette - replaced by the neutral chip.
