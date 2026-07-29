# Handoff: automation templating

## Where I actually stopped

**PR #1627 IS MERGED.** `origin/main` is at `5e4219f`, 59 commits, merge commit not squashed so
every message survives as the change log. **The branch was deliberately NOT deleted** - work
continued on it immediately and is now a follow-up PR's worth of commits.

The whole templating wave is live: the message locks, the render-backed leak gate, the templated
message bodies, the schedule generated from real sessions, `api/_academy-facts.js`, the
consolidated renderer, and the seven defects an adversarial tester caught. **San Jose and BAM GTA
are byte-identical across the entire sales preset on main.**

### The five skills, Zoran's own structure (ruled 2026-07-29)

1. **Branding deck** - reviews their old site + assets, staff+skill pass in localhost, owner
   approves the board on staging. **Exists** (`/branding-deck` in bam-client-sites).
2. **Core site build** - deck in, home/about/contact/programs out. **Exists** as
   `/site-build --phase core`. **NO owner gate**: our team approves in the workshop session.
3. **GHL migration** - seeds their contacts, message history and pipeline into the portal, then
   flips them off GHL. **Designed, not built.** Blocked on the seeding-flow design.
4. **Sales system build: free trial** - the ENTIRE system in one isolated skill. **BUILT this
   session** as `/sales-system` in bam-client-sites.
5. **Member management** - agreement + enroll funnel + member emails. **Parked on the
   orchestrator's backlog by his explicit instruction**, starts when he judges the sales preset
   genuinely plug-and-play.

**The owner approves exactly TWICE in the whole onboarding: their brand board, and their sales
messages.** That sentence is on `docs/plans/skills-pipeline.html` verbatim because it is what stops
a third approval being added later by someone with a good local reason.

**Isolation rule, his words:** more sales systems are coming, each needs its own build process, so
**the thing that forks is the SKILL, never the machinery underneath.**

### What is in flight right now

Three builds, all on `claude/optimistic-leavitt-db0107`, none committed to main:

| | Build | State |
|---|---|---|
| A | `/sales-system` skill | **Built, tested, 4 defects fixed, committed** |
| B | Owner sales-message approval step | Built, **adversarial tester running** |
| E | Reignition backend + migration | Built, **adversarial tester running** |

**Build D (site-build re-run guard) was DROPPED** by Zoran: "staff would never re run an entire
site build". The underlying collision finding stays true; the guard is not worth building.

### The decision waiting to be executed on Build E

**Reduce the webhook change to the minimum, and split the consolidation into its own change after
PR #1546 lands.** E's builder went outside its scope and refactored four live inbound-webhook
files (`twilio`, `resend`, `ghl` inbound + `email/sync-gmail`) from four copy-pasted stage-role
lists into a shared helper. Asked to justify it, it answered straight: **"not necessary. That was a
tidy-up I did while I was in there"**, and volunteered that half its own reasoning was circular
(the consolidation gave its test something exported to assert against).

Deciding facts: without the role added, unsent campaign steps are still cancelled (`exitEnrollment`
is role-blind), so the cost is the card MOVE being delayed up to ~24 hours, **a delay not a hole**;
and **the consolidation DELETES the exact line PR #1546 is rewriting**, so shipping it now makes a
stale PR more expensive to land. The minimal version is four files, four lines.

**Do not execute the trim while E's tester is mid-pass.** When you do, one assertion in
`api/_reignition.test.mjs` checks the shared constant - cut the consolidation and that assertion
goes green while measuring a constant nothing uses. Rewrite it against the four files' literals or
delete it. **It must not be left green and meaningless.**

### The live hole found and closed this session

**A body edit silently declassified a step from `attributed` to `shared`.** `resolveSyncClass`
takes the strictest of a row's class and its template's class; the seeder wrote no class on the
row, so the template ref carried the whole answer. Any body that stopped being exactly
`template:<key>` resolved `shared` - copyable. An academy's real parent testimonials were one edit
away from copying to every other academy, with the row looking completely ordinary.

Executed before the fix, all four resolved `shared`: a literal body, an empty body, a null body,
and `Template:nurture-3` with a capital T.

Fixed in `cd49fef`: the seeder stamps `resolveSyncClass(step)`, and **all 10 non-shared rows across
both live academies were backfilled**. San Jose's `nurture-3` verified still `enabled:false` after.

