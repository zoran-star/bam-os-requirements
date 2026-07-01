# Contacts off GHL (contact store) - BAM GTA

**Migrating the CONTACT record (the person: name/phone/email/tags/custom fields)
off GoHighLevel onto the portal `contacts` store**, per-academy via
`clients.contact_provider` ('ghl' default | 'portal'). Zoran chose **FULL REMOVAL**
(2026-07-01): the end state is portal-owned contacts, GHL fully out - reached in
safe stages, V1 untouched throughout.

## The universal-key strategy (important)
`ghl_contact_id` is the join key across ~22 tables (members, opportunities,
sms_threads, email_threads, the agent_* draft tables, contact_trainers, etc.).
We do NOT rename those columns. Instead the column KEEPS its name but its VALUE
stops always being a real GHL id: legacy contacts keep their GHL id; new
portal-native contacts get a portal-minted id (the `contacts.id` uuid) written into
`ghl_contact_id` everywhere. Same idea as the pipeline oppRef falling back to a
portal id. So joins never change - only the id's origin does.

## The store (already existed, backfilled, was dormant)
- `contacts` table (created 2026-06-30): id, client_id, ghl_contact_id (nullable),
  first_name, last_name, name, email, phone, athlete_name, tags[], custom_fields
  (jsonb, opaque GHL blob keyed by GHL field id), dnd, stripe_customer_id, source,
  date_added. Unique on (client_id, ghl_contact_id).
- `ghl_contacts` = the OLD mirror (V1.5), still fed by the sync cron; what reads
  used before this migration.
- GTA: 1,725 contacts in the store, ALL synced fresh (cron
  `cron-sync-contacts.js` runs every 10 min, GHL -> portal via
  `bulkUpsertPortalContacts`). 33 are members.
- Dormant sidecars for the custom-field-defs PR: `custom_field_defs`,
  `contact_field_values` (+ `writePortalFieldValues` in `_contacts.js`).

## The seam (api/_contacts.js)
- WRITES (pre-existing): `upsertPortalContact`, `bulkUpsertPortalContacts`,
  `writePortalFieldValues` - all best-effort, write only `contacts`, never call GHL.
- READS (added Stage 1): `contactProvider(clientId)` -> 'ghl'|'portal' (defaults to
  'ghl' on any error), and `contactsReadTable(clientId)` -> 'contacts' | 'ghl_contacts'.
  Callers swap ONLY the table name (both tables share the search columns).
- WRITES (added Stage 2): `mergePortalContactTags(clientId, ghlContactId, tags, {remove})`
  - store-only tag add/remove (reads tags[], merges case-insensitively, PATCHes back;
  no-op if the portal row doesn't exist yet). Plus a `patch` REST helper.

## Roadmap (4 stages, each its own PR)
1. **READ seam** - DONE 2026-07-01. Every contact-card read routes through
   `contactsReadTable`. Sites: `contacts.js` (Contacts tab search), `agent-contact-notes`,
   `agent-approvals` (x2), `automations` (x2), `kpis-v15` (x2), `agent/contact-memory`,
   `stripe/contact` (read only), `mass-send` (x2). Dormant (all academies 'ghl' =
   byte-identical). `inbox.js` does NOT read ghl_contacts directly (enriches via members).
2. **WRITE seam** - DONE 2026-07-01. Contact-field writes are provider-aware:
   - Tags: `agent/_tags.js` add/removeContactTags + markUnqualified/unmarkUnqualified now
     take a `clientId`; provider='portal' -> `mergePortalContactTags` (store), else GHL.
     Callers updated: `agent-approvals.js` (3 unqualified sites). `contacts.js` staff
     add/remove-tag branches to the store for portal (skips GHL + mirror refresh).
   - Custom fields: `ghl/post-trial.js` gates BOTH GHL custom-field PUTs (attendance +
     trainer) behind `contactProv !== 'portal'` - portal already stores attendance in
     `post_trial_reviews` and trainer in `contact_trainers`, so GHL writes are skipped.
   - Stripe cache: `stripe/contact.js` mirror PATCH now targets `contactsReadTable(...)`.
   NOT YET (Stage 3): the `/contacts/upsert` lead/onboarding creation sites + notes +
   workflow enrollment. All dormant (every academy 'ghl').
3. **Portal-native creation** - new leads created in the store with a portal-minted id
   (no GHL POST); mint flows into the join key. Verify GTA no longer needs GHL workflows
   (it runs portal automations) or gate them.
4. **Flip GTA** - set contact_provider='portal', STOP the cron overwriting portal data
   for portal academies (else it reverts portal edits), verify inbox/drawer/Contacts
   tab/post-trial.

## Status
- contact_provider = 'ghl' for ALL 44 clients (GTA included). Seam is live but dormant.
- messaging=twilio, email=resend, pipeline=portal already. Contacts is the last core one.
