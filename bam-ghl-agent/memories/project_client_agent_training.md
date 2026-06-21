# Client-Portal Agent Training + Brain-Configurable Follow-ups (2026-06-20)

Two related changes to the BAM GTA booking agent, both V2/agent-only (zero V1 impact).

## 1. Follow-ups are now brain-configurable (PR #588)
`bam-portal/api/agent/prompt-structure.js` — replaced the two loose follow-up
prose sections (`follow_up_logic`, `follow_up_config`) with THREE structured,
staff-editable `goal`-layer sections that auto-render in the Sandbox Brain editor
(🎯 Goal group): `followup_triggers`, `followup_timing`, `followup_exclusions`.
Wired into `assemblePrompt()` INSTRUCTIONS_ORDER. These are the agent's spec AND
the future nudge-scheduler's spec. Timing values are placeholders — Zoran to tune.
NOTE: nothing SENDS nudges yet; the scheduler is still unbuilt (see roadmap).

## 2. Client-portal agent training, local vs global (PR #592)
Selected client users train their academy's agent from THEIR OWN portal. Hard
local/global boundary; global needs Zoran's approval.

**Access grant:** `client_users.can_train_agent` (boolean, default false, opt-IN).
NOT the subtractive `allowed_tabs` model — it's an explicit additive show. Granted
now: Zoran (owner) + Fil on BAM GTA. To grant others: set the flag on their
`client_users` row (admin/SQL; no staff toggle UI built yet).

**Client API:** `bam-portal/api/agent-train.js` (NEW) — gated by can_train_agent
(or BAM staff). Actions: chat (role-play test, nothing sent), teach, lessons,
forget, sections, update-section, reset-section. Enforces LOCAL-ONLY server-side:
- lessons always born `scope='academy'`
- only `location`+`offer` brain layers editable (EDITABLE_LAYERS); general/goal
  return 403 ("global — not editable here")
- everything scoped to the trainer's granted client_id

**AI classifier (the "global detection"):** every taught lesson is judged
local-fact vs general sales-craft by Claude. General craft → `promotion_status=
'pending'` (lands in admin queue) BUT still applies to the trainer's academy
immediately. Local fact → `promotion_status='none'`. Conservative by design.

**Admin approval:** `api/agent-learnings.js` added staff-only actions
`list-promotions` / `approve-promotion` (flips scope→general) / `reject-promotion`.
UI: pending queue at top of staff `AgentTrainingView.jsx` (Agent Training).

**Client UI:** `client-portal.html` — new `Train Agent` top-level nav
(`#nav-train-agent`, desktop sidebar tab + auto-appears in mobile More sheet since
that's derived from sidebar items). Opt-in visible via `applyTrainAgentNavState()`
(called from `applyTabPermissions` + `_ensureStaffFlag`); hidden during Preview-as.
`_MY_CAN_TRAIN_AGENT` loaded in `loadMyPermissionsAndApply` select. Deep-link
guard in `switchView`. View = `openTrainAgentView()` with 3 sub-tabs:
💬 Test (sandbox chat), 📚 Lessons (teach + list w/ pending/shared badges),
📍 Knowledge (edit location/offer sections; global sections shown locked).

**Schema added (migration 20260620193000):** client_users.can_train_agent;
agent_lessons += promotion_status, promotion_reason, submitted_by_client_user,
reviewed_by, reviewed_at.

## ⚠️ Known gap (same as roadmap): no global SINK yet
`scope='general'` is still only a flag — `activeLessons()` queries by client_id,
so an approved "global" lesson doesn't actually propagate to other academies. The
approval gate is real, but "applies to all academies" only matters once academy
#2 exists + the shared-brain merge is built. BAM GTA is the only wired academy.

Related: [[project_automation_agent_roadmap]] · [[project_agent_sessions]] ·
[[project_multi_user_portal]] · [[project_client_auth]]
