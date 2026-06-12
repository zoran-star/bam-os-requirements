-- ────────────────────────────────────────────────────────────
-- guide_cards: Cam's content per ad offer.
-- Shown to clients in the "+ Add New Campaign" wizard.
-- ────────────────────────────────────────────────────────────
create table public.guide_cards (
  id uuid primary key default gen_random_uuid(),

  title text not null unique,                  -- "Camps", "Tryouts", etc.
  purpose text not null default '',
  filming_tips text not null default '',
  example_script text not null default '',
  example_assets jsonb not null default '[]'::jsonb, -- array of { name, url, type }

  updated_by uuid references public.staff(id) on delete set null,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Pre-seed the 10 default offers (empty content — Cam fills them in)
insert into public.guide_cards (title) values
  ('Camps'),
  ('Internal tournament'),
  ('Internal league'),
  ('Gym rental'),
  ('Youth academy'),
  ('Training'),
  ('Tryouts'),
  ('General teams'),
  ('New hire'),
  ('Promo')
on conflict (title) do nothing;

-- ────────────────────────────────────────────────────────────
-- RLS
-- ────────────────────────────────────────────────────────────
alter table public.guide_cards enable row level security;

-- Anyone authenticated can READ (so the client wizard can fetch them).
create policy "Authenticated read guide cards"
  on public.guide_cards for select
  to authenticated
  using (true);

-- Only admin + marketing staff can WRITE (Cam, Ximena, Zoran).
create policy "Marketing staff insert guide cards"
  on public.guide_cards for insert
  to authenticated
  with check (
    exists (
      select 1 from public.staff
      where user_id = auth.uid()
        and role in ('admin','marketing','marketing_manager','marketing_executor')
    )
  );

create policy "Marketing staff update guide cards"
  on public.guide_cards for update
  to authenticated
  using (
    exists (
      select 1 from public.staff
      where user_id = auth.uid()
        and role in ('admin','marketing','marketing_manager','marketing_executor')
    )
  );

create policy "Marketing staff delete guide cards"
  on public.guide_cards for delete
  to authenticated
  using (
    exists (
      select 1 from public.staff
      where user_id = auth.uid()
        and role in ('admin','marketing','marketing_manager','marketing_executor')
    )
  );

-- Auto-update updated_at
create or replace function public.set_guide_card_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger guide_cards_updated_at
  before update on public.guide_cards
  for each row execute function public.set_guide_card_updated_at();;
