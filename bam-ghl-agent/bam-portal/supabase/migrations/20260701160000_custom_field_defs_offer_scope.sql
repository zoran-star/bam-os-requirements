-- Offer-scope custom fields (Custom Fields, P4b). ADDITIVE.
-- Custom questions are authored per OFFER, in the offer wizard's Sales +
-- Onboarding sections (decided 2026-07-01). A def can now belong to an offer +
-- section; academy-level defs (GHL imports, the GTA seed) leave both null.
alter table public.custom_field_defs
  add column if not exists offer_id uuid references public.offers(id) on delete cascade;
alter table public.custom_field_defs
  add column if not exists section text;  -- 'sales' | 'onboarding' (null = academy-level)
do $$ begin
  alter table public.custom_field_defs
    add constraint custom_field_defs_section_chk
    check (section is null or section in ('sales','onboarding'));
exception when duplicate_object then null; end $$;

create index if not exists custom_field_defs_offer_idx
  on public.custom_field_defs(offer_id, section);

comment on column public.custom_field_defs.offer_id is
  'The offer this custom question belongs to (authored in the offer wizard). Null = academy-level field (e.g. GHL import). Cascades on offer delete.';
comment on column public.custom_field_defs.section is
  'Which wizard section authored it: sales | onboarding. Null for academy-level fields.';
