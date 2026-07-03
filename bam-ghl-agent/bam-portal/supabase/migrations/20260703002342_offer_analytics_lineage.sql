-- Per-offer analytics lineage (offer tie-in follow-up): win/loss, churn,
-- refunds, and funnel events all carry the offer. DB triggers fill offer_id
-- at insert time from the row's opportunity/member/contact, so EVERY writer
-- (agents, webhook, staff actions, future code) is covered without JS churn.
-- Triggers are best-effort: a lookup failure never blocks the insert.

alter table public.pipeline_outcomes add column if not exists offer_id uuid references public.offers(id);
alter table public.cancellations     add column if not exists offer_id uuid references public.offers(id);
alter table public.refunds           add column if not exists offer_id uuid references public.offers(id);
-- kpi_events.offer_id already exists.

create or replace function public.fill_offer_from_opportunity() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.offer_id is null and new.opportunity_id is not null then
    begin
      select o.offer_id into new.offer_id
        from public.opportunities o
       where o.client_id = new.client_id
         and (o.ghl_opportunity_id = new.opportunity_id or o.id::text = new.opportunity_id)
       order by o.created_at desc limit 1;
    exception when others then null;
    end;
  end if;
  return new;
end $$;

create or replace function public.fill_offer_from_member() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.offer_id is null and new.member_id is not null then
    begin
      select m.offer_id into new.offer_id from public.members m where m.id = new.member_id;
    exception when others then null;
    end;
  end if;
  return new;
end $$;

create or replace function public.fill_offer_from_contact_opp() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.offer_id is null and new.ghl_contact_id is not null then
    begin
      select o.offer_id into new.offer_id
        from public.opportunities o
       where o.client_id = new.client_id and o.ghl_contact_id = new.ghl_contact_id
       order by o.created_at desc limit 1;
    exception when others then null;
    end;
  end if;
  return new;
end $$;

drop trigger if exists trg_fill_offer on public.pipeline_outcomes;
create trigger trg_fill_offer before insert on public.pipeline_outcomes
  for each row execute function public.fill_offer_from_opportunity();

drop trigger if exists trg_fill_offer on public.cancellations;
create trigger trg_fill_offer before insert on public.cancellations
  for each row execute function public.fill_offer_from_member();

drop trigger if exists trg_fill_offer on public.refunds;
create trigger trg_fill_offer before insert on public.refunds
  for each row execute function public.fill_offer_from_member();

drop trigger if exists trg_fill_offer on public.kpi_events;
create trigger trg_fill_offer before insert on public.kpi_events
  for each row execute function public.fill_offer_from_contact_opp();

-- Backfill: all BAM GTA history belongs to the Training funnel (confirmed).
update public.pipeline_outcomes set offer_id = '52a6285c-7832-44e1-b531-ab7ef9d8fc21'
 where client_id = '39875f07-0a4b-4429-a201-2249bc1f24df' and offer_id is null;
update public.cancellations set offer_id = '52a6285c-7832-44e1-b531-ab7ef9d8fc21'
 where client_id = '39875f07-0a4b-4429-a201-2249bc1f24df' and offer_id is null;
update public.refunds set offer_id = '52a6285c-7832-44e1-b531-ab7ef9d8fc21'
 where client_id = '39875f07-0a4b-4429-a201-2249bc1f24df' and offer_id is null;
update public.kpi_events set offer_id = '52a6285c-7832-44e1-b531-ab7ef9d8fc21'
 where client_id = '39875f07-0a4b-4429-a201-2249bc1f24df' and offer_id is null;
