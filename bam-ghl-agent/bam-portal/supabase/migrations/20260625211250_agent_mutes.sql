-- Per-lead bot mute (guardrail #6): "hands off this lead". Lets staff stop a bot
-- from drafting/engaging a SPECIFIC contact without turning the whole agent off.
-- The agent detectors skip a muted contact; an explicit human send is unaffected.
--
--   agent = 'booking' | 'confirm' | 'closing'  -> mute that one bot for this lead
--   agent = NULL                               -> mute ALL bots for this lead (global)

create table if not exists public.agent_mutes (
  id             uuid primary key default gen_random_uuid(),
  client_id      uuid not null references public.clients(id) on delete cascade,
  ghl_contact_id text not null,
  agent          text,                          -- 'booking'|'confirm'|'closing' or NULL = all
  created_by     text,
  reason         text,
  created_at     timestamptz not null default now()
);

-- One mute per (academy, contact, agent) - coalesce NULL to '*' so a global mute is
-- distinct from a per-agent one and each is idempotent.
create unique index if not exists agent_mutes_unique
  on public.agent_mutes (client_id, ghl_contact_id, coalesce(agent, '*'));
create index if not exists agent_mutes_lookup_idx
  on public.agent_mutes (client_id, ghl_contact_id);

alter table public.agent_mutes enable row level security;

do $$ begin
  if not exists (select 1 from pg_policies where tablename='agent_mutes' and policyname='agent_mutes_select') then
    create policy agent_mutes_select on public.agent_mutes for select
      using (is_staff() or client_id in (select my_client_ids()));
  end if;
end $$;

comment on table public.agent_mutes is
  'Per-lead bot mute (hands-off-this-lead). agent NULL = all bots. Agent detectors skip muted contacts; explicit human sends are unaffected. Writes via service-role api/agent-mutes.js.';
