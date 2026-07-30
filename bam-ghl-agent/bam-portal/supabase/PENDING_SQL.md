# Pending SQL - migrations waiting to be applied to prod

**What this is:** the handoff ledger between sessions that WRITE migrations
(often remote/cloud Claude sessions that cannot touch the live DB) and the
session that APPLIES them (Zoran, locally, via the Supabase CLI).

**Zoran: run `/pending-sql` to apply everything listed here.** `/showtime` and
`/start` will nag you when this table is non-empty.

**Authors (any session that adds a migration file without applying it): add a
row here in the same commit as the migration.** Remote sessions can never
apply - always add your row. Rule lives in `bam-portal/CLAUDE.md`.

## ⏳ PENDING

| Migration file | What it does | Blocked features until applied | Added |
|---|---|---|---|
| `20260731T090000_clients_stripe_portal_url.sql` | Adds `clients.stripe_portal_url text` (nullable, no backfill). ONLY the column - the `receipts` build owns the wider receipt system and will declare it again; `IF NOT EXISTS` so whichever runs second is a no-op | The welcome email's manage-membership link (PR #1666). **Must be applied BEFORE that PR merges**: the code reads the column from the MAIN select lists (`CLIENT_COLS` in `api/automations.js` + `api/agent-confirm.js`, `SENDER_COLS` in `api/_send.js`), so merging first would 400 the clients read that feeds EVERY channel, SMS included. Additive and unread until the merge, so applying first is inert | 2026-07-31. **The orchestrator is applying this one directly**, per Zoran's 2026-07-31 ruling that the pending-column retry (one wasted 400 plus a warning line on every send, forever) is not an acceptable substitute for shipping the column. Not for `/pending-sql` |


> **`20260729T230000` step 2 - DONE 2026-07-30.** The follow-up this note demanded is
> shipped: `business_email`, `tagline` and `instagram_url` are in `CLIENT_COLS` in
> `api/automations.js` and `api/agent-confirm.js`, and `business_email` is in
> `SENDER_COLS` in `api/_send.js`. All three had been READ by `clientVars()` and
> SELECTED by nobody, so GTA's live automation emails went out with no tagline sentence
> and no footer Instagram link until the lists caught up.
>
> Both `*_COLS_PENDING` lists and `SENDER_COLS_PENDING` are now EMPTY and stay in the
> code on purpose - that is the mechanism for the next column that has to ship ahead of
> its migration. It is safe at any number of pending columns as written (the retry drops
> the whole list, because Postgres names only the FIRST unknown column in a select), and
> `api/_pending-client-column.test.mjs` keeps proving that by injecting a synthetic
> pending column rather than depending on a real one being unapplied.
>
> The class of bug is now a check: `api/_email-select-coverage.test.mjs` derives the
> required column set from `clientVars()`'s own source and fails when a select list does
> not cover it, and `api/_tagline-instagram.test.mjs` section 6 renders the pre-fix and
> post-fix row shapes side by side.

## ✅ APPLIED (most recent first)

| Migration file | Applied | By |
|---|---|---|
| `20260730T120000_public_ticket_intake.sql` | on or before 2026-07-30 | **Author unknown - found ALREADY APPLIED while going to run it.** Its row sat in PENDING, so this file was telling every reader that the public support form was still one SQL statement away from working. Verified complete rather than partial before moving it: `tickets_source_check` allows `public_form`, `tickets.public_token` exists, and all four indexes are present (`tickets_public_token_key`, `_recent_idx`, `_ip_idx`, `_email_idx`). Endpoint probed live afterwards: `POST /api/public-ticket` with an empty body returns **400 `A name is required.`**, not a 500, so the handler loads. **Not proven by that probe: the INSERT itself, because validation short-circuits before the write.** |
| `20260730T160000_locations_entry_note.sql` | 2026-07-30 | Claude (Supabase MCP, orchestrator, on Zoran's instruction to merge #1656). **Applied BEFORE the merge deliberately**, and the ordering is the point: the column is additive and the pre-merge code never read it, so applying it first is inert, while merging first would have left GTA with no entry sentence until the SQL ran. The leak ends at the merge either way, so migration-first removes the window at no cost. Verified by read-back rather than the success flag: exactly ONE row seeded (GTA, 1079 Linbrook Rd), and GTA's second venue plus both San Jose venues correctly NULL |
| `20260730T120000_step_rows_render_the_academy_name.sql` | 2026-07-30 | Claude (Supabase MCP, orchestrator). **All three md5 guards verified matching production BEFORE applying**, so the update was known to hit all three rows rather than silently hitting none. Verified after: all three carry `{{location.name}}`, zero literals left, and `scripts/snapshots/bam-gta.json` already carried the tokenized form for exactly those three rows, so production has caught up to the snapshot rather than drifting from it |
| `20260730120000_agent_reply_status_dismissed.sql` | 2026-07-30 | Claude (Supabase MCP, at Zoran's request). Verified after applying: all four CHECKs allow `dismissed`, `agent_closing_replies` kept `paused`. |
| `20260727150000_conversations_last_author_kind.sql` | 2026-07-30 | Claude (Supabase MCP, at Zoran's request). Cole's, not this session's. Verified the replacement trigger is a strict SUPERSET of the live one before running it (live set 3 fields, new sets those 3 plus `last_message_author_kind`), and that `author_staff_id` exists on `conversation_messages` - the table the trigger actually fires on. A missing column there would have failed every message insert |
| `20260729T235000_public_name_and_city_from_the_row.sql` | 2026-07-30 | Claude (Supabase MCP). Data only. GTA `public_name` -> By Any Means Toronto, address gains Oakville so `cityFromAddress` parses it, San Jose -> By Any Means San Jose |
| `20260729T230000_clients_tagline_instagram.sql` | 2026-07-30 | Claude (Supabase MCP). Verified `update_client_basics` ended at 24 settable columns, a strict superset of the 18 the live function had |
| `20260729T210000_clients_business_email.sql` | 2026-07-30 | Claude (Supabase MCP). Applied BEFORE the merge deliberately: the code drops GTA's hardcoded email, so deploying first would have held every academy's automation email |
| `20260729140000_ignition_campaigns.sql` | 2026-07-29 | Claude (Supabase MCP, at Zoran's request). Verified after: 18 + 11 columns, 4 RLS policies, 9 indexes, RLS on, 0 rows. Constraints probed in a self-rolling-back block - blank consent_basis, per_day 500, an unknown state and an orphan roster row are all rejected |
| `20260725121000_commission_calculator.sql` | 2026-07-26 | Zoran (SQL editor) |
| `20260725120000_onboarding_calls.sql` | 2026-07-26 | Zoran (SQL editor) |
