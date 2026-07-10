---
domain: pipeline-presets
review_state: ready-for-review
prototype_status: planned
core_parity: not-reviewed
last_reviewed: "2026-07-10"
prototype_commit: working-tree
core_commit_reviewed: unavailable
---

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

## Intended Model

| Concept | Purpose | Relationships and scope |
|---|---|---|
| `pipeline_presets` | The authored playbook (template) | Global (BAM-owned), keyed `free_trial`, `paid_assessment`, ...; status lifecycle |
| `preset_stages` | Template stage list | preset_id FK; **open `role_key` text** (replaces the closed 7-value `stage_role` enum); position; `worker_kind` agent \| automation \| human; agent_template_id / automation ref |
| `preset_transitions` | Template edge graph | Same shape as live `stage_transitions`: (from_role, trigger) → stage \| terminal |
| `agent_templates` | Reusable agent definition | key, mission, default prompt sections (moves the free-trial prose OUT of code constants into seeded data), tool config (reply/book/schedule/suggest-lost). Today's booking/confirm/closing become the free_trial preset's seeded rows |
| per-academy instance | The copy an academy runs | `apply_preset(client_id, preset)` stamps `pipeline_stages` + `stage_transitions` (both EXIST already) + new `client_agents` (client_id × agent_template + mode + brain overrides) |
| preset-scoped training | Lessons per motion | `agent_lessons.preset` real column (backfill `free_trial` from context tag); lessons key on agent_template; readers filter general lessons by the academy's preset |

## Phased path (each phase ships alone)

0. **Done:** stage registry, transition graph + router, automations engine,
   brain-as-data, preset-tagged lessons, Hawkeye training loop.
1. **Open the roles:** widen `stage_role` enum → text validated against the
   registry; move agent prompt defaults from code into seeded rows. ⚠ The
   enum→text widening is the ONE non-additive change - prod migration on live
   tables (`stage_transitions`, `pipeline_stages` CHECK) needs explicit review.
2. **Preset entities:** create the 4 template tables; seed `free_trial` from
   today's exact model; `apply_preset` replaces `seed_default_stage_transitions`.
3. **Generic workers:** collapse the 3 copy-pasted agent APIs
   (agent-approvals/confirm/closing) into one detector/drafter parameterized by
   (academy, stage, agent_template); Hawkeye tabs render from the academy's
   stages.
4. **Preset-scoped training:** `agent_lessons.preset` column, reader filters,
   per-preset `/consolidate-lessons` + intake mining.

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

## Open decisions (product - Zoran)

1. Preset hangs on the **academy or the offer**? (Offers are already first-class;
   one academy might want two motions.) This decides the FK shape - decide
   before Phase 2.
2. Who authors presets - BAM only, or academy forks?
3. Customization envelope for an academy's instance (recommend: transitions +
   agent mode editable; stage structure locked).
4. What is preset #2 in reality (design the abstraction against a real case).

## Parity gaps / shortcuts

- Core never reviewed (access blocker above).
- The design deliberately reuses the live `stage_transitions` shape rather than
  proposing a core-native one - if core already models pipelines differently,
  the template tables should follow core's shape instead; flag on review.
