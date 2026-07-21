# Plan: GHL conversation-history import (survive the Twilio cutover)

**Decision (2026-07-21, Zoran):** fix the gap where conversation history lives
only in GHL. Build a portal-owned message store + an import job, and fire the
conversation import **alongside** the contacts import the moment GHL connects.

## The gap (confirmed in code)
- `api/ghl/inbox.js` reads `/conversations/search` + `/conversations/{id}/messages`
  **live from GHL on every open**. It caches only the inbox-LIST payload for 12s
  (`ghl_inbox_cache`) and per-user read receipts (`ghl_conversation_reads`).
  **Message bodies are never persisted.**
- Contacts DO get mirrored (`api/ghl/cron-sync-contacts.js`, every 10 min,
  `bulkUpsertPortalContacts`, stamps `clients.ghl_contacts_last_synced_at`).
- So: leave GHL (Twilio cutover, `contact_provider='portal'`) and all message
  history disappears except active-lead agent snapshots. That's the gap.

## The fix

### 1. New portal-owned store tables
- `ghl_conversations`: client_id, contact_id, ghl_conversation_id (UNIQUE),
  channel (SMS/email/IG/...), last_message_at, last_message_preview,
  unread_count, imported_at, source='ghl'
- `ghl_messages`: ghl_message_id (UNIQUE), conversation_id, client_id,
  contact_id, direction (inbound/outbound), channel, body, from_addr, to_addr,
  sent_at, attachments jsonb, source='ghl'
- Idempotent upsert on the GHL ids (safe to re-run).

### 2. Import job — mirror the contacts-sync pattern
`api/ghl/import-conversations.js` (+ cron in vercel.json):
- Paginate `/conversations/search` per location → for each convo pull
  `/conversations/{id}/messages` → upsert both tables.
- Rate-limit safe (200ms between pages, 2s per-academy stagger, 429 exponential
  backoff, 270s function budget) - same guards as cron-sync-contacts.
- **Resumable**: per-academy cursor (`clients.conv_import_cursor`) so it
  continues across cron runs; **recent/active conversations first**, then older.
- Two modes:
  - **backfill** - deep one-time pull, chunked over multiple cron passes (a
    7,581-contact academy is large; cap initial depth e.g. last 12-24 months,
    then extend).
  - **incremental** - ongoing, only-new-since-last-sync, keeps the store current
    so the cutover is lossless.

### 3. Fire BOTH on GHL connect (onboarding) ← Zoran's ask
- On GHL OAuth connect (onboarding Contacts step / callback), kick off an
  immediate **contacts import AND conversation backfill together**.
- Contacts-step copy: "Bringing your contacts and message history over."
- Progress rides the existing Contacts step (n contacts · m conversations) -
  **no new owner-facing step** (conversations import is automatic, not a chore).

### 4. Read path
- Inbox reads from the store, **falls back to GHL live** for anything not yet
  backfilled (nothing looks missing mid-backfill).
- At Twilio cutover: flip inbox to **store-only**.

### 5. Cutover gate
- Block `contact_provider -> 'portal'` until "conversation backfill complete"
  for the academy. Guarantees zero history loss.

## Open questions (decide before build)
- **Attachments:** GHL-hosted media URLs may expire. v1 = store the URLs + flag;
  v2 = copy media into our storage bucket.
- **Depth/scale:** cap initial backfill window (recent first) vs pull everything?
- **Tables:** new dedicated `ghl_*` tables (recommended) vs extend the parent-app
  `customer_thread_*` tables (avoid - different purpose, would couple them).

## Build order
1. Tables + migration
2. `import-conversations.js` (backfill + incremental) + cron
3. Fire on GHL connect alongside contacts + step copy/progress
4. Inbox read-from-store with live GHL fallback
5. Cutover gate (`contact_provider` flip blocked until backfill complete)

## Scope decision (2026-07-21, Zoran)
- **Build now: conversations only** (SMS/email/DM messages + threads). Fixes the stated gap.
- **Phase 2 (documented, not built): the rest of the 🟢 data bucket** - call recordings/transcripts, notes, tasks, appointments, form/survey submissions. Same job pattern, add later.
- **Defaults for this build:** pull ALL history, recent-first, resumable cursor. Attachments = store GHL URLs for now (copy media to our bucket = phase 2). New dedicated `ghl_conversations` + `ghl_messages` tables.
- **V1 untouched:** gate the whole feature to V2/V1.5 (migrating academies). Pure-GHL V1 stays live-read only.

## Full GHL import menu (for phase 2 reference)
IMPORT (data): contacts ✅ · opportunities ✅ · conversations 🔵now · notes · tasks · appointments · form/survey submissions · custom-field values ✅.
REBUILD not import (config): pipelines · workflows · funnels/sites · templates · custom-field defs · calendars.
SKIP (N/A): GHL payments/invoices (Stripe is money source) · memberships/courses · reviews · blogs · products.

## BUILT (2026-07-21) - much smaller than the original plan
Investigation found the whole import machine ALREADY EXISTS - so we did NOT build
new tables/import/inbox/gate. What existed:
- Store: `sms_threads`/`sms_messages` + `email_threads`/`email_messages` (provider='ghl').
- Import: `api/messaging/import-ghl-history.js` + `email-import-ghl-history.js` (idempotent, POST `{client_id, max_pages?}`, returns `done`).
- Read path: `api/ghl/inbox.js` reads the store with a live-GHL fallback.
- Cutover catch-up: `api/twilio/migration-watch.js` fires the import AT Twilio-cutover.
- The ONLY gap: it never fired on CONNECT, only at cutover.

What we added (the fix):
- Migration `add_ghl_history_imported_marker`: `clients.ghl_history_imported_at timestamptz` (NULL = pending). APPLIED to prod.
- `api/ghl/cron-import-history.js`: for V2/V1.5 GHL academies with the marker NULL, calls the two existing import endpoints (BATCH=2/run, MAX_PAGES=50), stamps the marker when both report `done`. Also `?client_id=` to force one. V1 never touched.
- `vercel.json` cron `5-55/10 * * * *` (offset from the `*/10` contacts cron so both land together each ~10-min cycle without doubling GHL's per-location load).

Result: connect GHL -> within ~10 min the contacts cron AND this history cron both run = contacts + full conversation history land together; every already-connected V1.5/V2 academy backfills automatically. Activates on merge to main (crons deploy with prod).

## Status
BUILT 2026-07-21, on branch (PR pending merge to activate the cron). Phase 2 (notes/tasks/appointments/forms/attachment media) still deferred.
Relates to [[project_detail_portal_native_plan]] (the Twilio cutover is the LAST
step) and the contacts sync in `api/ghl/cron-sync-contacts.js`.
