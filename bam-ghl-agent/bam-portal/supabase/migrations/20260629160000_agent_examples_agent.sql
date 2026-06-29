-- Per-agent saved examples. agent_examples previously had no agent column - every
-- saved example was implicitly the booking agent's. Add an `agent` scope so the
-- Confirm + Closing agents can capture their own approved example exchanges
-- without bleeding booking-flavored tone into a confirmation or closing chat.
-- Existing rows default to 'booking' (correct - they are all booking examples today).
alter table public.agent_examples
  add column if not exists agent text not null default 'booking';

create index if not exists agent_examples_client_agent_idx
  on public.agent_examples (client_id, agent);

comment on column public.agent_examples.agent is
  'Which agent this example trains: booking | confirm | closing. Each agent loads only its own examples.';
