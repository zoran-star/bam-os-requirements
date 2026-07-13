---
name: consolidate-lessons-fleet-kpi
description: 2026-07-12 /consolidate-lessons extended - fleet scan triage, agent_lessons training-signal columns (thread_snapshot/stage_from/stage_to), consolidation_runs KPI table
type: project
---

# /consolidate-lessons - fleet triage + richer signal + KPI ledger (2026-07-12)

Extended the existing [[project_hawkeye_mission_control]] training loop. The skill
(`.claude/commands/consolidate-lessons.md`) + its I/O script
(`bam-portal/scripts/lessons-io.mjs`) already clustered raw teach-why lessons and
mined onboarding-intake gaps. Three additions:

1. **Fleet triage - `node scripts/lessons-io.mjs scan`** (new command). Reads every
   academy's active pile at once, prints raw-lesson count per agent, flags any
   academy **DUE** (15+ raw on a single agent), and summarises the shared general
   set. Writes `lessons-scan.json`. "Raw" = active + `created_by != 'consolidate-skill'`
   + `kind != 'good'`. Still consolidate ONE academy at a time after triage (dump
   requires a clientId on purpose). Query uses `&limit=100000` to avoid a silent
   PostgREST default-cap truncation across the whole fleet.

2. **Training-signal columns on `agent_lessons`** (migration
   `20260712190000_lesson_training_signal.sql`): `thread_snapshot` (convo tail when
   the lesson was taught), `stage_from` (pipeline stage the lead was in), `stage_to`
   (where a move sent them - null on plain send/reignite today, reserved for a
   future move+teach flow). Populated BACKEND-side at the 5 lesson-insert points in
   `agent-approvals.js` (booking, x3: held send / normal send / reignite),
   `agent-confirm.js` (x1 reignite), `agent-closing.js` (x1 reignite). Each file has
   a `threadSnapshot(row)` helper + a `LESSON_STAGE_FROM` const (Responded /
   Scheduled Trial / Done Trial); booking also has `readyThread(readyId, clientId)`
   which reads `thread_tail`/`summary` off the ready row. **No client-portal.html /
   frontend change** - stages are values the backend already owns, thread comes from
   the ready row. Additive + nullable; older rows stay null.

3. **`consolidation_runs` KPI table** (same migration): one timestamped row per apply
   run, auto-written by `lessons-io.mjs apply` (best-effort, never fails the apply;
   skipped on `--archive-only` recovery). Columns: client_id (null = cross-academy
   general run), ran_by, raw_count, academy_out, general_out, brain_facts, archived,
   candidates_new, by_agent jsonb, notes. plan.json can carry optional `ran_by /
   raw_count / brain_facts / candidates_new / by_agent / notes` to enrich it; else
   counts derive from the arrays. This closes the "ledger needs a timestamp for KPI
   tracking" gap - lessons/week + academy-vs-general split are now queryable.

**Applied to prod DB 2026-07-12** (linked project `jnojmfmpnsfmtqmwhopz`, via Supabase
MCP): 3 columns + `consolidation_runs` + RLS live, and `schema_migrations` has a row
recorded under the exact file version `20260712190000` so a future `supabase db push`
sees no drift (see `bam-portal/supabase/README.md`). Ships to code via PR #1388
(`claude/epic-fermat-73e3d9` -> main). Migration was applied BEFORE merge on purpose:
the backend capture code references the new columns, so they had to exist first or
teach-why inserts would silently fail. Aggregation logic unit-checked with a mock
harness (scan grouping + apply by_agent) before commit.
