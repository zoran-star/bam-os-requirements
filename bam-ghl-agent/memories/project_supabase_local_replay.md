---
name: Supabase local replay and migration cleanup
description: Read bam-portal/supabase/README.md before touching migrations, seeds, linked repair, or local Supabase replay
type: project
---

# Supabase local replay and migration cleanup

**Source of truth:** [`../bam-portal/supabase/README.md`](../bam-portal/supabase/README.md)

Read that file before touching:

- `bam-portal/supabase/migrations/`
- `bam-portal/supabase/seeds/`
- `bam-portal/supabase/config.toml`
- `supabase migration repair`
- `supabase migration fetch --linked`
- `supabase db push --linked`
- Storage bucket backfills

Current state: local replay is being unblocked with small historical backfill migrations plus ordered local seed data. This is temporary until the team does a proper baseline/squash.

Key limitation: some objects already exist in production but were missing from migration history. Backfill migrations are local-replay fixes, not new prod changes, and must be marked applied on the linked project before any linked push.

Do not treat `supabase migration fetch --linked` as a normal sync command right now. It can overwrite local replay fixes. If a remote/MCP-created migration must be fetched, start from a clean worktree and inspect the diff before keeping it.
