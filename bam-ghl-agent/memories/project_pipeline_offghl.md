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

## Find-opp READS cutover — DONE 2026-07-01 (2nd PR) + duplicate-bug fix
Migrated the find-opp locators from `ghl /opportunities/search` to the provider-aware
`findOpenOpp` (returns an oppRef), threading the oppRef OBJECT into moveStage/setStatus (NOT
`{ghlOpportunityId: oppId}` — for a portal-native row oppRefFilter must match on `id`). Sites:
- `agent-confirm.js` / `agent-closing.js`: local `findOpenOpp` helper made provider-aware
  (now `(clientId, token, locationId, contactId)` → oppRef; delegates to `findOpenOpp as
  findOpenOppStore`); all callers thread oppRef.
- `automations.js`: local `findOpenOppId` → `findOpenOppRef` (provider-aware, returns oppRef).
- `agent-approvals.js`: 4 inline GHL searches → `findOpenOpp({clientId,ghl,token,locationId,contactId})`.
- `website/leads.js` `placeOpportunity`: the **EXISTENCE check** (create-vs-move) was the
  DUPLICATE-BUG ROOT CAUSE — it searched GHL, never found the portal-native opp, and created a
  NEW one every intake (Michael had 4 cards, Monica/Yvette 2 each — all REAL 2026-07-01 leads,
  not test data). Now provider-aware: portal academies look in the store (findOpenOpp), so an
  existing opp is found + moved instead of duplicated. Cleaned up the 5 dup rows via SQL
  (kept each person's scheduled_trial). Every other academy keeps the exact GHL search.

## Deeper opp-find sites - DONE 2026-07-01 (3rd PR)
- `api/stripe/webhook.js` (WON on payment): kept the oppRef from findOpenOpp (was dropping
  `ref.id`), and if none resolved, looks it up by contact - portal-native members now mark won.
- `api/ghl/post-trial.js` (trial outcome -> stage): opp lookup is now provider-aware - reads the
  store `opportunities` row (by id OR ghl_opportunity_id) for portal instead of `ghl GET
  /opportunities/{id}` (which 404'd on a portal uuid); threads the oppRef into both moves.
- `api/twilio/inbound-webhook.js` + `api/resend/inbound-webhook.js` (reply -> bounce to Responded):
  provider branch - for portal reads the open opp + `stage_role` from the store (the true stage
  lives there; the GHL stage is stale) and bounces only from interested/nurture.

## The ONLY GHL touches left in the pipeline (non-breaking, not GTA writes)
- `api/ghl/post-trial.js` still READS GHL pipeline NAMES (to resolve the interested/done_trial
  stage) for BOTH providers - a read, not a write; the move goes to the store. Kept because
  passing a partial stage to `portalStageRowId` would wipe the registry's ghl_stage_id (merge with
  nulls). To fully remove: resolve the stage from the `pipeline_stages` registry by role instead.
- `api/ghl/inbound-webhook.js` (195,287): the GHL-MESSAGING inbound webhook - only fires for
  academies on GHL SMS. GTA is Twilio+Resend, so it NEVER runs for GTA. Left as-is (those
  academies are pipeline_provider='ghl' anyway).

## Net for GTA: pipeline opp WRITES are 100% off GHL (create/move/close/won across board,
## agents, automations, lead intake, post-trial, payment, inbound). Reads too, except the one
## post-trial stage-name lookup above.

## Also still on GHL for the pipeline layer (deferred, Zoran's call)
- **KPIs** (api/kpis-v15.js) and **calendars/booking** (api/ghl/calendars-v15.js) still read GHL
  ("we'll worry about kpi's and calendars later" — 2026-07-01).
- **Contact tags** (unqualified flips, api/agent/_tags.js) still write GHL contact tags.
