-- V1.5 Pipelines: free-text reason captured when a card is marked
-- won/lost/abandoned (GHL opportunity status still updated). (Applied via MCP 2026-06-16.)
create table if not exists public.pipeline_outcomes (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  opportunity_id text not null,
  status text not null, reason text, created_by uuid,
  created_at timestamptz not null default now()
);
create index if not exists pipeline_outcomes_client_idx on public.pipeline_outcomes(client_id);
create index if not exists pipeline_outcomes_opp_idx on public.pipeline_outcomes(opportunity_id);
alter table public.pipeline_outcomes enable row level security;
create policy pipeline_outcomes_select on public.pipeline_outcomes for select using (is_staff() or client_id in (select my_client_ids()));
create policy pipeline_outcomes_write on public.pipeline_outcomes for all using (is_staff()) with check (is_staff());
