# Handoff: automation templating

## Where I actually stopped

**Mid-step: templating BAM GTA's 5 remaining hardcoded literals in its sales messages.**
Nothing was applied to production. I dry-ran all five swaps through the real resolver first
and the result splits three ways.

**3 are proven byte-identical and safe to apply right now.** Verified by executing
`resolveMergeVars` on the current body and the proposed body and comparing:

| Row | Swap | Result |
|---|---|---|
| `contact_form` step 0 | `By Any Means Basketball` -> `{{location.name}}` | identical |
| `ghosted` step 1 | `https://byanymeanstoronto.ca/free-trial` -> `{{location.website}}/free-trial` | identical |
| `ghosted` step 2 | same | identical |

**2 are NOT identical and are waiting on Zoran.** I put both to him and he dismissed the
prompt without answering, so they are undecided, not declined:

- `ghosted` step 0 ends with the bare domain `byanymeanstoronto.ca`. `{{location.website}}`
  renders `https://byanymeanstoronto.ca`, adding a protocol into an SMS. Options offered:
  leave it hardcoded, accept the https, or build a bare-domain token.
- `trial_form` step 0 says `it's coach from By Any Means GTA`. `{{location.name}}` now renders
  `By Any Means Basketball`. Arguably the correct parent-facing name and consistent with every
  other message, but it IS a change to a live text.

**The next single action:** get those two answers, then apply all five with one UPDATE per row,
then re-render GTA and confirm the GTA lock still passes. `missed_trial` is already clean and
needs nothing.

### What I tried that did not work

- **Swapping `ghosted` step 0's bare domain for `{{location.website}}`.** Renders with `https://`
  prepended. `clientVars` builds `location_website` as `https://${domain}`, so there is no token
  today that yields a bare domain. Do not retry the swap expecting it to be invisible.
- **My first smoke test of `_brand-stats.js`** returned `{}` and looked broken. It was not. I had
  guessed the signature; it takes `(sb, clients)` and queries the database. Check signatures
  before reporting a module as broken.

### Things I believe but have NOT executed (house rule 5)

- **"Templating the email bodies moves 5 messages from blocked to copying."** The 8-of-17 figure
  today is real, computed by running `stepEnabled` over `CANONICAL_DEFAULTS`. The 13 and 15
  projections are my arithmetic, not executed.
- **"~40 minutes of staff time per academy."** An estimate. No skill has ever been run.
- **"Seeding San Jose through `applyPreset`/`seedAutomations` will work."** Never executed. The
  before-state is pinned in `scripts/snapshots/bam-san-jose.json`; the after has never happened.
- **"`bam-client-sites` reads no `brand_data`."** I checked `clients/` and `design-system/` only.
- **The unapplied migrations** (`20260727120000` sync_class, `20260727150000` welcome facts) have
  never been run against any database. Their SQL is unverified.
- **`upsert-automation`** has the same clobber shape as the bug I fixed in `upsert-step`. I judged
  it fail-safe (its direction turns messaging OFF) and its only caller always sends both fields.
  That judgement was not tested.

### Files another chat also touches

- **`public/client-portal.html`.** Three workstreams have converged on it. I did NOT touch it;
  every builder was explicitly told not to. If you need to, tell the orchestrator first.
- **`api/email-shells.js`.** I resolved a merge conflict there by UNIONING both sides: my optional
  content facts (`onlineProgramsUrl`, `referralOffer`) and main's link facts (`communityUrl`,
  `communityPlatform`, `reviewUrl`). Both are needed; do not "clean up" one set.

### Said by Zoran in chat and written down nowhere else

- **The skills are meant to cover more than emails.** His words: the skills should edit "all of the
  human judgement aspects of it (websites, email templates, branding, etc.)". **Everything planned
  so far is emails only.** Websites and branding are unscoped. This is the biggest gap between the
  plan and what he actually asked for.
- **"GTA as if it was created FROM the template"** is the framing he uses for why GTA gets
  templated at all. The test he has in mind: apply the master to a blank academy, fill in GTA's
  details, and you should get exactly what GTA has today.
