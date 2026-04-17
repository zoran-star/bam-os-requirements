# FullControl Prototype

The dream world front-end sandbox for FullControl OS. This is where every feature is designed, validated, and shown — before anything gets handed to a dev team. Auto-deploys to fullcontrol-prototype-six.vercel.app on every push to main.


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
- All new pages go in src/pages/, all shared UI in src/components/.

## Connects to
- Notion — business requirements live there; prototype is the living implementation
- whiteboard/ — planning sessions drive what gets built here
- bam-gta-phase1/ — the GTA apps are location-specific implementations of this prototype
