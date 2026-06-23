-- Quiet hours (8:00am-9:30pm): a reply that would otherwise send NOW but lands
-- outside the window is held instead of sent. The held reply is stored as an
-- 'approved' row with send_after = the next morning; the agent-approvals detect
-- cron flushes due rows (in-window + still in the Responded stage) and sends them.
-- Covers BOTH the self-drive auto-send and a human's "send now" click after hours.

alter table public.agent_ready_replies
  add column if not exists send_after timestamptz;  -- hold a send until this instant (quiet hours)

-- Fast lookup of due, held replies in the flush step.
create index if not exists agent_ready_replies_send_after_idx
  on public.agent_ready_replies (status, send_after)
  where send_after is not null;
