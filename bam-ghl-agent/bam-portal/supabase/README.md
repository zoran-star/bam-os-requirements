# Supabase Local Replay Notes

This folder has a few migrations and seed files whose main purpose is to make a fresh local Supabase database replayable. They exist because parts of the production schema were created before migration tracking was complete.

## Current Rule

For normal new database work:

1. Create a new migration after the latest migration.
2. Test it against a fresh local replay with `supabase start` or `supabase db reset`.
3. Commit the migration file.
4. Push/apply through the normal linked-project flow.

Do not use `supabase migration fetch --linked` casually. It fetches remote migration-history files, not the current schema, and can overwrite local replay fixes such as the conditional `entry_points` migration. If you must fetch a remotely/MCP-created migration, start from a clean worktree and inspect the diff before keeping anything.

## Historical Backfill Migrations

These migrations backfill objects that already existed in production but were missing from local replay:

- `migrations/20260518020000_create_portal_feedback.sql`
- `migrations/20260524160000_member_management_schema.sql`
- `migrations/20260612010000_sm_training_schema.sql`

These are not new production changes. They were marked as applied in the linked project with `supabase migration repair --status applied --linked` so `db push --linked` should not run them against production.

Before any linked push, verify these appear in both columns:

```bash
supabase migration list --linked
```

If one of these shows as local-only, do not push. Repair it as applied on linked first.

## Entry Points Migration

`migrations/20260611211126_entry_points.sql` intentionally does not hard-insert BAM GTA entry-point rows unless the BAM GTA client row already exists.

Do not revert this guard. Seeds run after migrations, so a fresh local replay does not have the BAM GTA client row when this migration runs. Reverting the guard causes:

```text
insert or update on table "entry_points" violates foreign key constraint "entry_points_client_id_fkey"
```

The final local entry-point rows are seeded later by `seeds/20_bam_gta_entry_points.sql`.

No migration repair is needed for this patched file. Its version already exists remotely; the local patch is only to make fresh local replay possible.

## Local Seed Data

`config.toml` loads seed files in this order:

- `seeds/00_bam_gta_client.sql`
- `seeds/10_bam_gta_training_offer.sql`
- `seeds/20_bam_gta_entry_points.sql`
- `pricing-catalog-gta-seed.sql`
- `seeds/30_local_parent_app_fixture.sql`
- `seeds/40_local_parent_schedule_fixture.sql`

These files provide local development data needed by the BAM GTA funnel, pricing catalog, entry points, and parent app work.

`seeds/30_local_parent_app_fixture.sql` is synthetic. It is not a production data dump. It seeds local Auth users, parent profiles, students, student memberships, legacy `members`, and `member_links` so parent-app APIs can be tested against the service-role boundary.

`seeds/40_local_parent_schedule_fixture.sql` is synthetic. It mirrors the fc-mobile parent demo schedule shape with date-relative slots, local BAM GTA locations, schedule templates, future reservations, a waitlist entry, and past attended/no-show appointments.

Local fixture logins:

- `parent.alex.rivera@example.test` / `local-password`
- `parent.jamie.chen@example.test` / `local-password`
- `staff.admin@example.test` / `local-password`

Keep client-specific/dev fixture data in seeds, not migrations. Migrations must be able to run before seeds exist.

## Storage Caveat

`supabase start` passing does not prove all Storage upload flows work. The app references buckets such as `ticket-files`, `message-attachments`, `member-avatars`, `resources`, `offers`, and `member-files`.

Some bucket rows were created historically outside this migration chain. If local upload flows fail with missing buckets, add a small idempotent storage backfill migration and mark it applied on linked if those buckets already exist in production.

## When Local Replay Fails Again

If a fresh local replay fails on another missing historical object:

1. Confirm whether the object already exists in linked/prod.
2. Add the smallest idempotent historical backfill migration in the correct timestamp order.
3. Mark that new backfill version as applied on linked/prod.
4. Rerun local replay.

This is a temporary local-unblock strategy. A proper baseline/squash can replace this later when the team is ready to standardize the migration process.
