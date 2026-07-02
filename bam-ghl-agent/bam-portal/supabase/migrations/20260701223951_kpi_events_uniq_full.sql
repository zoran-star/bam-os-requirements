-- Full (non-partial) unique index so PostgREST on_conflict=client_id,step,ref can
-- target it (Postgres can't infer a partial index from a plain conflict target).
-- NULL refs never conflict (nulls are distinct), so unrefd events still insert.
drop index if exists public.kpi_events_uniq;
create unique index if not exists kpi_events_uniq on public.kpi_events (client_id, step, ref);;
