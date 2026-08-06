# Pending SQL - migrations waiting to be applied to prod

**What this is:** the handoff ledger between sessions that WRITE migrations
(often remote/cloud Claude sessions that cannot touch the live DB) and the
session that APPLIES them (Zoran, locally, via the Supabase CLI).

**Zoran: run `/pending-sql` to apply everything listed here.** `/showtime` and
`/start` will nag you when this table is non-empty.

**Authors (any session that adds a migration file without applying it): add a
row here in the same commit as the migration.** Remote sessions can never
apply - always add your row. Rule lives in `bam-portal/CLAUDE.md`.

## ✅ APPLIED 2026-08-06 by MEMBER MANAGEMENT III

`20260806T063000_workbook_apply.sql` - three additive columns for the workbook review-and-apply flow, applied via Supabase MCP and **read back verified**: `workbooks.snapshot jsonb`, `workbook_cards.approved_at timestamptz`, `workbook_cards.approved_by uuid`.

`snapshot` is the photograph taken before apply touches anything. Phase 3 is irreversible - a Stripe price can be archived, never deleted - so the before-state of the offer jsonb, `clients.tax_config` and the client's `offer_prices` rows is stored first, and it is the only way back. Written first-wins via a conditional filter, so a second apply can never re-photograph the post-write state and call it "before".

`approved_at`/`approved_by` are the STAFF half of the two confirmations. The owner's deliberate act is `confirmed_at`; staff's is `approved_at`. Deliberately separate columns because they are different people answering different questions - "this is what I sell" versus "apply this to the live system" - and the apply gate reads `approved_at` exactly the way the submit gate reads `confirmed_at`.

The route degrades where these are absent: review still answers, and approve/apply/rollback refuse with a sentence naming this migration rather than 500ing.

**Ledger row added late.** An adversarial pass caught that the migration file claimed prod-applied with no row here, which `bam-portal/CLAUDE.md` requires in the same commit, so `/pending-sql` would never have surfaced it.

## ✅ APPLIED 2026-08-05 by MEMBER MANAGEMENT III

`20260805T003000_workbook_extras.sql` - two additive columns found while building the page and API, both applied via Supabase MCP and **read back verified** (`workbook_answers.current_value jsonb`, `workbook_cards.meta jsonb`).

Both are deliberately kept OUT of `workbook_answers` as decisions. `current_value` exists because three values matter and not two: what the portal stores today, what we showed the owner, and what he sent back. Comparing only the last two makes a card he merely confirmed read as "no change" while it silently renames the plan. `meta` holds presentation facts ("9 members pay on this plan today", the Live-in-Stripe pill) that a computed fact must never be able to serialize as something the owner confirmed.

The API tolerates `meta` being absent (catches PostgREST 42703 and omits it), so an environment without this migration degrades to a page missing the context strip rather than erroring.

## ✅ APPLIED 2026-08-04 by MEMBER MANAGEMENT III (Zoran tried to run `/pending-sql` himself; it is a Claude Code command, not a shell one, so it errored in his terminal and the orchestrator applied it via Supabase MCP instead)

`20260804T230000_workbooks.sql` - the owner-workbook capture schema. **Read back and verified, not trusted:** `workbooks` (16 cols, 3 indexes), `workbook_cards` (9 cols, 2 indexes), `workbook_answers` (14 cols, 4 indexes); RLS enabled and **0 policies** on all three, which is the intended service-role-only shape.

**RLS was PROVEN, not assumed.** Checking `relrowsecurity` only proves a flag is set. So: a real row was inserted with the service role and returned, then read back with the browser anon key, which got `[]`. Control run alongside it, because an empty array can also mean the probe is broken: no key at all returns 401 and a bogus key returns 401, so a 200 with `[]` genuinely means authenticated-and-filtered. Probe row deleted afterwards (`RLSPROBE_%`, 1 row removed, id 7f4f4796).

Design + rulings: `docs/plans/sj-price-match-log.md`. Core handoff: `docs/core-handoff/owner-workbooks.md`, **marked `core_parity: not-reviewed`** because `fc-core-srvc` returned `Repository not found` from this machine, so no core model was ever read.

## ✅ APPLIED 2026-08-01 by MEMBER MANAGEMENT II (Zoran's go: "merge and run it")

