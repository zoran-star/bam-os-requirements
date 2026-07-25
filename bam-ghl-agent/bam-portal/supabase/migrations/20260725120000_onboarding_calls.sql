-- Onboarding Call Sequence (Mike / BAM spec, 2026-07-25): the 7 structured
-- Scaling Manager calls that run when a new client is activated. Each call is
-- surfaced as an onboarding action item (sequential unlock - Call N opens only
-- once Call N-1 is done) and captures STRUCTURED data per topic, saved here on
-- the client profile - not a freeform notes box. The SM enters the data and
-- marks each call complete by hand (no Fathom / post-call-flow integration).
-- Field registry + step wiring live in api/action-items.js (SM_CALLS).
create table if not exists public.onboarding_calls (
  id                uuid primary key default gen_random_uuid(),
  client_id         uuid not null references public.clients(id) on delete cascade,
  step_number       int  not null check (step_number between 1 and 7),
  call_key          text not null,
  -- Structured per-topic fields, keyed by the registry in api/action-items.js
  -- (e.g. call 1: avatar, positioning, value_proposition, offer_structure).
  data              jsonb not null default '{}'::jsonb,
  completed_at      timestamptz,
  completed_by_name text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (client_id, step_number),
  unique (client_id, call_key)
);

create index if not exists onboarding_calls_client_id_idx on public.onboarding_calls (client_id);

-- keep updated_at fresh (same pattern as action_items)
create or replace function public.touch_onboarding_calls_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

drop trigger if exists trg_onboarding_calls_updated_at on public.onboarding_calls;
create trigger trg_onboarding_calls_updated_at
  before update on public.onboarding_calls
  for each row execute function public.touch_onboarding_calls_updated_at();

-- RLS: staff read/write; academy members may read their own calls (the client
-- checklist shows call progress). Writes stay staff-side - the serverless API
-- (service role) enforces staff-only toggling/data entry on top of this.
alter table public.onboarding_calls enable row level security;

drop policy if exists onboarding_calls_staff_rw on public.onboarding_calls;
create policy onboarding_calls_staff_rw on public.onboarding_calls
  for all to authenticated
  using (public.is_staff())
  with check (public.is_staff());

drop policy if exists onboarding_calls_client_read on public.onboarding_calls;
create policy onboarding_calls_client_read on public.onboarding_calls
  for select to authenticated
  using (client_id in (select public.my_client_ids()));
