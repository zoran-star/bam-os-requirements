# FullControl Prototype

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


## Structure
- src/pages/ — page-level components (Home, Sales, Members, Marketing, Content, Schedule, Settings, member-app/)
- src/components/ — shared components (Layout, Sidebar, GlobalInbox, PageBanner, SageBar, StatPill)
- src/styles/ — CSS modules per component/page
- src/hooks/ — custom React hooks (useBannerCanvas, useCountUp, useTypewriter)
- src/context/ — LocationContext (multi-location support)
- sessions/ — HTML review session files from whiteboard planning sessions

## Key rules
- Prototype and Notion must stay in sync. If you change the prototype, update Notion. If Notion changes, check if the prototype needs updating.
- Don't add features beyond what's been agreed in whiteboard sessions or confirmed by a human.
- Use CSS modules — no inline styles, no Tailwind.
- Brand guide: [`front-end/fullcontrol-brand.md`](../front-end/fullcontrol-brand.md) — colors, typography, spacing, component patterns. All new UI must follow it.
- All new pages go in src/pages/, all shared UI in src/components/.

## Connects to
- Notion — business requirements live there; prototype is the living implementation
- whiteboard/ — planning sessions drive what gets built here
- bam-gta-phase1/ — the GTA apps are location-specific implementations of this prototype
