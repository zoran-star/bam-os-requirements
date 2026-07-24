-- Phase 3 tail (2026-07-24): delete the per-academy stage_transitions COPIES.
--
-- Since the Phase 1 flip (2026-07-23) the router reads the flow graph from the
-- code MASTER (api/agent/presets.js via preset-master.js). These rows were kept
-- only as the emergency DB fallback. Verified before deleting: all 46 rows were
-- is_seed=true AND enabled=true - byte-identical duplicates of the master, with
-- ZERO academy pause overrides and ZERO hand-authored edges.
--
-- GUARDED ON PURPOSE: deletes only is_seed=true AND enabled=true. An academy's
-- pause override (enabled=false) and any hand-authored edge (is_seed=false)
-- would survive this migration untouched - pause is tier-2 operational control
-- and must never be wiped by a cleanup.
--
-- Recovery: bam-portal/supabase/restore/stage_transitions_backup_20260724.sql
-- re-inserts the exact rows (then set PRESET_EDGE_SOURCE=db + redeploy).
delete from public.stage_transitions
 where is_seed = true
   and enabled = true;
