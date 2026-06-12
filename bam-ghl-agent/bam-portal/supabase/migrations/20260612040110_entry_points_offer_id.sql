-- The offer is the organizing unit: each offer gets its own pipeline,
-- funnel, entry points, calendars, agents. Scope entry points to offers.
alter table public.entry_points add column if not exists offer_id uuid references public.offers(id);

-- GTA's existing entry points all belong to the Training offer
update public.entry_points
  set offer_id = '52a6285c-7832-44e1-b531-ab7ef9d8fc21'
  where client_id = '39875f07-0a4b-4429-a201-2249bc1f24df' and offer_id is null;;
