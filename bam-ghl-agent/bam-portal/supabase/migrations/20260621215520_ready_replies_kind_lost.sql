-- agent_ready_replies can now hold two kinds of agent proposal:
--   kind='reply'      → a drafted reply to send (the default, existing behaviour)
--   kind='mark_lost'  → the agent thinks this lead is dead and proposes marking
--                       them Lost. NEVER auto-executes (even in self-drive) — it
--                       always waits for a human ✓ in the Hawkeye inbox.
-- lost_reason carries the decline category (Too expensive / Bad fit / etc).

alter table public.agent_ready_replies
  add column if not exists kind        text not null default 'reply',
  add column if not exists lost_reason text;
