# Calendars off GHL (trial bookings) - BAM GTA

Moving trial BOOKINGS off GHL calendars onto **Luka's runtime spine**
(`schedule_slots` + `trial_bookings` + capacity RPCs). Per-academy via
`clients.booking_provider` ('ghl' default | 'portal'). See
[`docs/parent-app-architecture-handoff.md`](../docs/parent-app-architecture-handoff.md)
+ [`docs/parent-app-db-boundary.md`](../docs/parent-app-db-boundary.md) - HARD
RULES: never INSERT schedule_slots/trial_bookings/reservations directly (call the
RPCs), capacity math only via slot_spots_taken semantics (CONFIRMED reservations
+ BOOKED trials), templates/slots only via Luka's staff endpoints.

## GTA schedule - CREATED IN PROD 2026-07-02 (the gate Luka's doc flagged)
Via Luka's staff endpoints (temp staff auth, cleaned up after):
- 4 slot_templates (program `80000000-0000-4000-8000-000000000001` "BAM GTA Training"):
  - Group 1 (Elementary) - Weeknights: WEEKLY:MO,TU,WE,TH 19:00-20:00
  - Group 1 (Elementary) - Saturday: WEEKLY:SA 11:30-12:30
  - Group 2 (High School) - Weeknights: WEEKLY:MO,TU,WE,TH 20:00-21:00
  - Group 2 (High School) - Saturday: WEEKLY:SA 12:30-13:30
  - all: capacity 12 (Zoran-confirmed, replaces GHL's 9), credit_cost 1,
    slot_type GROUP_CLASS, TZ America/New_York
- 86 slots generated (2026-07-02 -> +60d). ⚠️ NO CRON extends them - slots run out
  ~2026-08-31; re-run generate-slots (or build a weekly cron) before then.
- Verified via public GET /api/website/trial-slots (needs an allowed Origin header).
- Schedule source: extracted from the 2 GHL booking calendars (Cmw4bCVBhexgi0Oi0Dkf
  Group 1, G5y4QI0MsFq3159IhFU7 Group 2) + Zoran's capacity edit.

## Reminder check (Zoran asked) - GHL is ALREADY silent
ALL 79 GTA GHL workflows are in DRAFT (incl. both "free trial booked" flows).
Parent comms run 100% on portal automations (contact_form, trial_form, ghosted,
nurture, onboarding, summer_special - all live). Cutover = zero comms gap.

## Rewiring plan (① greenlit 2026-07-02)
① Website booking (BUILT, pending flip): `clients.booking_provider` flag
   (migration 20260702150000). availability.js portal branch serves OUR slots
   (same {timezone, days} shape - site untouched; "Group N" from the entry_point
   label picks the template family; spots = capacity - CONFIRMED - BOOKED).
   leads.js booking branch portal path resolves booking.start -> schedule_slots
   row -> book_trial_slot RPC (p_ghl_contact_id = the contact join key,
   p_metadata.website_lead_id). requireGhl (the Stage-4 contact bridge) is now
   `booking && bookingProv !== 'portal'` -> flipping GTA kills the LAST GHL
   contact creation.
② Booking/Confirm agents -> book_trial_slot / trial_bookings reads (NOT DONE;
   agent/booking.js + agent-confirm.js still GHL appointments)
③ Portal calendar + trials-today (calendars-v15.js) -> read schedule_slots +
   trial_bookings (NOT DONE)
④ Post-trial form -> set_trial_outcome RPC (NOT DONE; feeds trial_bookings.status)
⑤ GHL contact bridge - dies with the ① flip ✅

## Flip checklist (GTA booking_provider='portal')
- [ ] ① deployed to prod
- [ ] availability returns portal slots (curl with site Origin)
- [ ] test booking end-to-end (book_trial_slot row + card -> scheduled trial +
      kpi_event trial_booked) then cancel via cancel_trial_booking RPC
- [ ] flip: update clients set booking_provider='portal' where id='39875f07-...'
