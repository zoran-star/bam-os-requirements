-- Free-form canvas scenes (mind-map / figjam-style). One JSON doc per scene key.
create table if not exists public.playground_scenes (
  id uuid primary key default gen_random_uuid(),
  key text unique not null,
  doc jsonb not null default '{"nodes":[],"edges":[]}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.playground_scenes enable row level security;
drop policy if exists "playground scenes anon all" on public.playground_scenes;
create policy "playground scenes anon all"
  on public.playground_scenes for all
  to anon, authenticated using (true) with check (true);

alter publication supabase_realtime add table public.playground_scenes;

insert into public.playground_scenes (key) values ('mindmap')
on conflict (key) do nothing;

-- Whiteboard card that opens the mind-map.
insert into public.playground_widgets (type, board, title, x, y, w, h, color)
values ('mindmap', 'mindmap', 'MIND MAP', 60, 460, 280, 160, '#1c1c22');;
