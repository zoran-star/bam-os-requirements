# Portal-native pipeline store (off-GHL pipeline cutover)

**2026-06-30: the sales pipeline write+read+queue path is now fully provider-aware and code-complete off GHL. DORMANT until a client is flipped.** Sibling of [[project_twilio_messaging_spine]] (same per-academy provider-toggle, own-store, dormant pattern). Messaging + calendars are SEPARATE efforts (other chats) - this note is pipeline/opportunity movement only.

## The toggle
- `clients.pipeline_provider` ('ghl' | 'portal') - all clients on 'ghl' today.
- `clients.pipeline_shadow` (bool) - dual-write flag: on 'ghl' + shadow=true, every opp write ALSO mirrors into the store so we can reconcile before flipping.
- Store tables: `opportunities` + `pipeline_stages` (migration `20260629170000_pipeline_store_foundation.sql`); flags (migration `20260629180000_pipeline_shadow_flag.sql`).

## The seam — `api/agent/_store.js` (the one place that branches portal vs GHL)
6 provider-aware opportunity functions (options-bag, each reads `pipelineFlags(clientId)` once):
`createOpp / moveStage / setStatus / findOpenOpp / queueOpps / contactInRole`.
`oppRef` = `{ ghlOpportunityId }` on GHL, `{ id, ghlOpportunityId? }` on portal.
Plus existing helpers it reuses: `resolveStage`, `pipelineFlags`, `shadowMirrorMove` (mirror is internal to moveStage/setStatus now), `buildPortalBoard`.
**Byte-identical guarantee:** provider='ghl' branches replicate today's exact GHL calls (or bypass search entirely by passing the known oppId). `findOpenOpp` GHL branch = `find(open) || opps[0]` (matches Stripe's old pick); do NOT use it where strict open-only is required.

`api/agent/_stage.js` queue helpers + finders take an OPTIONAL trailing `ctx = { clientId, sb }`. No ctx (or provider='ghl') = byte-identical GHL. The `/conversations/search` last-message join is LEFT on GHL (messaging effort).

## Call sites wired (PRs #938 A, #939 B, #942 C, #941 D — all merged)
- **B (#939):** threaded `ctx` into 34 queue/finder call sites across `agent-approvals.js`, `agent-confirm.js`, `agent-closing.js`, `agent-followups.js`, `automations.js`.
- **C (#942):** `website/leads.js` opp CREATE → `createOpp` (reuses already-loaded `client.id`); `ghl/pipelines.js` hand-marked status PATCH → `moveStage`/`setStatus`.
- **D (#941):** `stripe/webhook.js` mark-won → `findOpenOpp`+`setStatus('won')`; `ghl/inbound-webhook.js` + `twilio/inbound-webhook.js` reply→Responded & appointment→Scheduled-Trial → `moveStage` (finds kept RAW open-only to preserve the won-member guard); `ghl/post-trial.js` no-show→Interested & good-fit→Done-Trial → `moveStage`.

## Known follow-up (NOT yet wired)
- **Raw drag-drop stage move** (`ghl/pipelines.js` PATCH with `pipeline_id`+`stage_id`, no status) still hits GHL even under provider='portal'. Flagged in #942. Route it through `moveStage` before flipping any client to portal, or board drags won't persist to the store.

## Cutover runbook (OPS, not code)
1. Enable `pipeline_shadow=true` for GTA → soak (dual-write).
2. Reconcile store vs GHL board until clean (`api/admin/pipeline-cutover.js` staff panel: status/reconcile/set-shadow/flip; flip refuses unless shadow-on + reconcile-clean).
3. Wire the drag-drop follow-up above.
4. Flip `pipeline_provider='portal'`. V1 academies untouched throughout.
