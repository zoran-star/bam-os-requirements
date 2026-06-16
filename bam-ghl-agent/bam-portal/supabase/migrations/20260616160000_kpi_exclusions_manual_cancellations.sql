-- V1.5 KPIs human-cleaning: per-metric/month/offer/contact exclusions (raw count
-- minus exclusions; undo = delete the row; source data untouched) + manual
-- cancellations entered by hand for the Members section.
create table if not exists public.kpi_exclusions (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  month text not null,                 -- 'YYYY-MM'
  metric text not null,                -- sales_pipeline | sales_payments | members_cancelled
  offer_id uuid references public.offers(id) on delete cascade,
  ref_id text not null,                -- excluded contact/opportunity/sub/charge id
  label text,
  reason text,
  created_at timestamptz not null default now()
);
create unique index if not exists kpi_excl_uniq on public.kpi_exclusions
  (client_id, month, metric, ref_id, coalesce(offer_id, '00000000-0000-0000-0000-000000000000'::uuid));
create index if not exists kpi_excl_client_month on public.kpi_exclusions (client_id, month);
alter table public.kpi_exclusions enable row level security;
drop policy if exists kpi_excl_read on public.kpi_exclusions;
create policy kpi_excl_read on public.kpi_exclusions
  for select using (is_staff() or client_id in (select my_client_ids()));
drop policy if exists kpi_excl_write on public.kpi_exclusions;
create policy kpi_excl_write on public.kpi_exclusions
  for all using (is_staff()) with check (is_staff());

create table if not exists public.kpi_manual_cancellations (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  month text not null,                 -- 'YYYY-MM' the cancellation counts toward
  contact_name text,
  ghl_contact_id text,
  stripe_customer_id text,
  reason text,
  cancelled_on date,
  created_at timestamptz not null default now()
);
create index if not exists kpi_mc_client_month on public.kpi_manual_cancellations (client_id, month);
alter table public.kpi_manual_cancellations enable row level security;
drop policy if exists kpi_mc_read on public.kpi_manual_cancellations;
create policy kpi_mc_read on public.kpi_manual_cancellations
  for select using (is_staff() or client_id in (select my_client_ids()));
drop policy if exists kpi_mc_write on public.kpi_manual_cancellations;
create policy kpi_mc_write on public.kpi_manual_cancellations
  for all using (is_staff()) with check (is_staff());
