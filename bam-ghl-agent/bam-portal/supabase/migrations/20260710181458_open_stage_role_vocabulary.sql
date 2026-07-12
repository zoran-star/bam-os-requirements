-- Pipeline Presets — Phase 1: open the stage-role vocabulary.
--
-- Presets are authored in CODE (Zoran, 2026-07-10) and may introduce new stage
-- roles beyond the free-trial set — e.g. the discovery-call preset adds
-- 'discovery_call_booked'. Today three objects hard-reject any role outside a
-- fixed list, so a new preset literally cannot be stamped:
--   1. pipeline_stages.role      — 7-value CHECK
--   2. opportunities.stage_role  — 7-value CHECK
--   3. stage_transitions.from_stage_role / to_stage_role — the `stage_role` ENUM
--
-- This migration replaces the closed vocabularies with OPEN text + a soft format
-- check (lowercase snake_case), and drops the now-unused enum. The code registry
-- is the real source of truth for which roles are valid per preset.
--
-- WIDENING ONLY. Every existing value stays valid (verified: all rows are
-- lowercase snake_case) and no data is rewritten. Dormant until a code preset
-- uses a new role — the free-trial flow behaves byte-identically. V2-only
-- (V1/V1.5 academies stay pipeline_provider='ghl' and never read these tables).
-- Design: docs/core-handoff/pipeline-presets.md · bam-ghl-agent/docs/agent-preset-architecture.html

-- Shared format: a role key is lowercase, starts with a letter, snake_case.
-- Keeps garbage out ('Responded', '', 'a b') while allowing any new preset role.

-- 1. pipeline_stages.role -----------------------------------------------------
alter table public.pipeline_stages drop constraint if exists pipeline_stages_role_check;
do $$ begin
  alter table public.pipeline_stages
    add constraint pipeline_stages_role_fmt check (role ~ '^[a-z][a-z0-9_]*$');
exception when duplicate_object then null; end $$;

-- 2. opportunities.stage_role -------------------------------------------------
alter table public.opportunities drop constraint if exists opportunities_stage_role_check;
do $$ begin
  alter table public.opportunities
    add constraint opportunities_stage_role_fmt check (stage_role ~ '^[a-z][a-z0-9_]*$');
exception when duplicate_object then null; end $$;

-- 3. stage_transitions: enum -> text -----------------------------------------
-- ALTER ... TYPE text rebuilds the dependent unique constraint + index
-- automatically. Both columns are nullable (null = external entry / terminal
-- destination), so the format check tolerates null.
alter table public.stage_transitions
  alter column from_stage_role type text using from_stage_role::text,
  alter column to_stage_role   type text using to_stage_role::text;
do $$ begin
  alter table public.stage_transitions
    add constraint stage_transitions_role_fmt check (
      (from_stage_role is null or from_stage_role ~ '^[a-z][a-z0-9_]*$') and
      (to_stage_role   is null or to_stage_role   ~ '^[a-z][a-z0-9_]*$')
    );
exception when duplicate_object then null; end $$;

-- The stage_role enum is now unreferenced (verified: only the two columns above
-- used it; seed_default_stage_transitions inserts text literals, no type dep).
drop type if exists stage_role;

comment on constraint pipeline_stages_role_fmt on public.pipeline_stages is
  'Open stage-role vocabulary (Phase 1). Any lowercase snake_case role is allowed; the code preset registry is the source of truth for which roles are valid.';
