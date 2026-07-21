# Stage role rename: `interested` → `ghosted` (2026-07-21, PR #1546)

The free-trial preset's Ghosted stage used the internal role key **`interested`**
while its UI label was already **"Ghosted"**. That two-name mismatch is gone: the
role key is now **`ghosted`** across code + live DB + label.

## What moved (the portal ROLE KEY)
- Code (`bam-portal`): `_stage.js` `interestedStage()`→`ghostedStage()`, `_store.js`
  `ROLE_MATCHERS` key + regex, `presets.js` (both presets), and every importer /
  role literal (agent-approvals, automations, ghl/inbound-webhook, ghl/pipelines,
  email/sync-gmail, resend/inbound-webhook, twilio/inbound-webhook, website/miami-lead,
  admin/pipeline-cutover, ghl/post-trial, scripts/seed-stages).
- `client-portal.html`: `_plStageBot`/`_plStageRole`/`_EDGE_ROLE_LABEL`/`_EDGE_ROLE_ICON`/
  `ORD` role keys, `_plMove*ToInterested`→`*ToGhosted`, demo stage name, user-facing copy.
- DB (migrations `20260721150552` + `20260721150754`, applied to prod): flipped 26
  live rows (`pipeline_stages.role` ×2, `opportunities.stage_role` ×21,
  `stage_transitions.from/to_stage_role` ×3), set `label='Ghosted'`, and re-pointed
  the dead `seed_default_stage_transitions()` fn. Pure data - the stage-role
  vocabulary is open text (`^[a-z][a-z0-9_]*$`) since `20260710181458`, so no
  constraint/enum change.

## GOTCHA - what did NOT move (and why)
The **GHL-name mirror** columns keep the value `'interested'` on purpose - they
mirror the *actual GHL sub-account stage name*, not the portal role:
- `pipeline_stages.ghl_stage_name`, `entry_points.stage_name`
- `clients.ghl_kpi_config.portal_entry_routing.{trial_stage,contact_stage}`

They bridge to the new role via `ROLE_MATCHERS.ghosted = /interest|ghost/` in
`_store.js` (also mirrored in `roleForStageName`, `seed-stages.js`, and
`_plStageBot`). So GHL names like "Interested" still resolve to role `ghosted`.
If you ever "clean up" those mirror values, you must confirm the real GHL stage
name too, or name-based reconciliation breaks. The unrelated `not_interested`
**trigger** is a different concept and was left untouched.

Related: [[project_pipeline_offghl]] · [[project_sales_focus_mode]] ·
[[project_rearm_sweep]] · [[project_entry_point_routing]] · `docs/core-handoff/sales-flow.md`.
