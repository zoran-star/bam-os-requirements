---
domain: pipeline-presets
review_state: ready-for-review
prototype_status: partial
core_parity: not-reviewed
last_reviewed: "2026-07-10"
prototype_commit: working-tree
core_commit_reviewed: unavailable
---

## Phase 1 SHIPPED (2026-07-10) — applied to prod

Migration `bam-portal/supabase/migrations/20260710170000_open_stage_role_vocabulary.sql`
applied to the linked project (`jnojmfmpnsfmtqmwhopz`) via MCP `apply_migration`.
Opened the closed stage-role vocabulary so code presets can add new roles:
- dropped the 7-value CHECKs on `pipeline_stages.role` and `opportunities.stage_role`;
- converted `stage_transitions.from_stage_role` / `to_stage_role` from the
  `stage_role` **enum** to **text** (rebuilds the unique constraint + index
  automatically) and **dropped the now-unused enum**;
- added a soft `^[a-z][a-z0-9_]*$` format check on all three (nullable-tolerant
  on stage_transitions).
Verified in prod: enum gone, columns text, a new role (`discovery_call_booked`)
inserts, invalid (`BadRole`) rejects, all rows intact (pipeline_stages 9 /
stage_transitions 20 / opportunities 90), free-trial roles unchanged. Widening
only, no data rewritten. **Migration is idempotent** (drop-if-exists +
do/exception guards + type-drop-if-exists), so a future `db push` re-run is
harmless; mark it `migration repair --status applied` on linked when convenient
to keep history tidy (MCP recorded it under its own timestamp). No code change
needed - the free-trial preset behaves identically; the unlock is dormant until
a code preset uses a new role (Phase 2).

# Domain: Pipeline Presets (sales-system templates) — Prototype-to-Core Handoff

## Summary

- **What the prototype implements (proposed, NOT built):** a reusable **pipeline
  preset** layer above the existing per-academy pipeline. A preset is an authored
  template - stages, transition graph, and per-stage workers (agent templates /
  automations) - that gets STAMPED onto an academy (`apply_preset`), after which
  the academy runs its own instance. Training (agent_lessons) becomes
  preset-scoped so shared "general" lessons never cross sales motions.
- **Why:** today's agents implement exactly one motion (training offer +
  free-trial). Zoran wants to author new presets for academies that sell
  differently, configure agents/automations per stage in those presets, and have
  the same Hawkeye teach-why training loop work per preset.
- **Intended production direction:** core sales/pipeline domain gains a
  `pipeline_preset` (template) aggregate: preset → preset_stages →
  preset_transitions + agent_templates; per-tenant instantiation into the
  existing stage registry + transition graph.
- **Suggested core owner:** pipeline / sales-automation domain (same owner as
  [`sales-flow.md`](sales-flow.md) - this design extends that one upward).

## References

- **Design (model of record):**
  `bam-ghl-agent/docs/agent-preset-architecture.html` (entity map + 4-phase path
  + open product decisions).
- **Prototype (current foundation, live):** `pipeline_stages` +
  `clients.pipeline_provider` (migration `20260629170000_pipeline_store_foundation`),
  `stage_transitions` + `seed_default_stage_transitions` (migration
  `20260706122103_stage_transitions`, prod-applied, routed by
  `api/agent/_router.js routeTransition()`), `automations*` tables,
  `api/agent/prompt-structure.js` (AGENT_SPECS: the 3 hardcoded agents),
  `agent_lessons` (+ `context.preset` tag on general rows, 2026-07-10).
- **Core reviewed:** **NONE - `fc-core-srvc` is inaccessible from this
  environment** (the `zoran-star` GitHub account cannot resolve
  `Full-Control/fc-core-srvc`; same blocker as sales-flow.md). Core parity is
  UNVERIFIED; review required before Phase 1 ships.

## Decisions (Zoran, 2026-07-10) — these are LOCKED

1. **Preset hangs on the OFFER, not the academy.** One academy can run multiple
   offers, each with its own pipeline preset. Instance keys become
   (client_id, offer_id, role_key). Lead routing by offer already exists
   (`entry_points.offer_id`).
2. **Presets are authored by BAM, in CODE.** A versioned code registry (like
   `prompt-structure.js` today), not DB template tables and not an authoring
   UI. The earlier `pipeline_presets`/`preset_stages`/`preset_transitions`
   TABLE idea is superseded by a code registry + a stamp function.
