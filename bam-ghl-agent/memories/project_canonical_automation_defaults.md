# Canonical automation defaults + no-hardcode identity (2026-07-25)

Branch `claude/bam-v2-preset-automations-5148eb`. Build handoff: `docs/build-handoffs/preset-automations-canonical-no-hardcode.md`. Full rule doc: `docs/automation-canonical-defaults.md`.

## What shipped

1. **Canonical copy** - `api/form-intro-automations.js` defaults are now GTA's proven live copy, fully tokenized (`{{location.name}}`, `{{location.website}}`, `{{location_owner.first_name}}`). Ghosted step 3 = EMAIL (channel switch is deliberate); Nurture = the 4 designed emails (`template:nurture-1..4`). `CANONICAL_DEFAULTS` + `canonicalSteps()` exported as the one registry seeders + the divergence checker read.
2. **No GTA leak** - `api/email-shells.js`: `locFor(clientId, vars)` derives identity from the client row (`clientVars(client)`: business_name, website_setup.domain, owner_name first token, email, city parsed best-effort from address) for any academy without its own LOCATIONS entry. Identity tokens FAIL TO EMPTY, never fall back to GTA. Empty website drops the whole SMS line; empty footer links + domainless CTA tables are dropped from emails. Nurture email templates tokenized (only global-brand content remains literal).
3. **Auto-seed on preset apply** - `applyPreset` (api/agent/presets.js) seeds the preset's automations via the shared `api/agent/seed-automations.js` (create-if-missing, steps-only-when-zero, dormant approved:false). Portal `seed-preset-automations` action delegates to the same seeder.
4. **Divergence check** - `scripts/check-automation-divergence.mjs <clientId>|--all`: MATCH/EDITED/MISSING/EMPTY per key; exit 1 on MISSING/EMPTY. Run in onboarding QA after every preset apply.

## Business email split off the owner's (2026-07-29)

`clients.business_email` = the ACADEMY's public address. `clients.email` = the OWNER's, unchanged.

| Fact | Column | Renders as |
|---|---|---|
| Who parents email / unsubscribe through | `clients.business_email` | footer "Email" link, `{{SUPPORT_EMAIL}}`, the unsubscribe mailto |
| Who WE contact | `clients.email` | nothing parent-facing, ever |
| Number a member calls | `clients.phone` | `{{location.phone}}` (already existed, do NOT add a second phone column) |

- `clientVars()` reads `business_email` with **no fallback**. Empty does not borrow the owner's, it **HOLDS the send** (`api/_send.js`, same shape as the unverified-domain hold: owner texted once per 24h, own `email_events` type `business_email_hold_notice`, per-reason cooldown).
- GTA's `LOCATIONS` entry lost its `email:` line, then `tagline` + `instagram` (migration 20260729T230000), then **the whole entry was DELETED (2026-07-29)** - see the next section.
- Migration `20260729T210000_clients_business_email.sql` (⚠️ **PENDING** - also whitelists the 3 `google_rating*` cols in `update_client_basics` and seeds GTA `info@byanymeanstoronto.ca` + SJ `elijah@byanymeanssanjose.com`). Until applied: every academy's automation email holds. Not in the `loadClient` select lists yet on purpose (the after-the-migration rule); `_send.js` reads it via its own caught query - fold that in and delete it once applied.
- Business Basics card also got the Google reading fields (rating + count + stamped date), labelled **"Google showed 4.9 from 67 reviews on 29 Jul"**, never as current. Nothing consumes them.
- Locks: `api/_business-email.test.mjs` (5 controls), `_gta-message-lock` now fails if the snapshot drops `business_email` or if the owner address reaches a parent, `verify-bb-hydration` controls b5/b6/b7.

## The standing rule