- **He responds to visual artifacts, not prose.** Flowcharts and diagrams land; walls of text do
  not. `docs/plans/status.html` is built for him specifically and is the page to update when
  reporting progress.
- **He wants a separate agent to scan San Jose after seeding**, not the agent that seeded it.
- **He stopped item G when it was framed as "delete and rewrite GTA's rows"** and only approved it
  once it was reframed as making GTA template-derived. Framing matters with him: he rejects
  changes to GTA described as changes, and accepts the same changes described as templating.

---


**Goal:** make the free-trial sales system preset fully plug and play. Apply the preset and
everything copies onto a new academy, onboarding feeds it, and two skills handle the
human-judgement parts.

**Branch:** `claude/optimistic-leavitt-db0107`, pushed, no PR open.
**Status as of 27 Jul 2026:** 8 of the 17 preset messages copy to a new academy. Nothing is
deployed. Everything below is on that branch.

---

## Read these first, in this order

| Page | What it is |
|---|---|
| `docs/plans/status.html` | The dependency flow and the message counter. Start here |
| `docs/plans/gta-automation-map.html` | Every GTA message classified photocopy / swap / custom |
| `docs/plans/email-skill-rework.html` | The two skills, their 7 phases, the brand_data migration |
| `docs/plans/skill-run-example.html` | A worked transcript of both skills against GTA's real data |
| `docs/automation-message-harness.md` | The renderer, and why rendered output beats grep |

Serve them: `python3 -m http.server 5188 --directory docs/plans`

---

## The five decisions everything rests on

1. **GTA is the reference.** The master should equal GTA with identity templated out. GTA is
   the one academy where the right answer is already known, so if the template can rebuild
   GTA byte for byte it will build anyone.
2. **GTA's messages must never change by accident.** Locked by golden snapshot. Three
   deliberate changes were made and each was approved and proven surgical.
3. **No weekly drift check.** Zoran killed it in favour of a structural control: every row is
   marked preset-owned or academy-owned at write time. `sync_class` is therefore the ONLY
   mechanism, with no safety net behind it.
4. **Owners get no free-text override.** Copy changes route through support tickets, so every
   word stays staff-authored and therefore promotable.
5. **Two skills, run by internal BAM staff, not owners.** They propose copy as plain text in
   chat before anything is built.

---

## What is built and proven

Each was verified by making it fail first. Tests are committed; run them with plain `node`.

| Thing | Where | Test |
|---|---|---|
| `sync_class` marking + resolver | `api/_sync-class.js`, `api/email-templates/sync-classes.js` | `api/_sync-class.test.mjs` |
| Render-backed leak gate | same test file | 77 assertions |
| 3 emails re-shelled onto the shared frame | `api/email-templates/_shell.js`, `onboarding-emails.js` | GTA lock |
| Silent re-enable bug fixed | `api/_automation-step.js` | `api/_automation-step.test.mjs` |
| GTA byte-for-byte lock | `api/_gta-message-lock.test.mjs`, `api/__goldens__/` | itself |
| Blueprint data-loss guards | `api/_blueprint-card-guards.test.mjs` | itself |
| Onboarding promoted 3 -> 7 steps | `api/form-intro-automations.js` | `_sync-class` |
| `local` seeds `enabled:false` | `api/agent/seed-automations.js` | `_sync-class` |
| Parameterised renderer + review page | `scripts/render-messages.mjs` | fixtures in `scripts/snapshots/` |

**The strictest-wins rule:** `attributed` > `local` > `shared`. A step inherits its template's
class and a step row can only make it STRICTER, never looser. Unknown anything fails closed to
`attributed`.

**Current classes:** `nurture-4` is the only `shared` template. `nurture-3` and
`onboarding-testimonials` are `attributed`. Everything else is `local`, because the email
BODIES still carry GTA's phone, gym address, schedule and coach handles.

---

## What is left, in dependency order