`20260801T120000_client_stripe_direct.sql` - applied via Supabase MCP, read back: both tables exist (13 + 10 cols), RLS enabled on both, zero rows. Env `STRIPE_DIRECT_ENC_KEY` + `PORTAL_BASE_URL` set in Vercel PRODUCTION (preview adds blocked by a CLI wrapper loop - add per-branch if ever needed; preview deploys refuse webhook registration anyway via the PORTAL_BASE_URL guard).

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
| `20260731T210000_carry_calendar_booking_to_free_trial_booked.sql` | 2026-07-31 | Claude (Supabase MCP, on Zoran's order). ⚠️ **DATA, no schema.** Copies the `calendar_booking` recipient list onto the new `free_trial_booked` key in `clients.notification_prefs`, ONLY where the free_trial preset is stamped on a live offer. **Verified by read-back, not by the empty result:** BAM GTA now carries the same single recipient on both keys, and ShigHoops - which has `calendar_booking` set but NO preset stamp - was correctly left `null`, since writing the key there would be a recipient list with no pill to switch it off. Applied ahead of the merge deliberately and it is inert until then: nothing reads `free_trial_booked` until the code ships. Idempotent (never overwrites an existing list), so `/pending-sql` re-running it is a no-op. Note GTA's 4 teammates all have a blank `client_users.phone`, so the only recipient with a reachable number is still the owner |
| `20260731T190100_seed_receipt_mode.sql` | ⚠️ **DATA. This is the switch.** Sets `receipt_mode='recurring'` on BAM GTA + BAM San Jose (guarded on `v2_access IS TRUE`, matched on exact `business_name`). After this, those two academies start emailing parents a receipt for every successful payment | Receipts actually being sent. Everything else ships dormant | 2026-07-31, receipts build. **Apply AFTER `20260731T190000`.** It **RAISES and rolls back** unless it matches exactly 2 rows, so a wrong name switches nobody on rather than narrating a wrong outcome and committing it. The two names come from `scripts/snapshots/bam-gta.json` and `bam-san-jose.json` and the suite fails if they drift apart. If it raises: fix the WHERE, do not widen it. Real mail to real parents starts the moment this runs **APPLIED 2026-07-31 on Zoran's order, verified by read-back: receipt_mode='recurring' on exactly 2 rows (BAM GTA, BAM San Jose), no third academy touched. RECEIPTS ARE LIVE for those two. GTA has 35 live members, so real parents receive receipts from their next payment. tax_registration_number is still NULL for GTA - receipts carry the HST 13% line but no registration number until it is entered.** |
| `20260730T230000_offer_prices_billing_cadence.sql` | Adds nullable `offer_prices.billing_cadence` plus a CHECK allowing `4_weeks`, `monthly`, `12_weeks`, `24_weeks`, `3_calendar_months`, `6_calendar_months` or NULL. Additive, no data written, no default. NULL means "bill it exactly the way this build always has", so **applying it changes the billing of zero rows** - BAM GTA included. | Nothing breaks while it is unapplied: the code shipped ahead of it and every read of `billing_cadence` retries the select without the column (`sbWithCadence` in `api/website/checkout.js`, the inner retry in `api/website/offer.js`, the catch in `cadenceForCreation` in `api/offers/create-price.js`). What is BLOCKED is the feature: until this runs, no price row can be told to re-bill per 12 or 24 weeks or per true calendar month, so San Jose's 3 and 6 month terms keep billing per calendar quarter. | 2026-07-30 **APPLIED 2026-07-31 by the member-management room, verified by read-back: column + CHECK present, 0 rows carry a cadence (all legacy)** |
| `20260731T190000_member_receipts.sql` | The receipt system's schema. New table `member_receipts` (+ the **unique partial index on `(client_id, stripe_invoice_id) WHERE kind='payment'`**, which IS the send-once guard against Stripe's `invoice.payment_succeeded` + `invoice.paid` double-fire), **RLS enabled with staff-rw + client-read policies mirroring `member_agreements`**, plus `clients.receipt_mode` (nullable, CHECK recurring/first_only) and `clients.tax_registration_number`. Re-declares `clients.stripe_portal_url` with `IF NOT EXISTS`, so it is a no-op if `20260731T090000` already ran | **Nothing, and nothing breaks without it.** The code degrades: a missing column or missing table is read as "receipts are OFF for everybody" (`loadReceiptClient` / `isMissingSchema` in `api/_member-receipts.js`), never a throw, so the Stripe webhook and the refund action behave exactly as they do today. Until this is applied the whole feature is inert - which is also why it is safe to merge before applying | 2026-07-31, receipts build. Safe to apply any time; **turns nothing on** - `receipt_mode` is NULL for all 47 rows after it runs, and NULL is OFF. ⚠️ **The RLS block is not optional and must not be split off**: every row is one academy's parent data (athlete name, amount, card last4) and the portal ships a browser anon key, so the table applied without policies is readable cross-academy. `api/_member-receipts.test.mjs` fails if the enable-RLS or either policy leaves this file (`MUTATE=norls`) **APPLIED 2026-07-31 by the member-management room, verified by read-back: RLS enabled true, 2 policies, 0 rows, receipt_mode NULL for all 47 (OFF)** |
| `20260731T140000_emergency_contact_storage_defs.sql` | Adds the two academy-level STORAGE-ONLY defs (`emergency_contact_name`, `emergency_contact_phone`) to the academies **already using portal custom fields** (3 today = 6 rows; deliberately NOT all 47 clients, which would give every V1 academy two empty fields for a form it does not have). Definitions only, **no value backfill**. `ON CONFLICT (client_id, key) DO NOTHING`, so it is a no-op for any academy that already has the key (including one that archived or relabelled it) | Nothing is blocked, and that is the point: the code ships safe either way. `ensureStorageOnlyDefs()` mints the same rows on the enrollment path, so emergency answers start landing the moment the code merges, applied or not. Applying it makes the field appear (empty) on **every** contact's drawer immediately instead of one academy at a time on first enrollment. Order does not matter in either direction | 2026-07-31. Written not applied - for `/pending-sql`. The 18 historical answers still in `member_audit_log` are **not** touched by this; recovery is a separate human decision, reported by `scripts/recover-emergency-contacts.mjs` **APPLIED 2026-07-31 by the member-management room, verified by read-back: 6 defs across 3 academies** |
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
