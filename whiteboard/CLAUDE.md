# Requirements Whiteboard

Standalone planning tool for running structured review sessions across any FullControl project. Uses Notion as its backend. Auto-deploys to whiteboard-beta-indol.vercel.app.

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
