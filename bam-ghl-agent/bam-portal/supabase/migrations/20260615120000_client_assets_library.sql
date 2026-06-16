-- Per-academy asset library: one row per uploaded image, optionally tagged to an
-- offer / staff member / location. Powers the client portal "Assets" tab and the
-- website /api/website/assets endpoint. (Applied via MCP 2026-06-15.)
insert into storage.buckets (id, name, public)
  values ('client-assets', 'client-assets', true) on conflict (id) do nothing;

create table if not exists public.client_assets (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  label text, category text not null default 'other', alt text,
  storage_path text not null, mime_type text, size_bytes bigint, width int, height int,
  offer_id uuid references public.offers(id) on delete set null,
  staff_id uuid references public.client_users(id) on delete set null,
  location_id uuid references public.locations(id) on delete set null,
  sort_order int not null default 0, uploaded_by uuid,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index if not exists client_assets_client_idx on public.client_assets(client_id);
create index if not exists client_assets_offer_idx on public.client_assets(offer_id);
create index if not exists client_assets_staff_idx on public.client_assets(staff_id);
create index if not exists client_assets_location_idx on public.client_assets(location_id);
alter table public.client_assets enable row level security;
create policy client_assets_select on public.client_assets for select using (is_staff() or client_id in (select my_client_ids()));
create policy client_assets_insert on public.client_assets for insert with check (is_staff() or client_id in (select my_client_ids()));
create policy client_assets_update on public.client_assets for update using (is_staff() or client_id in (select my_client_ids())) with check (is_staff() or client_id in (select my_client_ids()));
create policy client_assets_delete on public.client_assets for delete using (is_staff() or client_id in (select my_client_ids()));
create policy client_assets_storage_select_all on storage.objects for select using (bucket_id = 'client-assets');
create policy client_assets_storage_client_insert on storage.objects for insert with check (bucket_id = 'client-assets' and ((split_part(name,'/',1)::uuid in (select my_client_ids())) or is_staff()));
create policy client_assets_storage_client_update on storage.objects for update using (bucket_id = 'client-assets' and ((split_part(name,'/',1)::uuid in (select my_client_ids())) or is_staff())) with check (bucket_id = 'client-assets' and ((split_part(name,'/',1)::uuid in (select my_client_ids())) or is_staff()));
create policy client_assets_storage_client_delete on storage.objects for delete using (bucket_id = 'client-assets' and ((split_part(name,'/',1)::uuid in (select my_client_ids())) or is_staff()));
