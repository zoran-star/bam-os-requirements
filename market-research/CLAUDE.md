# Market Research Survey

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


## What it collects
Academy owner data: business size, current tools, pain points, willingness to pay, and reactions to the FullControl prototype (embedded in the survey so owners can see what they're reacting to).

## Connects to
- Supabase — response storage (see src/supabase.js for connection details)
- prototype/ — prototype is embedded in the survey flow
- business/ — survey findings feed into market data explainer and investor materials

## Status
Survey has been scrapped. It is going to be re-worked once we have active users.
