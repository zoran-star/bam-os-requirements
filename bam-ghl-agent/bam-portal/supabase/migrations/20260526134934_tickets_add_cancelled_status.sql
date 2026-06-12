
-- The staff portal's cancel_ticket API action writes status='cancelled'
-- (api/tickets.js line ~363) but the DB check constraint didn't include
-- 'cancelled', so the UPDATE failed with 23514 every time staff hit the
-- Cancel button. Reported by Rosano 2026-05-26.
--
-- The frontend already treats 'cancelled' as a terminal status alongside
-- done/approved (see SystemsView.jsx fieldsLocked + status-text logic).
-- Just bring the DB in line with what the app already expects.

ALTER TABLE public.tickets
  DROP CONSTRAINT IF EXISTS tickets_status_check;

ALTER TABLE public.tickets
  ADD CONSTRAINT tickets_status_check
  CHECK (status = ANY (ARRAY[
    'open',
    'delegated',
    'in_progress',
    'awaiting_client',
    'in_review',
    'needs_rework',
    'approved',
    'done',
    'cancelled'
  ]));
;
