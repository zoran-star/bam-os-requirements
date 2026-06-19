-- Per-academy overrides for individual sections of the sales-agent system
-- prompt (Role, Pricing, Tone, Objection handling, etc.). Only edited sections
-- get a row; the rest fall back to the vendored default in
-- api/agent/prompt-structure.js. The sandbox endpoint reassembles the full
-- prompt = defaults with these overrides patched in.
create table if not exists public.agent_prompt_sections (
  id           uuid primary key default gen_random_uuid(),
  client_id    uuid not null references public.clients(id) on delete cascade,
  section_key  text not null,          -- e.g. 'pricing', 'tone', 'objection_handling'
  body         text not null,          -- the trainer's edited content for that section
  updated_by   text,
  updated_at   timestamptz not null default now(),
  unique (client_id, section_key)
);
create index if not exists agent_prompt_sections_client_idx
  on public.agent_prompt_sections(client_id);

alter table public.agent_prompt_sections enable row level security;
create policy agent_prompt_sections_select on public.agent_prompt_sections
  for select using (is_staff() or client_id in (select my_client_ids()));
create policy agent_prompt_sections_write on public.agent_prompt_sections
  for all using (is_staff()) with check (is_staff());

comment on table public.agent_prompt_sections is
  'Per-academy overrides for individual sections of the sales-agent system prompt. Sandbox reassembles defaults (api/agent/prompt-structure.js) + these overrides.';
