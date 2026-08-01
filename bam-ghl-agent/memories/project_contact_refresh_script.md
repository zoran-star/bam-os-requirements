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

SJ dry-run 2026-07-31: 555 in GHL, 535 already present, 20 new, 6 changed. Applied for real 2026-08-01 (556 contacts in store, verified in DB). Re-run --apply again right before the Stripe link-up sweep.

## The PGRST102 silent-loss bug (found live 2026-08-01, fixed)

The first --apply printed "upserted: 555" while the contacts table took ZERO rows. `bulkUpsertPortalContacts` posted all rows in ONE PostgREST bulk POST; PostgREST demands every object share the same keys (PGRST102 "All object keys must match") and rejects the whole batch; `clean()` strips empty fields per row so mixed batches are the NORM; the function swallows its own errors. Consequence: **the v15 sync cron's contact dual-write has been intermittently losing whole batches silently** (1453 source='sync' rows prove homogeneous batches landed; mixed ones vanished). Fix: bucket cleaned rows by exact key-set signature, one POST per homogeneous bucket; function now returns rows-actually-posted so callers can tell "wrote nothing" from "wrote all". Regression suite: `api/_contacts-bulk.test.mjs` (strict fake PostgREST that enforces PGRST102; MUTATE=mixed control). NOTE: prod cron still has the bug until this branch merges + deploys.

## SJ pre-link (leg 2, 2026-08-01)

All 20 live SJ members from `docs/workbook/sj-roster-2026-07-31.json` linked to portal contacts by rule C2 (exact-email single match, verified single + unlinked per row first) via direct SQL; `member_audit_log` row action_type='stripe-contact-prelink'. The later stripe-link sweep sees them as already_linked and skips (idempotent). The remaining ~127 Stripe customers link when MM II's direct-key transport goes live.
