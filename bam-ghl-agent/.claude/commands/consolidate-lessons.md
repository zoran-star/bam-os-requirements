# Consolidate Agent Lessons

You are consolidating the sales agents' **teach-why lessons**. Every time staff edit
an agent's draft in Hawkeye they must leave a "why", which appends a raw
`agent_lessons` row. Left alone the pile grows forever and every raw lesson rides
every future prompt (context rot: more prompt = worse instruction following). This
skill clusters the raw pile into a compact set, ROUTES each item to where it
belongs, and mines the pile for onboarding gaps.

## The preset model (read before classifying)

Today's agents implement exactly TWO presets: the **training offer** and the
**free trial sales system**. Other presets will come later for academies that do
not run free trials or sell differently. Consequences:

- "General" does NOT mean universal. A lesson like "when they hesitate on the
  trial, offer a specific day" is general **to the free-trial preset**. Tag it
  `preset: "free_trial"`. Only motion-agnostic craft (tone, pacing, empathy,
  texting style) is `preset: "universal"`.
- Academy-specific lessons are a DOUBLE signal: they fix that academy AND they
  flag a fact BAM should collect from every future client. That mining step is
  mandatory (Step 4), not optional.

## The four routing buckets

| Bucket | Test | Where it goes |
|---|---|---|
| **Brain fact** | The lesson states an academy FACT (price, schedule, coach, policy, capacity, address) | Update the matching fact section (`business_info`, `schedule`, `coaches`, `social_proof`, `selling_points`, `program`, `pricing`, `policies`, `qualification_config`) via Train Agent > Knowledge or an `agent_prompt_sections` upsert. Do NOT keep it as a lesson. Archive the source row. |
| **Academy lesson** | Behavioral steer that only makes sense for THIS academy | `client_id = academy`, `scope = 'academy'` |
| **General lesson** | Sales craft that helps every academy running this preset | `client_id = NULL`, `scope = 'general'`, preset-tagged |
| **Drop** | Stale, contradicted, or already covered by brain sections / an existing general lesson | Archive only |

Why brain facts must not stay lessons: lessons are injected with "they OVERRIDE
the guidance above", so a stale fact-lesson beats a corrected brain section forever.
Facts live in sections; lessons carry behavior.

## Prerequisites

The helper script talks to Supabase directly. It needs, in the environment:

- `SUPABASE_URL` (or `VITE_SUPABASE_URL`)
- `SUPABASE_SERVICE_ROLE_KEY` (or `SUPABASE_SERVICE_KEY`)

Pull them from the bam-portal Vercel project or a local `.env`. If they're not set,
the script exits with a clear message - ask Zoran where the keys are before retrying.

Run everything from `bam-ghl-agent/bam-portal/`.

## Step 1 - Pick the scope

Ask Zoran which academy to consolidate. Default: **BAM GTA**
(`39875f07-0a4b-4429-a201-2249bc1f24df`). One academy at a time - the dump
requires a clientId on purpose.

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
3. **Route** each merged lesson into one of the four buckets above. For general
   lessons decide the preset tag: mentions trials, booking a trial, post-trial
   enrollment = `free_trial`; pure texting craft = `universal`.
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
   (`49be4ce65ada4d45b736070e11452edb`).
2. **Brain section default** - the fact belongs in one of the 9 fact sections;
   improve that section's default/template wording so the Knowledge tab prompts
   every new academy for it.
3. **Config default** - a timer / threshold / cadence setting (root CLAUDE.md
   "configuration settings" rule) -> also an Onboarding Data Points row.
4. **Global default** - actually true for every academy -> fix the shared brain
   section or code default instead; nothing to collect.
5. **Live data** - changes weekly (capacity, current openings). NOT an intake
   question -> product/backlog candidate (Backlog DB `39c1f40a005c4c9ba50b0c7fe47b45bd`).

When a lesson spawned a candidate, put the candidate's ledger ID (e.g. `IC-003`)
on that plan entry as `intake_gap`.

## Step 5 - Confirm with Zoran BEFORE writing

Show a tight summary (use the AskUserQuestion popup for the decisions):

```
Booking:  14 raw  ->  4 academy + 2 general + 3 brain facts   (11 archived)
Confirm:   9 raw  ->  3 academy + 1 general                    (5 archived)
Closing:  11 raw  ->  3 academy + 2 general                    (6 archived)
Intake candidates: 4 new (IC-007..IC-010)
```

- List every new **general** lesson in full with its preset tag - those affect
  EVERY academy, so Zoran must eyeball them.
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
  "archive_general_ids": [ "<shared rows being replaced - Zoran-approved only>" ]
}
```

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

Apply the brain-fact section updates now too (Knowledge tab or
`agent_prompt_sections` upsert), and archive those source lessons via
`archive_ids` in the same plan.

## Step 7 - Record the intake candidates

- Append the new candidates to
  `bam-ghl-agent/docs/onboarding-intake-candidates.md` with Zoran's decisions
  (proposed / accepted / rejected / deferred) and the source lesson quotes.
- For each **accepted** onboarding-question or config-default candidate, create
  the row in the Notion Onboarding Data Points DB
  (`49be4ce65ada4d45b736070e11452edb`): Field Name, Description, Category,
  Collection Phase, Input Type, Source = `lesson-mining /consolidate-lessons
  <date> <academy>`, BAM GTA Example = the raw lesson quote, Blocks = "agent
  gives wrong answers about <topic>", FC Modules = "Sales agents". Paste the
  Notion link back into the ledger row.
- Commit the ledger in the same session.

## Step 8 - Report

Confirm, all mandatory:

- Lessons written / archived per agent, and that general lessons now load for
  every academy's matching agent (new academies inherit them automatically).
- Brain sections updated: `<keys or "none">`.
- Intake candidates: N proposed / M accepted / K rejected or deferred.
- Ledger committed: yes/no. Notion rows created: `<links or "none">`.

## When to run

Run per academy when **any agent has 15+ active raw lessons** (rows not created
by `consolidate-skill`), or every 2 weeks for each academy live on Hawkeye,
whichever comes first. The pile compounds silently - the readers load every
active lesson with no cap.

## Notes

- **Non-destructive**: archived = `active=false`, never deleted. To undo, flip
  those rows back to `active=true`.
- **Runtime**: the readers are the `loadConfig` functions in
  `api/agent-approvals.js`, `api/agent-confirm.js`, `api/agent-closing.js`, and
  `api/agent/brain.js`. They load
  `or=(client_id.eq.<academy>,and(client_id.is.null,scope.eq.general))` filtered
  by `agent`, so this storage model is what actually feeds the prompts.
- **Preset tags** live in `context.preset` on general rows. The readers do not
  filter on them yet (only one preset exists); when preset #2 ships, the tag is
  how we split the shared brain without re-reading every lesson.
- This replaces the old "promote to general" action AND the retired AI
  auto-promote queue - classification happens here, in one pass, by you + Zoran.
