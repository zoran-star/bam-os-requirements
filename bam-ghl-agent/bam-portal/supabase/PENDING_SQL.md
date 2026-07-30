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
| `20260727150000_conversations_last_author_kind.sql` | `conversations.last_message_author_kind` + trigger update, stamps who sent the last message | Staff Inbox sender prefixes ("You:" / "Mike:") - inbox otherwise fine, API falls back | 2026-07-27 (Cole session, PR #1629) |
| `20260729T210000_clients_business_email.sql` | `clients.business_email` (the academy's PUBLIC email, split from the owner's `clients.email`) + whitelists it and the three `google_rating*` columns in `update_client_basics` + seeds GTA `info@byanymeanstoronto.ca` and San Jose `elijah@byanymeanssanjose.com` | **APPLY BEFORE THIS BRANCH DEPLOYS.** The code drops the hardcoded GTA email, so until this is applied + seeded every academy's automation email **HOLDS** (nothing wrong goes out, engine re-queues, owner texted once/24h) and the Business Basics "Business email" + Google-reading fields stay blank and unsaveable. No data is lost in either state, but GTA's parent email stops. | 2026-07-29 (business/owner email split) |
| `20260729T230000_clients_tagline_instagram.sql` | `clients.tagline` + `clients.instagram_url` (the email footer's sentence and Instagram link, moved out of the hardcoded GTA `LOCATIONS` entry) + whitelists both in `update_client_basics` (transcribed superset: live 18 columns + T210000's 4 + these 2 = 24) + seeds GTA's two values where NULL | **APPLY AFTER `20260729T210000`, AND DO STEP 2 BELOW IN THE SAME SITTING.** The code stops pinning both fields, so until this is applied AND the columns are added to the `loadClient` select lists in `api/automations.js` + `api/agent-confirm.js`, BAM GTA's automation emails render with **no tagline sentence and no footer Instagram link**. Nothing is held, nothing is borrowed, no dead link ships - the footer is just two elements shorter, and unlike the business-email hold **this failure is silent**. Business Basics also keeps both fields blank and unsaveable until applied. Order matters: if T210000 is applied after this one it replays its own 22-column function and DROPS these two columns from the whitelist. | 2026-07-29 (queue item 31, email-layer hardcode) |

| `20260729T235000_public_name_and_city_from_the_row.sql` | **Data only, no schema change.** Sets BAM GTA `public_name` -> `By Any Means Toronto`, GTA `address` -> `2205 Rosemount Cres, Oakville, ON` (so the city can be parsed out of it), and BAM San Jose `public_name` -> `By Any Means San Jose`. Every update is guarded on the exact current value, so a re-run is inert and an owner's later edit survives. | **THIS ONE IS VISIBLE TO PARENTS AND ZORAN APPROVED IT.** The code half deletes the `LOCATIONS` map from `api/email-shells.js` outright, so GTA renders from its row like everyone else. Applied together, GTA's emails change in three ways: gold wordmark `GTA` -> `TORONTO`, the line beside it `OAKVILLE - GTA` -> `OAKVILLE`, and the name in copy / `<title>` / footer reason all read "By Any Means Toronto". **Until it is applied**, GTA's wordmark reads `BY ANY MEANS BASKETBALL` and it renders NO city and NO location tag at all (the address has no city in it), and San Jose would do the same. Nothing is held, nothing is borrowed, no dead markup ships - and this failure is SILENT, like `20260729T230000`'s. `api/_email-identity-from-the-row.test.mjs` section 8 asserts exactly what the interim renders. Order does not matter against the other two rows: this file touches no function and adds no column. | 2026-07-29 (queue item 31 closed, email-layer hardcode deleted) |

> **`20260729T230000` step 2, and it is not optional:** the moment that migration is
> live, add `tagline` and `instagram_url` to `CLIENT_COLS` in `loadClient()` in
> `api/automations.js` (the send worker, the owner approval surface and the Sales step
> preview all read that one row) and in `api/agent-confirm.js`. Until it is done, GTA's
> live emails are missing both footer facts. `api/_tagline-instagram.test.mjs` section 6
> asserts exactly what that interim renders.
>
> **Do NOT shortcut it via `CLIENT_COLS_PENDING`.** That retry is safe for ONE pending
> column and these would be the second and third. Postgres names only the first unknown
> column in a select (verified against prod 2026-07-29: `select tagline, instagram_url
> from clients` reports only `tagline`), and the retry is single-shot with the re-read
> outside the `try` - so with `business_email` also pending, the second read 400s
> uncaught and `loadClient` throws, stopping every automation including SMS. Loop the
> retry until nothing is blamed and extend `api/_pending-client-column.test.mjs` to two
> pending columns first, or just apply the migration and do step 2 properly.

## ✅ APPLIED (most recent first)

| Migration file | Applied | By |
|---|---|---|
| `20260729140000_ignition_campaigns.sql` | 2026-07-29 | Claude (Supabase MCP, at Zoran's request). Verified after: 18 + 11 columns, 4 RLS policies, 9 indexes, RLS on, 0 rows. Constraints probed in a self-rolling-back block - blank consent_basis, per_day 500, an unknown state and an orphan roster row are all rejected |
| `20260725121000_commission_calculator.sql` | 2026-07-26 | Zoran (SQL editor) |
| `20260725120000_onboarding_calls.sql` | 2026-07-26 | Zoran (SQL editor) |
