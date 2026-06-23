-- Per-contact memory: freeform notes a trainer/staff writes about a specific
-- lead/contact. Injected into the agent's prompt (as <contact_memory>) so it
-- personalizes replies and follow-ups (e.g. "already came to a trial", "shy kid
-- — emphasize small groups"). An append log: newest notes win.

create table if not exists public.agent_contact_notes (
  id             uuid primary key default gen_random_uuid(),
  client_id      uuid not null references public.clients(id) on delete cascade,
  ghl_contact_id text not null,
  note           text not null,
  created_by     text,
  active         boolean not null default true,
  created_at     timestamptz not null default now()
);

create index if not exists agent_contact_notes_contact_idx
  on public.agent_contact_notes (client_id, ghl_contact_id) where active = true;

alter table public.agent_contact_notes enable row level security;

do $$ begin
  if not exists (select 1 from pg_policies where tablename='agent_contact_notes' and policyname='agent_contact_notes_select') then
    create policy agent_contact_notes_select on public.agent_contact_notes for select
      using (is_staff() or client_id in (select my_client_ids()));
  end if;
end $$;

comment on table public.agent_contact_notes is
  'Freeform per-contact notes (trainer/staff) about a lead. Injected into the sales agent prompt as <contact_memory> so it remembers context per person. Writes go through the service-role API.';
