# Re-arm sweep (silently-stuck Responded leads → Ghosted)

**Shipped 2026-07-14 (PR #1412, merged to main).** Automated backstop that fixes the
"not flowing - no agent, no automation, idle 3+ days" gap the client-portal panel
(`_ccStuckCards` in `client-portal.html`) only *displayed*. A lead that replied
(exiting 👻 Ghosted on reply → bounced to Responded), got an agent answer, then went
silent again had **no active engine**: the agent only acts on inbound replies and
Ghosted exits permanently on that one reply. Some leads (imported straight to
Responded, e.g. `source='ghl-import'`) never had a Ghosted safety net at all.

## Where
- `bam-portal/api/automations.js` → `runRearm()` + `GET ?action=rearm`
  (Bearer `CRON_SECRET`, same auth as `?action=work`). Helper `lastGhlMessageMs()`.
- `vercel.json`: cron `/api/automations?action=rearm` every 15 min.
- No schema change - reuses `opportunities`, `automation_enrollments`,
  `agent_ready_replies`, `agent_reignitions`, `automations`.

## What it does
Finds open opps `stage_role='responded'` that are truly idle, then `enrollContact(ghosted)`
+ `moveStage(role='interested')` - the SAME handoff `runWork`'s form-intro roll-forward
does. Operationalizes the seed edge `responded --went_quiet--> interested` (which had no
engine firing `went_quiet` for Responded leads until now). Next inbound reply bounces the
lead back to Responded and the agent re-engages.

## Gotchas / guardrails
- **Idle clock = the LIVE GHL last-message date** (any direction, via
  `/conversations/search`), NOT `opportunities.updated_at` - the pipeline sync rewrites
  `updated_at` in bulk so it is only a coarse candidate floor. Fails SAFE (skip, never
  arm) if creds/inbox can't be read.
- Skips: active enrollment · pending/approved agent card · pending reignition.
- Anti-loop: `REARM_COOLDOWN_HRS` (48) since last Ghosted enrollment + cap
  `REARM_MAX_GHOSTED` (3 total per lead) then left for staff. `REARM_IDLE_DAYS` default 3.
  All three are **env vars today** → belong in the Onboarding Data Points DB as
  per-academy config later (flagged in the PR + handoff doc).
- **V1 firewall:** `isAutomationLive(client,'ghosted')` false for GHL-workflow academies
  + `opportunities` store is portal-provider only → V1 never touched.
- Emits an `automation_events` `rearm_ghosted` audit row per arm.

Sibling of the manual [[project_followup_forcing_function]] ghost card (this is the
automated version). Full transition spec in `docs/core-handoff/sales-flow.md`.
See also [[project_hawkeye_mission_control]], [[project_sales_crew_model]].
