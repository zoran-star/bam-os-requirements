create table if not exists public.agent_lessons (
  id          uuid primary key default gen_random_uuid(),
  client_id   uuid references public.clients(id) on delete cascade,
  kind        text not null default 'lesson',
  lesson      text not null,
  context     jsonb not null default '{}'::jsonb,
  active      boolean not null default true,
  created_by  text,
  created_at  timestamptz not null default now()
);
create index if not exists agent_lessons_client_active_idx
  on public.agent_lessons(client_id, active);

alter table public.agent_lessons enable row level security;
create policy agent_lessons_select on public.agent_lessons
  for select using (is_staff() or client_id in (select my_client_ids()));
create policy agent_lessons_write on public.agent_lessons
  for all using (is_staff()) with check (is_staff());

comment on table public.agent_lessons is
  'Sales-agent training lessons (corrections) captured in the Sandbox; active rows are injected into the agent system prompt at reply time. Per-academy (client_id).';;
