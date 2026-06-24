---
name: Follow-up Forcing Function (Responded stage)
description: 2026-06-23 — "everybody in the Responded stage always has a follow-up scheduled." Per-card All good / Needs action badge on the Sales board, a forced 2-step in Hawkeye (reply → mandatory follow-up approval), and an Abandon option added to the ✕/Lost flow. BAM GTA / V2-agent only, V1 untouched.
type: project
---

# Follow-up forcing function

Goal (Zoran): every lead in the **Responded** stage always has a follow-up
queued. Built three coordinated pieces. **Hawkeye = the 👁 agent approval queue.**

## 1. Sales-board badge (per Responded card)
- 🟢 **All good** = the lead has an active follow-up (`agent_followups` row with
  status `pending` or `approved`). 🔴 **Needs action** = none.
- Tap either → `_apxOpen(contactId)` opens Hawkeye **focused on that lead**
  (filters the queue to their cards); if nothing's queued, a "Draft a follow-up
  now" CTA runs the mandatory flow.
- Frontend only. `_PL_FU_PENDING` (Set of contactIds) loaded by
  `_plLoadFollowups()` via `POST /api/agent-followups {action:'list'}` whenever
  the board opens + agent is on. On 401/403 → `_PL_FU_PENDING=null` → badges hidden
  (don't paint everyone red). CSS `.pl-card-fu-good` / `.pl-card-fu-action`.
  Badge rendered in `cardHtml()` gated by `isResponded && _agentOn`.

## 2. Forced 2-step in Hawkeye (manual-approval mode only)
- After a ready reply is **sent** (`_apxReadyApprove` / `_apxReadySend`), a
  **blocking** modal pops: `_apxMandatoryFollowup(contactId,name,convId)`.
- It calls **NEW backend action** `POST /api/agent-followups {action:'draft-one'}`
  — drafts+queues ONE follow-up for that single contact (reuses the detector's
  brain/schedule-tool; idempotent; returns `{stop:true}` when the brain says no
  follow-up is warranted). Engine picks the send time (editable on the card).
- Resolve the card by: **✓ Approve** (`action:'approve'` → status `approved`,
  scheduled) · **✎ Edit** · **🚫 Lost** · **🗑 Abandon**. No plain close on the
  approve card (hard block). Modal z-index **9620** (above the 9400 queue, below
  the 9650 edit modal). `_APX_MAND` holds the in-flight context.
- 2-step is **Hawkeye-only** (self-drive auto-sends, no manual approve).

## 3. Abandon added to the ✕ / Lost flow
- **Lost** = mark opp `lost`. **Nurture is handled NATIVELY by GHL** — the
  academy's "Opportunity → Lost" workflow trigger auto-fires off the status
  change, so the portal does NOT enroll anyone (would double-enroll). True for
  BOTH Lost paths (Hawkeye `confirm-lost` AND the board-card Lost button), since
  both just flip the opp status to `lost`.
- **Abandon** = NEW action `POST /api/agent-approvals {action:'confirm-abandoned'}`
  — marks opp `abandoned`, records `pipeline_outcomes`, cancels queued
  replies+follow-ups, **no nurture, no message**. "Get them out of the pipeline."
- Abandon button added in: `_apxLostCard` (🚫 Lost tab), `_apxSkipModal` (the ✕
  flow — `onAbandon` handler), and the mandatory follow-up card.

## Lost vs Abandon (Zoran's definition)
- **Lost** → GHL's native "Opportunity → Lost" workflow auto-enrolls them in
  lead-nurture (no portal action — marking lost is enough).
- **Abandon** → just removed from the pipeline, no nurture.

## Files
- `api/agent-followups.js` — `draft-one` action (single-contact draft+queue).
- `api/agent-approvals.js` — `confirm-abandoned` action + Lost→nurture enroll in
  `confirm-lost`.
- `bam-portal/public/client-portal.html` — board badge (`_PL_FU_PENDING`,
  `_plLoadFollowups`, `_plNameForContact`, `_plCloseByContact`, badge in
  `cardHtml`), focused queue (`_apxOpen(contactId)`, `_apxLoad` filter,
  `_apxRender` focus banner), the `_apxMand*` mandatory-card family, Abandon
  wiring in `_apxLostCard`/`_apxLostAbandon`/`_apxSkipModal`/`_apxReadySkip`/
  `_apxFollowupSkip`.

## Open / dependency
- **None.** Lost-nurture is a GHL-side workflow (auto-fires on the Lost status
  change) — no portal config, no workflow id to set.
- No new tables/columns — reuses `agent_followups`, `agent_ready_replies`,
  `pipeline_outcomes`. No migration.

## Related
- [[project_client_agent_training]] — the follow-up engine + Hawkeye queue.
