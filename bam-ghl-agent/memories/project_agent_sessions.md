---
name: Agent Sessions — review Cam/Coleman/Mike/Rosano Claude Code transcripts
description: 2026-05-28. New system that captures team members' Claude Code sessions, generates dual technical+visual summaries via Claude, and shows them in Zoran's Systems → Review → Agent sessions panel.
metadata:
  type: project
---

# Agent Sessions

A system to let Zoran review what his team (Cam, Coleman, Mike, Rosano, anyone) is doing inside Claude Code sessions. Built 2026-05-28.

## The flow

```
┌──────────────────────────────────────────────────────────────────────┐
│                          TEAM MEMBER'S MACHINE                       │
│                                                                      │
│   Run /showtime           Do work...           Run /byebye           │
│        │                       │                    │                │
│        ▼                       ▼                    ▼                │
│  POST start →           (transcript            POST finish →         │
│  writes marker          accumulates in         packages transcript   │
│  to ~/.claude/          ~/.claude/             since marker, sends   │
│  showtime-active.json   projects/...)          to portal             │
└────────┬─────────────────────────────────────────────────┬───────────┘
         │                                                 │
         ▼                                                 ▼
┌──────────────────────────────────────────────────────────────────────┐
│                    portal.byanymeansbusiness.com                     │
│                                                                      │
│   /api/agent-sessions?action=start                                   │
│      → inserts row, returns id                                       │
│                                                                      │
│   /api/agent-sessions?action=finish                                  │
│      → stores transcript                                             │
│      → calls Claude (claude-sonnet-4-6) to generate                  │
│         {technical_summary, visual_summary}                          │
│      → marks status=completed                                        │
│                                                                      │
│   /api/agent-sessions (GET, zoran-only)                              │
│      → list                                                          │
│   /api/agent-sessions?id=<uuid> (GET, zoran-only)                    │
│      → single session with full transcript                           │
│   /api/agent-sessions?users=true (GET, zoran-only)                   │
│      → distinct user list for the tab strip                          │
└────────┬─────────────────────────────────────────────────────────────┘
         │
         ▼
┌──────────────────────────────────────────────────────────────────────┐
│   Staff portal → Systems → Review tab → "Agent sessions" sub-tab     │
│   (Only visible when me.email === zoran@byanymeansbball.com)         │
│                                                                      │
│   - User tabs: All / Cam / Coleman / Mike / Rosano (dynamic)         │
│   - List of sessions with one-line tech summary preview              │
│   - Click → modal: TECHNICAL (left) | VISUAL (right)                 │
│     + collapsible full raw transcript at bottom                      │
└──────────────────────────────────────────────────────────────────────┘
```

## Files

| File | Purpose |
|---|---|
| `bam-ghl-agent/bam-portal/api/agent-sessions.js` | Vercel function — start/finish/list/get |
| `bam-ghl-agent/bam-portal/src/views/AgentSessionsPanel.jsx` | The whole UI panel |
| `bam-ghl-agent/bam-portal/src/views/SystemsView.jsx` | Wires the panel into Review sub-tab (only if `me.email === ZORAN_EMAIL`) |
| `.claude/commands/showtime.md` | `/showtime` skill — marks session start |
| `.claude/commands/byebye.md` | `/byebye` skill — sends transcript + cleanup |
| `~/.claude/showtime-config.json` | LOCAL (not committed). Per-user. Has `{url, secret}`. |
| `~/.claude/showtime-active.json` | LOCAL marker between /showtime and /byebye. |

## Schema (`agent_sessions` table)

```
id                  uuid pk
user_email          text NOT NULL          ← who ran /showtime
user_display_name   text                   ← git user.name, for the UI tab
project_path        text                   ← pwd at /showtime time
session_id          text                   ← Claude Code session id (optional)
started_at          timestamptz            ← server time when /showtime hit
ended_at            timestamptz            ← server time when /byebye hit
message_count       int                    ← length of transcript array
transcript          jsonb                  ← full JSONL entries array
technical_summary   text                   ← Claude-generated, developer-level
visual_summary      text                   ← Claude-generated, ADHD-friendly
status              text                   ← 'in_progress' | 'completed' | 'failed'
```

RLS: only `zoran@byanymeansbball.com` can SELECT. Service role inserts/updates (the ingest endpoint uses service key + a shared bearer secret).

## Required env vars (set in Vercel)

- `SUPABASE_SERVICE_ROLE_KEY` — already set, used by other endpoints
- `ANTHROPIC_API_KEY` — already set, used by other endpoints
- **`AGENT_SESSION_INGEST_SECRET`** — NEW. Shared secret that /showtime and /byebye send as `Authorization: Bearer <secret>`. Generate with `openssl rand -hex 32`. Distribute to each team member who'll run the skills — they put it in `~/.claude/showtime-config.json` on their machine.

## How a team member sets up (one-time)

1. Get the ingest secret from Zoran.
2. Create `~/.claude/showtime-config.json`:
   ```json
   {
     "url": "https://portal.byanymeansbusiness.com/api/agent-sessions",
     "secret": "<paste secret here>"
   }
   ```
3. Make sure `jq` is installed: `brew install jq`.
4. Make sure `git config user.email` and `git config user.name` are set — the display name flows into the UI tabs.

Then `/showtime` to start, `/byebye` to stop. That's it.

## Gotchas

- **Marker requires same-machine usage.** /showtime writes to local disk; /byebye reads it. If you run /showtime on one machine and /byebye on another, it won't work.
- **Transcript file discovery** depends on Claude Code's path conventions — `~/.claude/projects/<cwd-with-slashes-as-dashes>/<session-uuid>.jsonl`. If Anthropic changes this, /byebye needs an update.
- **Summary generation is server-side and synchronous** on /finish — adds ~10-15s to the /byebye call. If Claude API is slow or down, transcript is still saved and `status=completed`, summaries just say "(error)".
- **Visibility is hardcoded** to `zoran@byanymeansbball.com` both in the API (`GET` returns 403 to anyone else) AND in the frontend (the sub-tab only renders for Zoran's email). Changing visibility requires both.

## When to update this note

- New columns added to `agent_sessions` → update the schema block
- API endpoint surface changes → update the flow diagram
- Skills behavior changes (different file paths, different config) → update the setup section
- Visibility rule changes → update the Gotchas section
