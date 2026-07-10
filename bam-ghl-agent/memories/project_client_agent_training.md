# Client-Portal Agent Training + Brain-Configurable Follow-ups (2026-06-20)

Two related changes to the BAM GTA booking agent, both V2/agent-only (zero V1 impact).

## ⭐ LESSON MODEL REVISED (2026-07-10, Zoran) - consolidation skill replaces auto-promote
The old "AI classifier -> promotion_status=pending -> staff approves -> scope flips
to general" flow is RETIRED, and the audit-flagged gap ("global scope was just a
flag, no cross-academy sink") is CLOSED.
- **General lessons now actually load for every academy.** Storage: an agent_lessons
  row with `client_id IS NULL, scope='general', agent=<x>`. The four readers
  (loadConfig in agent-approvals/confirm/closing + brain.loadBrainConfig) now query
  `or=(client_id.eq.<academy>,and(client_id.is.null,scope.eq.general))` filtered by
  agent, so a general **closing** lesson never bleeds into **booking**.
- **`/consolidate-lessons` skill** (`bam-ghl-agent/.claude/commands/consolidate-lessons.md`
  + `bam-portal/scripts/lessons-io.mjs`) is the new path: dump the raw teach-why pile
  for an academy -> Claude clusters/dedups/classifies into academy-specific vs general
  -> confirm with Zoran -> apply. Consolidated rows stamped `created_by='consolidate-skill'`;
  raw sources set `active=false` (history kept, prompts stay lean). We no longer hoard
  every raw lesson.
- **Promote-to-general UI REMOVED** from `src/views/AgentTrainingView.jsx` (the pending-
  approvals queue + mark-general/make-academy toggles). The view is now read/edit/archive
  only + points at the skill. agent-learnings.js's set-scope/list-promotions/approve-
  promotion/reject-promotion endpoints are now inert (no caller) - left in place, harmless.
- Below is the ORIGINAL 2026-06-20 model, kept for history.

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

**Set by BAM staff:** `api/agent-config.js` (staff-gated) `list`/`set-mode`. TWO UIs,
both staff-only: (1) staff portal `src/views/AgentModePanel.jsx` → **🎚 Autonomy** tab in
`AgentTrainingView.jsx` (all academies); (2) client portal Train Agent view 4th sub-tab
**🎚 Autonomy** (`_taRenderMode`/`_taSetMode`/`_taConfigApi` in client-portal.html, shown
only when `_IS_BAM_STAFF`, scoped to the current academy). Self-drive shows a warning modal.

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
Hawkeye inbox access (2026-06-21): approval inbox (agent-approvals + agent-followups
POST actions) is open to **BAM staff OR the academy's own owner / can_train_agent
member**, scoped to their client_id. Shared `api/agent/_auth.js` → `resolveAgentActor(req)`
= `{email,isStaff,academyClientIds,canActOn(clientId)}`; academy actors must pass
client_id, mutations are `&client_id=eq.` scoped. The autonomy MODE switch
(agent-config.js + 🎚 Autonomy tab, gated by `_IS_BAM_STAFF`) stays BAM-staff-only.
Button reveal (`_apxRefreshCount`) is visible-by-default, hides ONLY on 401/403.
Agent suggests LOST (2026-06-21): the reply agent can recommend marking a lead Lost
(propose_reply tool fields `recommend_lost`+`lost_reason`; criteria in new
`lost_criteria` brain section, goal layer). Detector stores it as
`agent_ready_replies.kind='mark_lost'` (+lost_reason; migration 20260621120000) —
ALWAYS queued for human confirm, NEVER auto-marked even in self-drive. Hawkeye
shows a red "🚫 Suggested Lost" section; Confirm → `agent-approvals confirm-lost`
finds the opp, optionally sends the warm closing msg, PUTs GHL status=lost, logs
pipeline_outcomes. Cases: hard no / chose-elsewhere / price-final / location / kid-
not-into-it / bad-fit / invalid-lead / opted-out / SOFT no's ("no time","maybe next
season"). NOT lost: booked, "let me think/talk to spouse" (nurture), no-response
(→ ghosted sequence, NOT lost), complaint/off-topic (→ escalate). ⚠️ ghosted routing
still relies on the Ghosted GHL workflow being set on the offer.
Hawkeye edits TRAIN (2026-06-21): editing a ready reply or follow-up in the drawer
prompts "teach the agent why?" and `_apxTeach()` calls `/api/agent-train` `teach`
(same classify-and-promote pipeline as the Train Agent tab) with context
{ai_drafted, you_sent} — born local, AI-classified, general craft → BAM promotion
queue. So Hawkeye is now itself a training loop, not just a send gate.

