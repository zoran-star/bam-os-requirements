# Canonical automation defaults + no-hardcode identity (2026-07-25)

Branch `claude/bam-v2-preset-automations-5148eb`. Build handoff: `docs/build-handoffs/preset-automations-canonical-no-hardcode.md`. Full rule doc: `docs/automation-canonical-defaults.md`.

## What shipped

1. **Canonical copy** - `api/form-intro-automations.js` defaults are now GTA's proven live copy, fully tokenized (`{{location.name}}`, `{{location.website}}`, `{{location_owner.first_name}}`). Ghosted step 3 = EMAIL (channel switch is deliberate); Nurture = the 4 designed emails (`template:nurture-1..4`). `CANONICAL_DEFAULTS` + `canonicalSteps()` exported as the one registry seeders + the divergence checker read.
2. **No GTA leak** - `api/email-shells.js`: `locFor(clientId, vars)` derives identity from the client row (`clientVars(client)`: business_name, website_setup.domain, owner_name first token, email, city parsed best-effort from address) for any academy without its own LOCATIONS entry. Identity tokens FAIL TO EMPTY, never fall back to GTA. Empty website drops the whole SMS line; empty footer links + domainless CTA tables are dropped from emails. Nurture email templates tokenized (only global-brand content remains literal).
3. **Auto-seed on preset apply** - `applyPreset` (api/agent/presets.js) seeds the preset's automations via the shared `api/agent/seed-automations.js` (create-if-missing, steps-only-when-zero, dormant approved:false). Portal `seed-preset-automations` action delegates to the same seeder.
4. **Divergence check** - `scripts/check-automation-divergence.mjs <clientId>|--all`: MATCH/EDITED/MISSING/EMPTY per key; exit 1 on MISSING/EMPTY. Run in onboarding QA after every preset apply.

## The standing rule

Defaults = the single canonical proven copy. Generally-good academy edits get PROMOTED back into the defaults; academy-specific facts NEVER become default literals (they are runtime merge tokens). Onboarding drip stays skeletal on purpose (GTA's is full of GTA-only facts, owner fills specifics).

## Gotchas

- GTA's `business_name` is "BAM GTA" and it has NO `website_setup.domain` - GTA rides its own LOCATIONS entry in email-shells.js; every other academy rides `clientVars`.
- `{{location.name}}` renders `clients.business_name` (e.g. "BAM San Jose") - keep business_name parent-presentable.
- Seeder is edit-safe via "zero steps" check: re-seeding an academy whose steps were deleted re-installs canonical; re-seeding an edited academy does nothing.
- San Jose: DONE 2026-07-26 - PR #1601 merged, apply-preset re-run, all 6 drips seeded dormant (approved:false until Lij goes live), divergence check = all MATCH.
- BAM NY has ghosted/nurture rows with ZERO steps (broken half-seed). Re-seed is PARKED by Zoran until San Jose is fully live - do not fix yet.
- Blank-domain drop is SENTENCE-level, not line-level (fixed 2026-07-26, PR #1605). Line-level deleted whole messages: missed_trial is one line so a domain-less academy rendered "" and the empty body burned 3 retries silently; ghosted step 2 lost its value proposition. Now only the sentence carrying the link drops; a bare-link line still drops with its ":" lead-in. `sendOn` also skips (never fails) a body that resolves empty.
- nurture-3 ships GTA's real testimonials with city/owner TOKENIZED, so another academy's parents read re-attributed quotes. SJ's nurture-3 step is deliberately enabled:false in prod until Lij's own testimonials arrive - that is a HOLD, not drift; do not re-enable, and expect SJ's nurture to show diverged.
- Vercel prod env gotcha bit again 2026-07-26: SUPABASE_SERVICE_KEY and VITE_SUPABASE_URL are stored WITH literal \n sequences - strip them before using pulled values locally.