3. **Per-instance customization = automations + agent training ONLY.** Stage
   structure, transitions, and agent missions stay locked to the preset, so
   BAM can safely re-stamp preset upgrades onto live instances.
4. **Preset #2 = the discovery-call motion** (`discovery_trial`): responded →
   discovery_call_booked (NEW) → trial_booked → done_trial, with the same
   ghosted + nurture automations. Reuses `trial_confirm` + `closing` agent
   templates as-is; new pieces are only the `call_booking` mission and the
   `call_confirm` stage/agent.

## Intended Model (updated for the decisions)

| Concept | Purpose | Relationships and scope |
|---|---|---|
| preset registry (CODE) | The authored playbook | Versioned code module, BAM-only; per preset: key, stage list (open `role_key`s), transition graph, worker per stage (agent template \| automation \| human) |
| agent templates (CODE) | Reusable agent definitions, shared ACROSS presets | key (`trial_booking`, `call_booking`, `call_confirm`, `trial_confirm`, `closing`), mission, default prompt sections, tool config. Today's 3 agents become the free_trial preset's entries |
| per-OFFER instance | The copy that runs | `apply_preset(client_id, offer_id, preset_key)` stamps `pipeline_stages` + `stage_transitions` (both EXIST; gain `offer_id`) + new `client_agents` (client × offer × agent_template + mode) |
| template-scoped training | Lessons per agent template | `agent_lessons.agent` becomes the agent_template key (backfill today's 3); general lessons attach to the TEMPLATE, so craft taught to a shared template (e.g. trial_confirm) benefits every preset that reuses it, while different missions never cross-bleed |

## Phased path (each phase ships alone)

0. **Done:** stage registry, transition graph + router, automations engine,
   brain-as-data, preset-tagged lessons, Hawkeye training loop.
1. **Open the roles:** ✅ DONE 2026-07-10 (migration
   `20260710170000_open_stage_role_vocabulary`, applied to prod - see the Phase 1
   section above). `stage_role` enum → text + soft format check; closed CHECKs
   dropped. Was the ONE non-additive change; done as widening-only, no data
   rewritten.
2. **Preset registry in code + per-offer instances:** write the registry,
   codify `free_trial` from today's exact model; `apply_preset(client, offer,
   preset)` replaces `seed_default_stage_transitions`; add `offer_id` to
   `pipeline_stages` / `stage_transitions` / agent config (⚠ unique-key change
   + BAM GTA backfill: map its existing rows to its Training offer).
3. **Generic workers:** collapse the 3 copy-pasted agent APIs
   (agent-approvals/confirm/closing) into one detector/drafter parameterized by
   (academy, offer, stage, agent_template); Hawkeye tabs render from the
   offer's stages.
4. **Template-scoped training:** `agent_lessons.agent` → agent_template key,
   reader filters by template, per-template `/consolidate-lessons` + intake
   mining.

## Production data guardrails

- All Phase 2+ schema is **additive**. Phase 1's enum→text widening is the only
  exception and is called out as needing review before implementation.
- Templates are global rows; every instantiated row keeps `client_id` tenant
  scope. Provider ids (`ghl_pipeline_id`, `ghl_stage_id`) stay isolated on the
  instance (`pipeline_stages`), never on templates.
- `role_key` is a stable identifier, never a display name (labels live in
  `label`).
- Stage moves keep flowing through `pipeline_outcomes` (append-only audit,
  unchanged).
- Idempotency: `apply_preset` upserts on (client_id, role_key) exactly like the
  current seeders.

## Remaining open items

1. Core parity review (blocked on `fc-core-srvc` access - see References).
2. BAM GTA backfill mapping when `offer_id` lands (its current rows map to the
   Training offer).
3. Same academy, two offers on the SAME preset: academy-scoped lessons are per
   (client, agent_template) - confirm they should be shared across that
   academy's offers (current lean: yes, academy facts are academy-wide).

## Parity gaps / shortcuts

- Core never reviewed (access blocker above).
- The design deliberately reuses the live `stage_transitions` shape rather than
  proposing a core-native one - if core already models pipelines differently,
  the template tables should follow core's shape instead; flag on review.
