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
├── prototype/                        ← FullControl prototype (Vite/React)
│   │                             Auto-deploys to: https://fullcontrol-prototype-six.vercel.app
│   └── bam-gta-phase1/           ← Phase 1 live deployment (BAM GTA)
│       ├── bam-gta-staff/        ← Staff dashboard app
│       ├── bam-gta-parent/       ← Parent/athlete app
│       └── info/                 ← GHL workflows + overview docs
├── market-research/            ← Market research survey sent to academies (Vite/React)
│                                 Auto-deploys to: https://full-control-survey.vercel.app
├── business/                   ← All business planning materials
│   ├── business/               ← Investor deck, pitch docs, planning files
│   ├── fc-company/             ← Investor page
│   ├── fc-landing/             ← Product landing page (reference)
│   └── survey-data-map.html    ← Interactive survey data visualization
├── whiteboard/                 ← Planning tool (Vite/React) — sessions live in each project folder
│                                 Needs Vercel project setup (see Whiteboard section)
├── sales-conversation-agents/  ← Sales conversation AI system prompts
├── bam-ghl-agent/              ← Autonomous GHL agent for client builds and support tickets
│   ├── client-portal.html      ← Client-facing support portal (10 tiles)
│   ├── bam-portal/             ← React/Vite staff portal app (live on Vercel)
│   ├── bam-gta-staff/          ← BAM GTA staff dashboard (React/Vite)
│   ├── docs/                   ← Schema, brand, and copy convention references
│   └── sections/               ← HTML section templates
└── CLAUDE.md
```

### Key files
- `prototype/src/` — the prototype (reference implementation of all features)
- `business/fc-company/index.html` — investor-facing page (active)
- `business/fc-landing/index.html` — product landing page (reference, not active)
- `sales-conversation-agents/conversation-ai-booking-agent.txt` — AI booking agent system prompt template
- `sales-conversation-agents/conversation-ai-booking-agent-bam-gta.txt` — BAM GTA-specific instance

## Deployments

Both apps auto-deploy on every push to `main` via Vercel Git integration:

| App | Directory | Live URL |
|-----|-----------|----------|
| Prototype | `prototype/` | https://fullcontrol-prototype-six.vercel.app |
| Market Research Survey | `market-research/` | https://full-control-survey.vercel.app |

**Do NOT manually deploy via CLI.** Just push to `main` and Vercel handles it.

## Whiteboard — Planning Tool

The whiteboard is a standalone planning tool (Vite/React) at `whiteboard/`. It's used to run structured review sessions for any project. The tool itself lives in `whiteboard/` — but the session output files (HTML review pages) live inside each project's own folder, not in `whiteboard/`. For example, FullControl product sessions live in `prototype/sessions/`.

### How it works — the full 6-step cycle

**Step 1: Visit the whiteboard**
Go to https://whiteboard-beta-indol.vercel.app. Sessions are organized in three columns: Not Ready (still being scoped), Ready (ready for review), Complete (reviewed and processed). Each card shows title, description, owner (Zoran/Cole), dates, and session type.

**Step 2: Review a session**
Click a session card. You'll see a user guide at the top explaining the controls. Items are split into two groups:
- **Decided items** — previously approved/rejected/given feedback. Collapsed in a green bar. Expand to see past decisions.
- **Pending items** — need your review. Each has three controls: approve (✓), reject (✕), or type feedback in the text field on the right.

**Step 3: Make your decisions**
For each pending item: approve if you agree as-is, reject if you don't want it, or type feedback to modify/redirect it. You can do a mix — approve some, reject some, give feedback on others.

**Step 4: Export**
Click "Export for AI" in the top right. This copies a markdown summary of all your decisions to the clipboard — what you approved, rejected, and your feedback text for each item.

**Step 5: Paste into Claude Code**
Open Claude Code in the `bam-os-requirements` repo. Paste the export. Claude will:
1. Parse and summarize your decisions
2. Walk through each feedback item with you — discuss, clarify, agree on actions
3. Present a 5-category confirmation checklist (sessions, onboarding data, Notion, prototype, other)
4. Wait for your confirmation before executing anything
5. Execute the confirmed actions
6. Mark the session complete and suggest next steps

See "Processing whiteboard session exports" below for the detailed instructions Claude follows.

**Step 6: Verify**
After Claude executes, check that: Notion pages were updated, prototype changes deployed, new sessions appeared on the whiteboard, onboarding data points were added. Claude should confirm each action, but always spot-check.

### Notion databases
- **Sessions DB:** `4e5492be5027427cbbc8994bcd73905c` — stores all session cards. Each session has: Title, Session ID, Status (To Do/In Progress/Complete), Description, Assigned To (Zoran/Cole), Section Number, Session Type (Onboarding Review/Follow-up/Ad Hoc), Completed Date, and **SECTION Data** (a rich_text field containing JSON with all the items, their statuses, and feedback). The SECTION Data is what the whiteboard app renders.
- **Backlog DB:** `39c1f40a005c4c9ba50b0c7fe47b45bd` — proposed changes not yet implemented. Used for prototype changes that come out of session reviews but aren't built immediately.
- **Onboarding Data Points DB:** `49be4ce65ada4d45b736070e11452edb` — canonical list of all data collected or configured during academy owner onboarding. Each entry has: Field Name, Description, Category, Collection Phase (Onboarding/First Week/Settings), Input Type, Required, Source, Placeholder Variable, BAM GTA Example, Blocks (what breaks without it), FC Modules (which modules use it). See "What counts as onboarding data" below for what belongs here.

### Processing whiteboard session exports

When a user pastes a session export from the whiteboard (starts with `---\nsession: SES-XXX-slug`), this is a **blocking trigger** — process it immediately using the 6-step process below.

**At the end of EVERY message during this process, display a progress tracker like this:**

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📍 SESSION PROCESSING — SES-XXX-title
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Step 1: Parse & Summarize    ✅
Step 2: Discuss Feedback      ✅ 
Step 3: Confirm Actions       ⬅️ YOU ARE HERE
Step 4: Execute               ⬜
Step 5: Mark Complete         ⬜
Step 6: Next Steps            ⬜
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
👉 TO MOVE FORWARD: [specific action needed from user]
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

Always show completed steps with ✅, current step with ⬅️ YOU ARE HERE, and remaining steps with ⬜. The "TO MOVE FORWARD" line tells the user exactly what they need to do next.

---

**Step 1: Parse and summarize**
- Parse the YAML frontmatter to get the session ID and title
- Count items by status: approved, feedback, rejected, pending/skipped
- Present a brief summary: "SES-020: 15 approved, 8 with feedback, 5 rejected, 2 skipped"

**How to read the export format:**
- `[x]` + "APPROVED" = user approved as-is
- `[x]` + "FEEDBACK: ..." = user approved with modifications
- `[✕]` + "REJECTED" = user explicitly rejected — this item will NOT be included
- `[ ]` with no status = user didn't review (pending) — ask about these
- Items with feedback but no `[x]` = user gave feedback but didn't approve — treat as feedback items to discuss
- Subsection notes appear as `> **Section notes:** ...`

**Rejected items are final.** Do not re-propose them, include them in Notion updates, or create follow-up work for them. They're out.

- TO MOVE FORWARD: Automatic — proceed to Step 2 immediately.

**Step 2: Walk through feedback items with the user**
- For each item with feedback, show the item title and the user's feedback
- Discuss what the feedback means — ask clarifying questions if needed
- Agree on the concrete action: update a requirement, create a new session, modify the prototype, or no action
- Ask about pending/skipped items — are they rejected or just unreviewed?
- This is a conversation — don't just process silently. The user wants to talk through their decisions.
- TO MOVE FORWARD: User confirms all feedback items are discussed and all open questions are answered.

**Step 3: Confirm before executing**
After discussing all feedback items, present a confirmation checklist with ALL 5 categories below. Do not skip any category — if nothing applies, explicitly say "Nothing here."

1. **Sessions to create** — List every new session to be created from feedback. Include title and what it covers.
2. **Onboarding Data** — What data points need to be added to the Onboarding Data Points DB? This includes not just owner-typed fields (Business Name, Selling Points) but also **configuration settings that power automated workflows** — timers, thresholds, channel preferences, cadence settings, defaults. Ask yourself: "Are there any settings, defaults, thresholds, or config values that need to be set during onboarding for this feature to work?" If nothing, say "Nothing to add here."
3. **Notion updates** — What changes to Business Requirements pages, Working Memory, or other Notion pages? Be specific: which page, which job IDs added/changed. Remember: if the prototype was updated, nudge about updating Notion too (and vice versa).
4. **Prototype updates** — What changes to the prototype (prototype/src/)? Which page/component, what's being added/changed. If nothing, say "Nothing to change here." Remember: if Notion was updated, nudge about updating the prototype too (and vice versa).
5. **Other actions** — Git commits, deployments, backlog items, marking session complete, etc.

**Wait for the user to confirm before executing anything.** Do not start updating Notion, writing code, or creating sessions until the user says go. They may want to adjust, add, or remove actions from the list.
- TO MOVE FORWARD: User confirms the checklist ("go ahead", "confirmed", "execute", etc.)

**Step 4: Execute confirmed actions**
Only after user confirmation, execute the agreed actions. Categories:

- **Update Notion Business Requirements** — Add or modify job IDs on the relevant domain page (Marketing, Sales, Member Management, etc.). For large pages that timeout via MCP, use the Node script approach: `whiteboard/push-requirements.mjs` pattern with `@notionhq/client` and the token from `whiteboard/.env.production`.
- **Update Onboarding Data Points DB** (`49be4ce65ada4d45b736070e11452edb`) — For approved data collection items, ensure they exist in the Data Points DB with correct Category, Collection Phase, Input Type, etc.
- **Create Backlog items** (`39c1f40a005c4c9ba50b0c7fe47b45bd`) — For prototype changes, create a Backlog entry with Status: Proposed and a description of what to build.
- **Update the prototype** (`prototype/src/`) — If the user wants to build something now, make the changes to the Vite/React prototype.
- **Create follow-up sessions** — If new topics surfaced during discussion, create new session cards in the Sessions DB (`4e5492be5027427cbbc8994bcd73905c`) with Status: "To Do", Type: "Follow-up", and populated SECTION Data. Use the Node script approach for writing SECTION Data (JSON chunked into 1900-char rich_text segments).
- **Update Working Memory** — If significant decisions were made, update the Working Memory page in Notion.
- TO MOVE FORWARD: Automatic — proceed to Step 5 after all actions complete.

**Step 5: Mark session complete**
- Update the session's Status to "Complete" in the Sessions DB
- Set Completed Date to today
- Update SECTION Data with final decisions (approved/rejected/feedback statuses and feedback text)
- Confirm with the user: "SES-020 marked complete. Here's what was done: [summary]"
- TO MOVE FORWARD: Automatic — proceed to Step 6.

**Step 6: Suggest next steps**
- Are there related sessions to create?
- Are there prototype updates to make based on the decisions?
- Are there Notion pages that need updating?
- Does the prototype and Notion still need to be synced on anything?
- Present these as options, don't just do them.
- TO MOVE FORWARD: User chooses what to work on next, or ends the session.

**Important rules:**
- Always separate **data points** (→ Onboarding Data Points DB) from **features** (→ Business Requirements pages)
- Never skip the conversation step (#2) — the user wants to discuss, not just have things auto-processed
- If Notion MCP times out on large pages, use the direct API via Node script (see `whiteboard/.env.production` for credentials)
- Commit and push changes after making edits so collaborators get them immediately
- The progress tracker MUST appear at the end of every message during session processing — no exceptions

### What counts as onboarding data

The Onboarding Data Points DB tracks everything an academy owner needs to provide or configure for FullControl to work. This is broader than it sounds. There are three types:

1. **Owner-typed business data** — Things the owner tells us about their business: Business Name, Selling Points, Coach Credentials, Mission Statement, etc. These are descriptive fields that describe who they are.

2. **Configuration settings** — Operational defaults that power automated workflows: the 15-minute post-trial escalation timer, notification channel preferences (SMS vs email), follow-up cadence (Day 0, Day 2), pause policy limits (30 days, 2x/year), dunning retry count. These feel like "feature config" but they ARE onboarding data because they need to be set before the system works, they have defaults that may need customizing, and features break or behave incorrectly without them.

3. **Integration credentials** — Stripe account, Meta CAPI connection, GHL sub-account. These are set once during onboarding and rarely changed.

**The test:** After every session, ask: "For the features we just discussed, what settings/defaults/thresholds need to exist for them to work? Would an academy owner need to set or confirm these during onboarding?" If yes → Onboarding Data Points DB.

### Environment variables (set in Vercel dashboard)
- `NOTION_TOKEN` — Notion integration API key
- `NOTION_SESSIONS_DB` — Sessions database ID
- `NOTION_BACKLOG_DB` — Backlog database ID

## Desktop prototype app
The interactive desktop prototype is a Vite/React app located at:

```
prototype/src/
```

**This is where all UI/prototype edits should be made.** The app structure:
- `src/pages/` — page-level components (Home, Sales, Members, Marketing, Settings, member-prototype/)
- `src/components/` — shared components (Layout, Sidebar, GlobalInbox, PageBanner, StatPill)
- `src/styles/` — CSS modules per component/page
- `src/hooks/` — custom React hooks

**If the prototype app location ever changes**, update this section immediately to reflect the new path so all collaborators always know where to find it.

## Sources of truth

There are two sources of truth — they serve different purposes and must stay in sync:

1. **Prototype** (`prototype/src/`) — the reference implementation showing what's been built. This is the living spec for UI, features, and interactions. When someone asks "what does the Sales page look like?" — the prototype is the answer. It deploys to https://fullcontrol-prototype-six.vercel.app on every push to `main`.
2. **Notion** — structured requirement tables under the [Business Requirements](https://www.notion.so/31b5aca8ac0f81dca970c023294b24de) parent page. When someone asks "what are the requirements for the Sales domain?" — Notion is the answer. Each domain page has a table of job IDs with full specs. Domains:
   - [Marketing](https://www.notion.so/31b5aca8ac0f81d3bffdc79932d118c9)
   - [Content](https://www.notion.so/31f5aca8ac0f81229933dab1be576bf1)
   - [Sales](https://www.notion.so/31b5aca8ac0f81638750d27bc0598d19)
   - [Member Management](https://www.notion.so/31b5aca8ac0f816c9b8ee4e4768270da)
   - [Scheduling App](https://www.notion.so/31c5aca8ac0f81bebc61e9e76deb6a02)
   - [Strategy](https://www.notion.so/31c5aca8ac0f81da85dcc72bf057e3d6)
   - [Profiles & Identity](https://www.notion.so/3245aca8ac0f819e8166d52f994a5f7a)
   - [AI Advisor](https://www.notion.so/3245aca8ac0f81978b4ef0972967611c)
   - [Settings & Configuration](https://www.notion.so/3315aca8ac0f81749b78f52144f369ba)

**These two must stay in sync. Never update one without updating the other.** When you add a feature to the prototype, add or update the corresponding Notion requirement. When you add a requirement to Notion, check if the prototype needs updating. After every session export processing, actively nudge the user: "The prototype was updated — should we also update the Notion requirements?" or "Notion was updated — does the prototype need to reflect this?" If the user only asks for one, remind them about the other. Drift between these two sources causes confusion and wasted work.

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
The [Open Loops database](https://www.notion.so/1eb460ed0646424d8ca7a4c33ceca9fc) in Notion tracks unresolved decisions, blockers, and action items across the project. Think of it as the project's "things we haven't figured out yet" list. It has statuses: CRLF (the single critical blocker — there's only ever one at a time), Open, and Closed.

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
Always be on the lookout for opportunities to save useful information, decisions, research, or context to Notion. If something comes up in conversation that seems worth preserving (new insights, configuration details, business info, strategy decisions, etc.), ask the user if they'd like it saved to Notion before moving on. Notion is where institutional knowledge lives — if it's not in Notion or the prototype, it doesn't exist for the next person.

## Sales Conversation Agents
The `sales-conversation-agents/` directory contains system prompts for AI sales agents:
- `conversation-ai-booking-agent.txt` — Template for the AI that books leads into free trials. Defines tone (casual, match lead energy), qualification logic, objection handling, follow-up cadence, and guardrails. Uses `{{PLACEHOLDER}}` variables populated from onboarding data.
- `conversation-ai-booking-agent-bam-gta.txt` — BAM GTA-specific instance with placeholders filled in.
- Future agents: Closing AI (post-trial conversion), Rebooking AI (no-show re-engagement). These are being designed via whiteboard sessions SES-025 and SES-026.

## Fun facts
At the end of every message, include a random fun fact about Serbia. Keep it to 2 lines max. Make it interesting and varied — history, culture, food, sports, geography, science, etc. Never repeat the same fact in a conversation.
