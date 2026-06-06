---
description: Apply the BAM portal's pending Supabase SQL migrations (marketing goals, GHL KPI config, funnel events) — run once to set up the database.
---

Set up the database for the marketing + GHL KPI features by applying the portal's
pending SQL migrations. **Idempotent — safe to run as many times as you want.**

## What it creates
- `clients.meta_cpl_goal` / `meta_monthly_budget` — Ad Performance goals
- `clients.ghl_kpi_config` — which GHL forms count as leads, etc.
- `ghl_funnel_events` — the lead / response / booking / conversion event log

## Steps (do all of them, don't stop for confirmation unless something fails)

1. **Get a Supabase access token.** Ask the user to paste an account-level token
   from https://supabase.com/dashboard/account/tokens — it starts with `sbp_`.
   (Zoran is admin on the portal project, ref `jnojmfmpnsfmtqmwhopz`.)
   - If they haven't given one, ask for it. **Never print, log, or commit the token.**

2. **Run the migration runner** from the repo root, substituting the token:
   ```bash
   node bam-ghl-agent/bam-portal/scripts/migration/apply-pending-sql.mjs <sbp_token>
   ```

3. **Report the result.** Each migration prints `OK` or `FAILED`. If all OK, tell
   the user the database is set up. If any failed, show the error line and stop.

4. **Optional sanity check** — confirm the columns/table exist (only if the user
   wants proof). Using a Supabase MCP `execute_sql` if available, or note they can
   check in the Supabase SQL editor:
   ```sql
   select column_name from information_schema.columns
   where table_name = 'clients' and column_name in ('meta_cpl_goal','meta_monthly_budget','ghl_kpi_config');
   select to_regclass('public.ghl_funnel_events') as funnel_events_table;
   ```

## Notes
- The runner uses the Supabase **Management API** with the personal access token —
  no `psql` or DB password needed.
- All migrations use `IF NOT EXISTS`, so running again never breaks anything.
- This does **not** apply `ghl_stage_tracking.sql` — that approach was dropped in
  favor of GHL webhooks; you don't need it.
