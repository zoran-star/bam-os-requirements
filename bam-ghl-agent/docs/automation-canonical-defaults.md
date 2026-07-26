# Canonical automation defaults - the no-hardcode rule

Shipped 2026-07-25 (build handoff: `docs/build-handoffs/preset-automations-canonical-no-hardcode.md`).

## The one rule

**`api/form-intro-automations.js` IS the single canonical, proven drip copy for every academy's seed.** Two obligations follow:

1. **Promote good edits back.** When an academy edits its copy in the portal and the edit is *generally* good (warmer wording, a better channel for a step, a designed email), promote it into the defaults so every future academy seeds the improvement. Defaults that lag the best live copy are a bug - that is exactly how San Jose nearly seeded weak, stale copy while GTA's live copy was months better.
2. **Never an academy literal in the defaults.** No academy name, domain, owner, city, phone, socials, schedule, or address. Academy specifics are runtime facts carried by merge tokens.

## How identity resolves (no GTA leak)

- Tokens: `{{location.name}}`, `{{location.website}}`, `{{location_owner.first_name}}`, `{{location.city}}`, plus `{{contact.*}}`.
- The senders (automations worker, confirm agent, previews) pass `clientVars(client)` - identity read from the `clients` row: `business_name`, `website_setup.domain`, `owner_name` (first token), `email`, city best-effort from `address`.
- `api/email-shells.js`: an academy without its own `LOCATIONS` entry gets a config **derived from those runtime vars**. Identity fields fail to **EMPTY** - never another academy's values. An empty `{{location.website}}` drops its whole line from an SMS; empty footer links and domainless CTA buttons are dropped from emails.
- The 4 designed nurture emails (`api/email-templates/nurture-emails.js`) are tokenized the same way - only global-brand content (Coleman, the YouTube channel, `byanymeansbball.com`) is literal.

## Seeding

- **Applying a preset seeds its automations automatically** (`applyPreset` -> `api/agent/seed-automations.js`), keyed off `presetAutomationKeys(presetKey)`. "Preset applied but zero drips" is no longer possible.
- Idempotent + edit-safe: creates an automation only if missing; adds steps only when the automation has **zero** steps. Re-applying never touches an academy's edited copy (GTA stays untouched).
- Seeds are dormant: `enabled:true, approved:false`. Nothing sends until the academy approves.
- The portal's `seed-preset-automations` action calls the same shared seeder.

## Onboarding QA - divergence check

After applying a preset to a new academy (and periodically):

```bash
node bam-portal/scripts/check-automation-divergence.mjs <clientId>
```

- A just-onboarded academy should be **all MATCH**.
- `MISSING` / `EMPTY` = broken seed (exit 1) - re-seed via `seed-preset-automations`.
- `EDITED` = per-academy copy. Deliberate is fine; generally-good edits get promoted back into the defaults (rule 1).
- `--all` sweeps every academy that has automations.

## The onboarding drip is skeletal on purpose

GTA's live `onboarding` automation is packed with academy-only facts (WhatsApp invite, socials, coach phone, weekly schedule, gym address). Those are owner-provided specifics filled in the portal after seeding - never default literals. The shipped `ONBOARDING_DEFAULT` stays tokenized and skeletal.
