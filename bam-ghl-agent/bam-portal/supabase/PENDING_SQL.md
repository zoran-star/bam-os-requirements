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
| `20260730T120000_step_rows_render_the_academy_name.sql` | Data only, BAM GTA only. The three `automation_steps` rows that hand-typed "By Any Means Basketball" now carry `{{location.name}}`: onboarding step 1's SMS body, onboarding step 2's email SUBJECT, `summer_special` step 0's SMS body. Each update is guarded on an md5 of the exact current field value, so a re-run is inert and a later owner edit in the Sales step editor survives untouched | Nothing is blocked, but GTA keeps sending the WRONG NAME until it is applied. `public_name` became "By Any Means Toronto" on 2026-07-30, so today these three messages say "By Any Means Basketball" while the shell around them says Toronto. Onboarding step 2 is the visible one: its email body header reads TORONTO while its subject line reads Basketball, in the same message | 2026-07-30 |
| `20260730T120000_public_ticket_intake.sql` | Widens `tickets_source_check` to allow `public_form`, adds `tickets.public_token` (unique where not null), adds 3 partial indexes the public-form rate limiter needs. All additive, no policy, no new table. | The PUBLIC support form at `/ticket`. It has NEVER created a ticket (213 exist, 0 from this form). Until this runs, `api/public-ticket.js` 500s on every submit and the form shows its honest "Your request was not submitted" screen with the email fallback - nothing lies, nothing is lost, nothing is saved. `/ticket/<token>` stays "Ticket not found". | 2026-07-30 |


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
| `20260730120000_agent_reply_status_dismissed.sql` | 2026-07-30 | Claude (Supabase MCP, at Zoran's request). Verified after applying: all four CHECKs allow `dismissed`, `agent_closing_replies` kept `paused`. |
| `20260727150000_conversations_last_author_kind.sql` | 2026-07-30 | Claude (Supabase MCP, at Zoran's request). Cole's, not this session's. Verified the replacement trigger is a strict SUPERSET of the live one before running it (live set 3 fields, new sets those 3 plus `last_message_author_kind`), and that `author_staff_id` exists on `conversation_messages` - the table the trigger actually fires on. A missing column there would have failed every message insert |
| `20260729T235000_public_name_and_city_from_the_row.sql` | 2026-07-30 | Claude (Supabase MCP). Data only. GTA `public_name` -> By Any Means Toronto, address gains Oakville so `cityFromAddress` parses it, San Jose -> By Any Means San Jose |
| `20260729T230000_clients_tagline_instagram.sql` | 2026-07-30 | Claude (Supabase MCP). Verified `update_client_basics` ended at 24 settable columns, a strict superset of the 18 the live function had |
| `20260729T210000_clients_business_email.sql` | 2026-07-30 | Claude (Supabase MCP). Applied BEFORE the merge deliberately: the code drops GTA's hardcoded email, so deploying first would have held every academy's automation email |
| `20260729140000_ignition_campaigns.sql` | 2026-07-29 | Claude (Supabase MCP, at Zoran's request). Verified after: 18 + 11 columns, 4 RLS policies, 9 indexes, RLS on, 0 rows. Constraints probed in a self-rolling-back block - blank consent_basis, per_day 500, an unknown state and an orphan roster row are all rejected |
| `20260725121000_commission_calculator.sql` | 2026-07-26 | Zoran (SQL editor) |
| `20260725120000_onboarding_calls.sql` | 2026-07-26 | Zoran (SQL editor) |
