# Consolidate Agent Lessons

You are consolidating the sales agents' **teach-why lessons**. Every time staff edit
an agent's draft in Hawkeye they must leave a "why", which appends a raw
`agent_lessons` row. Left alone the pile grows forever and every raw lesson rides
every future prompt (context rot: more prompt = worse instruction following). This
skill clusters the raw pile into a compact set, ROUTES each item to where it
belongs, and mines the pile for onboarding gaps. It triages the WHOLE fleet
first (`scan`) so you consolidate where the rot actually is, and every apply run
is logged to a `consolidation_runs` KPI table (timestamped) so the loop is
measurable over time.

## The control dial (read FIRST - master vs academy)

Since 2026-07-23 the sales system runs on the shared master-preset model
(`memories/project_sales_systems_plug_and_play.md`). Every lesson you route must
land on the right tier:

| Tier | Who owns it | Where a lesson about it goes |
|---|---|---|
| **1 MASTER** (locked, auto-propagates) | BAM: stages/edges, agent behavior, TONE and persistence ("one voice for every academy" - Zoran), qualification framework | Shared: a **general lesson** (client_id NULL), or - for absolute one-voice rules taught repeatedly - a **code edit to the shared brain** (`api/agent/prompt-structure.js`, general layer; ships via PR, propagates on deploy). A lesson that implies changing structure (stages, edges, Hawkeye actions, automations hooks) is a **master preset change or product ticket**, never a lesson. |
| **2 SEEDED-THEN-ACADEMY** | Academy: automation sequences, extra form Qs, lessons/training | An **academy lesson** (client_id = academy) - but ONLY behavioral steer that is genuinely local. Tone corrections are NEVER academy lessons (tone is tier 1). |
| **3 FACTS** (derived live) | Academy's own records | **Fix the SOURCE, not the agent.** 8 of 9 fact sections render LIVE via `api/agent/fact-render.js` (`program`, `schedule`, `pricing`, `policies`, `business_info`, `selling_points`, `coaches`, `qualification_config`) from the offer (`offers.data.*`), client record, locations, and staff records. A stored `agent_prompt_sections` upsert on those keys is IGNORED at runtime (rendered > stored > default) and the Train Agent API rejects the edit. Route the fact to its real home (Blueprint / offer editor / Team section). Only `social_proof` still takes stored section text (until Build 5 Google reviews). |

A tone/persistence correction taught at ONE academy is master craft by
definition - route it general (or to shared-brain code), never academy.

## The preset model (read before classifying)

Today's agents implement exactly TWO presets: the **training offer** and the
**free trial sales system**. Other presets will come later for academies that do
not run free trials or sell differently. Consequences:

- **For now, assume everything is the free-trial preset** (Zoran 2026-07-10).
  The apply script tags every general lesson `context.preset = 'free_trial'` by
  default - do not agonize over the tag. Only mark a lesson
  `preset: "universal"` when it is trivially motion-agnostic (pure tone /
  texting craft with zero mention of trials or booking). The tag exists so that
  when preset #2 ships we can split the shared brain without re-reading
  every lesson.
- Academy-specific lessons are a DOUBLE signal: they fix that academy AND they
  flag a fact BAM should collect from every future client. That mining step is
  mandatory (Step 4), not optional.

## Lessons are scoped by agent TEMPLATE (Phase 4)

A lesson's `agent` field is the **agent template's lessonKey**, not a runtime
agent. Templates live in the code registry
(`bam-ghl-agent/bam-portal/api/agent/presets.js` → `AGENT_TEMPLATES`). Today the
free-trial templates reuse the runtime names, so the keys you will see are
`booking` (= `trial_booking`), `confirm` (= `trial_confirm`), `closing`. When a
second preset ships you may also see `call_booking`, `call_confirm`, etc.

Why this matters when you write a GENERAL lesson: a general lesson attaches to a
**template**, and it then rides in **every preset that reuses that template**.

- `trial_confirm` and `closing` are shared - a general lesson on them upgrades
  every preset that includes those stages. High blast radius: eyeball carefully.