Defaults = the single canonical proven copy. Generally-good academy edits get PROMOTED back into the defaults; academy-specific facts NEVER become default literals (they are runtime merge tokens). Onboarding drip stays skeletal on purpose (GTA's is full of GTA-only facts, owner fills specifics).

## Gotchas

- ~~GTA rides its own LOCATIONS entry in email-shells.js~~ **NO LONGER TRUE (2026-07-29).** There is no per-client-id map in email-shells.js at all; every academy including GTA resolves through `clientVars`. GTA's `business_name` is still "BAM GTA" (internal only) and its `website_setup.domain` IS set (`byanymeanstoronto.ca`).
- `{{location.name}}` renders `clients.business_name` (e.g. "BAM San Jose") - keep business_name parent-presentable.
- Seeder is edit-safe via "zero steps" check: re-seeding an academy whose steps were deleted re-installs canonical; re-seeding an edited academy does nothing.
- San Jose: DONE 2026-07-26 - PR #1601 merged, apply-preset re-run, all 6 drips seeded dormant (approved:false until Lij goes live), divergence check = all MATCH.
- BAM NY has ghosted/nurture rows with ZERO steps (broken half-seed). Re-seed is PARKED by Zoran until San Jose is fully live - do not fix yet.
- Blank-domain drop is SENTENCE-level, not line-level (fixed 2026-07-26, PR #1605). Line-level deleted whole messages: missed_trial is one line so a domain-less academy rendered "" and the empty body burned 3 retries silently; ghosted step 2 lost its value proposition. Now only the sentence carrying the link drops; a bare-link line still drops with its ":" lead-in. `sendOn` also skips (never fails) a body that resolves empty.
- nurture-3 ships GTA's real testimonials with city/owner TOKENIZED, so another academy's parents read re-attributed quotes. SJ's nurture-3 step is deliberately enabled:false in prod until Lij's own testimonials arrive - that is a HOLD, not drift; do not re-enable, and expect SJ's nurture to show diverged.
- Vercel prod env gotcha bit again 2026-07-26: SUPABASE_SERVICE_KEY and VITE_SUPABASE_URL are stored WITH literal \n sequences - strip them before using pulled values locally.

## The LOCATIONS map is GONE (2026-07-29) - one field drives everything

The last academy-specific literal in the email layer is deleted. `locFor(clientId, vars)`
**keeps** its `clientId` parameter and **never reads it** - that is deliberate, so a test
can render under GTA's real id and prove nothing answers for it.

⛔ **Never reintroduce a per-client-id branch in email-shells.js** in any spelling (map,
switch, `if (clientId === ...)`, an `overrides` column). That is the regression this
removed. `api/_email-identity-from-the-row.test.mjs` fails if one appears.

**The last four pinned fields did NOT become four columns.** They collapsed to two the row
already had:

| Pinned field | Now derives from | Note |
|---|---|---|
| `suffix` (gold wordmark word) | `public_name` minus the "By Any Means" prefix | one field drives the wordmark AND the full name |
| `full` (parent-facing name) | `public_name` | |
| `locationTag` (line beside wordmark) | `cityFromAddress(address)`, uppercased | the hand-composed "OAKVILLE - GTA" is gone |
| `city` | `cityFromAddress(address)` | takes the part before the province, rejects anything with a digit |

**Zoran's ruling:** keeping BOTH old strings (a `GTA` wordmark and a "By Any Means Toronto"
full name) would need a pinned suffix column, which is the hardcode wearing a database
column. **One field, no overrides.** He accepted the visible cost.

**Migration `20260729T235000_public_name_and_city_from_the_row.sql` (⚠️ PENDING, data only,
every update guarded on the exact current value):**

| Academy | Change |
|---|---|
| BAM GTA | `public_name` -> `By Any Means Toronto` |
| BAM GTA | `address` -> `2205 Rosemount Cres, Oakville, ON` (so the city parses; it was a bare street line) |
| BAM San Jose | `public_name` -> `By Any Means San Jose` (it was the bare brand too, so its wordmark would have read BY ANY MEANS BASKETBALL - never a GTA-specific bug) |

**What a GTA parent sees change:** wordmark `GTA` -> `TORONTO`, tag `OAKVILLE - GTA` ->
`OAKVILLE`, and the name in copy / `<title>` / footer reason all read "By Any Means
Toronto". 37 step+words goldens and 10 markup goldens re-taken; all 133 changed lines are
those three substitutions and nothing else, verified against the git diff.

**The address fix is load-bearing and invisible.** Without it, 8 of 10 templates lose their
location tag and 4 lose the city from their copy. With it, `{{location.city}}` renders what
the pin used to supply, so it produces no golden change at all.

**Until the migration is applied** GTA's wordmark reads BY ANY MEANS BASKETBALL and it
renders no city and no tag. Nothing held, nothing borrowed, no dead markup - and **silent**,
like 20260729T230000's. Section 8 of the new suite asserts exactly that interim.

**Still hardcoded, deliberately NOT fixed here:** three of GTA's `automation_steps` rows
hand-type the brand name (onboarding step 1 SMS, onboarding step 2 subject,
`summer_special` step 0 SMS), and four hand-type the domain. So after the migration the
shell says "By Any Means Toronto" while those messages still say "By Any Means Basketball".
That is live copy in the database, a separate owner-visible edit. Pinned by section 9 of
`api/_email-identity-from-the-row.test.mjs`.

**⚠️ The snapshot trap.** The goldens read `scripts/snapshots/bam-gta.json` at the
**MONOREPO ROOT**, outside `bam-ghl-agent/`. Its client row must carry the new
`public_name` and `address` or the locks record the old identity. Both snapshot `_note`
blocks were extended to document that they are ahead of production and why.

**Locks:** `api/_email-identity-from-the-row.test.mjs` (53 assertions, 4 controls: `pin`,
`borrow`, `nocity`, `internal`); `_tagline-instagram` section 5 rewritten from "the entry
still pins four fields" to "locFor ignores the client id, for every field";
`_gta-step-lock`'s `MUTATE=domain` no longer needs its neutral-id workaround and now
catches 17 steps under GTA's own id.
