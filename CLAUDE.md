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
This repository holds the FullControl product prototype, survey, onboarding flows, and supporting docs. Business requirements are documented in Notion (see Sources of truth below).

## Repo structure

```
bam-os-requirements/
├── app/                ← FullControl prototype (Vite/React)
│                         Auto-deploys to: https://fullcontrol-prototype.vercel.app
├── survey/             ← User survey (Vite/React)
│                         Auto-deploys to: https://full-control-survey.vercel.app
├── docs/
│   ├── fc-company/     ← Investor page
│   ├── fc-landing/     ← Product landing page (reference)
│   └── survey-data-map.html ← Interactive survey data visualization
├── whiteboard/         ← Onboarding session whiteboard (Vite/React)
│                         Needs Vercel project setup (see Whiteboard section)
├── prompts/            ← AI conversation prompt templates
├── onboarding-*.html   ← Interactive onboarding review pages (10 files)
├── ghl-workflows-for-danny.html ← GHL workflow documentation
├── fullcontrol-investor-playbook.html
└── CLAUDE.md
```

### Key files
- `app/src/` — the prototype (reference implementation of all features)
- `docs/fc-company/index.html` — investor-facing page (active)
- `docs/fc-landing/index.html` — product landing page (reference, not active)
- `prompts/conversation-ai-booking-agent.txt` — AI booking agent system prompt template
- `prompts/conversation-ai-booking-agent-bam-gta.txt` — BAM GTA-specific instance

## Deployments

Both apps auto-deploy on every push to `main` via Vercel Git integration:

| App | Directory | Live URL |
|-----|-----------|----------|
| Prototype | `app/` | https://fullcontrol-prototype.vercel.app |
| Survey | `survey/` | https://full-control-survey.vercel.app |

**Do NOT manually deploy via CLI.** Just push to `main` and Vercel handles it.

## Onboarding Whiteboard

The whiteboard app is a visual kanban board for managing onboarding review sessions. Located at `whiteboard/`.

### How it works
1. Team visits the whiteboard → sees session cards in Not Ready / Ready / Complete columns
2. Click a session card → opens a review doc showing all items with their status
3. Decided items (approved/feedback) are collapsed at the top — expand to see past decisions
4. Pending items are open for review — approve (✓) or type feedback for each
5. When done → click "Export for AI" → copies markdown with session ID to clipboard
6. Paste into Claude Code → Claude walks through the feedback with you, agrees on actions, then executes (see "Processing whiteboard session exports" below)

### Notion databases
- **Sessions DB:** `4e5492be5027427cbbc8994bcd73905c` — stores all session cards + SECTION data
- **Backlog DB:** `39c1f40a005c4c9ba50b0c7fe47b45bd` — proposed changes not yet implemented
- **Onboarding Data Points DB:** `49be4ce65ada4d45b736070e11452edb` — canonical list of all data collected during onboarding

### Processing whiteboard session exports

When a user pastes a session export from the whiteboard (starts with `---\nsession: SES-XXX-slug`), this is a **blocking trigger** — process it immediately using the steps below.

**Step 1: Parse and summarize**
- Parse the YAML frontmatter to get the session ID and title
- Count items by status: approved, feedback, pending/skipped
- Present a brief summary to the user: "SES-020: 15 approved, 8 with feedback, 6 skipped"

**Step 2: Walk through feedback items with the user**
- For each item with feedback, show the item title and the user's feedback
- Discuss what the feedback means — ask clarifying questions if needed
- Agree on the concrete action: update a requirement, create a new session, modify the prototype, or no action
- This is a conversation — don't just process silently. The user wants to talk through their decisions.

**Step 3: Execute agreed actions**
Actions fall into these categories (do whichever apply):

