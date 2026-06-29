# Free Trial Calendars - Confirmed Decisions

Owner: Luka
Audience: Zoran and BAM Portal agents
Status: Confirmed direction after reviewing Zoran's proposal
Last updated: 2026-06-29

This doc captures the agreed adjustments to
[`trial-calendars-proposal.md`](trial-calendars-proposal.md). It is intended as the
short handoff for implementing free-trial booking off GHL without confusing trial
bookings with paid member reservations.

## Summary

Free-trial athletes and paid members should book into the same real-world training
session when they attend the same class.

That means `schedule_slots` represent the actual court/session, not the booking
channel. Paid member bookings and free-trial lead bookings point at the same slot
from separate tables.

```text
bookable_programs
  BAM GTA Training
        |
        v
schedule_slots
  Monday Older Training, capacity 15
        |
        +-- reservations      -- paid member bookings
        |
        +-- trial_bookings    -- free-trial lead bookings
```

## Confirmed Decisions

### 1. Keep `trial_bookings` separate from `reservations`

Use `trial_bookings` for free-trial leads because a trial lead does not have a
membership, credits, or entitlement yet.

`reservations` stays the paid/member booking table. It should continue to require a
real `academy_membership`, run entitlement checks, and debit/refund credits where
needed.

### 2. Do not duplicate schedule slots for trials

Do not create separate trial-only schedule slots when the trial athlete attends the
same session as paid members.

Not this:

```text
Monday Older Training - member slot
Monday Older Training - trial slot
```

Use one slot:

```text
Monday Older Training
  paid bookings  -> reservations
  trial bookings -> trial_bookings
```

### 3. Do not add `booking_kind` for the shared-slot model

Zoran's proposal used `booking_kind = FREE_TRIAL` because it assumed free trials
would be represented as their own slot kind.

We are not doing that for shared training sessions. The slot is still a normal
training/class slot. The booking table tells us whether the booking is paid/member
or trial/lead.

Only introduce a trial-specific slot kind later if BAM creates a real trial-only
session that is not available to paid members.

### 4. Availability is calculated, not stored

Do not store `spots_left` or `booked_count` as source-of-truth columns on
`schedule_slots`.

For shared trial/member sessions:

```text
spots_used =
  confirmed reservations
  + active trial_bookings

spots_left =
  schedule_slots.capacity - spots_used
```

Current parent classes already calculate availability from row counts. Trial
availability should extend that same pattern by adding active `trial_bookings` to
the count.

### 5. No trial-specific capacity cap for now

For now, do not add a separate `trial_capacity` restriction.

Trial bookings and paid bookings consume the same session capacity. If a session has
15 spots, the total of confirmed paid reservations plus active trial bookings should
not exceed 15.

### 6. Add conversion lineage on `trial_bookings`

When a trial converts to a paid/member account, link that conversion from the
`trial_bookings` row rather than adding `trial_booking_id` to shared member tables.

Add these nullable fields to `trial_bookings`:

```text
converted_member_id
converted_membership_id
converted_at
```

Conversion lifecycle:

```text
trial booked
  -> trial_bookings.status = BOOKED

trial happens
  -> status = SHOWED or NO_SHOW

checkout / signup completes
  -> member exists or is created
  -> academy_membership exists or is created
  -> customer_entitlement exists
  -> trial_bookings.status = CONVERTED
  -> converted_member_id / converted_membership_id / converted_at are filled
```

This keeps attribution and analytics without making core member rows depend on the
trial system.

## What Still Stands From Zoran's Proposal

- Free trials should move off GHL and onto BAM-owned scheduling.
- Free trials should reuse the existing `BAM GTA Training` `bookable_programs` row.
- The two GHL calendars are not two programs; they are age/time streams under the
  same Training program.
- The staff calendar should eventually show paid reservations and trial bookings
  together for the same slots.
- Trial writes should use the same service-role/RPC transaction pattern as parent
  booking writes.
- Trial-to-paid conversion should flow into `academy_memberships` and
  `customer_entitlements`.

## What Changes From Zoran's Proposal

| Proposal item | Confirmed direction |
|---|---|
| `booking_kind = FREE_TRIAL` slots | Do not add for shared sessions. |
| Separate trial slots | Do not duplicate slots when trials attend normal classes. |
| Query "trial availability" from trial slots | Query normal training slots and count both paid + trial bookings. |
| Trial availability counts only trial bookings | Availability counts confirmed `reservations` plus active `trial_bookings`. |
| `trial_booking_id` on member after conversion | Keep conversion links on `trial_bookings` instead. |
| Trial-specific capacity | Not needed for now. |

## Implementation Notes

The first implementation should focus on:

1. Add `trial_bookings`.
2. Add conversion lineage fields on `trial_bookings`.
3. Add a transaction-safe trial booking RPC/API that locks the `schedule_slots` row,
   counts confirmed `reservations` plus active `trial_bookings`, then inserts the
   trial booking only if capacity remains.
4. Update read APIs/calendar views to include trial booking counts when reporting
   availability.

Additional slot/template fields such as `allows_trial_bookings` or
`trial_audience_group` can be added later if implementation needs explicit
machine-readable filtering. They are not part of the confirmed minimal direction.
