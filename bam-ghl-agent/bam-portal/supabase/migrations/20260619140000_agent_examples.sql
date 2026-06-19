-- Trainer-curated few-shot examples for the sales agent, captured in the
-- Sandbox ("⭐ Save as example" on a good exchange). When an academy has any
-- saved examples, they're injected into the prompt as the style guide IN PLACE
-- OF the default examples. (Applied via Supabase MCP 2026-06-19.)
create table if not exists public.agent_examples (
  id          uuid primary key default gen_random_uuid(),
  client_id   uuid not null references public.clients(id) on delete cascade,
  parent_text text not null,
  agent_text  text not null,
  note        text,
  created_by  text,
  created_at  timestamptz not null default now()
);
create index if not exists agent_examples_client_idx on public.agent_examples(client_id);

alter table public.agent_examples enable row level security;
create policy agent_examples_select on public.agent_examples
  for select using (is_staff() or client_id in (select my_client_ids()));
create policy agent_examples_write on public.agent_examples
  for all using (is_staff()) with check (is_staff());

comment on table public.agent_examples is
  'Trainer-curated few-shot examples for the sales agent (captured in the Sandbox). When present, injected into the prompt in place of the default examples.';
