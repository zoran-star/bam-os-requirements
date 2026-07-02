-- KPI event log ("the real KPIs") - one row per funnel moment, written
-- portal-native at the instant it happens (Track A of the KPIs-off-GHL plan):
--   lead            form submit                    (api/website/leads.js)
--   trial_booked    card moved to Scheduled Trial  (api/agent/_store.js moveStage)
--   trial_attended  coach post-trial: showed up    (api/ghl/post-trial.js)
--   trial_no_show   coach post-trial: no-show      (api/ghl/post-trial.js)
--   joined          payment -> member won          (api/stripe/webhook.js)
--   cancelled       Stripe cancel / staff manual   (api/stripe/webhook.js, kpis-v15)
-- The KPI sandbox (Track B) imports approved historical rows into THIS table
-- with source='ghl-import', so live + history share one shape and one query.
create table if not exists public.kpi_events (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  offer_id uuid references public.offers(id) on delete set null,
  step text not null check (step in ('lead','trial_booked','trial_attended','trial_no_show','joined','cancelled')),
  ghl_contact_id text,                 -- the system-wide contact join key (may be a portal-minted uuid)
  contact_name text,
  occurred_at timestamptz not null default now(),
  source text not null default 'live', -- live | ghl-import | manual
  ref text,                            -- idempotency key per step (see writers)
  meta jsonb,
  created_at timestamptz not null default now()
);
create unique index if not exists kpi_events_uniq on public.kpi_events (client_id, step, ref) where ref is not null;
create index if not exists kpi_events_client_time on public.kpi_events (client_id, occurred_at);
create index if not exists kpi_events_client_step_time on public.kpi_events (client_id, step, occurred_at);
alter table public.kpi_events enable row level security;
drop policy if exists kpi_events_read on public.kpi_events;
create policy kpi_events_read on public.kpi_events
  for select using (is_staff() or client_id in (select my_client_ids()));
drop policy if exists kpi_events_write on public.kpi_events;
create policy kpi_events_write on public.kpi_events
  for all using (is_staff()) with check (is_staff());;
