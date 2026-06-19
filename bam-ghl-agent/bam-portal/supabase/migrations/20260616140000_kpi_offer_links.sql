-- KPIs Setup (V1.5): tie Stripe products + GHL pipelines to an offer, for
-- attribution in the Sales/Revenue/Members KPI sections. Distinct from
-- pricing_catalog (which routes checkout); this is purely for KPI grouping.
create table if not exists public.kpi_offer_links (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  offer_id uuid references public.offers(id) on delete cascade,
  kind text not null check (kind in ('stripe_product','ghl_pipeline')),
  ref_id text not null,           -- stripe product id (prod_...) or ghl pipeline id
  label text,                     -- snapshot of the product/pipeline name
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (client_id, kind, ref_id)
);

create index if not exists kpi_offer_links_client_idx on public.kpi_offer_links(client_id);
create index if not exists kpi_offer_links_offer_idx on public.kpi_offer_links(offer_id);

alter table public.kpi_offer_links enable row level security;

drop policy if exists kpi_offer_links_read on public.kpi_offer_links;
create policy kpi_offer_links_read on public.kpi_offer_links
  for select using (is_staff() or client_id in (select my_client_ids()));

drop policy if exists kpi_offer_links_write on public.kpi_offer_links;
create policy kpi_offer_links_write on public.kpi_offer_links
  for all using (is_staff()) with check (is_staff());
