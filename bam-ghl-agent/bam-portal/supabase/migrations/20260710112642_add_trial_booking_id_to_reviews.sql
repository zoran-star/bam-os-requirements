-- Post-trial form card: key the card on the TRIAL, not the CONTACT.
--
-- Bug (Kathryn Lack, 2026-07-10): the Confirm-tab post-trial form card gate
-- asked "has this CONTACT ever been reviewed?" (post_trial_reviews keyed only by
-- ghl_contact_id). A lead who no-showed one trial, rebooked, and did a second
-- trial had the OLD no-show review permanently suppress the new form card. This
-- hits every rebooked portal lead.
--
-- Fix: link each review to the specific trial_bookings row it reviewed. The gate
-- (api/agent-confirm.js + api/agent/booking.js) checks whether THIS booking is
-- reviewed, not whether the contact was ever reviewed. The per-opp upsert stays;
-- trial_booking_id just follows the latest reviewed trial.

alter table post_trial_reviews
  add column if not exists trial_booking_id uuid
  references trial_bookings(id) on delete set null;

comment on column post_trial_reviews.trial_booking_id is
  'The specific trial_bookings row this review is for (portal-booking academies). '
  'The post-trial form-card gate hides the card only when THIS booking is reviewed, '
  'so a rebooked lead''s prior-trial review never suppresses the new trial''s card.';

-- Backfill existing reviews: link each to the most recent trial that had already
-- run when the review was last touched (slot start_time <= updated_at + a small
-- grace for early submits). Reviewed bookings are usually already stamped
-- SHOWED/NO_SHOW; unresolvable rows (booking deleted) stay null, which is safe -
-- a card only surfaces for a still-BOOKED past trial.
update post_trial_reviews r
set trial_booking_id = (
  select tb.id
  from trial_bookings tb
  join schedule_slots ss on ss.id = tb.slot_id
  where tb.tenant_id = r.client_id
    and tb.ghl_contact_id = r.ghl_contact_id
    and ss.start_time <= r.updated_at + interval '6 hours'
  order by ss.start_time desc
  limit 1
)
where r.trial_booking_id is null;
