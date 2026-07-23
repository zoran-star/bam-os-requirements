# Build 2: agent facts are DERIVED views, not typed text

**Zoran's spec, pasted 2026-07-22 (BAM V2 engineering session, San Jose onboarding).** Status: PLANNING - mockup one fact ("program" from the offer), Zoran confirms, then build.

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
