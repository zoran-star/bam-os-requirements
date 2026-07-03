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
