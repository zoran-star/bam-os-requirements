-- Custom fields on MULTIPLE offers (Zoran 2026-07-09). ADDITIVE.
-- Until now a custom_field_defs row belonged to ONE offer (offer_id). A field
-- often applies to several offers (e.g. "Jersey size" on Training AND Camps),
-- so this join table lets one def attach to any number of offers. The original
-- offer_id stays as the authoring anchor (and back-compat for existing reads);
-- a def "applies to" an offer when offer_id = X OR a join row (field_id, X)
-- exists. Academy-level defs (offer_id null, no join rows) still apply to all.

create table if not exists public.custom_field_def_offers (
  field_id uuid not null references public.custom_field_defs(id) on delete cascade,
  offer_id uuid not null references public.offers(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (field_id, offer_id)
);
create index if not exists custom_field_def_offers_offer_idx
  on public.custom_field_def_offers(offer_id);
create index if not exists custom_field_def_offers_field_idx
  on public.custom_field_def_offers(field_id);

-- Backfill: every def that already names an offer gets a join row, so reads can
-- move to the join table uniformly without losing today's single-offer links.
insert into public.custom_field_def_offers (field_id, offer_id)
  select id, offer_id from public.custom_field_defs where offer_id is not null
  on conflict do nothing;

alter table public.custom_field_def_offers enable row level security;
-- Visibility follows the parent def's academy (join to custom_field_defs).
do $$ begin
  create policy custom_field_def_offers_select on public.custom_field_def_offers
    for select using (exists (
      select 1 from public.custom_field_defs d
      where d.id = custom_field_def_offers.field_id
        and (is_staff() or d.client_id in (select my_client_ids()))));
exception when duplicate_object then null; end $$;
do $$ begin
  create policy custom_field_def_offers_write on public.custom_field_def_offers
    for all using (is_staff()) with check (is_staff());
exception when duplicate_object then null; end $$;

comment on table public.custom_field_def_offers is
  'Many-to-many: a custom_field_defs row applies to these offers (beyond its authoring offer_id). Backfilled from custom_field_defs.offer_id.';
