-- Sales Flow: add the 'cancel_booking' trigger to the transition vocabulary.
--
-- Team decision (Zoran, 2026-07-21): a lead cancelling their booked trial in the
-- calendar is its own flow event - the scheduled_trial stage routes it back to
-- the booking agent to rebook. The edge itself (seed function + backfill for
-- existing clients) lands in the companion migration
-- 20260721121000_cancel_booking_ran_out_edges.sql.
--
-- ADD VALUE lives in its OWN migration file on purpose: Postgres forbids USING a
-- new enum value inside the transaction that added it, and each migration file
-- runs in its own transaction - so the edge inserts must come in a later file.

alter type transition_trigger add value if not exists 'cancel_booking';
