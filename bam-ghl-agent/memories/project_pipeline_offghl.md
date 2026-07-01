# Pipeline off GHL (opportunity store) — BAM GTA

**Migrating the sales pipeline (opportunities/stages) off GoHighLevel onto the
portal `opportunities` store**, per-academy via `clients.pipeline_provider`
('ghl' default | 'portal') + `clients.pipeline_shadow` (dual-write toggle).
GTA is `pipeline_provider='portal'`, `pipeline_shadow=true`.

## The provider seam (all in api/agent/_store.js — proven, tested)
- `moveStage` / `setStatus` / `findOpenOpp` / `queueOpps` / `createOpp` — each reads
  `pipelineFlags(clientId)` once, then branches:
  - **provider='ghl'** (every other academy): the EXACT GHL call it did before
    (+ `shadowMirrorMove` when shadow on). Byte-identical.
  - **provider='portal'** (GTA): operate on the `opportunities` table, NO GHL call.
    Row selected by `oppRefFilter` — prefers `oppRef.id`, falls back to `ghl_opportunity_id`.
- `buildPortalBoard(clientId)` — the board READ for provider='portal' (api/ghl/pipelines.js
  line ~533 branches to it). Reads `opportunities` + `pipeline_stages`, emits GHL-shaped JSON.

## What was already done (a prior session)
- Board READS → store (buildPortalBoard). ✅
- Manual card drag-drop + status close (pipelines.js POST → moveStage/setStatus). ✅
- The store + `pipeline_stages` (5 roles) + shadow mirror/backfill infra. ✅
- 24 real opps mirrored into the store (have `ghl_opportunity_id`).

## What I did 2026-07-01 — WRITES cutover (PR pending)
Migrated every remaining direct `ghl PUT /opportunities/{id}` (stage move + status
lost/abandoned) in the AGENT + AUTOMATION paths to the provider-aware
`moveStage`/`setStatus`. These bypassed the seam and dual-wrote GHL on every
AI/automation-driven move. Sites (14 + 1):
- `api/agent-approvals.js` ×5 (nurture move, lost, abandoned, scheduled_trial, interested)
- `api/agent-confirm.js` ×3 (responded bounce, nurture, lost)
- `api/agent-closing.js` ×2 (nurture, lost)
- `api/automations.js` ×4 (ghosted roll, nurture roll, ×2 exhausted-lost)
- `api/website/leads.js` ×1 (`placeOpportunity` existing-opp move; clientId-gated, raw-PUT fallback kept)
Removed the now-redundant separate `shadowMirrorMove` calls (moveStage/setStatus mirror
internally on the ghl branch). V1-safe: provider='ghl' + shadow=false → identical PUT, no mirror.
Opp CREATION already goes through provider-aware `createOpp` (website/leads.js:264).

## STILL ON GHL — the find-opp READS (next step)
The agent/automation/leads paths still LOCATE the opp via `ghl GET /opportunities/search`
(by contact_id) before the (now portal) write. Two consequences:
1. GTA still calls GHL once per pipeline action (a read).
2. **Portal-native opps (no `ghl_opportunity_id`) are INVISIBLE to these paths** — the GHL
   search can't find them, so agents/automations skip them. Found 8 such open opps for GTA
   on 2026-07-01 (test dupes: Michael ×4, Yvette ×2, Monica ×2). New provider='portal' opps
   are all portal-native, so this must be fixed for the cutover to be complete.
Fix: replace the find-opp searches with the provider-aware `findOpenOpp` (returns an oppRef),
and thread the oppRef OBJECT into moveStage/setStatus (NOT `{ghlOpportunityId: oppId}` — for a
portal-native row oppRefFilter must match on `id`). Variants to reconcile: agent-confirm.js /
agent-closing.js have a LOCAL `findOpenOpp(token,locationId,contactId)→id string`; automations.js
has a local `findOpenOppId(...)→id`; agent-approvals.js has 4 inline GHL searches.

## Also still on GHL for the pipeline layer (deferred, Zoran's call)
- **KPIs** (api/kpis-v15.js) and **calendars/booking** (api/ghl/calendars-v15.js) still read GHL
  ("we'll worry about kpi's and calendars later" — 2026-07-01).
- **Contact tags** (unqualified flips, api/agent/_tags.js) still write GHL contact tags.
