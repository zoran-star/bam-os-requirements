# BAM OS Requirements

## Collaborators
This repo is a collaborative project between **Zoran** and **Cole**. Both contributors use Claude Code to work on the requirements. Changes made by either collaborator should be committed and pushed promptly so the other person always has the latest state.

- **Zoran** has access to: Git, Notion MCP, GoHighLevel MCP
- **Cole** has access to: Git, Notion MCP

When working on requirements, be aware that the other collaborator may have made recent changes — always pull before editing.

## Session startup checklist
At the very start of every conversation, before doing any work:

1. **Confirm connections** — verify you have access to GitHub (this repo), Notion MCP, and GoHighLevel MCP (Zoran) or Notion MCP (Cole). Tell the user which connections are live and flag any that are missing or broken.
2. **Pull latest** — run `git pull` to get the latest changes from the other collaborator.
3. **Read Working Memory** — fetch the [Working Memory page](https://www.notion.so/31b5aca8ac0f81b59fd9e8b84aecffc9) in Notion. Read it fully. Then tell the user you've read it and briefly summarize the current state: what the CRLF is, what's on the horizon, and any recent decisions that may be relevant to the session.

**Example startup message:**
> Connected: GitHub, Notion, GHL. Pulled latest. Read Working Memory — current CRLF is [X], on the horizon: [Y]. Ready to go.

If any connection fails or the Working Memory page can't be fetched, flag it immediately so the user knows context may be incomplete.

## After you finish
Always commit and push changes after making edits. Use descriptive commit messages that reference the job IDs affected (e.g. "Add MEM-010 referral tracking requirement"). This ensures the other collaborator gets changes immediately.

## Change log
When committing, include a summary of what changed in the commit message body — which jobs were added, updated, or removed, and why. This serves as the change log for the project.

## What this repo is
This repository holds the interactive business requirements flow diagram for BAM OS (`bam_os_business_requirements_flow.html`). It is a single self-contained HTML file with embedded JavaScript data representing all business requirements across 7 domains.

## Repo structure

```
bam-os-requirements/
├── app/                ← FullControl prototype (Vite/React)
│                         Auto-deploys to: https://fullcontrol-prototype.vercel.app
├── survey/             ← User survey (Vite/React)
│                         Auto-deploys to: https://full-control-survey.vercel.app
├── docs/
│   ├── fc-company/     ← Investor page
│   └── fc-landing/     ← Product landing page (reference)
├── prompts/            ← Prompt templates
├── bam_os_business_requirements_flow.html
└── CLAUDE.md
```

### Key files
- `bam_os_business_requirements_flow.html` — interactive flowchart with all requirements data
- `docs/fc-company/index.html` — investor-facing page (active)
- `docs/fc-landing/index.html` — product landing page (reference, not active)

## Deployments

Both apps auto-deploy on every push to `main` via Vercel Git integration:

| App | Directory | Live URL |
|-----|-----------|----------|
| Prototype | `app/` | https://fullcontrol-prototype.vercel.app |
| Survey | `survey/` | https://full-control-survey.vercel.app |

**Do NOT manually deploy via CLI.** Just push to `main` and Vercel handles it.

## Desktop prototype app
The interactive desktop prototype is a Vite/React app located at:

```
app/src/
```

**This is where all UI/prototype edits should be made.** The app structure:
- `src/pages/` — page-level components (Home, Sales, Members, Marketing, Settings, member-app/)
- `src/components/` — shared components (Layout, Sidebar, GlobalInbox, PageBanner, StatPill)
- `src/styles/` — CSS modules per component/page
- `src/hooks/` — custom React hooks

**If the prototype app location ever changes**, update this section immediately to reflect the new path so all collaborators always know where to find it.

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
   - [AI Advisor](https://www.notion.so/3245aca8ac0f81978b4ef0972967611c)

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

## Keeping Working Memory up to date
The [Working Memory page](https://www.notion.so/31b5aca8ac0f81b59fd9e8b84aecffc9) in Notion has a Detail Pages table linking to all key Notion pages. **If a detail page is added, removed, or renamed, update the Detail Pages table in Working Memory immediately.**

## Open Loops
The [Open Loops database](https://www.notion.so/1eb460ed0646424d8ca7a4c33ceca9fc) in Notion tracks unresolved decisions, blockers, and action items across the project. It has statuses: CRLF (the single critical blocker), Open, and Closed.

**Proactively add to Open Loops when you notice:**
- An unresolved decision that needs human input
- A missing requirement or gap in coverage (like we did with admin-side scheduling)
- A blocker or dependency that can't be resolved in the current session
- A sync issue between HTML and Notion
- Anything the user says they need to do manually later
- Technical debt or known limitations flagged during work

When adding a loop, set Status to "Open" and choose an appropriate Priority (High/Medium/Low). Only Zoran designates CRLF — never assign it yourself.

## Conventions
- Job IDs follow the pattern: `{PREFIX}-{NUMBER}` for parent jobs, `{PREFIX}-{NUMBER}{letter}` for sub-jobs
- Release values: `MVP`, `V1`, `V2`, `V3`
- All jobs default to `Not Started` status
- Use em dash (—) for empty/not-applicable fields, not hyphen

## Notion as knowledge base
Always be on the lookout for opportunities to save useful information, decisions, research, or context to Notion. If something comes up in conversation that seems worth preserving (new insights, configuration details, business info, strategy decisions, etc.), ask the user if they'd like it saved to Notion before moving on.

## Fun facts
At the end of every message, include a random fun fact about Serbia. Keep it to 2 lines max. Make it interesting and varied — history, culture, food, sports, geography, science, etc. Never repeat the same fact in a conversation.
