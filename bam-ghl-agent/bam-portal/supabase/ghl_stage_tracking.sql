-- GHL stage-movement tracking.
--
-- GHL doesn't keep a stage-change history we can pull, so we record it ourselves:
-- an hourly cron (api/ghl.js?action=track-stages) snapshots every opportunity's
-- current stage and, when it differs from what we last saw, logs a transition.
-- KPIs (response rate, booking rate, trial show rate, etc.) are then computed by
-- COUNTING transitions in a date range — the real flow, not a point-in-time
-- snapshot. Tracking is forward-only (no backfill) — rates get accurate as data
-- accumulates after this is turned on.
--
-- Run once in the Supabase SQL editor (project ref jnojmfmpnsfmtqmwhopz).

-- Last-seen stage per opportunity (the snapshot the cron diffs against).
create table if not exists public.ghl_opp_state (
  location        text not null,
  opp_id          text not null,
  contact_id      text,
  pipeline_id     text,
  stage_name      text,
  canonical       text,
  monetary_value  numeric,
  source          text,
  first_seen_at   timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  primary key (location, opp_id)
);

-- Every detected stage move — this is what KPIs count.
create table if not exists public.ghl_stage_transitions (
  id              bigint generated always as identity primary key,
  location        text not null,
  opp_id          text not null,
  contact_id      text,
  from_stage      text,
  from_canonical  text,
  to_stage        text,
  to_canonical    text,
  moved_at        timestamptz not null default now()
);

create index if not exists idx_ghl_trans_loc_time   on public.ghl_stage_transitions (location, moved_at);
create index if not exists idx_ghl_trans_to_canon   on public.ghl_stage_transitions (location, to_canonical, moved_at);

-- Operational telemetry — service-role (the API) only. RLS on with no policies
-- means anon/auth clients can't read it directly; the API uses the service key.
alter table public.ghl_opp_state          enable row level security;
alter table public.ghl_stage_transitions  enable row level security;
