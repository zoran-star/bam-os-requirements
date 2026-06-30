# Portal-native pipeline store (off-GHL pipeline cutover)

**2026-06-30: BAM GTA IS LIVE on the portal-native pipeline. `pipeline_provider='portal'`, fully off GHL for pipeline movement.** Sibling of [[project_twilio_messaging_spine]] (messaging also went off GHL same day, in a separate chat). Calendars + Instagram DMs are still on GHL (out of scope here). This note = pipeline/opportunity movement only.

## Current live state (GTA, client_id 39875f07-0a4b-4429-a201-2249bc1f24df)
- `pipeline_provider='portal'`, `pipeline_shadow=true` (shadow left on as a GHL safety net post-flip; harmless).
- Backfill on 2026-06-30 seeded **5 stage rows + 24 open opps** (scheduled_trial 11, interested 7, done_trial 4, responded 2) straight from the live GHL board read.
- Rollback is instant + always allowed: `update clients set pipeline_provider='ghl' where business_name='BAM GTA';` (or cutover panel `flip` action=ghl).

## The toggle
- `clients.pipeline_provider` ('ghl' | 'portal'). Other academies still 'ghl'.
- `clients.pipeline_shadow` (bool) - dual-write flag: on 'ghl'+shadow, every opp write ALSO mirrors into the store (reconcile before flip). The board GET fires `shadowBackfillFromBoard` when shadow on = seeds the stage registry + mirrors open opps, ZERO extra GHL calls.
- Store tables: `opportunities` + `pipeline_stages` (migration `20260629170000`); flags (`20260629180000`). Both live on prod.

## The seam - `api/agent/_store.js` (the one place that branches portal vs GHL)
6 provider-aware opportunity functions (options-bag, each reads `pipelineFlags(clientId)` once):
`createOpp / moveStage / setStatus / findOpenOpp / queueOpps / contactInRole`.
`oppRef` = `{ ghlOpportunityId }` on GHL, `{ id, ghlOpportunityId? }` on portal. Reuses `resolveStage`, `pipelineFlags`, `shadowMirrorMove`, `shadowBackfillFromBoard`, `buildPortalBoard`.
**Byte-identical guarantee:** on provider='ghl' the branches replicate today's exact GHL calls (or bypass search by passing the known oppId). `findOpenOpp` GHL branch = `find(open) || opps[0]` (matches Stripe's old pick); do NOT use it where strict open-only is required (the inbound webhook finds stay raw on purpose).

`api/agent/_stage.js` queue helpers + finders take an OPTIONAL trailing `ctx = { clientId, sb }`. No ctx / provider='ghl' = byte-identical GHL. The `/conversations/search` last-message join is LEFT on GHL (that is the messaging effort, separate).

## All pipeline opp writes are now provider-aware (PRs, all merged)
- **#938 (A):** the `_store.js` opp layer + `_stage.js` ctx param.
- **#939 (B):** threaded `ctx` into 34 queue/finder call sites (`agent-approvals/confirm/closing/followups.js`, `automations.js`).
- **#942 (C):** `website/leads.js` opp CREATE -> `createOpp` (reuses loaded `client.id`); `ghl/pipelines.js` hand-marked status PATCH -> `moveStage`/`setStatus`.
- **#941 (D):** `stripe/webhook.js` won -> `findOpenOpp`+`setStatus('won')`; `ghl/inbound-webhook.js` + `twilio/inbound-webhook.js` reply->Responded & appointment->Scheduled-Trial -> `moveStage` (finds kept RAW open-only to keep the won-member guard); `ghl/post-trial.js` no-show->Interested & good-fit->Done-Trial -> `moveStage`.
- **#948:** raw drag-drop board move -> `moveStage`. **#950:** summer-special enroll Interested move -> `moveStage`.
- **#949:** cutover-panel flip guard hardened - refuses portal flip when GHL has open opps but the store is empty (`store_unpopulated`), closing the false-clean (0 stage rows = 0 drift = false green) hole. force overrides.
- **VERIFIED:** zero raw `ghl("PUT"|"POST", /opportunities...)` remain in pipelines.js / leads.js / stripe/webhook.js / inbound-webhook.js (ghl+twilio) / post-trial.js. The only GHL opp calls left live inside `_store.js`, gated on provider='ghl'.

## Cutover runbook (EXECUTED for GTA; reuse per academy)
Panel `api/admin/pipeline-cutover.js` (staff-JWT only): actions status/reconcile/set-shadow/flip.
1. `set-shadow on`. 2. Open the academy's Pipelines board once (fires backfill - seeds stages + mirrors opps). 3. `reconcile` -> want `clean` AND `mapped>0`. 4. (optional) soak. 5. reconcile again. 6. `flip` to portal (guard: shadow-on + populated + reconcile-clean; force overrides). Rollback to ghl is instant + always allowed. V1 academies untouched.
GOTCHA: the board GET + cutover panel both require a staff Supabase JWT, so the backfill step must be done from a logged-in portal session (owner loads the board). GTA flip on 2026-06-30 was done via direct SQL (set-shadow + flip) AFTER the owner loaded the board to trigger the backfill - because Claude has DB/service access but not a staff JWT.

## NEXT CHAT (planned): scan remaining GHL reliance
Pipeline (this chat) + messaging ([[project_twilio_messaging_spine]], other chat) are now BOTH off GHL. Next: a full scan of what STILL depends on GHL, **EXCLUDING calendars and Instagram DMs** (those stay for now). Likely suspects to map + plan retirement: contact/identity store (`ghl_contacts` mirror, custom fields, athlete-name field), tags, notes, any remaining workflow enrollments still poked, `ghl_pipeline_cache`, OAuth token plumbing (`ghl_access_token`/refresh), custom values. Deliverable = a dependency map + retire plan.