- `trial_booking` (book a trial) and `call_booking` (book a discovery call) are
  DIFFERENT templates even though both use the booking runtime - their craft
  never cross-bleeds. A "how to get them to book" lesson is usually
  motion-specific: keep it on the right template, and if it names the trial, tag
  `context.preset` (see the preset model above).

When you promote a general lesson in Step 5, **state its blast radius**: name the
template and which presets currently reuse it. The apply script validates every
lesson's `agent` against the registry's template keys, so a typo is rejected.

## The six routing buckets

| Bucket | Test | Where it goes |
|---|---|---|
| **Fact -> source** (tier 3) | The lesson states an academy FACT (price, schedule, coach, policy, capacity, address, areas served) | Fix the REAL HOME the renderer reads: `offers.data.*` (program/schedule/pricing/policies/selling points), the client record + locations (business_info, qualification values), staff records (coaches). NOT an `agent_prompt_sections` upsert - rendered sections ignore stored text and the API rejects the edit. Exception: `social_proof` still takes stored section text. Archive the source row. |
| **Master craft -> code** (tier 1) | An absolute one-voice rule taught repeatedly (e.g. "no emojis", "don't reply to bare acknowledgments") | Edit the shared brain in `api/agent/prompt-structure.js` (usually the `tone` section - rides EVERY agent, every preset, every academy). Ship via PR. Archive the source rows once merged. Highest blast radius: Zoran must approve the exact wording. |
| **General lesson** (tier 1) | Sales craft that helps every academy running this preset, but is situational (not an absolute rule) | `client_id = NULL`, `scope = 'general'`, preset-tagged |
| **Academy lesson** (tier 2) | Behavioral steer that only makes sense for THIS academy (a local play, a local operating preference). NOT tone (tier 1), NOT a fact (tier 3) | `client_id = academy`, `scope = 'academy'` |
| **Structure / product flag** | The lesson implies changing the pipeline, edges, Hawkeye actions, automations, or reports a bug / feature idea | Not a lesson. Flag to Zoran: master preset change (auto-propagates), product backlog item, or bug. Archive the row. |
| **Drop** | Stale, contradicted, contact-specific (belongs in `agent_contact_notes`), or already covered by rendered facts / shared brain / an existing general lesson | Archive only |

Why facts must not stay lessons: lessons are injected with "they OVERRIDE the
guidance above", so a stale fact-lesson beats a corrected live-rendered fact
forever. Facts live in their sources; lessons carry behavior. Contact-specific
teachings ("Meg is away this weekend", "we gave him 2 free weeks") belong in
that contact's `agent_contact_notes`, never in the lesson pile.

## Prerequisites

The helper script talks to Supabase directly. It needs, in the environment:

- `SUPABASE_URL` (or `VITE_SUPABASE_URL`)
- `SUPABASE_SERVICE_ROLE_KEY` (or `SUPABASE_SERVICE_KEY`)

Pull them from the bam-portal Vercel project or a local `.env`. If they're not set,
the script exits with a clear message - ask Zoran where the keys are before retrying.

Run everything from `bam-ghl-agent/bam-portal/`.

## Step 1 - Triage the fleet, then pick an academy

Start with a fleet scan so you consolidate WHERE the rot actually is, not blind:

```bash
node scripts/lessons-io.mjs scan
```

This writes `lessons-scan.json` and prints every academy's raw-lesson count per
agent, flagging any that are **DUE** (15+ raw on a single agent = the run
trigger), plus the size of the shared general set (which rides every academy).
"Raw" = lessons not yet created by `consolidate-skill`.

Show Zoran the DUE list and let him pick. Then consolidate **one academy at a
time** - the dump still requires a clientId on purpose (a no-arg dump would mix
academies and misattribute facts). Work the DUE academies in turn; the scan is
how you know the queue. Default when nothing is obviously due: **BAM GTA**
(`39875f07-0a4b-4429-a201-2249bc1f24df`).

