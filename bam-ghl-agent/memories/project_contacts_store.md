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

## P2 done (2026-06-30, dormant) - contact_id FK added + backfilled
- `contact_id uuid references contacts(id) on delete set null` on **members, website_leads, opportunities** (+ index each). Migration `20260630211000`. Nothing reads it yet; code still joins on `ghl_contact_id` (byte-identical).
- GTA backfill coverage: members 34/39 (5 have no ghl_contact_id = portal-native), website_leads 36/81, opportunities 13/30.
- **FINDING: the `ghl_contacts` mirror is INCOMPLETE.** 45 leads + 17 opps reference GHL contact IDs that are NOT in `ghl_contacts` (so not in `contacts` either). The mirror/cron doesn't cover every contact. Fix = create contact rows from lead/opp data in P3 (portal owns creation), OR do a fuller GHL pull. Until then those rows dual-read via `ghl_contact_id`.
- Inbox tables (`ghl_inbound_messages`, `inbox_message_log`, `ghl_conversation_reads`) NOT repointed yet - deferred to the inbox effort.

## P3 done (2026-07-01, dormant) - gap closed + dual-write live paths
- **P3a (data, migration `20260701120000`):** materialized contacts from website_leads + opportunities own fields for rows whose GHL id was never mirrored, then re-linked. GTA now website_leads 81/81 + opportunities 30/30 linked.
- **P3b (code):** new `api/_contacts.js` = `upsertPortalContact(clientId, ghlContactId, fields)` (returns portal id) + `bulkUpsertPortalContacts(rows)`. Best-effort, only writes `public.contacts`, NEVER calls GHL (dormant-safe). `clean()` drops empty values so sparse callers don't null good data under merge-duplicates. Wired at 4 paths: `onboarding/activations.js` (member enroll + links members.contact_id), `website/leads.js` (receipt stamp + links website_leads.contact_id), `website/ch3-lead.js` (CH3 upsert), `ghl/cron-sync-contacts.js` (V1.5 bulk mirror). **Goes live on merge+deploy** - smoke-test a website lead + a signup after deploy to confirm a contacts row lands.

## NOT built yet (next PRs, in order)
1. ~~Repoint joins~~ **DONE (P2).** 2. ~~Portal writes + dual-write~~ **DONE (P3).**
3. **P4a DONE (2026-07-01, dormant, migration `20260701130000`):** `custom_field_defs` (per academy: key/label/type/options/position/required/archived + `ghl_field_id` bridge, unique client_id+key) + `contact_field_values` (typed value per contact+field, RLS joins to contacts). Empty, nothing reads them.
   **P4b management UI DONE (2026-07-01, PR #960):** staff-portal "Custom Fields" nav tab (admin/scaling_manager), `api/custom-fields.js` CRUD over `custom_field_defs` (mirrors `action-items.js`), `src/views/CustomFieldsView.jsx` (academy picker + list + add/edit modal, 9 types). Dormant: definitions only, nothing renders values yet.
   **P4b import-from-GHL DONE (2026-07-01, PR #964):** `api/custom-fields.js` GET `?action=ghl-fields` (reads live GHL customFields, maps dataType->type, flags already-imported) + POST `{action:"import-ghl"}` (creates defs with `ghl_field_id` bridge); "Import from GHL" modal in the view. One-click adopt of an academy's existing GHL fields.
   **P4b value fold-in DONE (2026-07-01, PR #966):** SQL fn `fold_custom_field_values(client_id)` (migration `20260701140000`, security definer) maps `contacts.custom_fields` blob -> `contact_field_values` by `ghl_field_id`; the import-ghl action calls it after adopting fields (returns `{imported, folded}`). Verified on GTA: 559+530 values folded from 2 real fields. So import = fields + their existing values in one click.
   **P4b STILL pending:** (a) render + edit values per contact in the member drawer; (b) feed `api/email-shells.js resolveMergeVars` from defs/values. Definitions + import + values-backfill are all done; only the contact-level display/edit + merge-var read remain.
4. **Flip `contact_provider='portal'` + stop `cron-sync-contacts.js`.** BLOCKED until inbound email + social DMs leave GHL (GHL needs the contact to thread an incoming reply).

## PRs
- **#959:** P1-P4a - foundation (`contact_provider` toggle, `contacts` table, backfill), repoint joins, gap backfill, dual-write code, custom-field schema.
- **#960:** P4b - custom fields management UI (`api/custom-fields.js` + `CustomFieldsView.jsx` + nav tab).
