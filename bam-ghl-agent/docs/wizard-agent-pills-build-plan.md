# BUILD PLAN: "Powers your sales agent" pills in the offer wizard

**Written 2026-07-24 by the BAM V2 engineering session.** Small, self-contained UI build. Execute in a fresh chat.

## The one-liner

The offer wizard is where an academy owner types the facts their sales agents read. Today nothing in that wizard says so. Add a small marker to the wizard sections whose data feeds the agents, so an owner filling in their offer knows those answers are going straight into what the agent tells parents.

This is the REVERSE direction of the editing loop that already shipped: the agent brain view already says "Rendered from: Offer - Schedule step" with an "Edit the brain" button that jumps here. This build closes the loop from the other side.

## Why it matters right now

BAM San Jose (Elijah "Lij" De Guzman) is filling in his Training offer this week. His answers ARE his agent's setup - a weak one-line description becomes what the agent says to every parent. The marker changes how carefully those fields get filled.

## CONFIRMED design decisions (Zoran)

- SECTION-level, not field-level. A badge per wizard section, not on every input - the wizard must stay uncluttered.
- Copy: "Powers your sales agent" (sentence case, no em dash - hyphens only, repo-wide hard rule).
- Only sections that ACTUALLY feed a rendered agent fact get the marker. Do not mark sections that do not.

## Which sections feed the agents (verified against `api/agent/fact-render.js`, 2026-07-24)

The Training offer wizard registry lives in `bam-ghl-agent/bam-portal/public/client-portal.html` at the `training: [` section list (~line 30212). Renderer: `_bbRenderOfferWizard()` (~line 29477).

| Wizard section id | Feeds which agent fact | What exactly |
|---|---|---|
| `general_info` | `program` + `qualification_config` | age_range, gender, skill_level, description, capacity, coach_ratio |
| `schedule` | `schedule` + `program` | classes, weekly times, per-class group_size |
| `pricing` | `pricing` | pricing_offerings (plans, commitments, whats_included) |
| `policy` | `policies` | cancel, pause, refunds, makeup, parents watching, under-18, holidays |
| `value` | `selling_points` | what_makes_different, program_structure |

NOT marked (they feed nothing the agent reads today): sales, onboarding, and any other section not in the table above. VERIFY this list against `derivedFactOverrides()` in `api/agent/fact-render.js` before building - it is the source of truth and may have grown.

Two agent facts come from OUTSIDE this wizard and are out of scope here: `business_info`/`qualification_config` partly from the Locations editor, and `coaches` from the Team section (client_users title + bio). If marking those surfaces is cheap and looks right, propose it to Zoran - do not do it unasked.

## Build steps

1. Read `bam-ghl-agent/bam-portal/design-system/DESIGN.md` first. Reuse an EXISTING pill/badge pattern from the portal - do not invent a new component. The brain view already renders a blue `LIVE - from your offer` badge (`#6EA8D8`) for derived facts; matching that colour ties the two ends of the loop together visually.
2. Add a map of section id -> true for the five sections above (single source in the file, near the wizard registry).
3. Render the badge in the section header inside `_bbRenderOfferWizard()`. If the wizard has a step/segment nav as well as a section body header, put it in ONE of them (body header preferred) - not both.
4. Optional if it is clean: a title/tooltip on the badge naming what it feeds, e.g. "Your agent reads this when a parent asks about pricing". Keep it to one short sentence.
5. Do NOT touch the fields themselves, the save paths, validation, or the onboarding wizard's step registries (`_OBF_STEPS` / `_OBF_SECTIONS`).

## Verify before committing (run from `bam-ghl-agent/bam-portal/`)

1. `node scripts/verify-client-portal-ui.mjs` - must pass (the tour verifier; mandatory after ANY client-portal.html edit).
2. `npm run build` - must pass.
3. Grep the diff for an em dash (U+2014) - there must be none.
4. Confirm the badge renders on exactly the five sections listed and nowhere else.

## Repo rules

- Branch, PR, merge - `main` is protected. Use a git worktree if another session may be editing.
- No emojis in product UI. Sentence case. Never an em dash in person-facing copy.
- V1 academies unaffected (this is V2 Blueprint UI only).
- Update `bam-ghl-agent/memories/project_build2_agent_facts_derived.md` in the same wave (it tracks the editing-loop work) and add the MEMORY.md line if you create a new note.
- Zoran is ADHD + a visual learner: short visual updates, mockup the badge placement for him BEFORE building, use the AskUserQuestion popup for any decision.

## Context to read first

- `bam-ghl-agent/memories/project_build2_agent_facts_derived.md` - the derived-facts architecture and the editing loop that shipped (PRs #1566, #1567, #1568, #1574, #1576, #1577).
- `bam-ghl-agent/memories/project_sales_systems_plug_and_play.md` - the three-tier ownership model. The offer is TIER 3 (the academy's own facts), which is exactly why marking it is honest: those fields really are theirs and really do drive the agent.
