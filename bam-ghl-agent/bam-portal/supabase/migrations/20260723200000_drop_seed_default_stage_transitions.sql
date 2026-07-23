-- Phase 3 cleanup (2026-07-23): drop the legacy seed_default_stage_transitions()
-- SQL function. It has been dead since applyPreset (api/agent/presets.js)
-- replaced it, was kept in sync by hand as a defensive measure, and since the
-- Phase 1 flip the router reads the flow graph straight from the code master -
-- so a function that could re-insert per-academy edge copies is now a footgun,
-- not a fallback. Existing stage_transitions ROWS are deliberately kept: they
-- are the emergency fallback (PRESET_EDGE_SOURCE=db) and the pause overlay.
drop function if exists public.seed_default_stage_transitions(uuid);
