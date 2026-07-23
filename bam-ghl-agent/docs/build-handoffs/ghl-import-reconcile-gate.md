# BUILD: Fix the pipeline-import reconcile gate (ghl_stage_id never populated)

You are picking up a scoped build in the **bam-os-requirements** repo, portal app at
`bam-ghl-agent/bam-portal/`. Supabase project: `jnojmfmpnsfmtqmwhopz` (use the Supabase MCP).
Surfaced during BAM San Jose's V2 onboarding. Nothing has been built yet.

## The problem (already traced - verify, don't re-derive)

`/ghl-pipeline-import` documents `reconcile` as **the gate staff check before flip**
(step 5 of `.claude/commands/ghl-pipeline-import.md`). That gate can never come back
clean, for any academy.

Live evidence from BAM San Jose (`client_id 5576acf0-acd3-4c05-9f9f-ebfde8618154`):
the import wrote 65/65 cards with correct roles, but `reconcile` returned:

```
ghl:    open_mapped=0   open_unmapped=83
portal: open_total=65   (interested 9, scheduled_trial 1, done_trial 11, nurture 44)
drift:  missing=0  mismatched=0  extra=65
clean:  false
```

### Root cause 1 - the stage map is always empty
`api/admin/pipeline-cutover.js` (~line 395) builds its GHL-stage -> role map like this:

```js
for (const r of reg) if (r.ghl_stage_id) stageToRole.set(String(r.ghl_stage_id), r.role);
```

`reg` is the academy's `pipeline_stages` rows. **Nothing ever sets `ghl_stage_id`.**
`scripts/apply-preset.mjs` / `api/agent/presets.js` create the 5 preset stages with
`ghl_stage_id` NULL, and the import runbook has no linking step. Confirmed in the DB -
all 5 of San Jose's rows have `ghl_stage_id = null`. So `stageToRole` is empty, every
GHL opp falls into `open_unmapped`, `ghlByGid` stays empty, and consequently every
imported portal row is reported as `extra`.

### Root cause 2 - intentional re-classification reads as drift
The runbook deliberately re-sorts cards by recency, not by their GHL stage name. For
San Jose we routed 44 stale cards to `nurture` - a role their GHL board has no stage
for at all. So even once root cause 1 is fixed, reconcile would report dozens of false
`mismatched` rows for divergence that was the whole point of the import.

## What to build

1. **A stage-linking step.** During import, map each preset role to the academy's actual
   GHL `stage_id` (the dump already carries `stage_id` + `stage_name` per card), have
   staff confirm the mapping, and persist it to `pipeline_stages.ghl_stage_id`.
   Handle the real case where a preset role has **no** corresponding GHL stage
   (San Jose has no "Nurture") and where several GHL stages collapse into one role.
2. **Teach reconcile the difference between drift and intent.** Record the role each card
   was imported as, and diff against that baseline rather than against the raw GHL stage.
   Only a *post-import* change on either side should count as drift.
3. **Check `shadow-on` for the same defect.** It is supposed to keep the store synced with
   GHL moves until the flip. If it resolves a moved card's role through the same empty
   `stageToRole`, it is a silent no-op today. Verify and fix if so.

## Acceptance criteria
- After an import, `reconcile` returns `clean: true` when nothing has actually drifted.
- A real post-import divergence (someone moves a card in GHL) shows up as `mismatched`.
- Intentional recency-based re-classification does NOT show up as drift.
- `pipeline_stages.ghl_stage_id` is populated for any academy that has been imported.
- Backfill San Jose so its gate can pass without re-importing.

## Relevant files
- `api/admin/pipeline-cutover.js` - `actionDump`, `actionImportCards`, `actionReconcile`,
  `actionSetShadow`, `actionFlip`; the stage map is ~line 395, drift detection ~line 427
- `scripts/ghl-import.mjs` - the CLI wrapping those actions
- `scripts/apply-preset.mjs` + `api/agent/presets.js` - create the stages (ghl_stage_id NULL)
- `.claude/commands/ghl-pipeline-import.md` - the runbook; update it with the new linking step
- Tables: `pipeline_stages` (`role`, `label`, `position`, `ghl_stage_id`), `opportunities`
  (`ghl_opportunity_id`, `stage_role`, `status`, `contact_name`), `stage_transitions`

## Current state of BAM San Jose (do not break it)
- Free Trial preset applied: 5 `pipeline_stages` + 23 `stage_transitions`
- 65 of 83 open cards imported (18 terminal cards deliberately skipped)
- `pipeline_shadow = true`, `pipeline_provider = 'ghl'`, **not flipped**
- The imported roles are correct and were signed off. Preserve them - fix the gate
  around the data, do not re-sort the data to satisfy the gate.

## Ground rules
- Start by **verifying the diagnosis yourself** against the live DB and code before
  writing anything. Report back if the trace above is wrong.
- Work in a **git worktree** (`scripts/wt <name>`) - multiple sessions run on this repo.
- Follow the portal engineering + safe-build conventions (`/showtime` or `/build-portal`).
- **Never use an em dash** in any output, code comment, UI copy, or Slack text. Hyphens only.
- Do not flip any academy's pipeline. Flip is a separate, human-gated action.
- Commit and push with a descriptive message when done.

## First step
Verify the trace, then come back with a short plan (how you will capture the role -> GHL
stage mapping, and how reconcile will distinguish intent from drift) before implementing.
