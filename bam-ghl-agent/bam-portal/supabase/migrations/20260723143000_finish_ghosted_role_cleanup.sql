-- Finish the interested -> ghosted role cutover (Phase 0, 2026-07-23).
--
-- Migration 20260721150552 renamed the role, but the CODE kept authoring
-- 'interested' until the deploy that ships with this cleanup - so every stamp /
-- self-seed after 2026-07-21 re-created the old key. Left behind:
--   BAM GTA      - an orphan duplicate 'interested' stage row (0 opps, 0 edges,
--                  same ghl_stage_id as its real 'ghosted' row)
--   BAM San Jose - a full 'interested' stage stamped after the rename, now
--                  carrying live leads
-- Run AFTER the code deploy, never before, or it simply re-drifts.
--
-- Step 1 must precede step 2: pipeline_stages is unique on (client_id, role), so
-- renaming GTA's orphan would collide with the 'ghosted' row it already has.
-- Both steps are guarded + idempotent - safe to re-run, and a second run is a no-op.

-- 1. Drop duplicate 'interested' rows ONLY where the client already has a
--    'ghosted' row and nothing points at the duplicate.
delete from public.pipeline_stages i
 where i.role = 'interested'
   and exists (select 1 from public.pipeline_stages g
                where g.client_id = i.client_id and g.role = 'ghosted')
   and not exists (select 1 from public.opportunities o where o.stage_id = i.id);

-- 2. Rename what remains (same body as 20260721150552).
update public.pipeline_stages
   set role = 'ghosted', label = coalesce(label, 'Ghosted')
 where role = 'interested';

update public.opportunities
   set stage_role = 'ghosted'
 where stage_role = 'interested';

update public.stage_transitions
   set from_stage_role = 'ghosted'
 where from_stage_role = 'interested';

update public.stage_transitions
   set to_stage_role = 'ghosted'
 where to_stage_role = 'interested';
