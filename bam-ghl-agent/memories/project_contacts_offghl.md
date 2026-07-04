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
3. **Flip GTA** (REORDERED ahead of creation - lower risk) - gate the sync cron so it
   does NOT `bulkUpsertPortalContacts` for contact_provider='portal' (else it clobbers
   portal-only edits), then set GTA contact_provider='portal'. Store verified flip-ready
   2026-07-01: `contacts` is a superset of `ghl_contacts` (1725 vs 1701, 0 missing,
   names match, tags match). No frontend reads `ghl_contacts` directly. leads.js already
   dual-writes the store + portal-routes automations, so new leads land in the store even
   with the cron gated.
4. **Portal-native creation** - DONE 2026-07-01 (4th PR). New contacts are found-or-minted
   in the store via `resolveOrMintPortalContact(clientId, fields)` (in `_contacts.js`):
   match by email (preferred) or phone -> merge-update + reuse the existing join id (a
   legacy person keeps their real GHL id, history stays joined); else MINT one uuid used
   as BOTH `contacts.id` and `contacts.ghl_contact_id` - the minted id flows through the
   system-wide join key with no schema change. Gated sites (provider='portal' branch):
   - `website/leads.js` pushToGhl: mints in the store; GHL note + conversation skipped
     (message lives on website_leads + mapped custom_fields); GHL workflow fallback gated.
   - `onboarding/activations.js` (member signup): resolve-or-mint instead of GHL upsert;
     tags omitted from the follow-up upsertPortalContact (it REPLACES arrays - the mint
     already union-merged); legacy GHL workflow fallback gated.
   - `website/onboarding.js` (ADAPT waiver): mint + stamp lead; GHL note/convo/workflow skipped.
   - Inbound webhooks create no contacts (read-only resolution) - nothing to gate.
   **THE ONE RESIDUAL (requireGhl)**: a lead submission WITH a calendar booking still does
   the GHL /contacts/upsert, because `POST /calendars/events/appointments` needs a real GHL
   contact id and CALENDARS ARE STILL ON GHL (Zoran deferred them). Remove when calendars
   move off GHL. The GHL id still dual-writes to the store, so data stays home either way.

## Status - GTA FLIPPED LIVE 2026-07-01
- GTA contact_provider='portal' (flipped after the cron gate deployed; store verified:
  1,725 contacts, tags/emails intact, superset of the mirror). All other 43 academies 'ghl'.
- GTA now: messaging=twilio, email=resend, pipeline=portal, contacts=portal, booking=portal.
- GHL touches left for GTA contacts: (1) the booking-flow GHL upsert (calendar residual,
  above), (2) pipeline stage-NAME reads (documented in project_pipeline_offghl). Plus the
  deferred KPIs + calendars.

## Tags for GTA are effectively OFF GHL (verified 2026-07-04)
Question came up: "are tags fully off GHL for GTA v2?" Answer: functionally yes.
- **Writes**: portal-native already (`mergePortalContactTags` -> `contacts.tags[]`, Stage 2 above).
- **Classification (lead vs member)**: GTA does NOT use GHL tags. Because GTA is on the
  own-store inbox path (twilio+resend), `inbox.js` classifies via `classifyStoreConversations`
  (inbox.js:239-295) = match against the portal `members` table (by contact id / phone /
  email); member if matched, else lead. ZERO GHL calls. The GHL tag classification path
  (inbox.js:621-673, reads `offers.data.lead_tags`/`client_tag` then hits GHL
  `/contacts/search`) is only reached by academies NOT on the store path (the 43 GHL ones).
  The store-path branch is chosen at inbox.js:448 (`if (smsOn || emailOn || metaOn)`).
- **So the offer's `lead_tags`/`client_tag` fields are DEAD CONFIG for GTA** - nothing reads
  them. Left in place (harmless); not deleted.
- **UI change 2026-07-04** (client-portal.html): offer builder now HIDES the GHL tag dropdowns
  (`ghl_tags_multi` "Lead tags" + `ghl_tag` "Member tag") for portal academies. New global
  `CONTACT_PROVIDER` ('ghl'|'portal') set on login (~43226) + academy switch (~25101) from
  the clients `.select` (contact_provider added at ~43153). Gate `_bbHideTagFields()` +
  `_TAG_TYPES` used in `_bbRenderStepFields` (~24424). Mirrors the existing `_bbIsV1()` gate.
## Tag catalog off GHL - DONE 2026-07-04 (simpler than the original scope)
The last GHL tag-list call for GTA (`_bbLoadTags()` -> `/api/ghl/comms-config` ->
GHL `/locations/{id}/tags`) is gone. The original scope proposed a new `tag_provider`
flag + `ghl_tag_defs` table + GHL sync - all UNNECESSARY. The academy's live tag
catalog = the DISTINCT tags already on its portal contacts, so we DERIVE it from
`contacts.tags[]` (the same pattern `mass-send.js` already used). No new table, no
migration, no cron, no new flag - gated on the existing `contact_provider='portal'`.
- **Endpoint**: `GET /api/contacts?action=tag-list&client_id=` -> `{ tags: [names] }`,
  distinct `unnest(tags)` over `contactsReadTable(clientId)` (works for portal + GHL).
- **`_bbLoadTags()`** (client-portal.html): for `CONTACT_PROVIDER==='portal'`, fetch
  `action=tag-list` instead of comms-config. Populates `_bbTagList` (feeds the contact
  tag editor + the now-hidden offer fields) with ZERO GHL calls.
- **Free-type new tags**: the contact tag editor (`_tagEditorHtml`/`_tagAddNew`) gained a
  "+ new tag" text input for portal academies. Needed because a derived catalog only
  contains APPLIED tags - typing is how a brand-new tag first enters. On add it's pushed
  into `_bbTagList` locally so it shows immediately. GHL academies: dropdown-only, unchanged.
- **No flip needed**: GTA is already `contact_provider='portal'`, so this is live for GTA
  on deploy; the 43 GHL academies are untouched (still use comms-config/GHL).
Net: GTA tags are now 100% off GHL - classification (members table), writes
(`contacts.tags[]`), AND the catalog (derived from `contacts.tags[]`). Shipped in PR #1131.
