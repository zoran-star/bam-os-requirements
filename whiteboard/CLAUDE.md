# Requirements Whiteboard

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


## Key rule
The whiteboard tool lives here. Session output files (HTML review pages) live in each project's own folder — not in whiteboard/. Example: FullControl product sessions → prototype/sessions/

## Notion databases
- Sessions DB: 4e5492be5027427cbbc8994bcd73905c
- Backlog DB: 39c1f40a005c4c9ba50b0c7fe47b45bd
- Onboarding Data Points DB: 49be4ce65ada4d45b736070e11452edb

## API routes
- api/sessions.js — read/write session cards to/from Notion
- api/backlog.js — write proposed changes to Backlog DB

## Session export flow
User clicks "Export for AI" → copies markdown → paste into Claude Code → Claude runs the 6-step processing flow (parse, discuss, confirm, execute, mark complete, next steps). See root CLAUDE.md for the full protocol.

## Credentials
.env.production contains NOTION_TOKEN — gitignored, never commit. Ask Zoran if you need it.
