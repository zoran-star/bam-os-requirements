# Consolidate Agent Lessons

You are consolidating the sales agents' **teach-why lessons**. Every time staff edit
an agent's draft in Hawkeye they must leave a "why", which appends a raw
`agent_lessons` row. Left alone the pile grows forever and every raw lesson rides
every future prompt. This skill clusters the raw pile into a compact, deduped set,
split into:

- **Academy-specific lessons** — offer, pricing, location, schedule, coach names,
  local facts. Stay with THAT academy (`client_id = academy`, `scope = 'academy'`).
- **General bot lessons** — sales craft that helps every academy (objection
  handling, tone, pacing, qualification instincts). Shared across ALL academies
  (`client_id = NULL`, `scope = 'general'`), loaded by every agent of that type.

Both carry `agent` (booking | confirm | closing) so a general **closing** lesson
never bleeds into **booking**. After consolidating, the raw source rows are
deactivated (history kept, just not loaded), so prompts stay lean.

> This replaces the old manual "promote to general" action — the classification is
> done here, in one pass, by you + Zoran.

## Prerequisites

The helper script talks to Supabase directly. It needs, in the environment:

- `SUPABASE_URL` (or `VITE_SUPABASE_URL`)
- `SUPABASE_SERVICE_ROLE_KEY` (or `SUPABASE_SERVICE_KEY`)

Pull them from the bam-portal Vercel project or a local `.env`. If they're not set,
the script exits with a clear message — ask Zoran where the keys are before retrying.

Run everything from `bam-ghl-agent/bam-portal/`.

## Step 1 — Pick the scope

Ask Zoran which academy to consolidate. Default: **BAM GTA**
(`39875f07-0a4b-4429-a201-2249bc1f24df`). Consolidate one academy at a time so the
academy-specific vs general split stays clean.

## Step 2 — Dump the raw pile

```bash
node scripts/lessons-io.mjs dump <clientId>
```

This writes `lessons-dump.json`: the academy's own active lessons + the current
shared general set, grouped by agent. Read it.

## Step 3 — Cluster and classify (this is the actual work — you do it)

For EACH agent (booking / confirm / closing), work through that agent's lessons:

1. **Cluster** near-duplicates and lessons about the same behavior.
2. **Merge** each cluster into ONE crisp, imperative lesson ("When X, do Y"). Keep
   the agent's own voice; never invent a rule staff didn't teach.
3. **Classify** each merged lesson:
   - Mentions this academy's price / offer / location / schedule / coaches / local
     facts → **academy**.
   - Pure sales craft that would help any academy's same-type agent → **general**.
   - If it's genuinely both, keep the local specifics in an **academy** lesson and
     lift only the transferable craft into a **general** one.
4. **Drop** anything stale, contradicted by a newer lesson, or already covered by
   the brain sections.

Respect the repo hard rules in every lesson string: **no em dashes** (use a hyphen),
**no emojis**. Lessons are injected into prompts and can echo into parent-facing
copy.

Then build `plan.json`:

```json
{
  "client_id": "<the academy uuid>",
  "academy":  [ { "agent": "booking", "lesson": "..." } ],
  "general":  [ { "agent": "confirm", "lesson": "..." } ],
  "archive_ids": [ "<id>", "<id>" ]
}
```

- `academy` / `general` = the consolidated lessons to WRITE.
- `archive_ids` = **every raw source id you consolidated** from the dump, PLUS any
  prior `created_by='consolidate-skill'` rows you're replacing (so re-runs don't
  stack duplicate consolidated rows). Only list ids you actually folded in; leave a
  lesson active if you chose not to touch it.

## Step 4 — Confirm with Zoran BEFORE writing

Show a tight before → after summary per agent:

```
Booking:  14 raw  ->  4 academy + 2 general   (8 archived)
Confirm:   9 raw  ->  3 academy + 1 general   (5 archived)
Closing:  11 raw  ->  3 academy + 2 general   (6 archived)
```

List the new general (shared-brain) lessons in full — those affect EVERY academy,
so Zoran should eyeball them. Wait for his go.

## Step 5 — Apply

```bash
node scripts/lessons-io.mjs apply plan.json
```

The script inserts the consolidated academy + general lessons and sets the archived
rows `active=false`. The agents pick up the new set on their next detector run — no
redeploy needed.

## Step 6 — Report

Confirm counts written/archived, and remind Zoran that general lessons now load for
every academy's matching agent. If new academies come online later, they inherit the
general set automatically.

## Notes

- **Non-destructive**: archived = `active=false`, never deleted. To undo, flip those
  rows back to `active=true`.
- **Runtime**: the readers are the `loadConfig` functions in `api/agent-approvals.js`,
  `api/agent-confirm.js`, `api/agent-closing.js`, and `api/agent/brain.js`. They load
  `or=(client_id.eq.<academy>,and(client_id.is.null,scope.eq.general))` filtered by
  `agent`, so this storage model is what actually feeds the prompts.
