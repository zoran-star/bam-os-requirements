-- Automation engine outage fix (2026-07-10, applied live via MCP the same day).
--
-- The dedupe unique index on automation_jobs was PARTIAL:
--   create unique index automation_jobs_dedupe on automation_jobs (dedupe_key)
--     where dedupe_key is not null;
-- PostgREST's on_conflict=dedupe_key emits plain ON CONFLICT (dedupe_key), which
-- Postgres cannot match to a partial index (error 42P10). Every job insert from
-- scheduleStepJob (api/automations.js) failed, the silent catch swallowed it,
-- and the engine stopped queueing (~Jul 3): 23 enrollments sat "active" with
-- zero pending jobs - Ghosted / intro / onboarding / nurture all frozen.
--
-- Fix: a plain UNIQUE constraint. Postgres treats NULLs as distinct in unique
-- constraints, so nullable dedupe_key behaves identically while giving
-- ON CONFLICT a valid arbiter. The stalled enrollments were backfilled with
-- their missing step jobs at apply time (one-off data fix, not repeated here).

drop index if exists automation_jobs_dedupe;
alter table automation_jobs add constraint automation_jobs_dedupe unique (dedupe_key);
