# Prod schema dump (drift snapshot)

**What:** `bam-portal/scripts/migration/dump-prod-schema.mjs` writes a full prod schema snapshot to `bam-portal/supabase/snapshots/prod-schema.sql`. Read-only (catalog SELECTs via Management API, same auth as `apply-pending-sql.mjs`).

**Run:**
```
node bam-portal/scripts/migration/dump-prod-schema.mjs <sbp_... token>
```
Token: https://supabase.com/dashboard/account/tokens (account level)

**Covers:** tables + columns, constraints, indexes, RLS on/off per table, all policies, views, functions, triggers, enums. Prints a warning list of tables with RLS disabled.

**Why:** prod schema changes via MCP without migration files, so the repo SQL drifts from reality. Commit the snapshot, re-run any time, `git diff` shows exactly what changed in prod. Also feeds the parent-app work (fc-mobile) that needs an accurate picture of prod.

**Gotcha:** output is reconstructed from pg_catalog, close to but not byte-identical with pg_dump.
