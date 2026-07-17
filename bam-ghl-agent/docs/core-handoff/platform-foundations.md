# Platform Foundations Core Handoff

Owner: Luka (fc-mobile parent app backend). Last updated: 2026-07-14.

This doc records the parent-domain platform tables in `bam-portal` that are
owned by the parent app backend and intended to be adopted by core later.
Schema source material lives in `fc-mobile/docs/`.

## Owned Tables

| Status | Tables |
|---|---|
| Applied (identity) | `customer_profiles`, `students`, `academy_memberships`, `member_links` |
| Applied (schedule read model) | `slot_templates`, `schedule_slots`, `reservations`, `waitlist_entries` |
| Applied (commerce/credits runtime) | `offer_options`, `offer_prices`, `entitlement_templates`, `customer_entitlements`, `credit_ledger` |
| Applied (access spine before booking) | `bookable_programs`; `bookable_program_id` columns on `entitlement_templates`, `customer_entitlements`, `slot_templates`, and `schedule_slots` |
| Applied (trials) | `trial_bookings` |
| Applied 2026-07-03 (parent messaging Phase 1) | `customer_message_threads`, `customer_thread_messages`, `customer_thread_reads` |
| Implemented locally 2026-07-14 (deployment pending) | `parent_notification_events`, `parent_notification_preferences`, `parent_notification_deliveries`; parent Expo extensions on shared `device_tokens` |
| Planned later | parent message attachments, additional notification event producers, and SMS delivery |

## Parent Messaging Model

Parent messaging is anchored on `customer_profiles.id` plus `tenant_id`, with
one `GENERAL` thread per tenant/profile in Phase 1. Writes go through the
service-role-only `customer_send_thread_message` RPC, which creates the thread
when needed, dedupes `client_message_id`, reopens a closed thread only for new
parent sends, and updates sender read state. `customer_thread_messages` stores
snapshotted author fields and deliberately has no FK to `staff` or
`client_users`; staff authorization happens in the API layer. All three
messaging tables follow the parent-domain rule: public schema, explicit
`tenant_id`, RLS enabled with zero policies, and service-role access only.

## Parent Notification Model

Notification events are immutable business facts separated from channel
deliveries and foreground presentation. Preferences are per parent profile,
category, and `PUSH`/`SMS` channel. Only Expo push is active in the first phase;
SMS consent is modeled but no SMS worker or SMS delivery row is created.

`STAFF_MESSAGE_RECEIVED` is the first producer. A database trigger on a new
staff-authored `customer_thread_messages` row creates a deduplicated event in
the same transaction and fans it out to active parent Expo registrations unless
the parent disabled the Messages push category. Delivery is best-effort after
the message commit, with an atomic claim RPC, Expo tickets/receipts, bounded
retry, and invalid-token disabling. All three notification tables use deny-all
RLS and explicit service-role access.