**The pattern worth carrying:** the seeder's comment said "persist this once that migration is
applied". The migration was applied that morning, which **silently promoted a correct deferral into
a live defect**, and nothing connected the two events. Standing duty now sits with whoever applies a
migration: sweep for deferred TODOs it just activated. **Refinement that matters:** only comments
that DEFER AN ACTION become defects. Comments that DEGRADE GRACEFULLY ("fall back to empty if the
table is missing") are guards, not landmines - a sweep that flags both cries wolf.

### The next single action

**Design the seeding flow** (direct / altered / reignited), which is the last design blocking
Build C, the GHL migration skill. Zoran approved reignition first precisely so the seeding design
has somewhere to put cold leads. After that: build C, then the reignition UI (Sales-section tile +
Blueprint campaign builder), then seed San Jose end to end - which is also **the measurement** that
replaces every minute estimate on the status page.

### What was found on the way, and matters more than the swap

**The GTA fixture had drifted from production, badly, for the second time.**
`scripts/snapshots/bam-gta.json` had `brand_data` truncated, `website_setup` reduced to the
domain, `missed_trial` / `trial_form` / `summer_special` missing entirely, onboarding recorded as
3 steps against production's 8, and the ghosted bodies already edited to the PROPOSED tokenized
form rather than the live one. Anything that read it for "GTA's real state" got a wrong answer.
Re-captured from production and verified body by body by md5, all 21 matching. `render-messages.mjs`
now also selects every column `clientVars` reads, so a `--client` re-capture cannot silently drop
a field the way the missing `public_name` once did.

**The master had the same bare-domain bug, for everyone.** `form-intro-automations.js` ghosted
step 0 used `{{location.website}}`, so every future academy would have texted `https://...` as a
standalone SMS line. Fixed in the master, not just for GTA. This is why the bare-domain token was
the right answer and "leave it hardcoded" was not.

**GTA's identity is still half-pinned in code.** GTA is the ONLY academy with an entry in the
`LOCATIONS` map in `email-shells.js`, so blanking its `website_setup.domain` changes nothing:
`locFor()` falls straight back to the hardcoded `siteUrl`. Found because a negative control
FAILED to be caught, not by reading code. **Deliberately not fixed:** the same entry carries GTA's
tagline, instagram, `onlineProgramsUrl` and `referralOffer`, and the columns that would replace
them (migration `20260727150000`) are unapplied, so deleting it today silently shortens GTA's
welcome email. Severity SCALE, blocked on that migration.

### New proof in the repo

`api/_gta-step-lock.test.mjs` locks all 21 automation step bodies rendered through the real send
path (`resolveMergeVars` for SMS exactly as `api/_send.js` calls it, `renderEmail` reduced to
parent-visible words plus link targets for email). Three negative controls, all caught:
`MUTATE=token` edits a body's web address, `MUTATE=domain` takes the academy's site away,
`MUTATE=name` lets the internal label reach a parent.

Full suite re-run at this point, 5 of 5 green: `_sync-class`, `_automation-step`,
`_gta-message-lock`, `_gta-step-lock`, `_blueprint-card-guards`.

### Things I believe but have NOT executed (house rule 5)

- **"Templating the email bodies moves 5 messages from blocked to copying."** The 8-of-17 figure
  is real, computed by running `stepEnabled` over `CANONICAL_DEFAULTS`. The 13 and 15
  projections are arithmetic, not executed.
- **"~40 minutes of staff time per academy."** An estimate. No skill has ever been run.
- **"Seeding San Jose through `applyPreset`/`seedAutomations` will work."** Never executed. The
  before-state is pinned in `scripts/snapshots/bam-san-jose.json`; the after has never happened.
- **"`bam-client-sites` reads no `brand_data`."** Only `clients/` and `design-system/` checked.
- **The unapplied migrations** (`20260727120000` sync_class, `20260727150000` welcome facts) have
  never been run against any database. Their SQL is unverified. I did confirm that `sync_class`
  is genuinely absent from `automation_steps` in production, so that half is no longer a guess.
- **`upsert-automation`** has the same clobber shape as the bug fixed in `upsert-step`. Judged
  fail-safe (its direction turns messaging OFF) and its only caller always sends both fields.
  That judgement is still untested.
- **San Jose's snapshot has not been re-captured.** `scripts/snapshots/bam-san-jose.json` was
  written by the same hand as the GTA one that turned out to be abridged. Treat it as suspect
  until it has been checked against production the same way.

### Files another chat also touches

- **`public/client-portal.html`.** Three workstreams have converged on it. I did NOT touch it;
  every builder was explicitly told not to. If you need to, tell the orchestrator first.
- **`api/email-shells.js`.** I resolved a merge conflict there by UNIONING both sides: my optional
  content facts (`onlineProgramsUrl`, `referralOffer`) and main's link facts (`communityUrl`,
  `communityPlatform`, `reviewUrl`). Both are needed; do not "clean up" one set.

