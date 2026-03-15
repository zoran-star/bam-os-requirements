# BAM OS Requirements

## Collaborators
This repo is a collaborative project between **Zoran** and **Cole**. Both contributors use Claude Code to work on the requirements. Changes made by either collaborator should be committed and pushed promptly so the other person always has the latest state.

- **Zoran** has access to: Git, Notion MCP, GoHighLevel MCP
- **Cole** has access to: Git, Notion MCP

When working on requirements, be aware that the other collaborator may have made recent changes — always pull before editing.

## Before you start
Always run `git pull` before making any edits to files in this repo. This ensures you have the latest changes from the other collaborator.

## After you finish
Always commit and push changes after making edits. Use descriptive commit messages that reference the job IDs affected (e.g. "Add MEM-010 referral tracking requirement"). This ensures the other collaborator gets changes immediately.

## Change log
When committing, include a summary of what changed in the commit message body — which jobs were added, updated, or removed, and why. This serves as the change log for the project.

## What this repo is
This repository holds the interactive business requirements flow diagram for BAM OS (`bam_os_business_requirements_flow.html`). It is a single self-contained HTML file with embedded JavaScript data representing all business requirements across 7 domains.

## Sources of truth
There are two sources for BAM OS business requirements that must stay in sync:

1. **This repo** (`bam_os_business_requirements_flow.html`) — interactive visual flowchart with all jobs, sub-jobs, and full field-level details embedded as JavaScript data
2. **Notion** — structured tables under the [Business Requirements](https://www.notion.so/31b5aca8ac0f81dca970c023294b24de) parent page:
   - [Marketing](https://www.notion.so/31b5aca8ac0f81d3bffdc79932d118c9)
   - [Content](https://www.notion.so/31f5aca8ac0f81229933dab1be576bf1)
   - [Sales](https://www.notion.so/31b5aca8ac0f81638750d27bc0598d19)
   - [Member Management](https://www.notion.so/31b5aca8ac0f816c9b8ee4e4768270da)
   - [Scheduling App](https://www.notion.so/31c5aca8ac0f81bebc61e9e76deb6a02)
   - [Strategy](https://www.notion.so/31c5aca8ac0f81da85dcc72bf057e3d6)
   - [Profiles & Identity](https://www.notion.so/3245aca8ac0f819e8166d52f994a5f7a)

**When making changes, update BOTH sources.** The HTML file is the more complete source — it has a unified schema across all domains and full sub-job detail rows. Notion pages have varying column structures per domain (see below).

## Domain structure

| Domain | Job ID prefix | North Star Metric |
|--------|--------------|-------------------|
| Marketing | MKT- | Cost per qualified free trial |
| Content | CNT- | Content output velocity |
| Sales | SAL- | Qualified trial conversion rate |
| Member Management | MEM- | Client retention rate |
| Scheduling App | APP- | Client retention rate |
| Strategy | STR- | Business performance visibility |
| Profiles & Identity | PRF- | Account data integrity |
| AI Advisor | AI- | Time to confident action |

## Schema differences across Notion pages
- **Marketing, Content, Strategy**: Full schema with Parent ID column
- **Sales**: Full schema but no Parent ID column; sub-job One-Liner fields may be blank
- **Member Management**: Full schema but no Parent ID column
- **Scheduling App**: Different schema — has Category column, omits Frequency/Data Inputs/Data Sources/One-Liner

The HTML file uses a **unified schema** across all domains. When adding new requirements, follow the HTML schema and adapt for each Notion page's column structure.

## HTML file structure
All requirement data lives in the `JOBS_DATA` JavaScript object (starts around line 482). Each domain has:
- `title`, `subtitle` (north star metric), `color`
- `jobs[]` array where each job has: `id`, `isParent`, `title`, `oneLiner`, `requirement`, `release`, `initiatedBy`, `frequency`, `dataInputs`, `dataSources`, `outputAction`, `humanTouchpoint`, `integrations`, `dependencies`, `edgeCases`, `notes`, `uxDetail`, `subJobs[]`

The Scheduling App domain also uses a `category` field per job.

## How to add or update a requirement
1. Update the `JOBS_DATA` object in the HTML file with all fields
2. **Immediately** update the corresponding Notion page table with the same data (adapting to that page's column structure) — do NOT defer Notion updates as a separate step
3. If adding a new parent job with sub-jobs, ensure sub-jobs are listed as separate rows in BOTH sources

**CRITICAL: Every single change to the HTML must be paired with the corresponding Notion update in the same step.** Do not batch Notion updates for later. The workflow is: HTML change → Notion change → commit. Every time, no exceptions.

## Presenting requirements
When showing requirements in a table, always include the one-liner column alongside ID, title, type, and release. This gives a quick summary without needing to drill into the full details.

## Conventions
- Job IDs follow the pattern: `{PREFIX}-{NUMBER}` for parent jobs, `{PREFIX}-{NUMBER}{letter}` for sub-jobs
- Release values: `MVP`, `V1`, `V2`, `V3`
- All jobs default to `Not Started` status
- Use em dash (—) for empty/not-applicable fields, not hyphen

## Fun facts
At the end of every message, include a random fun fact about Serbia. Keep it to 2 lines max. Make it interesting and varied — history, culture, food, sports, geography, science, etc. Never repeat the same fact in a conversation.
