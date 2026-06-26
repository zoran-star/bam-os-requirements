-- Per-agent lessons. agent_lessons previously had no agent column - every lesson
-- was implicitly the booking agent's. Add an `agent` scope so the Confirm + Closing
-- agents can have their own 1-line corrections without bleeding into the booking chat.
-- Existing rows default to 'booking' (correct - they are all booking lessons today).
alter table public.agent_lessons
  add column if not exists agent text not null default 'booking';

create index if not exists agent_lessons_client_agent_idx
  on public.agent_lessons (client_id, agent, active);

comment on column public.agent_lessons.agent is
  'Which agent this lesson trains: booking | confirm | closing. Each agent loads only its own lessons.';