**Cross-academy general review.** The shared general set is the same for every
academy. When you have several DUE academies, eyeball the pooled general list
from the scan ONCE up front: a craft pattern showing up in three academies'
piles is a strong general-lesson candidate, and you avoid writing the same
general lesson three times. Route it general on the first academy, then just
reference it (don't re-add) on the rest.

## Step 2 - Dump the raw pile

```bash
node scripts/lessons-io.mjs dump <clientId>
```

This writes `lessons-dump.json`: the academy's own active lessons + the current
shared general set, grouped by agent (booking / confirm / closing). Read it fully.
Notes on the dump:

- Each row carries `context` (often `ai_drafted` vs `you_sent` - what the bot
  wrote vs what staff actually sent) and `promotion_reason` (the live classifier's
  local-vs-general hint). Use both as evidence; neither is a verdict.
- Each row also carries `thread_snapshot` (the conversation tail when the lesson
  was taught), `stage_from` (the pipeline stage the lead was in), and `stage_to`
  (where a move sent them, if the teach rode a move - usually null today). These
  are the training-signal columns added 2026-07-12. Use them as evidence: the
  thread shows what actually happened in the chat, and the stage tells you which
  motion the correction belongs to (helps route academy-vs-general and mine the
  intake gap). Older rows may have them null - that's fine, fall back to context.
- `good` arrays are `kind='good'` positive examples. They feed a different
  mechanism - NEVER merge them into fix lessons, and leave them active unless
  Zoran explicitly retires one.
- `warnings` flags legacy rows with `scope='general'` but a `client_id` (old
  promote flow). They only ever loaded for this academy - reclassify each one as
  a true academy lesson or a real shared general lesson.

## Step 3 - Cluster, classify, route

For EACH agent, work through that agent's lessons:

1. **Cluster** near-duplicates and lessons about the same behavior.
2. **Merge** each cluster into ONE crisp, imperative lesson ("When X, do Y").
   Consolidate at the right altitude: a durable heuristic, not a brittle if-else
   rule and not a vague platitude. Keep the agent's own voice; never invent a
   rule staff didn't teach. If 3+ lessons are all about tone/structure, consider
   whether ONE before/after example (agent_examples) would teach it better than
   more rules - flag that to Zoran instead of writing a mega-lesson.
3. **Route** each merged lesson into one of the six buckets above. For general
   lessons decide the preset tag: mentions trials, booking a trial, post-trial
   enrollment = `free_trial`; pure texting craft = `universal`. Consolidate
   **each agent separately** - a lesson never moves between agents; if the same
   craft was taught on two agents, decide whether it is an absolute one-voice
   rule (-> shared brain code, covers all agents at once) or write it per
   template.
4. **Track lineage**: for every merged lesson keep the list of raw source ids it
   folded in - the plan carries them as `source_ids`.
5. **Drop** anything stale or contradicted by a newer lesson.

Respect the repo hard rules in every lesson string: **no em dashes** (use a
hyphen), **no emojis**. Lessons are injected into prompts and can echo into
parent-facing SMS. The apply script rejects violations, so fix them now.

## Step 4 - Mine intake gaps (the onboarding bridge)

This is the step that makes each FUTURE client's agent start smarter. For every
**academy lesson** and every **brain fact** you routed, ask:

> "Which client fact, had BAM collected it at onboarding, would have made this
> correction unnecessary?"

First read the ledger `bam-ghl-agent/docs/onboarding-intake-candidates.md`.
Skip anything already **accepted / rejected / deferred** (rejected is final -
never re-propose). Then build a candidates table:

| Candidate data point | Source lesson(s) (quote raw text) | Agent | Disposition | Status |
|---|---|---|---|---|

Disposition is one of five:

1. **Onboarding question** - a static fact every academy should be asked up
   front -> row in the Notion Onboarding Data Points DB
   (`49be4ce65ada4d45b736070e11452edb`) AND a real question in the V2 UI (see
   below).
2. **Missing source field** - the fact belongs in a rendered fact section but
   its SOURCE has no field for it (e.g. "areas served" has no offer/client
   home). Add the field to the source (offer wizard question, client record,
   Team section) AND extend the matching renderer in
   `api/agent/fact-render.js` to include it. (Stored section wording only
   still applies to `social_proof`.)
3. **Config default** - a timer / threshold / cadence setting (root CLAUDE.md
   "configuration settings" rule) -> also an Onboarding Data Points row + a V2
   Settings control.
4. **Global default** - actually true for every academy -> fix the shared brain
   section or code default instead; nothing to collect.
5. **Live data** - changes weekly (capacity, current openings). NOT an intake
   question -> product/backlog candidate (Backlog DB `39c1f40a005c4c9ba50b0c7fe47b45bd`).

When a lesson spawned a candidate, put the candidate's ledger ID (e.g. `IC-003`)
on that plan entry as `intake_gap`.

**V2 UI placement (mandatory for dispositions 1 and 3).** A candidate is not
done when it lands in Notion - the question must actually get ASKED. For each
onboarding-question / config-default candidate, recommend ONE concrete home in
the V2 client portal and say why:

| Surface | Use it for |
|---|---|
| **BB card** (General / Staff / Locations / Brand / KPIs / Offers / Member Onboarding, `clients.*_data` jsonb) | Business-level facts the owner types once |
| **Offer setup** (per-offer fields) | Facts that vary per offer (Training is one offer type) - pricing details, group capacity, trial policy |
| **"Finish your onboarding" side page / Action Items step** | Anything that must be COMPLETED (connect, upload, confirm), not just typed |
| **Train Agent > Knowledge section wording** | Agent-only facts - improve the section template so the tab prompts for it |
| **V2 Settings** | Config defaults: timers, thresholds, channels, quiet hours |

Recommend the surface, the exact field label + input type, and where in that
surface it sits. Then **workshop it with Zoran** (AskUserQuestion popup:
placement options + your recommended one first). Once he picks, **build it in
the same session**: add the field/step to the V2 UI with storage wired, plus
the Notion row and the ledger entry. A candidate's Status only becomes
`accepted` when the question exists in the UI.

## Step 5 - Confirm with Zoran BEFORE writing

Show a tight summary (use the AskUserQuestion popup for the decisions):

```
Booking:  14 raw  ->  4 academy + 2 general + 3 brain facts   (11 archived)
Confirm:   9 raw  ->  3 academy + 1 general                    (5 archived)
Closing:  11 raw  ->  3 academy + 2 general                    (6 archived)
Intake candidates: 4 new (IC-007..IC-010)
```

- List every new **general** lesson in full with its **template + blast radius**
  (which presets reuse that template) and its preset tag - those affect EVERY
  academy running an affected preset, so Zoran must eyeball them.
- List every **brain fact** section update (section key + new wording).
- Any id in `archive_general_ids` (deactivating a SHARED lesson) needs Zoran's
  explicit yes - it changes every academy's prompt.
- Walk the intake candidates table and get accept / reject / defer per row.

Wait for his go.

## Step 6 - Apply

Build `plan.json`:

```json
{
  "client_id": "<the academy uuid>",
  "academy":  [ { "agent": "booking", "lesson": "...", "source_ids": ["<id>"], "intake_gap": "IC-007" } ],
  "general":  [ { "agent": "confirm", "lesson": "...", "preset": "free_trial", "source_ids": ["<id>"] } ],
  "archive_ids": [ "<this academy's raw + replaced consolidate-skill rows>" ],
  "archive_general_ids": [ "<shared rows being replaced - Zoran-approved only>" ],

  "ran_by": "zoran", "raw_count": 34, "brain_facts": 3, "candidates_new": 2,
  "by_agent": { "booking": { "academy": 4, "general": 2 } }, "notes": "biweekly GTA pass"
}
```

The last line is **optional KPI metadata**: the apply script auto-writes one
`consolidation_runs` row per run (timestamped) for lessons/week + accept-rate
tracking. Fill these so the row is rich - `raw_count` (raw lessons that went
in), `brain_facts` (count you routed to fact sections, since those aren't in the
academy/general arrays), `candidates_new` (intake candidates minted this run),
`by_agent`, `ran_by`, `notes`. Omit them and the row still lands with counts
derived from the arrays; the KPI is just coarser.

Bucket rule for archives: `archive_ids` takes ONLY rows belonging to this
academy (its raw lessons + its prior `created_by='consolidate-skill'` rows you
are replacing). Prior consolidated GENERAL rows have `client_id` NULL - they go
in `archive_general_ids`, never `archive_ids` (the scoped filter would match
nothing and the archive would fail). Only list ids you actually consolidated.

```bash
node scripts/lessons-io.mjs apply plan.json
```

The script validates first (agent enum, em dashes, emojis), inserts everything
in ONE atomic POST, then archives with scoped filters. **If it exits non-zero,
STOP and read the output**: a failed archive means raw lessons still ride
prompts next to their replacements. Recovery:

- The inserts already landed (the `plan.json.applied` marker says so). A bare
  re-run retries ONLY the failed archives.
- If the ids were in the wrong bucket, fix the plan and re-run with
  `--archive-only`.
- NEVER use `--force` after a failed archive - it re-inserts every lesson as a
  duplicate.

Apply the fact-source updates now too: edit the offer (`offers.data.*`), client
record, locations, or staff rows that the renderers read (Supabase MCP or the
Blueprint UI). Only `social_proof` still goes through an
`agent_prompt_sections` upsert. Master-craft code edits go in a PR in the same
session. Archive all source lessons via `archive_ids` in the same plan.

## Step 7 - Record AND build the intake candidates

- Append the new candidates to
  `bam-ghl-agent/docs/onboarding-intake-candidates.md` with Zoran's decisions
  (proposed / accepted / rejected / deferred), the source lesson quotes, and
  the agreed V2 UI placement.
- For each **accepted** onboarding-question or config-default candidate:
  1. **Build the question into the V2 UI** at the workshopped placement (BB
     card field, offer-setup field, onboarding side-page step, Knowledge
     section wording, or Settings control) with storage wired end to end.
     Follow the design system (`bam-portal/design-system/DESIGN.md`) and update
     mobile in the same pass.
  2. Create the row in the Notion Onboarding Data Points DB
     (`49be4ce65ada4d45b736070e11452edb`): Field Name, Description, Category,
     Collection Phase, Input Type, Source = `lesson-mining /consolidate-lessons
     <date> <academy>`, BAM GTA Example = the raw lesson quote, Blocks = "agent
     gives wrong answers about <topic>", FC Modules = "Sales agents". Paste the
     Notion link back into the ledger row.
  3. Mark the ledger row `accepted` only once the UI field exists.
- Commit the ledger + UI changes in the same session.

## Step 8 - Report

Confirm, all mandatory:

- Lessons written / archived per agent, and that general lessons now load for
  every academy's matching agent (new academies inherit them automatically).
- Brain sections updated: `<keys or "none">`.
- Intake candidates: N proposed / M accepted / K rejected or deferred.
- V2 UI questions built: `<field + surface, or "none">`.
- Ledger committed: yes/no. Notion rows created: `<links or "none">`.
- KPI: the apply script auto-wrote a timestamped `consolidation_runs` row with
  this run's counts - confirm it landed (the apply log prints "Recorded
  consolidation_runs KPI row"). That table is the durable ledger for tracking
  lessons/week and the academy-vs-general split over time.

## When to run

Run per academy when **any agent has 15+ active raw lessons** (rows not created
by `consolidate-skill`), or every 2 weeks for each academy live on Hawkeye,
whichever comes first. The pile compounds silently - the readers load every
active lesson with no cap. **Run `node scripts/lessons-io.mjs scan` any time to
see which academies are due at a glance** - it's the cheap read that tells you
whether a full pass is worth it.

## Notes

- **Non-destructive**: archived = `active=false`, never deleted. To undo, flip
  those rows back to `active=true`.
- **Runtime**: the readers are the `loadConfig` functions in
  `api/agent-approvals.js`, `api/agent-confirm.js`, `api/agent-closing.js`, and
  `api/agent/brain.js`. They load
  `or=(client_id.eq.<academy>,and(client_id.is.null,scope.eq.general))` filtered
  by `agent`, so this storage model is what actually feeds the prompts.
- **Fact precedence at runtime**: rendered fact (`fact-render.js`) > stored
  `agent_prompt_sections` text > hardcoded default. So a fact fix ONLY takes
  effect if you edit the source the renderer reads. If a rendered section
  looks wrong, the offer/client/staff data is wrong - fix it there.
- **Preset tags** live in `context.preset` on general rows. The readers do not
  filter on them yet (only one preset exists); when preset #2 ships, the tag is
  how we split the shared brain without re-reading every lesson.
- This replaces the old "promote to general" action AND the retired AI
  auto-promote queue - classification happens here, in one pass, by you + Zoran.
