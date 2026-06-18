-- V1.5-only onboarding steps: map athlete-name field + connect KPIs.
alter table public.clients add column if not exists athlete_map_done_at timestamptz;
alter table public.clients add column if not exists kpi_setup_done_at timestamptz;
