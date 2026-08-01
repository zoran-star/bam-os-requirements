# BAM OS Requirements

FullControl product prototype, the BAM staff/client portals, academy onboarding, and supporting docs. Shared repo: Zoran and Cole. **Pull before editing, commit and push after.**

## How to talk to Zoran

ADHD, visual learner, hates reading. **Short + visual.** Tables, bullets, bold the key info, one clear next action per message. Never a wall of prose. If detail is needed, link to it instead of pasting it.

## ⛔ Never use an em dash in person-facing output

Not in emails, SMS, UI copy, labels, client sites, portals, or agent replies. Every repo, no exceptions. Use a hyphen, comma, or colon. (Only exception: an em dash as the "empty" value inside a Notion table cell.)

## Project router: which folder for which work

Each folder has its own CLAUDE.md + memories/ that load when you `cd` in. **If Zoran is in the wrong folder for the task, say so.**

| Work | Folder |
|---|---|
| Staff portal, client portal, GHL agent, onboarding flows | `bam-ghl-agent/` |
| FullControl prototype (UI/features reference) | `prototype/` |
| BAM GTA staff + parent apps | `prototype/bam-gta-phase1/` |
| Investor pages, decks, business planning | `business/` |
| AI sales agent prompt (the "brain") | `bam-ghl-agent/bam-portal/api/agent/prompt-structure.js` (behavior) + `fact-render.js` (per-academy facts). `sales-conversation-agents/` is design notes only |
| Brand guide, shared front-end resources | `front-end/` |
| Market research survey | `market-research/` |
| Investor demo of the portal (zero-backend build) | `fc-demo/` |
| Notion business requirements | repo root |
| New top-level folder | repo root, run `/setup-project-memory <folder>` |

## ⚠️ Multiple sessions at once: use a worktree

Two sessions in the same folder share one HEAD, so one `git checkout` silently clobbers the other's uncommitted edits. If another session might be running:

```bash
scripts/wt <session-name>
```

Work in `~/bam-os-worktrees/<session-name>`, then commit/push/PR as normal. Keep the canonical checkout on `main` and don't edit in it. Clean up with `git worktree remove`.

## Design systems

Exactly two are canonical. Never call anything else "the design system":

- **V2, the live product** (BAM GTA runs on this): `bam-ghl-agent/bam-portal/design-system/tokens.css` + `DESIGN.md`. Read `DESIGN.md` before any portal UI work.
- **Prototype, reference only**: `prototype/src/styles/theme.css`.

Every other `theme.css` in the repo is a copy. Details: [`memories/project_design_systems_map.md`](memories/project_design_systems_map.md).

## Memory

Notes live in [`memories/`](memories/). Scan [`MEMORY.md`](memories/MEMORY.md) first, then open what's relevant.

**Update memory the moment something changes**, not at commit time: schema changes, new wiring, workflow changes, decisions, moved paths, gotchas. New note means a new line in `MEMORY.md`. Run `/memory-audit` periodically.

## Other

- Start a conversation with `/start` unless Zoran opens with a specific task.
- Commit messages: say what changed and why. That is the change log.
- End every message with a 2-line fun fact about Serbia. Never repeat one in a conversation.
