-- Store the lead's last message text on a scheduled follow-up so the Hawkeye
-- card can show "what they last said" + when, alongside the next send time.
alter table public.agent_followups
  add column if not exists last_message text;
