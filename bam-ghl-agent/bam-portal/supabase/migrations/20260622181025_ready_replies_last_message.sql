-- Store the lead's last message on a ready-reply / suggested-lost row so the
-- Hawkeye card can show what the person actually said (context for approving).
alter table public.agent_ready_replies
  add column if not exists last_message text;
