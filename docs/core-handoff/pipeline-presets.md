---
domain: pipeline-presets
review_state: ready-for-review
prototype_status: partial
core_parity: not-reviewed
last_reviewed: "2026-07-10"
prototype_commit: working-tree
core_commit_reviewed: unavailable
phases_done: [1, 2, "3a", 4]
---

## Phase 4 SHIPPED (2026-07-10) — template-scoped training

Lessons were ALREADY template-scoped by the Phase 2 design: `agent_lessons.agent`
holds an agent template's lessonKey, and free_trial's templates reuse the runtime
names (`trial_booking`→'booking', `trial_confirm`→'confirm', `closing`→'closing').
So the readers (loadConfig in agent-approvals/confirm/closing + brain.js) already
filter by `agent=eq.<templateKey>` and isolate correctly — a general `call_booking`
lesson (agent='call_booking') never loads into the booking runtime (agent=eq.booking).
Verified in prod: existing lessons key on `booking` / `closing` = valid template
keys → **zero backfill**.

What this phase wired up:
- `bam-portal/scripts/lessons-io.mjs` now imports `AGENT_TEMPLATES` from
  `api/agent/presets.js` and validates every plan lesson's `agent` against the
  registry's template lessonKeys (`booking|confirm|closing|call_booking|call_confirm`)
  — accepts a new preset's templates automatically, rejects a typo. Renamed the
  internal `AGENTS` const to `TEMPLATE_KEYS`; the general-lesson motion tag list is
  now `PRESET_TAGS` (context.preset = free_trial|universal), unchanged.
- `.claude/commands/consolidate-lessons.md` gained a "Lessons are scoped by agent
  TEMPLATE" section: general lessons attach to a template and ride every preset
  reusing it; the confirm step must state each general lesson's **blast radius**
  (template + which presets reuse it); shared templates (trial_confirm, closing)
  = high blast radius, booking-vs-call missions never cross-bleed.

Gated on the parked engine (Phase 3b): a runtime only LOADS a non-free-trial
template's lessons (e.g. call_booking) once it identifies as that template, which
is the engine's job. Until then the data model + skill are ready and correct.

## Phase 3a SHIPPED (2026-07-10) — offer data + read seam

- **Backfill:** both live pipelines map to their Training offer (Zoran). `pipeline_stages`
  + `opportunities` were ALREADY offer-backfilled by the offer-spine wave; this run
  backfilled the 20 BAM GTA `stage_transitions` edges (DETAIL has none), derived from
  each academy's own `pipeline_stages.offer_id` (guarded to academies with exactly one
  pipeline offer — no hardcoded ids). Verified: 20/20 tagged, 0 null, no dup edges.
- **Offer-aware read seam (DORMANT):** `resolveFromRegistry` / `resolveStage`
  (`api/agent/_store.js`) and `resolveEdge` / `routeTransition` (`api/agent/_router.js`)
  take an optional `offerId` that adds `&offer_id=eq.` ONLY when provided. No caller
  passes it, so prod is byte-identical (grep-verified). Because offer_id is fully
  backfilled, a filtered lookup returns the same row/edge an unfiltered one does today.
- **What this does NOT change:** the pipeline_stages unique stays `(client_id, role)`;
  `shadowUpsertStageRegistry` still upserts on `(client_id, role)` and does not thread
  offer; the 3 agent APIs are untouched. So each academy still runs exactly ONE pipeline.

## Phase 3b — the agent engine (PARKED until a gym needs a second preset)

**Status (Zoran, 2026-07-10): PARKED.** Not worth the live-SMS-routing risk while
every gym runs the single free-trial preset. **Trigger to build:** the first gym
that sells with a non-free-trial motion (e.g. discovery-call) signs up and needs
its own preset live. Everything below is a ready spec; when triggered, build it as
a focused, canaried effort (canary on BAM GTA single-offer first - behavior must
stay identical). Phases 1 / 2 / 3a already laid all the groundwork (open roles,
code registry + applyPreset, offer-tagged data + dormant offer-aware read seam),
so this is the only remaining piece before one academy can run two offer pipelines.

Precise spec:

1. **Thread per-opportunity offer.** Every queue/move/create path already has the
   opp (which carries `offer_id`). Pass `offerId` into `resolveStage` / `resolveEdge`
   / `routeTransition` (seam ready) and into `shadowUpsertStageRegistry` /
   `portalStageRowId` so the self-seed writes the right offer.
