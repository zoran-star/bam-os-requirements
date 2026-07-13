# Agent Team Rules

How to build effective Claude Code agent teams for Full Control / the BAM portal.
Read this before spawning a team. Teammates inherit it automatically (it's in the repo).

Agent teams = one lead + 2-5 teammates, each with its own context window, sharing a
task list and messaging each other directly. Use them for complex, multi-area work
that runs in parallel. For sequential or single-file work, use subagents instead.

---

## The mental model (the big 3)

```
1. TERRITORY  -> each agent owns its own files
2. DIRECT MSG -> agents talk to each other, not just through the lead
3. PARALLEL   -> they work at the SAME time and react to each other
```

If your task doesn't need all 3, you probably want subagents, not a team.

**Meta-rule:** Design the team like you'd staff a real project. Right specialists,
clear ownership, no two people on the same doc, everyone knows who to hand off to.
If a human team structured that way would work, the agent team will too.

---

## File & work ownership

| Rule | Why |
|---|---|
| One agent = one territory | Two agents editing the same file overwrite each other. Split by folder/layer. |
| Every agent has real work | An idle agent = wasted money. If you can't name its deliverable, it shouldn't exist. |
| Size the task "just right" | Too small = coordination costs more than the work. Too big = it runs 20 min then goes wrong. Aim for a clear unit (one function, one screen, one report). |
| The QA/reviewer owns nothing it built | The checker must be independent, or it rubber-stamps its own work. |

## Context & communication

| Rule | Why |
|---|---|
| Full context in the spawn prompt | Teammates get ZERO conversation history. They read files + your prompt, nothing else. |
| Name the handoffs explicitly | "When done, message the Frontend agent" - don't assume they figure out who to talk to. |
| Give the goal, not just the task | An agent that knows why makes better calls than one following blind steps. |
| Define the exact deliverable | "A working endpoint at /x returning JSON shape {...}" beats "build the backend." |

## Team size & cost

| Rule | Why |
|---|---|
| 2-5 agents. Never 10+ swarms | Each is a full session = Nx tokens. 3 focused > 5 scattered. |
| ~5-6 tasks per agent | Keeps everyone busy without thrashing. 15 tasks -> 3 agents, not 8. |
| Prefer subagents when they don't need to talk | If it's sequential 1->2->3, or agents never message each other, a team is overkill. |

## Control & safety

| Rule | Why |
|---|---|
| Pre-approve tools | Otherwise agents freeze every 10 sec asking permission. Set an allowlist in `.claude/settings.local.json`. |
| Use plan-approval mode for risky work | Agents plan first, the lead approves before they touch anything. |
| Save to temp/doc files as they go | If an agent loses work or gets shut down early, the file survives. |
| Watch early, kill early | If an agent heads down the wrong path in the first 2 min, stop it. Don't let it run 15. |
| Let them shut down cleanly | Shutdown = "save your work" handshake, not a force-kill. An agent can say "not done, wait." |

---

## Setup checklist (one-time)

1. Enable the flag in `.claude/settings.local.json`:
   ```json
   {
     "env": { "CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS": "1" },
     "permissions": {
       "allow": ["Bash(npm run build)", "Bash(npm run lint)", "Bash(git*)", "Edit", "Write"]
     }
   }
   ```
2. Restart Claude Code (the flag is read at startup).
3. Optional: run in a terminal with tmux for split-pane view of every agent.

## Full-stack feature template (file ownership)

```
DB agent        -> Supabase migration + RLS
Edge-fn agent   -> supabase/functions/<feature>/
Staff-UI agent  -> bam-portal/src/... (staff pages)
Parent-UI agent -> parent app files (only if the feature touches it)
QA agent        -> reads everything, writes a pass/fail report only
```

If two agents would touch the same file, give one an isolated worktree (`scripts/wt`).

---

## Repo-specific notes

- Every teammate reads `CLAUDE.md` automatically, so the no-em-dash rule, brand rules,
  and project router are inherited. You don't need to repeat them in the spawn prompt.
- Skills and MCP servers load from project/user settings, same as a normal session.
- Teammates inherit the lead's permission mode. If the lead is on bypass, so are they.
- Agent teams are experimental. Start with research/review (cheap, low risk) before
  parallel writes.
