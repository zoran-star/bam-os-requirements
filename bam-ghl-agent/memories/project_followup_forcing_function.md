---
name: Quiet Lead → Send to Ghosted (Responded stage)
description: 2026-06-24 — REPLACED the "always schedule a follow-up" forcing function. Responded leads quiet ≥24h (from our last msg) now get a "Send to Ghosted" card in Hawkeye instead of a drafted nudge. Staff click 👻 Send to Ghosted (enroll in academy ghosted_workflow + move to Interested) or Lost/Abandon/Skip. No more auto-drafted nudge messages, no mandatory 2-step modal. BAM GTA / V2-agent only.
type: project
---

# Quiet lead → Send to Ghosted

**Supersedes the old "follow-up forcing function" (2026-06-23).** Zoran realized BAM
GTA already has an **SMS Ghosted** GHL automation (multi-touch texts+emails → moves
back to Interested on reply → marks Lost if no reply → Lost triggers lead-nurture).
So the agent should NOT draft one-off nudges and should NOT force a follow-up on
every lead. Instead: if a lead's quiet ~a day, the action is **Send to Ghosted**.

## The model now
- **Detector** (`api/agent-followups.js` `detect` cron): finds Responded-stage leads
  whose **last message is ours** and who've been **quiet ≥24h** (`MIN_QUIET_HOURS=24`,
  was 12). For each, queues a **`kind:'ghost'`** card in `agent_ready_replies`
  (status pending). **No Claude call** — the card shows the real thread tail. No more
  nudge-message drafting; no writes to `agent_followups` from the detector.
- **Hawkeye** (`client-portal.html`): new **👻 Went quiet** tab (first tab). Each ghost
  card: **👻 Send to Ghosted** (primary) or **✕ other** → skip / Lost / Abandon, each
  with an optional "why" note that trains the brain via the existing `_apxTeach`
  pipeline (`/api/agent-train` teach). Train-the-brain = optional note field.
- **Send to Ghosted** = `POST /api/agent-approvals {action:'confirm-ghost', ready_id|contact_id}`:
  enrolls the contact in the academy's `offers.data.ghosted_workflow` (helper
  `enrollGhosted`), moves the opp to **Interested** (`interestedStage` in `_stage.js`),
  logs `pipeline_outcomes` status `ghosted`, cancels the lead's queued cards. The GHL
  workflow then does the actual multi-touch follow-up.
- **Sales-board badge** (per Responded card): 🔴 **Needs action** = has a pending ghost
  card (quiet ~a day, not yet ghosted). 🟢 **All good** = none. Source = `_PL_GHOST`
  (loaded by `_plLoadNeedsAction` via `agent-approvals list-ready`, kind='ghost').
  Tap → `_apxOpen(contactId)` opens Hawkeye focused on that lead.

## Removed (was the forcing function)
- The **mandatory 2-step modal** after every reply (`_apxMand*` family, `_apxAfterMand`,
  `_apxDraftForFocus`) — deleted from `client-portal.html`.
- The **`draft-one`** action + the LLM nudge drafter (`buildFollowupSystem`,
  `SCHEDULE_TOOL`, `runScheduleAgent`, `loadConfig`) — deleted from `agent-followups.js`.
- `_PL_FU_PENDING` / `_plLoadFollowups` (badge from `agent_followups`) → replaced by
  `_PL_GHOST` / `_plLoadNeedsAction` (badge from ghost cards).

## Lost vs Abandon vs Ghost (Zoran's definitions)
- **Ghost** → enroll in ghosted automation + move to Interested. The default for a
  quiet lead. GHL handles the sequence (reply → Responded, no reply → Lost).
- **Lost** → mark opp `lost`. GHL's native "Opportunity → Lost" workflow auto-enrolls
  lead-nurture (no portal enroll). For leads who clearly said no / bad fit.
- **Abandon** → remove from pipeline, no nurture, no message.

## Kept / still legacy
- `agent_followups` table + its worker/`list`/`approve`/`send-now`/etc. stay (drain any
  already-approved rows). The detector no longer creates new ones.
- `kind` on `agent_ready_replies` is free text (no CHECK) → no migration for `ghost`.
- **`FollowupsPanel.jsx`** (React, used in SandboxApp + AgentTrainingView) NOT updated —
  it lists `agent_followups` (now empty for new leads) and still works; ghost cards live
  in Hawkeye on the client portal, not in that panel. Low priority to mirror.

## Files
- `api/agent-followups.js` — detector now queues ghost cards (LLM-free); draft-one + nudge LLM removed.
- `api/agent-approvals.js` — `confirm-ghost` action + `enrollGhosted` helper; imports `interestedStage`.
- `api/agent/_stage.js` — new `interestedStage()` (regex /interest/i on Training pipeline).
- `client-portal.html` — ghost tab + `_apxGhostCard`/`_apxGhostConfirm`/`_apxGhostSkip`,
  badge flip (`_PL_GHOST`/`_plLoadNeedsAction`), mandatory-modal family removed.

## Related
- [[project_client_agent_training]] — the Hawkeye queue + brain training.
