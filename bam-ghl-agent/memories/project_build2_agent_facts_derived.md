# Build 2: agent facts are DERIVED views, not typed text

**Zoran's spec, pasted 2026-07-22 (BAM V2 engineering session, San Jose onboarding).** Status: **FIRST FACT SHIPPED 2026-07-23** - `program` renders live from the Training offer.

## Shipped 2026-07-23 (program fact)
- `api/agent/fact-render.js`: pure `renderProgram(offers.data)` (age_range, gender, skill_level, description, structure, per-class group_size w/ capacity fallback, coach_ratio) + `derivedFactOverrides(clientId, sb)` (60s offer cache; returns {} on any failure). Returns null when <3 lines -> stored text stays as fallback (sparse-offer safety).
- Precedence everywhere: **rendered fact > stored agent_prompt_sections text > hardcoded default.** Wired in BOTH `_sections.loadMergedOverrides` (approvals/confirm/closing/sandbox) and `brain.loadBrainConfig` (previews) - live == preview guaranteed.
- Wizard: 2 new Training-offer questions - `coach_ratio` (general_info step, text) + `group_size` per class (schedule block_builder, text). GTA coach_ratio backfilled ("At least 2 coaches per session").
- NOT rendered by design: private training / adult classes / camps (future offer types; agent = not-currently-offered + flag interest).
- **DRIFT SURFACED, needs Zoran:** GTA ages - stored override said "6 and up", offer says "9-17" (now the agent says 9-17; if 6 is right, fix the offer age range). GTA offer description = "Regular training" (weak; now agent-visible - improve in the offer editor).
- **2026-07-23 later (PR #1567): schedule/pricing/policies/business_info renderers SHIPPED.** Promoted sync-agent's builders into fact-render.js; sync-agent imports the same fns (one source of truth, stored text = sparse fallback only). Upgrades: schedule resolves location ids -> names + 12h times; pricing includes whats_included + excludes archived; loader fetches offer+client+locations parallel w/ 60s cache. Verified on real SJ prod data.
- **2026-07-23 latest (PR #1568): selling_points LIVE from offer.value** - Build 3's home question RESOLVED: GTA's curated bullets moved into offer.data.value.what_makes_different (+ owner culture line); renderSellingPoints wired into derivedFactOverrides. 6 of 6 core facts now render live.
- **2026-07-23 (audit catch + PR): coaches SHIPPED (Build 4).** renderCoaches reads client_users (title/bio present = a coach), owner first. Killed the hardcoded leak "certified by By Any Means, played college/pro" that was FALSE for every non-GTA academy. Empty (San Jose today) -> neutral instruction, agent invents NO credentials. Edit path exists (Team section title+bio). qualification_config also now renders (audit catch). 8 fact sections render live.
- **2026-07-23 (PR #1576): EDITING LOOP UI SHIPPED (US-1..4, built by Opus subagent, independently verified).** FACT_SOURCES map -> source labels on every derived section; 'Edit the brain' button deep-links via _factJumpTo (_bbNavigate offers/{step} · locations · staff); fresh:true cache-bust on return from a jump (bustFactCache export); brain-health strip 'N of 8 facts live' + jump chips for fully-missing facts; staff SandboxApp derived sections = read-only cards (killed a dead-end editable textarea). US-5 SHIPPED (PR #1577, Opus subagent + independent verification): per-teammate 'Can edit the agent's brain' toggle in Blueprint Staff member cards, wired to existing can_train_agent via the owner-gated set-staff-tabs action (caller must be staff/owner; owner target rejected; teammate can never flip their own; new teammates default off; BAM staff stay hidden).
- Still open in Build 2: social_proof/Google (Build 5 - then websites tie-in); pricing transparency MODE -> preset-level (structural, later); wizard-side 'powers your agent' pills (fast-follow).

## Principle
An agent fact (the per-academy sections sales agents read) is a VIEW onto structured data we already store - never free text typed into the agent. A fact lives once in its real home; the agent renders it from there. Edit the offer -> agent updates. No drift, no double entry.

## Current state (verified, don't rebuild)
- `api/agent/prompt-structure.js` already splits SHARED behavior (layer "general", in code, propagates on deploy) from PER-ACADEMY fact sections (layer location/offer/goal).
- BUT each fact section today = hardcoded GTA default in SECTIONS, or a per-academy TEXT override in `agent_prompt_sections` (seeded by `api/offers/sync-agent.js`). Facts are NOT pulled live. Closing that = Build 2.

## Fact -> real source map (Zoran's picture)
| Fact section | Source |
|---|---|
| business_info | academy record (name, address, phone, trial link, years) |
| schedule | offer.data.schedule |
| program | offer.data.general_info (age, skill, group size, co-ed, private, camps, adult) |
| pricing | offer.data.pricing (transparency mode + tiers + discounts) |
| policies | offer.data.policy (cancel/pause, makeup, parent-watching, under-18) |
| coaches | staff records (owner already there) - NOT a typed fact. Includes coach CREDENTIALS + coach-to-athlete RATIO, both sourced from staff records (= Build 4, per-academy, small) |
| selling_points | the offer; canonical home TBD, likely value/what-makes-different (= Build 3: pin the home + add any missing offer questions; parents-watching Q already exists. Mixed shared/academy, small) |
| social_proof | Google Reviews auto-pull (= Build 5: SHARED build, but each academy connects its own Google account - "shared with per-academy connect". Big side-build); manual fact until then |
| qualification_config | sales-system preset (same dims for all academies) + offer's age/location |

## Program-fact gap routing (Zoran 2026-07-23, on the mockup)
The 4 fields GTA's hardcoded program text knows but the offer doesn't ask:
- **Group sizes** -> CALCULATED from the SCHEDULE section of onboarding: add a group-size/capacity field per class (offer.data.schedule.classes[] lacks it today; the spine `schedule_slots.capacity` column already exists to receive it). Renderer derives "Group sizes: up to N" from the classes.
- **Coach ratio** -> new question in the GENERAL section of the Training-offer onboarding (general_info field).
- **Private training** -> NOT a program field. It's a whole separate training-offer TYPE, built later. REMOVED from the fact.
- **Adult classes** -> same, separate offer type later. REMOVED.
Pattern (matches camps/clinics): when an academy later HAS such an offer, the agent ties to THAT offer; until then the agent treats it as not-currently-offered (+ flag interest to admin - lead signal).

## Preset-level vs academy-level (feeds Build 1's structure-vs-fact audit)
- PRESET-level (shared, a change hits ALL academies): trial link, pricing-transparency MODE, qualification.
- Already global behavior (leave shared): under-18 = parent books.
- camps/clinics: static fact for now; ties to a camps/clinics OFFER when that exists (= Build 6).

## Hard requirement
Any preset/shared-level edit reaches EVERY academy on the preset (see [[project_sales_systems_plug_and_play]]). Backend + core-data -> run `align-core-data-model` when designing.

## Relation to other builds
Build 2 is the umbrella ("facts render from their sources"). Wiring lives in: Build 1 (shared-preset propagation, PATH B runtime-read), Build 3 (selling-points home + missing offer questions), Build 4 (coaches -> staff), Build 5 (Google Reviews).

## Flow
Plan -> MOCKUP of one fact rendering live from its source (e.g. "program" assembled from offer.data.general_info) -> Zoran confirms -> build. Short + visual. No em dashes.

## Editing-loop UI (US spec workshopped 2026-07-23, Zoran)
Decisions: button copy = **"Edit the brain"**; brain-health strip = IN vNow (fully-MISSING facts only, not thin ones); wizard-side "powers your agent" pills = OUT for vNow (Claude's call - keep the wizard uncluttered mid-SJ-onboarding, fast-follow later); social_proof excluded from health strip (stays BAM-managed until Build 5, then websites tie-in). US-5 staff-edit permission = OWNER TOGGLE, spec pending Zoran confirmation (default ON = staff can edit, stored ghl_kpi_config.staff_can_edit_brain, enforced in agent-train API for staff writes to lessons/examples/fallback sections; owner-only toggle in Train Agent view; staff side shows view-only lock when off). Build (US-1..4) delegated to an Opus subagent on branch claude/bam-v2-engineering-build-fc4f9d.
