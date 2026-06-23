-- agent_ready_replies can now also hold a BOOKING proposal:
--   kind='book' → the agent proposes booking a free-trial appointment for a lead
--                 who confirmed a specific day/time. NEVER auto-creates the
--                 appointment (even in self-drive at first) — a human ✓ in the
--                 Hawkeye inbox triggers the real GHL booking (confirm-book).
-- The slot details ride alongside the draft confirmation message.

alter table public.agent_ready_replies
  add column if not exists book_calendar_id text,        -- GHL calendar id (group-matched)
  add column if not exists book_slot_at      timestamptz, -- the exact slot the lead confirmed
  add column if not exists book_group        text;        -- 'Group 1' / 'Group 2' (for display)
