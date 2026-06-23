-- Richer Hawkeye cards: a 2-3 sentence convo summary + OUR last message to the
-- lead (alongside the lead's last message that's already stored).
alter table public.agent_ready_replies
  add column if not exists summary       text,
  add column if not exists last_outbound text;

alter table public.agent_followups
  add column if not exists summary       text,
  add column if not exists last_outbound text;
