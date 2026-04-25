# Market Research Survey

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

Survey sent to basketball academy owners to collect market data and validate the FullControl concept. This is NOT the onboarding survey for new FullControl customers — it's a research instrument that has already been distributed. Mostly in reference/maintenance mode.

## What it collects
Academy owner data: business size, current tools, pain points, willingness to pay, and reactions to the FullControl prototype (embedded in the survey so owners can see what they're reacting to).

## Connects to
- Supabase — response storage (see src/supabase.js for connection details)
- prototype/ — prototype is embedded in the survey flow
- business/ — survey findings feed into market data explainer and investor materials

## Status
Survey has been scrapped. It is going to be re-worked once we have active users.
