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

## 3. Follow-up engine — scheduled nudges, approve-each (PR #595, 2026-06-20)
The nudge engine, human-gated. Detector drafts the next nudge for quiet leads
onto a timeline; admin approves before it auto-sends.

**Table `agent_followups`** (migration 20260620230000): client_id, ghl_contact_id,
ghl_conversation_id, contact_name, goal, draft_message, scheduled_at, status
(pending/approved/sent/skipped/canceled/failed), trigger_reason, last_lead_at,
confidence, approved_by/at, sent_at, send_error. Unique partial index
one-active-per-contact (status in pending/approved). RLS select staff/member.

**`api/agent-followups.js`:**
- `?action=detect` (cron */30, Bearer CRON_SECRET): per engine-enabled academy,
  GHL conversations/search → quiet leads (lastMessageDirection=outbound, between
  MIN_QUIET_HOURS=12 and MAX_AGE_DAYS=14), skip if active/recent followup exists,
  pull thread, Claude `schedule_followup` tool reads the brain's follow-up rules
  and returns {should_followup, send_in_hours, message, goal, reason, stop} →
  insert status=pending. Cap 12/run.
- `?action=work` (cron * * * * *): send status=approved & scheduled_at<=now via
  GHL `/conversations/messages`; cancels if lead replied since draft. APPROVE-EACH:
  pending never auto-sends.
- staff POST: list / approve / skip / edit / snooze / send-now / detect-now.
- inbound-webhook.js cancels pending+approved for a contact on their reply.

**UI:** `FollowupsPanel.jsx` → `⏰ Follow-ups` tab in staff AgentTrainingView
(alongside Learnings & approvals + Sandbox). approve/edit/skip/+1d/send-now,
"↻ check for new" runs detect-now.

**Gate:** per-academy `clients.ghl_kpi_config.followup_engine_enabled` (true for
BAM GTA). ⚠️ Before approving live: turn OFF GHL's follow-up workflow steps for
that academy or it double-texts. This engine is what retires those (roadmap step 4).

## 4. Agent autonomy mode — one switch, unified approval inbox (2026-06-21)
ONE per-academy switch governs BOTH engines (reply bot + follow-ups). Replaces the
two loose booleans (`agent_approvals_enabled`/`followup_engine_enabled`).

**Mode** = `clients.ghl_kpi_config.agent_mode` ∈ `off | hawkeye | self_drive`.
Shared helper `api/agent/_mode.js`: `agentMode(client)` (legacy fallback: either old
bool on → 'hawkeye'), `modeIsOn`, `modeSelfDrives`, `shouldAutoSend(mode,{confidence,
escalate})`, `SELF_DRIVE_MIN_CONFIDENCE=0.8`. `agent-config.set-mode` also keeps the
two legacy bools in sync.
- **off** = silent. **hawkeye** = draft everything, human approves. **self_drive** =
  auto-send when confidence≥0.8 & !escalate; UNSURE/escalate still queue to the inbox.

**Set by BAM staff:** `api/agent-config.js` (staff-gated) `list`/`set-mode`. UI =
`src/views/AgentModePanel.jsx`, new **🎚 Autonomy** tab in `AgentTrainingView.jsx`.
Self-drive pick shows a red warning modal.

**Ready replies queue** (responded-bot equivalent of agent_followups): table
`agent_ready_replies` (migration 20260621000000) — detector pre-drafts the next reply
for Responded-stage leads who just messaged. NEW cron `agent-approvals?action=detect`
(*/5). agent-approvals actions added: `detect` (cron), `list-ready`, `skip-ready`; the
`send` action takes optional `ready_id` to close the row. Self-drive auto-sends high-conf
drafts in detect (auto_sent=true) + logs agent_approvals; escalations/low-conf queue.
agent_approvals stays the audit log; agent_ready_replies is the live queue.

**Follow-up self-drive:** `agent-followups.runWork` now also sends `pending` rows whose
time is due when academy is self_drive & confidence≥0.8 (else they stay for approval).
detect gate switched from `followup_engine_enabled` → `modeIsOn(agentMode())`.

**Unified approval inbox (client portal):** `📨 Approve (N)` button in the Inbox-tab
toolbar (`#ib-approve-btn`, staff-only via `_IS_BAM_STAFF`). `_apx*` fns in
client-portal.html — right-side drawer, 2 sections: ⏰ Follow-ups (agent-followups
list/approve via send-now/edit/skip) + 💬 Ready messages (agent-approvals list-ready/
send w/ ready_id/skip-ready/local-edit). Count refreshed on inbox load. inbound-webhook
now cancels pending/approved `agent_ready_replies` too (+ notify gate uses agentMode).
⚠️ Inbox is staff-operated for now (endpoints staff-gated); opening it to academy
owners (can_train_agent) is a later step.

## ⚠️ Known gap (same as roadmap): no global SINK yet
`scope='general'` is still only a flag — `activeLessons()` queries by client_id,
so an approved "global" lesson doesn't actually propagate to other academies. The
approval gate is real, but "applies to all academies" only matters once academy
#2 exists + the shared-brain merge is built. BAM GTA is the only wired academy.

Related: [[project_automation_agent_roadmap]] · [[project_agent_sessions]] ·
[[project_multi_user_portal]] · [[project_client_auth]]
