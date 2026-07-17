-- Cancellation data quality (applied to prod 2026-07-16 after deduping 4
-- duplicate cancel rows - same sub id, same day, double-click artifacts).
--
-- reason_category: structured churn reason (schedule | price | injury |
-- moved | service | seasonal | other) chosen in the cancel flow; the free
-- text `reason` stays for detail.
--
-- Unique partial indexes: one cancel event per subscription (a re-join
-- creates a NEW sub id, so this never blocks a real second cancellation),
-- and one per member for subs-less members. Backstop for the
-- check-before-insert in actionCancel / handleSubDeleted.
ALTER TABLE public.cancellations
  ADD COLUMN IF NOT EXISTS reason_category TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS cancellations_one_cancel_per_sub
  ON public.cancellations (stripe_subscription_id)
  WHERE type = 'cancel' AND stripe_subscription_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS cancellations_one_cancel_per_member
  ON public.cancellations (member_id)
  WHERE type = 'cancel' AND member_id IS NOT NULL AND stripe_subscription_id IS NULL;