- **Update Notion Business Requirements** — Add or modify job IDs on the relevant domain page (Marketing, Sales, Member Management, etc.). For large pages that timeout via MCP, use the Node script approach: `whiteboard/push-requirements.mjs` pattern with `@notionhq/client` and the token from `whiteboard/.env.production`.
- **Update Onboarding Data Points DB** (`49be4ce65ada4d45b736070e11452edb`) — For approved data collection items, ensure they exist in the Data Points DB with correct Category, Collection Phase, Input Type, etc.
- **Create Backlog items** (`39c1f40a005c4c9ba50b0c7fe47b45bd`) — For prototype changes, create a Backlog entry with Status: Proposed and a description of what to build.
- **Update the prototype** (`app/src/`) — If the user wants to build something now, make the changes to the Vite/React prototype.
- **Create follow-up sessions** — If new topics surfaced during discussion, create new session cards in the Sessions DB (`4e5492be5027427cbbc8994bcd73905c`) with Status: "To Do", Type: "Follow-up", and populated SECTION Data. Use the Node script approach for writing SECTION Data (JSON chunked into 1900-char rich_text segments).
- **Update Working Memory** — If significant decisions were made, update the Working Memory page in Notion.

**Step 4: Mark session complete**
- Update the session's Status to "Complete" in the Sessions DB
- Set Completed Date to today
- Confirm with the user: "SES-020 marked complete. Here's what was done: [summary]"

**Step 5: Suggest next steps**
- Are there related sessions to create?
- Are there prototype updates to make based on the decisions?
- Are there Notion pages that need updating?
- Present these as options, don't just do them.

**Important rules:**
- Always separate **data points** (→ Onboarding Data Points DB) from **features** (→ Business Requirements pages)
- Never skip the conversation step (#2) — the user wants to discuss, not just have things auto-processed
- If Notion MCP times out on large pages, use the direct API via Node script (see `whiteboard/.env.production` for credentials)
- Commit and push changes after making edits so collaborators get them immediately

### Environment variables (set in Vercel dashboard)
- `NOTION_TOKEN` — Notion integration API key
- `NOTION_SESSIONS_DB` — Sessions database ID
- `NOTION_BACKLOG_DB` — Backlog database ID

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

1. **Prototype** (`app/src/`) — the reference implementation showing what's been built. This is the living spec for UI, features, and interactions.
2. **Notion** — structured requirement tables under the [Business Requirements](https://www.notion.so/31b5aca8ac0f81dca970c023294b24de) parent page:
   - [Marketing](https://www.notion.so/31b5aca8ac0f81d3bffdc79932d118c9)
   - [Content](https://www.notion.so/31f5aca8ac0f81229933dab1be576bf1)
   - [Sales](https://www.notion.so/31b5aca8ac0f81638750d27bc0598d19)
   - [Member Management](https://www.notion.so/31b5aca8ac0f816c9b8ee4e4768270da)
   - [Scheduling App](https://www.notion.so/31c5aca8ac0f81bebc61e9e76deb6a02)
   - [Strategy](https://www.notion.so/31c5aca8ac0f81da85dcc72bf057e3d6)
   - [Profiles & Identity](https://www.notion.so/3245aca8ac0f819e8166d52f994a5f7a)
   - [AI Advisor](https://www.notion.so/3245aca8ac0f81978b4ef0972967611c)
   - [Settings & Configuration](https://www.notion.so/3315aca8ac0f81749b78f52144f369ba)

**When adding or updating requirements, update Notion.** The prototype serves as the visual reference for what's been built. Notion is the authoritative spec for requirement details, job IDs, release targets, and field-level documentation.

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
| Settings & Configuration | SET- | Onboarding completion rate |

## Schema differences across Notion pages
- **Marketing, Content, Strategy**: Full schema with Parent ID column
- **Sales**: Full schema but no Parent ID column; sub-job One-Liner fields may be blank
- **Member Management**: Full schema but no Parent ID column
- **Scheduling App**: Different schema — has Category column, omits Frequency/Data Inputs/Data Sources/One-Liner
- **Settings & Configuration**: To be created — follow Marketing schema as template

When adding new requirements, follow the Marketing domain schema as the template and adapt for each Notion page's column structure.

## How to add or update a requirement
1. Update the corresponding Notion page table with the requirement details
2. If adding a new parent job with sub-jobs, ensure sub-jobs are listed as separate rows
3. Commit and push any related prototype or documentation changes

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
- A gap between what the prototype shows and what Notion documents
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
