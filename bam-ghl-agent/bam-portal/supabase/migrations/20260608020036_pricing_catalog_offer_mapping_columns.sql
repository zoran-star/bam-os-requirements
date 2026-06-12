-- Phase 1 of the Offer⇄Stripe⇄CoachIQ price-mapping feature.
-- Additive, all nullable → existing reads/writes unaffected.
alter table public.pricing_catalog
  add column if not exists offer_id          uuid,
  add column if not exists offer_price_key   text,        -- e.g. '2/wk|3_months'
  add column if not exists coachiq_product_id text,        -- harvested from Stripe metadata or manual
  add column if not exists match_status      text not null default 'unmatched',  -- unmatched | proposed | confirmed
  add column if not exists match_confidence  numeric,
  add column if not exists match_source      text,         -- ai | manual | metadata
  add column if not exists matched_at        timestamptz;

comment on column public.pricing_catalog.offer_id is 'FK→offers.id — which BB offer this price belongs to (soft ref).';
comment on column public.pricing_catalog.offer_price_key is 'Which price-row within the offer, e.g. plan|term = 2/wk|3_months.';
comment on column public.pricing_catalog.coachiq_product_id is 'CoachIQ product id tied to this price (harvested from Stripe sub metadata.productId, or entered manually).';
comment on column public.pricing_catalog.match_status is 'unmatched | proposed (AI suggested, awaiting approval) | confirmed (owner approved).';

create index if not exists idx_pricing_catalog_offer       on public.pricing_catalog (offer_id);
create index if not exists idx_pricing_catalog_offer_price on public.pricing_catalog (offer_id, offer_price_key);;
