-- Pause modal: let staff manually set the member's NEXT PAYMENT date instead of
-- letting it be computed from the pause length. The chosen date is the Stripe
-- trial_end (next charge). Stored on the pause row so BOTH the immediate path
-- (actionPause) and the future-scheduled path (cron Phase A) honor it.
-- A manual next-payment date still requires a pause period (pause_start/pause_end).

alter table public.cancellations
  add column if not exists manual_trial_end date;  -- staff-set next charge date (overrides the computed trial_end)
