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
