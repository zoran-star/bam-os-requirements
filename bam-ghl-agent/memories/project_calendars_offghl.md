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

## Rewiring status
① Website booking - ✅ LIVE 2026-07-02, GTA FLIPPED (booking_provider='portal',
   migration 20260702150000). availability.js portal branch serves OUR slots (same
   {timezone, days} shape - site untouched; "Group N" from the entry_point label
   picks the template family). leads.js portal path: booking.start ->
   schedule_slots row -> book_trial_slot RPC. VERIFIED live twice (test bookings,
   both cancelled + wiped): contact minted portal-native, slot claimed 12->11,
   card -> scheduled_trial, kpi_event trial_booked fired, cancel freed the spot.
   GOTCHA FIXED (PR #1025): pushToGhl's GHL_LOCATIONS_JSON gates ran BEFORE the
   portal-native branch, and prod's GHL_LOCATIONS_JSON is EMPTY -> contact
   creation silently null. portalNativeContact() now runs FIRST (zero GHL config;
   also repaired GTA form-lead contact creation which that empty var had broken).
   requireGhl bridge = dead for GTA (⑤ ✅).
② Agents - ✅ BUILT 2026-07-02 (3rd PR). api/agent/booking.js is the provider
   seam: freeSlots + nextAppointment take {clientId} and branch (portal reads
   schedule_slots/trial_bookings); new bookPortalTrial(clientId, {slotAtIso,
   group, contactId, contactName}) books via the RPC (p_source='staff', contact
   details enriched from the contacts store). agent-approvals: check_availability
   tool + confirm-book action branch; bookingCtx carries clientId (runAgent +
   draftOpener). agent-confirm: both nextAppointment sites pass clientId.
③ Portal calendar + trials-today - ✅ BUILT 2026-07-02 (4th PR). calendars-v15.js
   branches to portalHandler() before any GHL token fetch: list (entry_points ->
   calendar chips, capacity from slot_templates), events (trial_bookings joined to
   slots, GHL-event shape), trials-today (today bounds, cancelled excluded),
   appointment drawer (booking + contact from the contacts store, custom-field
   labels via custom_field_defs), contact (store), settings GET (templates ->
   openHours shape, read_only:true), set-status (showed/noshow ->
   set_trial_outcome, cancelled/invalid -> cancel_trial_booking + KPI
   trial_attended/no_show w/ ref trialoutcome-tb:{id}), create-appointment ->
   bookPortalTrial. Settings WRITE returns a friendly error for portal (edit via
   schedule templates - follow-up if Zoran wants an editor; would proxy the staff
   JWT to Luka's template endpoints).
④ Post-trial form - ✅ BUILT 2026-07-02 (same PR). post-trial.js stamps the
   coach's outcome onto the contact's most recent STARTED trial_bookings row via
   set_trial_outcome (SHOWED/NO_SHOW, 1h grace, best-effort).
⑤ GHL contact bridge - ✅ dead with the ① flip

## GHL calendar deps remaining after ①-⑤
- kpis-v15 sales_bookings GHL branch (only for booking_provider='ghl' academies;
  GTA reads kpi_events).
- agent-confirm's contactInRespondedStage/GHL-conversation reads etc are pipeline/
  messaging concerns, already provider-aware elsewhere.
- Slot generation has NO cron: re-run generate-slots before ~2026-08-31.
