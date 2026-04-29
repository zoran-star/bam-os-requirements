# Business Planning Materials

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


## What it's for
Investor conversations, acquisition prep, business planning, partnership discussions.

## Exit strategy
- To be determined

## Key files
- business/fullcontrol-investor-playbook.html — main investor deck
- business/summary.html — one-page pitch
- business/plan.html — full business plan
- business/gap-analysis.html — feature gap analysis vs competitors
- business/market-data-explainer.html — market size data and sources
- business/problem-dissector.html + problem-review.html — problem validation
- fc-landing/ — product landing page (reference design, not active)
- repo-map.html — dark-theme visual repo overview

## Brand guide
Any HTML pages built here (investor deck, landing, etc.) should follow the Full Control design system at [`front-end/fullcontrol-brand.md`](../front-end/fullcontrol-brand.md).

## Key rule
These docs are for external conversations. Keep them polished and up to date. If key metrics change (ARR, user counts, timeline), update the investor playbook immediately. Always confirm with the human when uploading these materials to the cloud.
