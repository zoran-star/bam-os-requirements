# Sales Conversation Agents

## Project memory
Notes live in [`memories/`](memories/). Scan [`memories/MEMORY.md`](memories/MEMORY.md) first, then open the specific note. See [`memories/README.md`](memories/README.md) for conventions.

## Memory upkeep — UPDATE IN REAL TIME, NOT JUST AT COMMIT

Update memory **the moment** something changes, not at commit time.

**Update memory IMMEDIATELY when:**
- A schema or data shape changes → update the relevant note
- A new file or component is wired up → update the project note
- A workflow/integration changes → update or create a note
- A decision lands → save it
- A path moves → update CLAUDE.md
- A gotcha is discovered (RLS rules, column case, env quirks) → save it

**Before commit, double-check:**
- New note added to `memories/`? → add a line to `MEMORY.md`
- `MEMORY.md` in sync with files in the folder?

Run `/memory-audit` periodically. Memory drift wastes context.


## Status
Booking agent is being built for BAM GTA. Zoran is working with Danny on sourcing training data from the best sales academies in the BAM Business network to train the agent. Still early stage.

## Current agents
- conversation-ai-booking-agent.txt — master template with {{PLACEHOLDER}} variables
- conversation-ai-booking-agent-bam-gta.txt — BAM GTA instance (all placeholders filled in)

## Planned agents
- Closing AI — post-trial conversion nudges (being designed in SES-025)
- Rebooking AI — re-engages no-shows (being designed in SES-026)
- More to be created

## How to create a new location instance
1. Copy conversation-ai-booking-agent.txt
2. Name it conversation-ai-booking-agent-{location-slug}.txt
3. Replace all {{PLACEHOLDER}} variables with location-specific values
4. Placeholder values come from the Onboarding Data Points DB in Notion (ID: 49be4ce65ada4d45b736070e11452edb)

## Key rule
The master template is the source of truth for agent behaviour. Location instances should only differ in their placeholder values — not in logic, tone guidelines, or guardrails. If the logic needs to change, update the master template first.

## Architecture — facts vs behavior (no duplicate sources)
The live agent "brain" runs from **`bam-portal/api/agent/prompt-structure.js`** (read by `api/agent-sandbox.js` + the GHL responder), with per-academy overrides in the `agent_prompt_sections` Supabase table.

Two kinds of section:
- **BEHAVIOR** (layer `general`/`goal`: role, tone, core_behavior, qualification, objection_handling, conversation_flow, guardrails, boundaries, examples, follow-up). **Academy-agnostic. Contains NO literal facts** — no ages, prices, addresses, links, discounts. It references the config generically ("the program's age range", "the configured price range", "the booking link in business info"). Shared across every academy/offer.
- **FACT** (layer `location`/`offer`: business_info, schedule, coaches, social_proof, selling_points, program, pricing, policies, qualification_config). **Per-academy. Holds every literal value EXACTLY ONCE** — age only in `program`, price + discounts only in `pricing`, address + booking link only in `business_info`, schedule only in `schedule`. Edit a fact in one place → it propagates everywhere.

**Why:** previously the age ("9") was baked into 5 behavior sections, so editing it in one place didn't change the agent. Now facts live once. **Rule: never put a literal fact in a behavior section — reference the config instead.** A new academy = override the FACT sections only.

> The `.txt` files here are the human-readable spec. The brain (`prompt-structure.js`) is what actually runs — keep them in sync, and apply the facts-vs-behavior rule to both.
