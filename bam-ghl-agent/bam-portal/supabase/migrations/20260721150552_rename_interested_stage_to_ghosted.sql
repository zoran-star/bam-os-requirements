-- Rename the free-trial preset's "interested" stage ROLE to "ghosted" (V2).
-- The UI already labelled this stage "Ghosted"; this aligns the internal role KEY
-- (and the live rows carrying it) with that name so code + data + label agree.
--
-- Pure data rewrite - no DDL. The open stage-role vocabulary (migration
-- 20260710181458) allows any lowercase snake_case role and 'ghosted' passes the
-- format checks, so no constraint/enum change is needed. Idempotent.
--
-- SCOPE: only the portal ROLE KEY moves. The GHL-name MIRROR columns
-- (pipeline_stages.ghl_stage_name, entry_points.stage_name, and
-- clients.ghl_kpi_config.portal_entry_routing.*_stage) intentionally KEEP
-- 'interested' - they mirror the actual GHL sub-account stage name and are bridged
-- to the new role by the ROLE_MATCHERS /interest|ghost/ regex (api/agent/_store.js).
--
-- NOTE (2026-07-23): this file was reconstructed from the live database. It was
-- applied to prod via MCP on 2026-07-21 but the .sql was never committed, so
-- local replay drifted from prod. Body is verbatim from
-- supabase_migrations.schema_migrations.

update public.pipeline_stages
   set role  = 'ghosted',
       label = coalesce(label, 'Ghosted')
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