### Said by Zoran in chat and written down nowhere else

- **CLOSED 2026-07-29. The skills covering more than emails is settled.** He asked for "all of the
  human judgement aspects of it (websites, email templates, branding, etc.)" and it sat parked for
  days. Put to him before building, he restructured it himself into the five skills above. The
  website skills turned out to ALREADY EXIST in bam-client-sites; what was missing was the sales
  system's message half, which is now built.
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


**Goal:** a new academy fully onboarded in about 30 minutes of the OWNER's time, with five skills
doing the human-judgement work and staff approving it. The free-trial sales system is the piece
that had to become plug and play first.

**Branch:** `claude/optimistic-leavitt-db0107`. **#1627 is MERGED** (main at `5e4219f`); the branch
lives on and carries the next PR's worth of work.
**Status:** 11 of the 17 preset messages copy to a new academy with nobody involved, measured by
running `stepEnabled` over `CANONICAL_DEFAULTS`, not estimated. Of the 6 that do not, 5 are
authored per academy by design and 1 is the parked testimonials email.

---

## Read these first, in this order

| Page | What it is |
|---|---|
| `docs/plans/skills-pipeline.html` | **The five skills and why in that order. Start here** |
| `docs/plans/sales-system-inventory.html` | Every item of the sales system: templated / fills in / written |
| `docs/plans/ignition-template.html` | Reignition, the approved design |
| `docs/plans/status.html` | The message counter and what blocks what |
| `docs/automation-message-harness.md` | The renderer, and why rendered output beats grep |
| `docs/plans/email-skill-rework.html` | The older two-skill design. Superseded by the five, still useful on the 7 phases |

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

Items 1 and 2 of the old list (templating GTA's messages, then the email bodies) are **DONE and
merged**. What remains:

1. **Design the seeding flow** - direct / altered / reignited. The last design blocking Build C.
   Reignition is already designed and approved, so cold leads have somewhere to go.
2. **Finish the three in-flight builds.** A is done; B and E are with adversarial testers. Then
   execute the agreed E trim (minimum webhook change, consolidation split out after #1546).
3. **Build C, the `/ghl-migration` skill.** Two phases: `seed` (dump, classify with CANONICAL
   role names, import, shadow-on, reconcile, quarantine, report) and `flip` (refuses until the
   sales system is approved and sending; flips pipeline/booking/calendar/email only). **Includes
   repairing the reconcile gate**, which has never worked - `pipeline_stages.ghl_stage_id` is
   never populated, so every imported row lands in `extra` and the only way to flip today is
   `--force`.
4. **The reignition UI.** The Sales-section tile (V2 only, shown only while a campaign is active,
   live count, click to roster, click a person for the existing contact card) and the staff
   campaign builder in the Business Blueprint.
5. **Seed San Jose end to end.** Render before, seed through `applyPreset`/`seedAutomations` (the
   real path, never a one-off script), render after, diff, then a SEPARATE agent scans whether it
   took. **This run is also the MEASUREMENT** that replaces every minute estimate on the status
   page, and Zoran's 30-minute target is measured against the owner's clock, not the staff clock.
6. **Item 31 and the support-email decision**, as ONE visual for Zoran. Removing GTA's hardcoded
   `LOCATIONS` entry needs two brand calls from him (the gold wordmark suffix, and which address
   parents write to - `clients.email` is his personal inbox, not a support address) plus two new
   columns and a city fix. Measured: 7 of 9 identity fields still differ.

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
