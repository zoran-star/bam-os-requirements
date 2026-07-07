# Free Trial Calendars on the Parent App Spine - Design Proposal

Owner: Zoran (BAM Portal)
For review by: Luka (fc-mobile parent app backend)
Status: Historical proposal; shipped on the runtime spine
Last updated: 2026-07-07

2026-07-07 status note: the trial booking infra this proposal describes has
shipped: `trial_bookings`, shared capacity through `slot_spots_taken`, public
trial slot/booking APIs, staff trial outcome APIs, and staff calendar visibility.
Use `parent-app-architecture-handoff.md` and `parent-app-db-boundary.md` for the
active guardrails.

## TL;DR

Replace the two GHL free-trial calendars (Younger 9-13, Older 14+) with `FREE_TRIAL`
slots on the **existing** `bookable_programs` Training spine, split by an
`audience_group`, booked into one new `trial_bookings` table. The staff calendar then
shows trials + member classes together, and trial-to-paid conversion flows straight
into the member booking spine.

**Key principle (from the handoff doc):** Free trials are NOT reservations. No
membership, no credits, no entitlement until conversion.

## 1. What the two calendars are today

The two trial calendars differ by **age band only** - same days, same program,
different times. Both currently live in GHL; the AI booking agent picks the group by
athlete age.

| Calendar | Age | Mon-Thu | Saturday |
|---|---|---|---|
| Younger (Group 1) | 9 to 13 | 7-8pm | 11:30am-12:30pm |
| Older (Group 2) | 14+ | 8-9pm | 12:30-1:30pm |

- Entry point: website form at `byanymeanstoronto.ca/free-trial`
- Routing: AI booking agent sets `book_group = Group 1` or `Group 2` by age, then
  books the matching calendar.
- Capacity (documented): ~6-12 players per session, 2+ coaches.
- Runs on holidays.

**The insight:** this is not two programs. It is **one program (BAM GTA Training), two
audience streams.** Conversion from either trial lands in the same Training membership.

## 2. How it fits Luka's spine

```text
bookable_programs  ("BAM GTA Training")   <- already seeded, reuse it
        |
   slot_templates (booking_kind = FREE_TRIAL)
        |  + audience_group: 'U13' | '14_PLUS'   <- splits the 2 calendars
        v
   schedule_slots (FREE_TRIAL)            <- the bookable trial times
        |
        v
   trial_bookings  (NEW table)            <- the lead's booking. NO credits, NO membership
        |
        v  (post-trial form sets status)
   BOOKED -> SHOWED -> CONVERTED
                         |
                         v
              creates academy_membership
              + customer_entitlement      <- now they enter the member booking spine
```

### The two calendars = one filter, not two systems

Both are `schedule_slots` where `booking_kind = 'FREE_TRIAL'`, split by a single column:

| Lead picks | Query |
|---|---|
| Younger calendar | `FREE_TRIAL` slots where `audience_group = 'U13'` |
| Older calendar | `FREE_TRIAL` slots where `audience_group = '14_PLUS'` |

The AI agent already decides the group by age - it just writes to `trial_bookings`
instead of GHL.

## 3. Proposed new table: `trial_bookings`

```text
trial_bookings
  id, tenant_id
  bookable_program_id        -> Training
  schedule_slot_id           -> the chosen trial slot
  audience_group             'U13' | '14_PLUS'
  website_lead_id            -> the lead
  parent_name, athlete_name, athlete_age, email, phone
  status   BOOKED / CANCELLED / SHOWED / NO_SHOW / CONVERTED
  source   website / staff / agent
  booked_at, cancelled_at, metadata jsonb
  created_at, updated_at
```

Why a separate table (not `reservations`):

- A trial lead has no `academy_membership_id`.
- It consumes no credits and needs no active entitlement.
- Forcing trials into `reservations` would break the member/credit model.

The staff calendar then reads **both** off the same `schedule_slots`:

- member bookings: `schedule_slots + reservations`
- trial bookings: `schedule_slots + trial_bookings`

## 4. Free-trial flow without GHL

1. Website asks our API for trial availability.
2. API reads `schedule_slots` for Training where `booking_kind = FREE_TRIAL` and the
   right `audience_group`.
3. Parent (or AI agent) chooses a slot.
4. API saves the `website_lead`, locks the slot, checks capacity, inserts
   `trial_bookings`.
5. Portal calendar reads `schedule_slots` + `trial_bookings`.
6. Post-trial form updates `trial_bookings.status` (SHOWED / NO_SHOW).
7. On conversion, create the `academy_membership` + `customer_entitlement`, set
   `trial_bookings.status = CONVERTED`.

## 5. Open decisions before build

These are the handoff doc's open questions, with our case applied:

| Decision | Recommendation |
|---|---|
| One program or two? | **One** (Training), split by `audience_group`. |
| Where does age-group routing live? | New `audience_group` column on the trial slots (simplest). |
| Do trial slots share capacity with member classes, or are they dedicated trial sessions? | **Need a call** - are the Mon-Thu trial times dedicated trial sessions, or trialists dropped into existing member classes? |
| Which reminders replace GHL first? | **Need a call** - SMS only, + day-of reminder? (confirm-agent copy already exists) |
| Keep `trial_booking_id` on the member after conversion? | Recommend yes (for trial-to-paid analytics). |

## 6. Constraints / sequencing (from the boundary doc)

- `trial_bookings` + new columns on `slot_templates` / `schedule_slots` **touch
  Luka-owned scheduling tables** -> per the DB boundary doc, this needs a **Luka sync
  before any migration.**
- Should land **after** the operational offer-pricing cutover, not before (Luka's
  stated sequencing).
- Luka tables stay deny-all RLS (service-role only). No new `authenticated` policies.
- `0005` booking-write RPCs are now deployed; trial booking writes follow the
  same service-role-RPC pattern.

## 7. Current state reference

- Schema for the member spine is applied in prod (`parent_0001` to `0004`);
  `bookable_programs` has the BAM GTA Training row seeded.
- Parent runtime identity/schedule/entitlement data is live; parent-created
  member reservations remain empty until parent launch traffic.
- Booking-write RPCs (`0005`) are deployed.
- Trial booking infra is deployed and live for website trials.

## Related docs

- [`parent-app-architecture-handoff.md`](parent-app-architecture-handoff.md) (section: Free Trials After GHL)
- [`parent-app-db-boundary.md`](parent-app-db-boundary.md)