## 5. Per-contact memory — agent remembers each person (PR #612, 2026-06-21)
The agent personalizes per lead. `api/agent/contact-memory.js` → `loadContactMemory(sb, clientId, contactId)`
assembles a `<contact_memory>` block from: `post_trial_reviews` (attended? showed_up?
good_fit? trainer + notes), `ghl_contacts` (athlete_name, tags), and `agent_contact_notes`
(freeform team notes, NEW table migration 20260621000000). Appended to the system prompt in
BOTH `agent-approvals.js` draftForContact AND `agent-followups.js` detector. So it won't
re-pitch a first trial to someone who already attended, and honors trainer steers.
- `api/agent-contact-notes.js`: get/add/remove (staff or academy member).
- `client-portal.html`: '🧠 Agent memory' section in the contacts drawer (`_cdLoadMemory`/
  `_cdMemoryHtml`/`_cdAddNote`/`_cdRemoveNote`) — facts + notes + add box.
- Post-trial form (post-trial.js → post_trial_reviews) is the auto source of trial context.

## 6. Read-time Responded gate + Quiet hours (2026-06-22)
Two send-safety fixes. `api/agent/_stage.js` + both queue APIs + `_quiet.js` (NEW). V2-only.

**Read-time Responded gate.** Bug: a lead who LEFT the Responded stage (e.g. Sergio
Luciano) still showed in Hawkeye. Cause: drafting & sending were stage-gated, but the
LIST endpoints just returned every `pending`/`approved` row — a stale card only
disappeared when the */5 detector cron pruned it. Fix: `list-ready` (agent-approvals)
and `list` (agent-followups) now filter rows against the live Responded contact set.
New in `_stage.js`: `respondedContactIdSet()` (throws on GHL err → callers FAIL OPEN:
show possibly-stale rather than empty inbox), `respondedContactIdSetCached()` (60s
module cache keyed by locationId) + `peekRespondedIdSet(locationId)` (cache peek with
NO token fetch — the count-refresh hot path skips GHL/pickGhlToken on a cache hit;
keyed by `client.ghl_location_id`). No-Responded-stage or GHL down → no filter (open).

**Quiet hours = 8:00am–9:30pm America/Toronto** (`_quiet.js`: `withinQuietHours`,
`nextSendableTime`, `QUIET_TZ/QUIET_START_MIN/QUIET_END_MIN`; DST-correct via Intl).
The agent NEVER texts a parent outside the window — every send path enforces it:
- **Scheduled follow-ups:** detector clamps `scheduled_at` into the window;
  `runWork` cron early-returns when out of window (cron-lag tail → next morning).
- **Self-drive auto-send (approvals detect):** out of window → HOLD as
  `agent_ready_replies` row `status='approved'` + `send_after=` next morning
  (`deferred` counter) instead of sending.
- **Human "send now" (Hawkeye):** out of window → same hold (approvals `send`
  action; followups `send-now` sets status approved + `scheduled_at`=morning).
  API returns `{deferred:true, send_after}`; client toasts "📅 Quiet hours -
  scheduled for …" (`_apxQuietMsg` in client-portal.html).
- **Flush:** approvals `detectForClient` sends due held rows at the top of each run
  (in-window + still Responded; else cancels). Reuses the existing */5 detect cron.

**Schema (migration 20260622210000, APPLIED to prod):** `agent_ready_replies +=
send_after timestamptz` + partial index `(status, send_after) where send_after is
not null`. Held auto-sends are `status='approved'` so they don't render in Hawkeye's
pending-only Ready tab until flushed.

## ⚠️ Known gap (same as roadmap): no global SINK yet
`scope='general'` is still only a flag — `activeLessons()` queries by client_id,
so an approved "global" lesson doesn't actually propagate to other academies. The
approval gate is real, but "applies to all academies" only matters once academy
#2 exists + the shared-brain merge is built. BAM GTA is the only wired academy.

Related: [[project_automation_agent_roadmap]] · [[project_agent_sessions]] ·
[[project_multi_user_portal]] · [[project_client_auth]]
