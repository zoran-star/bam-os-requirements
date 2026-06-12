-- Cards living on the whiteboard home. Each opens a full-screen view when tapped.
create table if not exists public.playground_widgets (
  id uuid primary key default gen_random_uuid(),
  type text not null default 'todo',
  title text not null default '',
  x double precision not null default 0,
  y double precision not null default 0,
  w double precision not null default 280,
  h double precision not null default 340,
  color text not null default '#151518',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.playground_widgets enable row level security;
drop policy if exists "playground widgets anon all" on public.playground_widgets;
create policy "playground widgets anon all"
  on public.playground_widgets for all
  to anon, authenticated using (true) with check (true);

alter publication supabase_realtime add table public.playground_widgets;

-- Seed the one TODO card we already have.
insert into public.playground_widgets (type, title, x, y, w, h)
values ('todo', 'TODO', 60, 80, 280, 360);;