2. **Offer-scope the registry unique.** `pipeline_stages` unique →
   `(client_id, offer_id, role)` NULLS NOT DISTINCT; update
   `shadowUpsertStageRegistry`'s `on_conflict` to `client_id,offer_id,role`. Safe
   because all live rows already have a non-null offer (no NULL-vs-value dup), but
   MUST land together with step 1 or the self-seed makes duplicate stage rows.
3. **Collapse the 3 agent APIs** (`agent-approvals` reply bot, `agent-confirm`,
   `agent-closing`) into one detector/drafter parameterized by (academy, offer,
   stage, agent_template from `presets.js`). Each detector run iterates the
   academy's offers × the preset's agent stages.
4. **Hawkeye UI** renders tabs from the academy's offer pipelines instead of the
   hardcoded booking/confirm/closing.
5. Canary on BAM GTA (single offer — behavior must stay identical) before any
   academy runs a second offer pipeline.

## Phase 2 SHIPPED (2026-07-10) — registry + apply_preset, applied to prod

- **Code registry** `bam-portal/api/agent/presets.js`: `AGENT_TEMPLATES` (reusable
  worker defs = runtime + mission + lessonKey) + `PRESETS`. `free_trial` is
  today's exact model (dry-run reproduces the live 5 stages + 20 edges verbatim);
  `discovery_trial` (preset #2) defined too (6 stages incl. `discovery_call_booked`,
  26 edges, reuses `trial_confirm` + `closing`). `applyPreset({clientId, offerId,
  presetKey, dryRun})` + `buildPresetRows()` (pure). CLI `scripts/apply-preset.mjs`
  (`--list`, `--dry-run`). This replaces the one-off `seed_default_stage_transitions`
  (kept, still works, now legacy).
- **Migration** `20260710180000_stage_transitions_offer_id.sql` (applied to prod):
  added `offer_id` to `stage_transitions` (pipeline_stages + opportunities already
  had it from the offer-spine wave); recreated the edge unique as
  `UNIQUE NULLS NOT DISTINCT (client_id, offer_id, from_stage_role, trigger,
  to_kind, to_stage_role, to_terminal)` — same name so the legacy seed's
  `ON CONFLICT ON CONSTRAINT` still works. This ALSO fixes a latent bug: every
  edge key holds a NULL, and the old NULLS-distinct unique never matched, so a
  re-stamp/re-seed would have duplicated all edges.
- **Verified in prod (rolled back)**: dry-run free_trial == live model; the new
  unique makes a same-offer re-stamp idempotent (dupe entry edge → 1 row) and
  allows the same edge under a different offer (per-offer scope); zero leak, BAM
  GTA still 20 edges / 0 offer-tagged.
- **Scope boundary (honest):** the board/router/agents still key the pipeline by
  `(client_id, role)` and ignore offer_id (resolveStage / resolveEdge /
  buildPortalBoard / shadowUpsertStageRegistry). So applyPreset targets a NEW
  academy (one offer, one pipeline — no collision) or an idempotent re-stamp of
  the same offer. ONE academy running TWO offer pipelines at once needs those
  readers to go offer-aware + the pipeline_stages unique to gain offer_id =
  **Phase 3**. applyPreset REFUSES the multi-offer case rather than corrupt a
  reader that can't yet disambiguate. The existing pipelines (BAM GTA, DETAIL
  Miami) keep offer_id NULL until Zoran picks each one's offer (deferred backfill).

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
2. **Preset registry in code + apply_preset:** ✅ DONE 2026-07-10 (see Phase 2
   section above). Registry `api/agent/presets.js`, `applyPreset`, migration
   `20260710180000` (offer_id on stage_transitions + per-offer NULLS NOT DISTINCT
   edge unique). Deferred within this phase: the pipeline_stages unique gaining
   offer_id and the existing-pipeline offer backfill — both belong with the
   offer-aware readers in Phase 3, and applyPreset guards the multi-offer case
   until then.
3. **Generic workers + offer-aware readers:** collapse the 3 copy-pasted agent
   APIs (agent-approvals/confirm/closing) into one detector/drafter parameterized
   by (academy, offer, stage, agent_template); make resolveStage / resolveEdge /
   buildPortalBoard / shadowUpsertStageRegistry offer-aware (key by client +
   offer + role); add offer_id to the pipeline_stages unique; backfill the two
   live academies' pipelines to their chosen offer; Hawkeye tabs render from the
   offer's stages. THIS is what lets one academy run two offer pipelines.
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
