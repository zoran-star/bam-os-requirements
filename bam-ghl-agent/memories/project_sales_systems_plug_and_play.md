# Sales systems are SHARED + plug-and-play (GUARDRAIL)

**Decided 2026-07-22 (Zoran).** A sales system's STRUCTURE is shared across every academy on a preset and must stay plug-and-play. An academy NEVER forks the structure.

## What is "structure" (shared, never forked)
- Pipeline stages + edges (`pipeline_stages`, `stage_transitions`)
- Automation steps / logic / timing / channel (`automations`, `automation_steps`)
- Agent behavior (already shared via `api/agent/prompt-structure.js`)
- The preset definition itself (`api/agent/presets.js`)

## What is per-academy (the ONLY legal source of difference)
Facts injected at runtime, resolved from the academy's own data:
- Offer details, staff records, selling points, calendar links, business name, addresses, pricing.
These flow in as merge fields / variables - not as edits to the structure.

## The rule: "one client needs X" has exactly TWO legal answers
1. **Everyone gets X** -> add it to the shared preset; it AUTO-PROPAGATES to all academies on that preset (no per-academy override, no approval gate - Zoran's call).
2. **X is a fact, not structure** -> parameterize it as a merge field sourced from the academy's data.

The illegal third answer = a per-academy structural edit / hand-tweaked copy row that forks that academy. If a design would create per-academy structural divergence, **STOP and flag it to Zoran** before building.

## Why
Per-academy structural forks create drift, break propagation, and force every future edit to be reconciled per academy. Zoran wants sales systems to be truly plug-and-play. If a client genuinely needs a structural change, that's a signal to make it shared OR to rebuild how the sales system connects to the academy (facts, not forks).

## Tension with today's code (the actual Build 1 work)
The current design has per-academy edit escape hatches that CONTRADICT this principle and cause drift:
- **Automations seeder is "create-only-if-missing / edit-safe"** (`api/automations.js` seed-preset-automations; `api/form-intro-automations.js` comments literally say "the academy then edits the step"). A master copy/timing edit therefore NEVER reaches academies that already have that automation.
- **Pipeline re-stamp** upserts, and a changed destination throws a 409 needing `force`, which WIPES the academy's edges. So structural edits either don't land or clobber.
- The **step-builder CRUD** (`upsert-automation`, `upsert-step`, `delete-step`, `reorder`) lets an academy hand-edit automation steps = a structural fork.

Build 1 = make master preset edits (pipeline + automations) auto-propagate to all live academies, and close/neutralize these fork hatches (academy-specific copy must come from merge-field facts, not hand-edited rows).

**DECISION 2026-07-22 (Zoran): go PATH B = runtime-read.** Stop materializing pipeline + automations into per-academy rows; board/router/worker read STRUCTURE straight from the shared preset at runtime (like agent behavior already does). Truest plug-and-play, zero drift, editing master is instantly live. This is core-data / backend architecture -> run `align-core-data-model` before building.

**Migration safety rule (Zoran flagged this himself):** before throwing away any per-academy copy, classify EVERY piece of data the sales system uses as either STRUCTURE (comes from master - safe, same for all) or FACT/STATE (per-academy - must have a guaranteed LIVE source). No academy may silently lose a fact that today lives only in its stored copy. Audit -> guarantee every fact has a live source (backfill gaps) -> THEN remove copies. Never flip blind. Companion dependency = Backlog item 2 (agent brain / agent notes must pull from offer/staff sources, not stored text) - see [[project_build2_agent_facts_derived]].

## Handoff absorbed 2026-07-22 (docs/sales-preset-entity-handoff.md, PR #1548 merged via #1554)
- Entity must reproduce the corrected free_trial graph: **5 stages, 23 edges + qualifications block** - VERIFIED in code (buildPresetRows compiles 23) and in GTA prod (23 rows, incl. cancel_booking + 3 ghosted_ran_out edges). 3 PR migrations applied to prod (re-timestamped 20260722205022/205044/205051 via MCP).
- Hard rules to encode: unqualified = ONE dead end (always criteria pick); lost/not-interested -> nurture, never unqualified; ghosted cadence day 1/2/3 with ENGINE as source of truth; stage = entry+engine+exits; hand-off copy in EXIT point only.
- **Academy edge edits on preset update: prod has ZERO hand-authored edges (is_seed=false count = 0 across all academies)** - so master-wins costs nothing today; retire academy-level edge authoring (Exit editor writes) per the guardrail.
- **DRIFT FINDING (poster child): ghost-stage role key.** Prod GTA renamed role interested->ghosted (prod-only migrations 20260721150552/150754, files NOT in repo) but code (presets.js, _stage.js:95) still authors `interested`; GTA carries an orphan `interested` stage row (0 opps, null label) + stale positions (two stages at position 0). Runtime survives only because GHL-name regex /interest|ghost/i matches both. Code and prod disagree = exactly the drift class the entity kills. **DECIDED 2026-07-22 (Zoran): canonical role key = `ghosted`, prod wins** - Phase 0 renames code (presets.js + _stage.js ref) + deletes GTA's orphan `interested` row.
- **Plan status 2026-07-22: NOT yet signed off.** Before building, Zoran will (a) paste the transcript of the other sales-system call (more preset context + edits), and (b) confirm everything wrapped into the sales system via a VISUAL DIAGRAM mockup showing what overlaps with what (preset structure, agents, automations, facts, funnels, builds 1-6, global vs academy). Diagram -> Zoran confirms -> then Phase 0.
- Detail Miami: 4 stages (no nurture), role `ghosted`, ZERO stage_transitions, stamp says free_trial but never applied (preset_applied_at null - distrust). Do NOT per-academy apply; Detail onboards via the entity (first proof).
- Also deferred to entity: context global-vs-academy editing loop (= Build 2, one propagation system), entry-point funnel ties shown in config, kill `seed_default_stage_transitions` SQL duplication.
- Gotcha: opportunities.stage_id FKs pipeline_stages.id -> stage IDENTITY rows must survive as thin anchors even under runtime-read; edges (stage_transitions) can go fully virtual.

## Jul 21 meeting transcript absorbed 2026-07-22 (Sembly PDF, 13pp) - NEW for the entity
Most "note for assembly" items already shipped in PR #1548 (verified). NEW additions to the entity design:
- **The preset bundles MORE than structure**: stages+edges + engines (agents/automations) + qualifications + Hawkeye action kinds + funnels/entry-point ties + **KPIs** (qualified trial close rate = the preset's main health metric; win/lost/deciding marks feed it; GTA ~31%). Entity must carry the KPI definition per preset.
- **AI-co-work preset authoring**: when preset #2 gets built (interest-form-only academies that hand-schedule pre-trials), structure the entity so Claude can co-author any preset ("these are the types of things presets might have"). Preset = template for ANY business (house cleaners etc).
- **Member-management presets are a PARALLEL preset family** (training-offer one exists, applied to GTA + Detail Miami) - entity architecture should anticipate preset families beyond sales.
- **Every-stage-has-an-engine guardrail**: nobody may sit in a pipeline with no automation, no agent, no Hawkeye (the Meg case, Zoran's "biggest pain") - entity validation rule.
- **Contact page ties to the sales preset only while exactly ONE preset exists**; multiple offers -> contact page routing is an OPEN design question (Zoran: "I'll figure it out").
- Open backlog items surfaced (not in the 6 builds yet): filtering agent for non-lead inbound (IG/email/SMS -> lead-detect + spam, future); rethink whether initial automations are still needed alongside the booking agent; client-facing naming/simplification pass (Rosano's point); closing-agent objections + sales strategies knowledge (Zoran+Mike sit-down in Miami); VERIFY age+location questions actually collected on the free-trial form; contact-page website editor can't annotate sections (separate bug).
- Onboarding-flow notes (separate track): Twilio texting/calling think-through for first clients; ads tri-mode choice (we-run / they-run pick Meta campaign tied to preset + marketing focus-mode setup / no-ads = no marketing section).

Related: [[project_sales_crew_model]], [[project_offer_tie_in]], [[project_entry_point_routing]]. Key files: `api/agent/presets.js`, `api/agent/prompt-structure.js`, `api/offers/apply-preset.js`, `api/offers/sync-agent.js`, `api/automations.js`, `api/form-intro-automations.js`, `api/offers/setup-status.js`.
