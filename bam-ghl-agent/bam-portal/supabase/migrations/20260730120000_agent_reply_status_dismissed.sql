-- "Send nothing" has never worked. On any academy. Not once.
--
-- THE BUG. Staff tapping "Send nothing" on a Hawkeye reply card fires
-- `dismiss-ready`, which PATCHes the row to status='dismissed':
--   api/agent-approvals.js:1121  -> agent_ready_replies
--   api/agent-confirm.js:1178    -> agent_confirm_replies
--   api/agent-closing.js:1101    -> agent_closing_replies
-- Every one of those tables carries a status CHECK that does not list
-- 'dismissed', so PostgREST answers 400 (23514) and the write is rejected.
-- Confirmed against production 2026-07-30: ZERO rows with status='dismissed'
-- exist in any of these tables, across the whole history of every academy.
--
-- WHAT STAFF SEE TODAY (traced through public/client-portal.html, not guessed).
-- The card flies out of the deck at 200ms and the deck advances at 480ms, but
-- the API call itself rides the 6s undo window (`_hawkDefer`). So six seconds
-- after moving on, `_hawkFlush` catches the throw and shows a red toast
-- carrying the raw PostgREST error, and `_hk2Unresolve` puts the dismissed card
-- back on top of the queue. The card is immortal: dismiss it, it comes back.
--
-- WHY 'dismissed' AND NOT THE EXISTING 'skipped'. They are different decisions,
-- and collapsing them would be worse than the bug (comment at
-- api/agent-approvals.js:1115):
--   skipped   = SNOOZE. The detector's timestamp-match dedupe ignores skipped
--               rows, so it re-drafts the same inbound on the next run.
--   dismissed = TERMINAL for that inbound. The dedupe treats any non-skipped
--               row as an answer, so the message is never re-drafted. A NEW
--               inbound from the same lead still gets a fresh card.
-- api/agent-closing.js:720 already reads status=in.(pending,approved,dismissed)
-- for exactly that dedupe - the reader was shipped, the writer could never land.
--
-- THE TRAP IN THIS MIGRATION. The four lists are NOT identical.
-- agent_closing_replies gained 'paused' in 20260723213000_closing_pause_on_reply
-- (a lead reply parks the follow-up plan instead of hard-cancelling it). The
-- other three never had it. Pasting one list onto all four would silently drop
-- 'paused' and reject every live paused row on the next write. Each constraint
-- below therefore restates its OWN values verbatim and adds exactly one.
-- The value sets here were read off production, not off this repo's history.
--
-- agent_followups has no 'dismissed' writer today - reply cards are the only
-- ones with a "Send nothing" move. It is widened with its siblings so the four
-- reply-side tables keep one shape; nothing starts writing it as a result.
--
-- DELIBERATELY NOT TOUCHED: agent_approvals, which has NO status CHECK at all
-- and holds 'sent' (120), 'scheduled' (3), 'no_reply' (1) - values three of the
-- four tables below would reject. Adding a constraint there is a separate
-- decision that could start rejecting live writes; it is not a tidy-up to ride
-- along here.
--
-- Idempotent: drop-if-exists then recreate, the same shape as
-- 20260723213000_closing_pause_on_reply.sql.

-- pending, approved, sent, skipped, canceled, failed  (+ dismissed)
alter table public.agent_ready_replies
  drop constraint if exists agent_ready_replies_status_check;
alter table public.agent_ready_replies
  add constraint agent_ready_replies_status_check
  check (status in ('pending','approved','sent','skipped','canceled','failed','dismissed'));

-- pending, approved, sent, skipped, canceled, failed  (+ dismissed)
alter table public.agent_confirm_replies
  drop constraint if exists agent_confirm_replies_status_check;
alter table public.agent_confirm_replies
  add constraint agent_confirm_replies_status_check
  check (status in ('pending','approved','sent','skipped','canceled','failed','dismissed'));

-- pending, approved, sent, skipped, canceled, failed  (+ dismissed)
alter table public.agent_followups
  drop constraint if exists agent_followups_status_check;
alter table public.agent_followups
  add constraint agent_followups_status_check
  check (status in ('pending','approved','sent','skipped','canceled','failed','dismissed'));

-- pending, approved, sent, skipped, canceled, failed, PAUSED  (+ dismissed)
-- 'paused' is this table's alone. Do not copy any other list over this one.
alter table public.agent_closing_replies
  drop constraint if exists agent_closing_replies_status_check;
alter table public.agent_closing_replies
  add constraint agent_closing_replies_status_check
  check (status in ('pending','approved','sent','skipped','canceled','failed','paused','dismissed'));
