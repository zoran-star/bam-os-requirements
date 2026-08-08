---
name: Owner/staff SMS notifications (V1.5/V2)
description: Per-academy SMS that texts the teammates an academy picks, from the academy's own GHL number, for 8 events. Config in Blueprint → Staff. Built 2026-06-23/24.
metadata:
  type: project
---

# Owner/staff SMS notifications (V1.5/V2)

Texts the teammates an academy selects, **from the academy's own GHL number**, for a set of events. V1.5/V2 only. Built 2026-06-23/24.

## Data
- `clients.notification_prefs` jsonb: `{ "<event_key>": ["<client_users.id>", ...] }` — who gets texted per event. Empty = nobody.
- Recipients' phones come from `client_users.phone` (the teammate phone field added same session; invite + edit-anytime).
- `post_trial_escalations(client_id, appointment_id unique, ghl_contact_id, created_at)` — dedup for the post-trial cron.

## Core helper
- `api/_notify-owners.js` → `notifyOwners(clientId, eventKey, message)`. Loads the client, gates V1.5/V2, resolves selected teammates' phones, sends via `sendSms()` (`api/ghl/_core.js`, academy's GHL number). Non-throwing, dedupes by phone. Call as `notifyOwners(...).catch(()=>{})` from any trigger.

## Config UI
- Client portal **Blueprint → Staff → 🔔 Notifications** (owner/BAM-staff only, CRM tiers): per event, tap teammates to toggle. Saves via `POST /api/clients?action=set-notification-prefs`. Functions in client-portal.html: `_bbRenderNotifPanel`, `_bbNotifToggle`, `_bbNotifSave`, events list `_NOTIF_EVENTS`.

## The 8 events + triggers
| event_key | fires from | tier |
|---|---|---|
| inbox_message | `api/ghl/inbound-webhook.js` (inbound logged) | V1.5/V2 |
| calendar_booking | `api/ghl/inbound-webhook.js` AppointmentCreate branch (fetches contact+time) | V1.5/V2 |
| stripe_payment | `api/stripe/webhook.js` new-member first paid | V1.5/V2 |
| new_signup | `api/stripe/webhook.js` signup activation | V2 (UI) |
| payment_failure | `api/stripe/webhook.js` invoice.payment_failed | all (has recipients only if set) |
| ticket_update | `api/tickets.js` request_client / approve / send_for_final_review | all |
| action_item | `api/action-items.js` create | all |
| post_trial_escalation | cron `api/ghl/cron-post-trial-escalate.js` (every 15m) | V1.5/V2 |

## Gotchas / dependencies
- **Calendar bookings need the FC marketplace app subscribed to the `AppointmentCreate` webhook event** (same URL as InboundMessage: `/api/ghl/inbound-webhook`). Until that's on in GHL, booking texts don't fire. Verified our endpoint routes appointment payloads → `{type:"appointment"}`.
- **post_trial_escalation** only fires for academies with trial calendars set (`ghl_kpi_config.booking_calendar_ids`) + recipients chosen. Logic: trial appointment ended ≥15 min ago + no `post_trial_reviews` row for the contact → text + dedup row. Cron in `vercel.json` `*/15`.
- Texting needs the teammate to have a **phone on file** (their row in Blueprint → Staff).
- **GTA is fully wired live**: all 8 events → Zoran (`client_users` owner row, phone +14165733718).

See [[project_multi_user_portal]] (teammate phone), [[project_sales_comms]] (post-trial), [[project_v15_tier]].

## Idea parked 2026-07-03 (Zoran): customizable regular digest notifications
Beyond per-event texts: RECURRING digest notifications (daily/weekly summary
per academy) with owner-side customizability - which sections (leads, bookings,
payments, marketing machine health), frequency (daily/weekly/off), channel
(SMS/email/push), per teammate. Would slot into the existing
notification_prefs jsonb + Blueprint -> Staff -> Notifications panel pattern.
Not scoped, not scheduled - parked for a future session.

## ⚠️ It reaches almost nobody (found 2026-08-07)

Zoran got a "New booking" text for **GAME Winner**, an academy that is not his,
and asking why turned up the state of the whole channel.

**`notifyOwners` sends to the OWNER always, plus anyone in `notification_prefs`.**
Recipients are picked by *who has a phone on file*, and a recipient with a blank
phone is silently skipped. Measured across every V1.5/V2 academy:

| | count |
|---|---|
| active `client_users` owner rows | 39 |
| **with a phone number** | **6** |
| of those, Zoran's | 5 |
| **real academy owners reachable by SMS** | **1** (Elijah, San Jose) |

`notification_prefs` is `{}` on the academies checked, so no teammates are
selected either. **The channel runs, returns `ok: true`, and delivers to nobody.**
`notifyOwners` reports `{ ok: true, recipients: 0 }` when it reached zero people,
which is why nothing ever surfaced. See [[reference_assurance_without_connection]].

### The role bug that made Zoran the recipient
Two bulk service-role INSERTs attached his GTA login (`info@byanymeanstoronto.ca`,
auth user `8dab9ca4-...`) to academies so he could get into them:

- `2026-06-03 13:48:23.484047` - 36 rows, role **`member`**. Harmless.
- `2026-06-29 17:01:29.989808` - 7 rows, role **`owner`**. ← the bug

Same intent, wrong role the second time. Because `notifyOwners` queries
`role=eq.owner` and his was the only owner row with a phone, he became the sole
recipient for four client academies while their real owners (Kyle Randall, Najee
Fitzgerald, Jeremy Heil, Nathan Poelsma) got nothing.

**Fixed 2026-08-07:** those 6 rows set back to `member` (BAM Internal Ads left as
owner - Zoran is its only owner and it is V1, so it never notified anyway). He is
now owner on BAM GTA + Internal Ads only. Being a `member` costs him nothing:
`_canManageAll` in client-portal.html is `role === 'owner' || _IS_BAM_STAFF`.

**`client_users` has no `created_by` column**, so who ran those INSERTs is not
recorded anywhere. Worth adding if provenance ever matters.

### Still open
Stopping the wrong recipient did not create a right one. The four academies now
notify **zero** people. The real gap is that owner phone is never captured:
33 owners have none. Fix the capture and backfill before building any opt-out,
or the opt-out governs a channel that reaches one person.
