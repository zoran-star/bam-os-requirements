# Sales systems are SHARED + plug-and-play (GUARDRAIL)

**⚠ REFINED 2026-07-23 (Zoran) - THREE TIERS, not two.** Automation SEQUENCES (message copy, branded emails, timing, steps) are NOT shared structure: BAM tailors the initial drip per academy at onboarding, then the ACADEMY owns it (edits today via support tickets for emails - self-serve sequence editing = future build). Master edits to sequences do NOT retro-propagate (only new academies get the new seed); academy edits never touch the master. The current create-only-if-missing seeder is CORRECT for this tier. Tier model: (1) BAM MASTER locked + auto-propagating = stages/edges + which automations exist & where they hook + agent behavior + qualifications framework + KPI defs; (2) SEEDED-THEN-ACADEMY-OWNED = automation sequences/content; (3) FACTS derived live; (+ STATE untouched). This SHRINKS Build 1: only tier 1 needs runtime-read/auto-propagation. The 2026-07-22 framing below ("automation steps are structure, close the edit hatches") is superseded on that point - step-builder CRUD is a legit academy surface, not a fork hatch.

**Decided 2026-07-22 (Zoran).** A sales system's TIER-1 STRUCTURE is shared across every academy on a preset and must stay plug-and-play. An academy NEVER forks the structure.

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
- Detail Miami: 4 stages (no nurture), role `ghosted`, ZERO stage_transitions, stamp says free_trial but never applied (preset_applied_at null - distrust). Do NOT per-academy apply; Detail onboards via the entity.
- **PHASE ORDER CHANGE (Zoran 2026-07-22): go-live moves AFTER cleanup, and BAM San Jose (Lij) goes first, not Detail Miami.** Final order: Phase 0 reconcile+audit -> Phase 1 entity (runtime-read) -> Phase 2 agent facts from sources -> Phase 3 cleanup (retire copy-stamping + academy edge authoring + seed_default_stage_transitions) -> Phase 4 go-live: San Jose FIRST (fresh onboarding, lands on the finished machine), then Detail Miami.
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

## ⚠ BUILD CHECK (Zoran 2026-07-22): un-mark Lost when Nurture bounces back
**VERIFIED 2026-07-22 (Phase 0). Actual model:** nurture opps keep opportunities.status='open' (all 28 GTA nurture leads are open - agents/bounce NOT blocked; my isOpenOpp worry was wrong). "Lost" = KPI mark: `pipeline_outcomes` append rows; cc-sales-kpis counts outcome 'lost' OR 'nurture' as lost ("nurture = marked lost", Zoran 2026-07-15); "won beats lost if they buy later". **THE GAP:** the nurture->responded reply bounce (ghl/twilio/resend/email inbound webhooks) writes NO outcome row, so a returned lead still counts LOST in close rate until they actually buy. FIX: on bounce, append a pipeline_outcomes 'reopened' (or 'responded') row + make cc_qualified_trials latest-outcome-wins so returned leads count PENDING, not lost.

## Phase 0 findings (2026-07-22, investigation done, fixes pending Zoran review)
1. **Role split-brain confirmed but fail-safes hold.** Prod rows/edges = `ghosted`; code = `interested` (~12 call sites: presets.js, _stage.js:95, automations.js 307/312/337/669, agent-approvals 1634-5, ghl/pipelines 485/498, inbound-webhook 350 guard, twilio mirror, miami-lead 142, admin/pipeline-cutover 54). routeTransition(fromRole 'interested') misses the prod edge -> callers fall back to HARDCODED moves (behavior-identical for GTA); GHL-provider paths resolve stages via GHL label regex /interest|ghost/i -> GTA works today by fallback. Portal-provider academies (Detail) WOULD break (webhook guard `stage_role==='interested'` never matches renamed rows). Fix = code rename sweep interested->ghosted (keep accepting both in read guards during transition), delete GTA orphan `interested` stage row (0 opps, null label), re-stamp GTA (idempotent, fixes stale positions: prod has nurture=0/ghosted=1 vs preset responded=0..nurture=4).
2. **Prod-only migrations missing from repo:** 20260721150552_rename_interested_stage_to_ghosted + 20260721150754_sync_seed_default_stage_transitions_ghosted (applied via MCP, files never committed). Export into supabase/migrations/ for local-replay integrity.
3. **Lost-mark gap** (above).
4. **fc-core-srvc still inaccessible** from zoran-star account (repo 404s; same blocker recorded in docs/core-handoff/pipeline-presets.md since Jul 10). Core parity unreviewed; proceeding on the local handoff + Production Data Guardrails. OPEN LOOP: Zoran to get Luka to grant repo access.
5. **Handoff decision drift:** pipeline-presets.md Decision #3 (2026-07-10) says per-instance customization = automations + training; Zoran 2026-07-22 tightened to TRAINING + FACTS ONLY (automations are shared structure too) + runtime-read replaces stamped copies. Handoff doc must be updated when Phase 1 ships.

## Board feedback 2026-07-22 (Zoran, on the FigJam entity board)
- v4: Meta ad is NOT part of the sales system (marketing side) - removed from the board; the funnel piece that IS sales = the landing page (form + calendar inside it). Board = one left->right flow: landing page -> Booking -> Confirm -> Closing -> Member (far right); Ghosted + Nurture sit BELOW inside the pipeline frame (Nurture = the Lost bench). Second page added: "Building blocks" - high-level components of a sales system (stages, entry/exit points, engines, agents, automations, Hawkeye, funnels, forms, calendars, qualifications, knowledge, metrics).
- **Onboarding data points are NOT part of the sales system** - they belong to the MEMBER-MANAGEMENT system preset, which gets its own confirm session later. Removed the OB data-points box from the sales board.
- **Contact page form joins the sales preset ONLY when it's the academy's only offer** (matches transcript; encode as a conditional entry source).
- Sales board must show FULL detail (agent knowledge, all data stored at every point) via dropdowns; pipeline stages get a visual frame; qualifications card with where each criterion is collected (free-trial form up front, agents reading/asking in messages, trainer post-trial form).

Related: [[project_sales_crew_model]], [[project_offer_tie_in]], [[project_entry_point_routing]]. Key files: `api/agent/presets.js`, `api/agent/prompt-structure.js`, `api/offers/apply-preset.js`, `api/offers/sync-agent.js`, `api/automations.js`, `api/form-intro-automations.js`, `api/offers/setup-status.js`.

## Shared board deployment (2026-07-23)
Public shareable URL: **https://bam-sales-system-board.vercel.app** (Vercel project `bam-sales-system-board`, scope `zoran-stars-projects`). Source of truth = `bam-ghl-agent/docs/sales-preset-entity-map.html`; the deploy folder `bam-ghl-agent/docs/sales-system-board/` holds a COPY as `index.html` + a `vercel.json` (noindex header).
**NOT git-linked on purpose** - pushes to main do NOT build it, so it never competes for the team's build slot. To update after editing the map:
```
cp bam-ghl-agent/docs/sales-preset-entity-map.html bam-ghl-agent/docs/sales-system-board/index.html
cd bam-ghl-agent/docs/sales-system-board && vercel deploy --prod --yes --scope zoran-stars-projects
```
Link is PUBLIC (no auth) but noindex'd. Contains internal figures (GTA close rate, academy names) - fine for staff/partners, not for the open web.
