---
description: Apply the pending Supabase migrations queued up by other sessions (reads bam-portal/supabase/PENDING_SQL.md, applies via Supabase CLI, updates the ledger)
---

# /pending-sql - apply queued migrations to prod

Remote/cloud Claude sessions write migration files but can't touch the live DB.
They queue them in the ledger; this command is the local (Zoran) side that
applies them and closes the loop.

## Step 1 - Read the ledger

Read `bam-ghl-agent/bam-portal/supabase/PENDING_SQL.md`.

- If the **PENDING** table is empty: say "No pending SQL - all caught up." and stop.
- Otherwise show the user a short table: file, what it does, what's blocked without it.

## Step 2 - Read the Supabase README first (MANDATORY)

Read `bam-ghl-agent/bam-portal/supabase/README.md` before touching the linked
project. It documents the historical backfill migrations that must be marked
repair-applied, and why `supabase migration fetch --linked` must NOT be run.

## Step 3 - Verify against the live project

```bash
cd bam-ghl-agent/bam-portal && supabase migration list --linked
```

Cross-check: every ledger-PENDING file should show as not-applied on the linked
project. If a ledger entry is already applied live, just move it to the APPLIED
section (Step 5) - someone applied it by hand and forgot the ledger.

## Step 4 - Apply

Preferred (applies all pending in order):

```bash
cd bam-ghl-agent/bam-portal && supabase db push --linked
```

Confirm the file list it prints matches the ledger before saying yes.

**Fallback** (CLI or link trouble): print each pending file's SQL for the user
to paste into the Supabase dashboard SQL editor (project `jnojmfmpnsfmtqmwhopz`),
then record it so the CLI history stays truthful:

```bash
supabase migration repair --status applied --linked <version>
```

(`<version>` = the leading timestamp of the filename.)

## Step 5 - Close the loop

1. In `PENDING_SQL.md`: move each applied row from PENDING to APPLIED with
   today's date and who applied it.
2. If the migration's ledger row or memory note mentions a follow-up (e.g.
   "unblocks sender prefixes"), confirm the feature works with one quick check.
3. Update any memory note that tracks the migration's feature (the ledger row
   usually names the PR - check its memory note).
4. Commit + push:

```bash
git add -A && git commit -m "chore(sql): applied pending migrations (see PENDING_SQL.md)" && git push
```

## Rules

- Never delete rows from APPLIED - it's the audit trail.
- Never apply anything NOT in the migrations folder (no ad-hoc SQL through this flow).
- If `db push` wants to apply something not in the ledger, STOP and reconcile
  first - another session forgot its ledger row; add it before applying.
