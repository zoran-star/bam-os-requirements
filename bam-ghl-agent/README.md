# BAM GHL Agent

## What it is

A white-labeled GoHighLevel agency product for sports businesses (academies, clubs, trainers, AAU teams) and home services companies. BAM OS manages their CRM, automations, websites, funnels, pipelines, and communication systems inside GHL sub-accounts.

This project builds a fully autonomous GHL agent that handles two modes:

**Mode 1 — Support Ticket Agent**
When an existing client submits a ticket (error, change, or add-item), the agent diagnoses the issue, proposes fix steps, generates assets (copy, code, embed codes), and outputs a client-facing user guide.

**Mode 2 — Onboarding Build Agent**
When a new client completes their onboarding form, the agent reads all inputs, decides the site structure, pulls matching HTML sections from a Notion template library, injects copy and custom values, and outputs complete HTML per page ready to paste into GHL.

## Who's working on it

- **Zoran** — founder, product direction
- **Cameron (Rosano)** — systems/build side

## Project structure

```
bam-ghl-agent/
├── CLAUDE.md                     ← full project context and agent rules
├── agent-prompt.md               ← Claude API system prompt
├── client-portal.html            ← client-facing support portal (10 tiles)
├── dashboard.html                ← internal team dashboard
├── error-ticket-internal.html    ← internal view for error tickets
├── change-ticket-internal.html   ← internal view for change tickets
├── build-mode.html               ← builder's second-monitor timer
├── class-setup.html              ← onboarding: class setup step
├── offer-setup.html              ← onboarding: offer setup step
├── parent-onboarding.html        ← onboarding: parent onboarding step
├── bam-portal/                   ← React/Vite staff portal app (live on Vercel)
├── bam-gta-staff/                ← BAM GTA staff dashboard (React/Vite)
├── docs/                         ← reference docs (schema, brand, copy conventions)
├── sections/                     ← HTML section templates
└── env/.env.example              ← env var reference (real values gitignored)
```

## Knowledge base

The agent reads from a Notion knowledge base:
https://www.notion.so/33a5aca8ac0f81f38881d3f7003294ec

Contains: Build Guides, User Guides, Template Sections, Template Pages, Funnels, Forms, Custom Values, Tags, Pipelines, and the Questions Database.

## Design standards

All frontend work follows the Full Control design system (`docs/fullcontrol-brand.md`):
- Dark-first (ink surfaces)
- Space Grotesk / Inter / JetBrains Mono
- Gold (`#E8C547`) as the only accent
- No shadows, no gradients, no rounded corners > 6px
