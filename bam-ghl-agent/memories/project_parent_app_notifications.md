---
name: Parent app notifications
description: 2026-07-14 local push foundation across bam-portal and fc-mobile; staff message is the first complete Expo tracer, SMS modeled but inactive
type: project
---

# Parent app notifications

Owner: Luka. Policy source of truth:
`fc-mobile/docs/parent-app-notifications.md`.

## Decision

Recording an event, creating a channel delivery, and showing a foreground alert
are separate decisions. Self-originated immediate acknowledgements do not push
when actor and recipient are the same parent. External/asynchronous/attention
events may push when enabled. Push ships first. SMS plus consent are represented
in the model but no SMS delivery or worker exists yet.

## Local implementation (2026-07-14)

- Migration:
  `bam-portal/supabase/migrations/20260714043304_parent_notifications.sql`.
- Tables: `parent_notification_events`, `parent_notification_preferences`,
  `parent_notification_deliveries`. They are RLS enabled with zero policies and
  explicitly service-role only.
- `device_tokens` is shared safely: existing client portal rows default to
  `CLIENT_PORTAL` + `APNS`; parent rows use `PARENT` + `EXPO`. Every sender query
  must include both scope and provider. Legacy direct RLS is restricted to the
  client-portal APNs path.
- Parent APIs: `/api/parent/devices`,
  `/api/parent/notification-preferences`, and protected
  `/api/parent/notifications-worker` (five-minute cron).
- Delivery: Expo tickets, receipts, bounded exponential retry, stale-claim
  recovery, and `DeviceNotRegistered` token disabling. Optional
  `EXPO_ACCESS_TOKEN` is supported.
- First producer: an inserted staff-authored `customer_thread_messages` row
  transactionally creates `STAFF_MESSAGE_RECEIVED`, deduped by message ID, then
  fans out to active preference-eligible parent devices. Staff send awaits a
  best-effort immediate dispatch capped at three seconds; the cron is the
  safety net. Push failure never fails the message.
- Native: `expo-notifications` config plugin, authenticated token registration,
  installation identity in SecureStore, token-rotation listener, best-effort
  unregister before sign-out, Profile permission/global preference control,
  message query invalidation on receipt, banner suppression while Messages is
  active, and one-time tap routing after auth/navigation readiness.

## Verification completed locally

- Fresh `supabase db reset` replay passed through the new migration and seeds.
- Rollback-only SQL tracer passed: message -> event -> delivery -> atomic claim,
  plus acknowledgement suppression, preference suppression, zero SMS delivery,
  and deny-all parent-table access assertions.
- Parent API TypeScript and targeted ESLint passed; 75 parent/client API unit
  assertions and 79 local Supabase-backed runtime assertions passed.
- fc-mobile workspace TypeScript and lint/format checks passed.
- Supabase linter found only older unrelated issues in
  `parent_join_waitlist`, `cancel_trial_booking`, and `merge_contacts`.

## Not deployed; rollout prerequisites

No hosted migration, Vercel deploy, credential mutation, EAS build, or push send
was performed. Before physical-device E2E:

1. review/apply the linked migration and deploy parent APIs/cron with
   `CRON_SECRET`;
2. configure APNs credentials for iOS;
3. configure Firebase apps for every Android package variant and expose the
   service file through the EAS file variable `GOOGLE_SERVICES_JSON`;
4. build a new development client (remote push is unavailable in Expo Go and
   cannot be proven on an iOS simulator);
5. test foreground Messages suppression, outside-Messages presentation, and a
   terminated-app notification tap on a physical device.
