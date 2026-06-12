-- Denormalized field: set when a future-dated pause is queued.
-- Cleared when the pause activates (by cron) or is cancelled/unscheduled.
-- Lets the staff portal show a "Pause queued" pill without joining
-- cancellations on every render.

ALTER TABLE public.members
  ADD COLUMN IF NOT EXISTS pause_scheduled_for date;

CREATE INDEX IF NOT EXISTS idx_members_pause_scheduled_for
  ON public.members (pause_scheduled_for)
  WHERE pause_scheduled_for IS NOT NULL;;
