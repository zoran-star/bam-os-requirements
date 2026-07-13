-- Richer training signal on every teach-why lesson + a KPI ledger for the
-- /consolidate-lessons skill.
--
-- Part 1 - agent_lessons gets three columns so a lesson snapshots the FULL
-- context that birthed it, not just the proposed/edited message pair. Today a
-- teach-why row only stores context.{suggested,sent}; the conversation that
-- prompted the correction and the pipeline movement around it are dropped, even
-- though both are available at capture time. Consolidation (and future agent
-- retraining) is only as good as the signal we keep, so keep it.
--   thread_snapshot - the conversation tail (last few messages) at capture time
--   stage_from      - the pipeline stage the lead was in when taught
--   stage_to        - the stage they were moved to, when the teach came with a
--                     move/book/lost action (NULL for a plain reply correction)
-- All three are additive + nullable: existing rows and any capture path that
-- can't supply them keep working unchanged.
alter table public.agent_lessons
  add column if not exists thread_snapshot text,
  add column if not exists stage_from      text,
  add column if not exists stage_to        text;

comment on column public.agent_lessons.thread_snapshot is
  'Conversation tail (last few messages) at the moment this lesson was taught - the training context behind the correction. NULL when no thread was available (proactive openers).';
comment on column public.agent_lessons.stage_from is
  'Pipeline stage the lead was in when this lesson was taught (Responded | Scheduled Trial | Done Trial ...). Derived from the agent at capture time.';
comment on column public.agent_lessons.stage_to is
  'Stage the lead was moved to when the teach-why came with a move/book/lost action. NULL for a plain reply correction (no movement).';

-- Part 2 - one row per /consolidate-lessons APPLY run. The apply script writes it
-- automatically so we can track the consolidation loop as a KPI over time:
-- lessons consolidated per week, academy vs general split, archive rate, and how
-- many onboarding-intake candidates each run mines. client_id is NULL for a
-- cross-academy general-only run; set for a single-academy run.
create table if not exists public.consolidation_runs (
  id             uuid primary key default gen_random_uuid(),
  client_id      uuid references public.clients(id) on delete set null,
  ran_by         text,
  raw_count      int   not null default 0,   -- active raw lessons that went into the run
  academy_out    int   not null default 0,   -- consolidated academy lessons written
  general_out    int   not null default 0,   -- consolidated general (shared-brain) lessons written
  brain_facts    int   not null default 0,   -- lessons routed out to fact/brain sections
  archived       int   not null default 0,   -- raw/replaced rows deactivated
  candidates_new int   not null default 0,   -- onboarding-intake candidates minted this run
  by_agent       jsonb not null default '{}'::jsonb,  -- per-agent breakdown {booking:{raw,academy,general},...}
  notes          text,
  created_at     timestamptz not null default now()
);
create index if not exists consolidation_runs_client_idx
  on public.consolidation_runs (client_id, created_at desc);
create index if not exists consolidation_runs_created_idx
  on public.consolidation_runs (created_at desc);

alter table public.consolidation_runs enable row level security;
create policy consolidation_runs_select on public.consolidation_runs
  for select using (is_staff());
create policy consolidation_runs_write on public.consolidation_runs
  for all using (is_staff()) with check (is_staff());

comment on table public.consolidation_runs is
  'KPI ledger for the /consolidate-lessons skill: one row per apply run (per academy, or NULL client for a cross-academy general pass). Written by scripts/lessons-io.mjs apply.';
