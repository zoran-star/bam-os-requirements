-- Hawkeye cards now show the recent conversation inline. Store the last few
-- messages [{role:'lead'|'agent', text}] captured at draft time.
alter table public.agent_ready_replies
  add column if not exists thread_tail jsonb;
alter table public.agent_followups
  add column if not exists thread_tail jsonb;
