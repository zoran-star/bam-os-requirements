# Sales Conversation Agents

System prompts and other building materials to set up the AI sales agents that run inside of Full Control. This is the "AI-native" layer that makes FullControl feel autonomous.

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
