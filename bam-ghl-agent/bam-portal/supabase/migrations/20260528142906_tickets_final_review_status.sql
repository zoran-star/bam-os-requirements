-- Allow final_review status. Sits between in_review (executor submitted)
-- and done — manager has reviewed internally, now sending to the client
-- for their sign-off. From the client's side it looks like a special
-- "FINAL REVIEW" state where they can approve or send feedback.
ALTER TABLE public.tickets DROP CONSTRAINT IF EXISTS tickets_status_check;
ALTER TABLE public.tickets ADD CONSTRAINT tickets_status_check
  CHECK (status = ANY (ARRAY[
    'open','delegated','in_progress','awaiting_client','in_review',
    'final_review','needs_rework','approved','done','cancelled'
  ]));;
