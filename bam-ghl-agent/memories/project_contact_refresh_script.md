# Contact refresh script + the v2 sync gap

**2026-07-31, SJ contact link-up room.**

## The gap

`api/ghl/cron-sync-contacts.js` runs every 10 min for every GHL-connected academy, BUT its contact mirror block (writes to `ghl_contacts` + dual-write into portal `contacts` via `bulkUpsertPortalContacts`) is gated on `client.v15_access === true`. A **v2 academy with v15_access=false gets NO ongoing contact sync at all** - the cron only stamps `ghl_contacts_last_synced_at` and patches member parent fields, so the stamp looks alive while the contact store goes stale. BAM San Jose's 536 portal contacts were a one-off Jun 30 import (source='ghl-import'; no shipped code writes that source to contacts - it was a session script).

## The fix: manual refresh CLI

`scripts/refresh-portal-contacts.mjs --client <id> [--apply]` (dry-run by default):

- Reuses the cron's real machinery, not a fork: the per-contact mapping was extracted into `export ghlContactToMirrorRow(client, c, nowIso)` in cron-sync-contacts.js (byte-identical cron behavior, tester-verified), and the script imports it + `ghlFetchWithBackoff`.
- Dry-run prints fetched / already-present / new / changed counts + sample names; failures print FAILED + exit 1, never "0 contacts".
- `--apply` upserts `ghl_contacts` AND portal `contacts` (source='ghl-import'); refuses `contact_provider='portal'` academies (their store is source of truth).
- Test: `api/_contact-refresh.test.mjs` (plain node, source-text extraction, MUTATE=fork / MUTATE=email negative controls that PRINT; in the CI glob).

## Gotchas for a live run

- Run from a checkout WITH node_modules (imports pull @sentry/node at module level; env-safe though - Sentry.init is gated on VERCEL_ENV=production).
- `.env.local` values are quoted WITH a literal `\n` inside the quotes (the echo-into-env gotcha) - sourcing the file breaks; extract + strip quotes/`\n` per var.
- `bulkUpsertPortalContacts` swallows its own errors: "upserted: N" can lie; watch stderr for `[bulkUpsertPortalContacts] non-fatal:`.
- Dry-run "changed" count overstates (case-only email diffs; GHL-cleared fields count as changed but `clean()` will not null them in contacts on apply).

SJ dry-run 2026-07-31: 555 in GHL, 535 already present, 20 new, 6 changed. Re-run with --apply right before the Stripe link-up sweep (see the SJ contact link-up room).
