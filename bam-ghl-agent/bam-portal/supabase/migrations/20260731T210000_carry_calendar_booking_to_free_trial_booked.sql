-- Carry the old booking-notification choice onto the preset's new pill.
--
-- WHY. `calendar_booking` was the only booking pill, and BAM GTA switched it on
-- for a teammate. It fired from ONE place, a GHL AppointmentCreate webhook, and
-- GTA books on the portal spine (book_trial_slot, no GHL appointment), so it
-- sent nothing across 25 bookings in 30 days while the settings screen said it
-- was on. The fix moves free-trial bookings onto `free_trial_booked`, declared by
-- the free_trial preset. Without this backfill, that switch-on silently resets to
-- nobody and the owner has to rediscover a setting they already chose.
--
-- WHAT IT DOES. Copies the calendar_booking recipient list to free_trial_booked
-- for academies that have the free_trial preset stamped on a live offer.
--
-- WHAT IT DOES NOT DO.
--   * It does not touch calendar_booking. That pill still exists and still fires
--     for non-trial calendars (BAM runs a Coach Cert calendar through it).
--   * It does not touch academies with no preset stamp. ShigHoops has
--     calendar_booking set but no stamp, so it gets no free_trial_booked pill in
--     the portal - writing the key would be a recipient list with no switch.
--   * It never OVERWRITES an existing free_trial_booked list, so re-running it
--     cannot undo a choice made after it first ran. Idempotent.
--   * The OWNER is unaffected either way: notifyOwners() always includes them.
--     This is only about the teammates the owner picked.
--
-- Expected scope at time of writing: exactly 1 row (BAM GTA).
update public.clients c
set notification_prefs = c.notification_prefs
      || jsonb_build_object('free_trial_booked', c.notification_prefs -> 'calendar_booking')
where jsonb_typeof(c.notification_prefs -> 'calendar_booking') = 'array'
  and not (c.notification_prefs ? 'free_trial_booked')
  and exists (
    select 1
    from public.offers o
    where o.client_id = c.id
      and o.status is distinct from 'archived'
      and o.data -> 'sales' ->> 'preset_key' = 'free_trial'
  );
