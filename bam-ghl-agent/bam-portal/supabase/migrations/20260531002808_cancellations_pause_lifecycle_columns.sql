-- Track lifecycle of pause rows in cancellations.
-- activated_at: set when the pause becomes active (Stripe trial_end set + members.status='paused')
--   For immediate pauses, set at insert time. For future-scheduled, set by cron when start_date hits.
-- completed_at: set when the pause ends (members.status flipped back to 'live')
--   Set by cron when pause_end < now() and member is still 'paused'.

ALTER TABLE public.cancellations
  ADD COLUMN IF NOT EXISTS activated_at timestamptz,
  ADD COLUMN IF NOT EXISTS completed_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_cancellations_pending_pause
  ON public.cancellations (pause_start)
  WHERE type = 'pause' AND activated_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_cancellations_active_pause
  ON public.cancellations (pause_end)
  WHERE type = 'pause' AND activated_at IS NOT NULL AND completed_at IS NULL;;
