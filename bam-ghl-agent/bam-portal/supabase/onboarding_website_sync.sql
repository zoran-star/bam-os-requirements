-- onboarding_website_sync.sql
-- Applied to prod 2026-06-17 (migration: sync_onboarding_website_to_brand_data).
--
-- Purpose: make sure a website a client enters ANYWHERE reaches Cam's marketing
-- Client card, which reads clients.brand_data.website_url.
--
-- The self-serve onboarding flow (onboarding-reloaded.html) stores its answers in
-- onboarding_reloaded.answers (jsonb) — the "Existing website URL" question lands
-- under key 'website_1' — and never wrote to clients.brand_data. This trigger
-- mirrors that answer into brand_data.website_url so the marketing team sees it.
--
-- Fills only when the client has no website on file, so a staff-curated value in
-- the Brand Basics editor is never clobbered. SECURITY DEFINER so the anon
-- onboarding upsert is allowed to update the clients row via the trigger.
--
-- Complements the front-end change (MarketingView.clientWebsiteFrom) which reads
-- website_url -> domain -> website -> url, covering older imports.

create or replace function public.sync_onboarding_website_to_brand()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_url text;
begin
  if NEW.client_id is null or NEW.answers is null then
    return NEW;
  end if;

  -- Primary: the dedicated "Existing website URL" answer.
  v_url := nullif(trim(coalesce(NEW.answers->>'website_1','')), '');

  -- Fallback: any website_* answer whose value looks like a URL/domain.
  if v_url is null then
    select nullif(trim(a.value #>> '{}'), '')
      into v_url
    from jsonb_each(NEW.answers) a
    where a.key like 'website%'
      and (a.value #>> '{}') ~* '(^https?://|www\.|\.[a-z]{2,}(/|$))'
    limit 1;
  end if;

  if v_url is null then
    return NEW;
  end if;

  update clients
     set brand_data = jsonb_set(coalesce(brand_data, '{}'::jsonb), '{website_url}', to_jsonb(v_url), true)
   where id = NEW.client_id
     and nullif(trim(coalesce(brand_data->>'website_url','')), '') is null;

  return NEW;
end;
$$;

drop trigger if exists trg_sync_onboarding_website on public.onboarding_reloaded;
create trigger trg_sync_onboarding_website
after insert or update of answers on public.onboarding_reloaded
for each row execute function public.sync_onboarding_website_to_brand();
