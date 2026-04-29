# Front-End

## Project memory
Notes live in [`memories/`](memories/). Scan [`memories/MEMORY.md`](memories/MEMORY.md) first, then open the specific note. See [`memories/README.md`](memories/README.md) for conventions.

## Memory upkeep
Before every commit, run through:
- Decision worth keeping? → save to `memories/` and add a line to `MEMORY.md`
- File moved, created, or renamed? → update CLAUDE.md paths
- A memory note stale or wrong? → update or delete it
- Is `MEMORY.md` in sync with the files in the folder?

Run `/memory-audit` periodically.

---

## What this folder is
Canonical home for all shared front-end resources used across projects in this repo. Any new component, screen, or page in the BAM OS / client portal must reference this folder for brand and design decisions.

## Brand guide
The single source of truth for the Full Control design language:
- **[`fullcontrol-brand.md`](fullcontrol-brand.md)** — colors, typography, spacing, component patterns, tone

All other projects in this repo (prototype/, bam-ghl-agent/, business/, etc.) should reference this file. Do not maintain separate copies elsewhere — the stubs in `prototype/docs/style-guide.md` and `bam-ghl-agent/docs/fullcontrol-brand.md` redirect here.

## Conventions
- If the brand guide changes, update `fullcontrol-brand.md` here — not in any other project folder
- When adding new shared front-end resources (tokens, component specs, icon sets), drop them in this folder and add a memory note
