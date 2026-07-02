-- Offer tie-in Wave 1: key lead-touching surfaces to offers.
-- Plan: bam-ghl-agent/docs/offer-tie-in-plan.md

alter table public.pipeline_stages add column if not exists offer_id uuid references public.offers(id);
alter table public.opportunities add column if not exists offer_id uuid references public.offers(id);
alter table public.automations add column if not exists offer_id uuid references public.offers(id);
alter table public.agent_prompt_sections add column if not exists offer_id uuid references public.offers(id);
alter table public.website_leads add column if not exists offer_id uuid references public.offers(id);
alter table public.website_leads add column if not exists entry_point_id uuid references public.entry_points(id);
alter table public.post_trial_reviews add column if not exists offer_id uuid references public.offers(id);

create index if not exists opportunities_client_offer_idx on public.opportunities (client_id, offer_id);
create index if not exists website_leads_client_offer_idx on public.website_leads (client_id, offer_id);
create index if not exists pipeline_stages_client_offer_idx on public.pipeline_stages (client_id, offer_id);

-- Offer <-> Meta ad campaign mapping (per-offer CAC / campaign ownership)
create table if not exists public.offer_ad_campaigns (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id),
  offer_id uuid not null references public.offers(id),
  campaign_id text not null,
  campaign_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (client_id, campaign_id)
);
alter table public.offer_ad_campaigns enable row level security;
create policy offer_ad_campaigns_select on public.offer_ad_campaigns
  for select using (is_staff() or client_id in (select my_client_ids()));
-- writes: service-role API only (deliberately no insert/update/delete policies)

-- Backfill
do $$
declare
  gta uuid := '39875f07-0a4b-4429-a201-2249bc1f24df';
  training uuid := '52a6285c-7832-44e1-b531-ab7ef9d8fc21';
begin
  -- BAM GTA's existing pipeline, opportunities, automations, and post-trial
  -- reviews all belong to the Training offer (confirmed by Zoran 2026-07-02).
  update public.pipeline_stages    set offer_id = training where client_id = gta and offer_id is null;
  update public.opportunities      set offer_id = training where client_id = gta and offer_id is null;
  update public.automations        set offer_id = training where client_id = gta and offer_id is null;
  update public.post_trial_reviews set offer_id = training where client_id = gta and offer_id is null;

  -- Leads inherit lineage from their entry point (all clients). Leads whose
  -- entry point has no offer (e.g. GTA's adapt form) correctly stay NULL
  -- until that offer exists.
  update public.website_leads wl
     set entry_point_id = ep.id,
         offer_id = ep.offer_id
    from public.entry_points ep
   where ep.client_id = wl.client_id
     and ep.key = wl.form_type
     and wl.entry_point_id is null;

  -- Seed per-offer campaign mapping from the academy-level campaign picks.
  insert into public.offer_ad_campaigns (client_id, offer_id, campaign_id)
  select gta, training, unnest(c.meta_campaign_ids)
    from public.clients c
   where c.id = gta and c.meta_campaign_ids is not null
  on conflict (client_id, campaign_id) do nothing;

  -- agent_prompt_sections: NULL offer_id = academy-wide brain (deliberate; no backfill).
end $$;
