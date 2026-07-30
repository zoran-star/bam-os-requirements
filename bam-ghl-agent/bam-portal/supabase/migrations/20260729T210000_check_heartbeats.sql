-- Durable "when did this check last run, and what did it say".
--
-- ✅ APPLIED to prod 2026-07-29 (mcp apply_migration, name: check_heartbeats),
-- orchestrator gate cleared. Verified by querying production afterwards rather
-- than trusting the success flag: 6 columns with the intended types, RLS
-- enabled, exactly ONE policy (SELECT, staff-only), 1 trigger, 0 rows. The
-- forge-resistance claim was verified by EXECUTION, not by reading the policy
-- list: an insert as role `authenticated` fails with insufficient_privilege.
--
-- WHY IT EXISTS (AUTOMATION TEMPLATING II, 2026-07-29): the testimonial drift
-- reconciler runs on a schedule and alerts only on failure, which means SILENCE
-- IS NOT A PASS - a dead cron and a clean estate produce identical observable
-- output: nothing. Roughly 33-34 crons in vercel.json (two rooms counted
-- differently on different refs) with nothing watching whether ANY of them ran.
-- Recount before quoting a number; the point is that the count is unwatched. This exists so the testimonial check is not the 35th.
--
-- It is the same reasoning as `clients.google_rating_checked_at` one level up: a
-- fetched fact that looks current and may be days dead needs its timestamp
-- carried with it, so staleness can be a condition instead of an assumption.
--
-- ⚠️ WHAT THIS HONESTLY DOES NOT SOLVE. A PERMANENTLY dead cron still cannot
-- alert about itself - nothing inside a check can detect the check not running.
-- What this buys is that the state becomes DISCOVERABLE rather than invisible:
--   • a resumed-after-gap run sees the stale heartbeat and alerts about the gap
--   • anything else (a person, a staff view, a future fleet watchdog) can ask
--     "when did this last run" with one query and get a real answer
-- A permanently dead cron is detected by someone READING this row, not by the
-- row itself. Do not describe this table as cron monitoring; it is the
-- precondition for cron monitoring.
--
-- Deliberately keyed by an arbitrary `check_key` rather than being testimonial-
-- specific, so it generalises if a real fleet watchdog is ever built - but
-- building that watchdog is explicitly NOT claimed here and remains unowned.

create table if not exists public.check_heartbeats (
  -- Stable identifier for the check, e.g. 'testimonial-drift'. One row per
  -- check: this records CURRENT state, not history.
  check_key   text primary key,
  -- When the check last completed a real run. The load-bearing column.
  checked_at  timestamptz not null,
  -- What it concluded on that run. NOT "is everything fine now" - it is as
  -- stale as checked_at, which is the entire point of storing them together.
  ok          boolean not null,
  -- Verdict payload (counts, failure lines). Shape belongs to the writer.
  detail      jsonb,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

comment on table public.check_heartbeats is
  'Last-run state per automated check. Makes a silently dead schedule DISCOVERABLE - it does not monitor crons by itself; something must read it.';
comment on column public.check_heartbeats.checked_at is
  'When the check last actually ran. A verdict is only as current as this. Treat an old timestamp as an unknown state, never as a pass.';
comment on column public.check_heartbeats.ok is
  'The verdict AS OF checked_at. Reading it without reading checked_at is the mistake this table exists to prevent.';

create or replace function public.touch_check_heartbeats_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

drop trigger if exists trg_check_heartbeats_updated_at on public.check_heartbeats;
create trigger trg_check_heartbeats_updated_at
  before update on public.check_heartbeats
  for each row execute function public.touch_check_heartbeats_updated_at();

-- RLS: staff read it, only the service role writes it. An academy has no
-- business seeing internal check state, and nothing client-facing writes here.
alter table public.check_heartbeats enable row level security;

drop policy if exists check_heartbeats_staff_read on public.check_heartbeats;
create policy check_heartbeats_staff_read on public.check_heartbeats
  for select to authenticated
  using (public.is_staff());

-- No insert/update/delete policy for `authenticated` ON PURPOSE: writes come
-- from the service role only, which bypasses RLS. A check whose own heartbeat
-- could be forged by a client would be worse than no heartbeat.
