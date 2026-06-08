-- Soft-delete for KPI data cleaning.
--
-- The journey board / drill-down ✕ used to HARD delete funnel events, which a
-- later "Refresh now" would re-pull and resurrect (and the undo trash lived only
-- in browser memory, so a refresh lost it). This flag fixes both:
--   - reads (ghl-kpis / -monthly / -detail / board) filter excluded=false
--   - refreshFunnel's upsert (merge-duplicates) omits `excluded`, so a re-pull of
--     an excluded ref RETAINS excluded=true → it stays hidden
--   - the trash bin = excluded=true rows, so it survives a page refresh
--
-- Run once in the Supabase SQL editor (project ref jnojmfmpnsfmtqmwhopz) — or
-- use the /apply-sql skill. Idempotent.

alter table public.ghl_funnel_events
  add column if not exists excluded boolean not null default false,
  add column if not exists excluded_at timestamptz;

comment on column public.ghl_funnel_events.excluded is
  'Soft-delete for KPI cleaning: hidden from KPIs/board and not resurrected by re-pull (merge-duplicates omits this column so it is retained). The trash bin = excluded=true rows.';

create index if not exists idx_ghl_events_excluded
  on public.ghl_funnel_events (client_id, excluded);
