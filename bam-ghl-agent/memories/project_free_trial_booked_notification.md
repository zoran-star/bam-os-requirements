# Free trial booked: the owner's text

**Shipped 2026-07-31.** Zoran's ask: text the academy owner when a free trial is
booked, and let the owner pick which teammates also get it.

## The bug it fixes

`calendar_booking` was already a pill in the client portal's Team card, and BAM
GTA had it switched **ON** for a teammate. It fired from exactly ONE place -
`api/ghl/inbound-webhook.js`, on a GHL `AppointmentCreate`.

GTA's `booking_provider` is `portal`. Portal bookings go through the
`book_trial_slot` RPC and **create no GHL appointment at all**. So across **25
trial bookings in 30 days, it sent nothing**, while the settings screen said it
was on the whole time. Zoran confirmed independently that he had never received
one. DETAIL Miami (also `portal`) was in the same state.

Nothing threw and nothing was logged, because nothing was broken: the code that
existed did what it said. The **wire** between the switch and the event never
existed. See [[reference_assurance_without_connection]] - this is that shape
exactly.

## How it works now

| Piece | Where |
|---|---|
| Event declared by the preset | `PRESETS.free_trial.notifications` in `api/agent/presets.js` |
| Exposed to the UI | `presetNotifications()` + `presetContents()` -> `/api/offers/apply-preset?action=list` |
| One notifier | `api/_notify-trial-booked.js` (`notifyTrialBooked({clientId, trialBookingId, kind})`) |
| Sender | existing `notifyOwners()` -> owner ALWAYS + opted-in teammates, from the academy's own number |
| Setting UI | existing per-teammate pill row, Blueprint -> Team, owner-only. **No new surface.** |
| Storage | `clients.notification_prefs.free_trial_booked` (jsonb, no migration needed) |

`kind` is `booked` / `cancelled` / `rescheduled` - **one pill, three triggers**,
not three pills (Zoran's call).

## The two rules that matter

**1. The preset owns the pill.** `_NOTIF_EVENTS` in `client-portal.html` is the
tier list (`crm` / `v2`); preset events are loaded at runtime from the manifest
into `_BB_NOTIF_PRESET_EVENTS`. **Never hardcode a preset event in
`_NOTIF_EVENTS`** - that is precisely how `calendar_booking` came to render for
academies whose bookings could never reach it. An academy with no preset stamp
sees no pill. `api/_notify-trial-booked.test.mjs` check 5 enforces this.

**2. Text when the FAMILY acts, stay silent when the ACADEMY acts.** The owner
does not need a text about the button they just pressed.

| Fires | Silent |
|---|---|
| website funnel, free-trial page form, Miami page, parent app, agent/staff Book-it | calendar drawer "mark cancelled" (`api/ghl/calendars-v15.js`), Confirm deck "can't make it" / park (`api/agent-confirm.js`) |

## GHL-booking academies

They never touch `trial_bookings`, so their text still comes from the
appointment webhook. `trialBookingEventForGhlCalendar()` upgrades it to
`free_trial_booked` **only** when the appointment's calendar is an entry point
tied to an offer whose preset declares the event. Everything else keeps
`calendar_booking` - BAM runs a Coach Cert calendar through it. One pill means
one thing on both transports, and applying the preset never hands an academy a
dead switch.

Also fixed in passing: that webhook rendered its time in the **server's**
timezone (UTC on Vercel), so a Toronto owner read a booking three hours off with
no zone in the string. Now `clients.time_zone`, via `formatSlotTime()`.

## The guard

`node api/_notify-trial-booked.test.mjs` - check 1 walks EVERY file that invokes
`book_trial_slot` / `cancel_trial_booking` / `reschedule_trial_booking` and fails
unless it notifies or is on `SILENT_ON_PURPOSE` with a written reason. The caller
**count is pinned** (7), because a scan that quietly narrows passes every other
check while the gap it exists to catch walks straight through - an earlier
version did exactly that and went green with `api/parent/trial-booking.ts`
missing. `MUTATE=unwire` proves it bites.

## Open / gotchas

- **GTA's 4 teammates all have a blank `client_users.phone`.** Only the owner has
  a reachable number, so only Zoran receives it until phones are filled in.
- Backfill `20260731T210000_carry_calendar_booking_to_free_trial_booked.sql`
  copies GTA's existing `calendar_booking` recipient onto the new key. **In
  APPLIED 2026-07-31**, verified by read-back: GTA carries the same recipient on
  both keys, ShigHoops correctly untouched (it has `calendar_booking` set but no
  preset stamp, so no pill). Inert until the code merges.
- `discovery_trial` deliberately does NOT declare the event (Zoran's call). The
  test notes it so preset #2 gaining it is a deliberate edit.
- `reschedule` only exists on the website path. An agent-driven rebook is a
  cancel then a book, so it sends two texts, which is honest.

Related: [[project_calendar_off_ghl]], [[project_staff_perms_notifs]],
[[project_sales_preset_data_mandatory]], [[reference_assurance_without_connection]]
