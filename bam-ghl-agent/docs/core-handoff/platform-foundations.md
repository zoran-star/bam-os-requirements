# Platform Foundations Core Handoff

Owner: Luka (fc-mobile parent app backend). Last updated: 2026-07-03.

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
| Planned later | parent message attachments and notification delivery tables |

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