1. **Template GTA's sales messages.** Unblocked. Swap the typed-in name and domain in
   `contact_form` step 1, `trial_form` step 1, `ghosted` steps 1 and 2 for tokens. `public_name`
   now exists and GTA's is "By Any Means Basketball", so `{{location.name}}` renders identically
   to today. **Prove it byte for byte with the GTA lock afterwards.**
2. **Template the email words.** The big one: moves 5 messages from blocked to copying. Pull
   phone, gym address, weekly schedule and coach handles out of the email bodies. The schedule
   should generate from `schedule_slots` (GTA has 86 live rows) rather than being typed.
   Once done, those templates become `shared` and seed ON.
3. **Build the two skills.** Spec in `email-skill-rework.html`. They author the 2 genuinely
   per-academy emails from what the owner already entered.
4. **Two wizard approval steps.** So an owner approves their messages before anything sends.
   The wizard already promises this and the step has never existed. Full rule: `_OBF_STEPS` row
   + `_obfFetchState` detector + `_OBF_SECTIONS` key, all three or it is invisible.
5. **Seed San Jose.** Render before, seed through `applyPreset`/`seedAutomations` (the same path
   a new academy uses, NOT a one-off script), render after, diff. Then a SEPARATE agent scans
   whether it took.
6. **Deploy.**

---

## Traps. Every one of these bit somebody today

- **A stale test fixture passes for the wrong reason.** The GTA lock had a hardcoded client row.
  When `public_name` landed in production, GTA's real output changed and the lock stayed green
  because it was comparing an old reality to goldens of that same old reality. It now reads
  `scripts/snapshots/bam-gta.json`, shared with the renderer, and asserts its own freshness.
  **If you add a production field, re-capture that snapshot.**
- **`local` meaning nothing at seed time.** It blocked copying in the leak gate but seeded
  steps ON. Promoting the sequence without fixing that would have sent GTA's story to every
  academy, enabled. Fixed, but the lesson generalises: a label that changes no behaviour is
  half-enforced, and half-enforced looks safe until it is not.
- **Re-seeding must be diff-and-patch, never delete-and-recreate.** San Jose's `nurture-3` is
  `enabled:false` deliberately. It is the ONLY disabled step in the entire system. A naive
  re-seed re-enables it and San Jose starts sending GTA's real parents' quotes.
- **Never trust a claim you have not executed.** Four false blockers were raised in one day by
  reading code. Trace overrides, do not grep literals: ask whether something overrides the value
  on the path to output, and whether that override fails OPEN or CLOSED.
- **The tester must never be the builder.** Two real bugs today were caught only because a
  separate agent was told to break things rather than confirm them. One of them was the lead
  agent being wrong.
- **If the proof is not in the repo, the fix is not finished.** Three builders produced excellent
  evidence and two left it in a scratchpad.
- **HTML before migration 400s everything.** A select naming a column that does not exist yet
  breaks the whole card. Apply the migration first, then merge the code.

---

## Open items not owned here

- **Testimonials connection** is parked deliberately. The table exists and is EMPTY. The seam is
  documented in `email-skill-rework.html`: `ONBOARDING_DEFAULT` ships 7 steps and the connection
  inserts one between era and review. **That 7-vs-8 gap against GTA is recorded on purpose.** Do
  not close it by promoting the testimonials step; that ships GTA's real parents to everyone.
- **`brand_data` cleanup** (drop `stats`/`domain`/`website_url`, move three keys) is built on
  branch `claude/brand-data-evidence` but NOT merged, pending the Business Basics fix landing
  first. `stats` is not merely stale, it is wrong: GTA's claims Friday training and GTA has never
  trained on a Friday.
- **The sales agent reads zero `brand_data`.** It has no idea the academy has a story or a
  why-us. A gap of omission, never decided.
- **Pro Precision's time zone** says Toronto, its address is Australia.
- **`wants_about_page`** is read by `api/website/team.js` and written by nothing.

---

## Two numbers to be honest about

- **2 emails are authored per academy, every academy.** A recurring cost, not a one-time build.
- **Roughly 40 minutes of staff time per academy.** The drafting is instant; a person still has
  to read, judge, and review the rendered messages.
