alter table public.clients
  add column if not exists ghl_kpi_config jsonb;

comment on column public.clients.ghl_kpi_config is
  'Staff-confirmed GHL funnel wiring (lead forms, trial calendar, etc.) for the KPI dashboard. NULL = not configured.';;
