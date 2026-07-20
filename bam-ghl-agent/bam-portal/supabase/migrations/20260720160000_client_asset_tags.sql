-- Content Library: free-text "extra tags" on any asset (Track 2 / P1 follow-up,
-- Zoran 2026-07-20). Complements the structured taxonomy - available for every
-- content_type (action/coaching/culture/testimonial/other). Additive.
create table if not exists public.client_asset_tags (
  asset_id   uuid not null references public.client_assets(id) on delete cascade,
  client_id  uuid not null references public.clients(id) on delete cascade,
  tag        text not null,
  created_at timestamptz not null default now(),
  primary key (asset_id, tag)
);
create index if not exists client_asset_tags_search_idx
  on public.client_asset_tags(client_id, tag);

comment on table public.client_asset_tags is
  'Free-text keyword tags on Content Library assets. Any content_type. Distinct from client_asset_skills (basketball skill presets).';

alter table public.client_asset_tags enable row level security;
create policy cat_staff_all on public.client_asset_tags
  for all using (is_staff()) with check (is_staff());
create policy cat_client_select on public.client_asset_tags
  for select using (client_id in (select my_client_ids()));
create policy cat_client_insert on public.client_asset_tags
  for insert with check (
    client_id in (select my_client_ids())
    and exists (select 1 from public.client_assets a
                where a.id = asset_id and a.client_id = client_asset_tags.client_id
                  and coalesce(a.source,'manual') <> 'ticket'));
create policy cat_client_delete on public.client_asset_tags
  for delete using (
    client_id in (select my_client_ids())
    and exists (select 1 from public.client_assets a
                where a.id = asset_id and coalesce(a.source,'manual') <> 'ticket'));
