---
description: Session entry sequence — show recent activity, present project menu, route the user, and tell them what's next
---

Run the session entry sequence. Treat this as the user's "what's going on?" landing page.

## Step 1 — Pull latest + confirm connections

```bash
git pull
```

State which connections are live: GitHub (always), Notion MCP, GoHighLevel MCP. Flag any missing.

## Step 2 — Show recent activity

Show the last 5 commits with author + what changed:

```bash
git log --oneline -5 --format="%h  %an  %s  (%ar)"
```

Then list which folders were touched in those commits so the user sees what's been moving:

```bash
git log -5 --name-only --format="--- %h %s ---" | head -50
```

## Step 3 — Present project menu

Show this menu, pulling the **first non-header line of each project's `memories/MEMORY.md`** as the status hint (so the menu is data-driven, not stale-hardcoded):

```
Where do you want to work?

  1. prototype/                  — <status hint from prototype/memories/MEMORY.md>
  2. bam-ghl-agent/              — <status hint from bam-ghl-agent/memories/MEMORY.md>
  3. whiteboard/                 — planning tool
  4. business/                   — investor + planning materials
  5. market-research/            — survey (mostly maintenance mode)
  6. sales-conversation-agents/  — AI sales agent prompts
  7. (root)                      — Notion business requirements / cross-project work
  
  + new project — run /setup-project-memory <name>
```

If a folder has no notes yet, show "(no notes yet)" as the hint.

## Step 4 — Wait for the user to pick

Don't proceed until the user picks. They might say "1", "bam-ghl-agent", "the staff portal" — match it to a folder.

## Step 5 — Load that project's context

Once they pick:
1. Tell them to `cd` into that folder if they aren't already (so the subfolder's CLAUDE.md auto-loads on their next message — this matters for context window efficiency)
2. Read that folder's `memories/MEMORY.md` and the most relevant 1-2 notes from it
3. Read the folder's `CLAUDE.md` if you don't already have it loaded

## Step 6 — Tell them what's next

Based on what you just read, present:

```
=== <project> ===
Last decision: <pulled from notes — recent decision or status>
Active threads: <2-3 bullet list from notes / "Next steps" sections>
Blocked on: <any "waiting on X" items from notes>

What do you want to do?
  - Pick up where we left off: <suggest concrete next step>
  - Something else (tell me what)
```

Don't fabricate — if the notes don't say what's next, just say "no current next-step is documented; what are you working on?"

## Step 7 — Begin work

Once they answer, drop the menu and just work.
