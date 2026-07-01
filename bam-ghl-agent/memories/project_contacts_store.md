# Portal-native contacts store (off-GHL contacts)

**2026-06-30: PR 1 landed (dormant foundation).** Sibling of [[project_pipeline_store_cutover]] and [[project_twilio_messaging_spine]] - same own-store pattern (provider toggle + `ghl_*` bridge + backfill). This note = the contacts/people system-of-record only. Inbound email/social DMs are a separate effort (still on GHL).

## Current state (2026-06-30)
- **Dormant.** Nothing reads `public.contacts` yet. Every academy `contact_provider='ghl'`. Zero behavior change. V1/V1.5 untouched.
- Migration `20260630210000_contacts_store_foundation.sql` applied to prod directly (like the pipeline/messaging foundations, it is NOT in the remote `list_migrations` history - git file is the record; applied via MCP execute_sql).
- Backfill from `ghl_contacts` ran on prod: **GTA = 1,701 contacts** (exact match to source), 53,156 all-academy total.

## The toggle
- `clients.contact_provider` ('ghl' | 'portal'), checked constraint. Default 'ghl'. Flip to 'portal' only after portal writes dual-write to GHL + reconcile.

## The store - `public.contacts`
- Portal UUID `id` = the intended new join key. `ghl_contact_id` = reconciliation bridge (unique per client_id), lines up with `members.ghl_contact_id`, `opportunities.ghl_contact_id`, `website_leads.ghl_contact_id`, inbox.
- Columns mirror `ghl_contacts`: first/last/name, email, phone, athlete_name, tags[], dnd, stripe_customer_id, date_added + `source` ('ghl-import' for backfill) + `custom_fields` jsonb (opaque GHL blob carried forward until the field-defs PR).
- RLS mirrors sibling stores: select = `is_staff() or client_id in (select my_client_ids())`; write = `is_staff()`.
- Indexes: client_id, (client_id, ghl_contact_id), (client_id, lower(email)), (client_id, phone), gin(tags), stripe_customer_id.

## NOT built yet (next PRs, in order)
1. **Repoint joins** - add `contact_id` uuid to members/website_leads/opportunities/(inbox); dual-read (prefer contact_id, fall back to ghl_contact_id).
2. **Portal writes + dual-write to GHL** - contact create/edit + website leads + Stripe signups write `contacts`; still push to GHL (shadow) so inbox/email/social resolve the person.
3. **Owner-managed custom-field definitions** - new `custom_field_defs` + values tables + Settings UI; migrate the opaque GHL blob into real defs. Feeds the portal merge-var resolver (`api/email-shells.js resolveMergeVars`).
4. **Flip `contact_provider='portal'` + stop the inbound `cron-sync-contacts.js`.** BLOCKED until inbound email + social DMs also leave GHL (GHL needs the contact to exist to thread an incoming IG DM / email reply).

## PRs
- **#959:** PR 1 - foundation (`contact_provider` toggle, `contacts` table + RLS + indexes, backfill from `ghl_contacts`).
