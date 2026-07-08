# Offer schedule -> portal-native slots ("Path B")

**Goal:** the Training offer's Schedule section + capacity are the single source of
truth. Publishing/saving the offer generates the bookable slots on the portal-native
calendar (Luka's spine). No separate schedule editor - you edit the schedule in the
offer, the calendar follows.

Decided 2026-07-07 (Zoran, "go with B"). Context: [[../memories/project_detail_portal_native_plan]].

## The chain (why order matters)

```
Training offer  ──►  Stripe Matcher  ──►  bookable_program  ──►  slot templates  ──►  generate-slots  ──►  live
  data.classes[]        (confirmed          (offers-sync)         (THIS spec)          (Luka endpoint)
  data.capacity          pricing_catalog)
```

Slots can't exist without a `bookable_program`, and `offers-sync` refuses to create
one without **confirmed pricing_catalog rows** ("run the Stripe Matcher first"). So B
is gated on Phase 0 (offer -> pricing -> program) being done. DETAIL Miami today:
`0 programs, 0 confirmed pricing` - blocked on the Stripe Matcher.

## Piece 1 - the transformation (BUILT + tested)

`bam-portal/api/_offer-schedule.js` -> `offerToTemplatePayloads(offer, opts)`.

Pure, no I/O. Maps `offer.data.classes[].weekly_times[]` + `offer.data.capacity` into
`slot_templates` CREATE payloads for `POST /api/runtime/schedule/templates`.

- **Input** (offer wizard, Training): each class -> `weekly_times[]` of
  `{ days:['Mon','Wed'], start:'18:00', end:'20:00', location }`; offer-level
  `capacity` (the new "Max capacity per session" field).
- **Output** per row: `{ payload, matchKey }` where `payload` =
  `{ client_id, name, slot_type:'GROUP_CLASS', default_start_time, default_end_time,
  default_capacity, default_credit_cost:0, recurrence_rule:'WEEKLY:MO,WE', is_active,
  location_id|default_location, bookable_program_id }` and
  `matchKey = "recurrence|start|end"` (the dedupe key). `default_credit_cost` is 0
  (trials cost 0 credits).
- Skips + warns on: ad-hoc classes (`consistent:'No'`), empty/invalid days or times,
  `start>=end`, duplicate rows. Missing capacity -> omit field (endpoint default 10) + warn.
- Time parsing handles `18:00` and `6:00 PM`. Days handle `Mon`/`Monday`/`mon`.

Worked example (DETAIL MS/HS, cap 25):
`{days:['Mon','Wed'], start:'18:00', end:'20:00'}` ->
`{ recurrence_rule:'WEEKLY:MO,WE', default_start_time:'18:00', default_end_time:'20:00',
default_capacity:25, slot_type:'GROUP_CLASS', name:'Training - MS / HS (Mon, Wed)' }`.

Tested: 19 assertions (Detail case + edge cases) pass. Test lives in the commit body /
can be re-run standalone.

## Piece 2 - the orchestrator (TO BUILD)

A thin, staff-authed portal endpoint (e.g. `POST /api/schedule/sync-offer`,
`{ client_id, offer_id }`). It is the ONLY place that touches Luka's boundary, and it
does so via his sanctioned endpoints (never direct inserts):

1. Load the offer; `templates = offerToTemplatePayloads(offer, { clientId, bookableProgramId })`.
   Resolve `bookableProgramId` = the client's ACTIVE `bookable_programs` row (error if none:
   "run the Stripe Matcher first").
2. `GET /api/runtime/schedule/templates?client_id=...` -> existing templates. Derive each
   existing template's `matchKey` (`recurrence_rule|default_start_time|default_end_time`).
3. **Create** payloads whose `matchKey` is new -> `POST /api/runtime/schedule/templates`.
   **Skip** ones that already exist (re-sync safe). Optionally **deactivate**
   (`is_active:false` via PATCH) templates that no longer appear in the offer.
4. `POST /api/runtime/schedule/generate-slots { client_id, date_from: today, date_to: +365d }`
   (1-year coverage - see Piece 3).
5. Return `{ created, skipped, deactivated, slots_generated, warnings }`.

**Auth:** these runtime endpoints require a real staff JWT (`getStaffContext`, no secret
bypass). From the client portal the logged-in session JWT works. For a server-side trigger
(cron/webhook) mint a temp staff session with the service-role key, like
`scripts/extend-gta-slots.mjs`.

**Trigger:** call it when the Training offer is published, or from a "Sync schedule to
calendar" action in the offer wizard. Re-runnable any time the schedule/capacity changes.

## Piece 3 - slot coverage (TO DO)

Maintain a **rolling 1-year window** (Zoran 2026-07-07): initial generate-slots runs to
+365d, and a scheduled job keeps re-running generate-slots (idempotent) so coverage never
falls below ~1 year ahead. Mirror GTA's Routine pattern (`scripts/extend-gta-slots.mjs`,
but `date_to = +365d`), unless Luka ships a native auto-extend cron (Q5).

## Decisions (2026-07-07, Zoran + agent leans)

1. **Ownership -> portal orchestrator.** Offer->slots lives portal-side, calling Luka's
   `templates` + `generate-slots` endpoints. His endpoints stay the only write path.
2. **Trial credit cost -> 0.** Trials cost 0 credits; `default_credit_cost:0` on the
   templates. (Revisit only if a credit-based member plan books the same slots.)
3. **Location -> flexible.** `location_id` when the offer's location value is a uuid, else
   `default_location` free text.
4. **Deactivation -> deactivate, never delete.** Removing a class from the offer sets its
   template `is_active:false` (delete is blocked while future slots exist anyway).
5. **Auto-extend -> rolling 1 year, keep extending.** Generate to +365d up front; a
   scheduled job keeps extending so ~1 year of slots is always live.

Still worth a quick note to Luka: confirm he's fine with the portal orchestrating via his
endpoints (Q1), or whether he'd rather own offer->slots on his side.

## Status

- [x] Piece 1 transformation - built + tested (`api/_offer-schedule.js`)
- [x] "Max capacity per session" field on the Training offer wizard
- [~] Piece 2 orchestrator - **DRAFTED** (`api/schedule/sync-offer.js`), DORMANT (not wired to any
  trigger). Can't be live-tested until a `bookable_program` exists (Stripe Matcher). Also needs Luka to
  OK the temp-staff-mint auth path for owner-triggered syncs. Pipeline: transform → dedupe by matchKey →
  POST/PATCH templates → generate-slots in 92-day windows to +365d.
- [ ] Piece 3 slot-coverage cron (re-run generate-slots monthly to hold the rolling 1-year window)
- [ ] Wire a trigger (offer publish, or a "Sync schedule to calendar" button)
