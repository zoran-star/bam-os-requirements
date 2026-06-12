-- Personal playground TODO board for Zoran. Isolated from portal tables.
create table if not exists public.playground_todos (
  id uuid primary key default gen_random_uuid(),
  section text not null,
  section_position int not null default 0,
  label text not null,
  position int not null default 0,
  done boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.playground_todos enable row level security;

-- Personal playground: access is gated client-side by a passcode, so allow the
-- anon/publishable key full access to this table only.
drop policy if exists "playground anon all" on public.playground_todos;
create policy "playground anon all"
  on public.playground_todos
  for all
  to anon, authenticated
  using (true)
  with check (true);

-- Seed from Zoran's current TODO note
insert into public.playground_todos (section, section_position, label, position) values
  ('non claude', 0, 'Prasad!!', 0),
  ('non claude', 0, 'mentorship!!', 1),
  ('non claude', 0, 'Myles recurring', 2),
  ('portal', 1, 'app submission', 0),
  ('portal', 1, 'on-boarding / tasks', 1),
  ('portal', 1, 'bam gta member management / executing on members', 2),
  ('portal', 1, 'Cam guide card set up', 3),
  ('portal', 1, 'Randy', 4);;
