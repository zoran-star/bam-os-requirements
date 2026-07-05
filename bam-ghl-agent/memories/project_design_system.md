# V2 Design System (living)

**2026-07-05 - v1.1.** (v1.1 = emoji rule tightened: NO emojis at all in product UI/copy; SVG icons only.) Canonical system extracted from the three "good skin" V2 pages (Home `renderHomeV2`, Assets, Calendar) in `bam-portal/public/client-portal.html`.

## Where it lives
- **Spec:** `bam-portal/design-system/DESIGN.md` (living doc - version + changelog at the bottom)
- **Tokens:** `bam-portal/design-system/tokens.css` (dark default + `html[data-theme="light"]`)
- **Enforcement:** `bam-ghl-agent/CLAUDE.md` § Design standards + `bam-portal/CLAUDE.md` top section both hard-point agents at DESIGN.md before any front-end work.
- `docs/client-portal-design.md` = superseded (banner added). `front-end/fullcontrol-brand.md` = marketing/editorial surfaces only (scope note added).

## Locked decisions (Cole via AskUserQuestion, 2026-07-05)
1. **Gold = token gold** `#D4B65C` dark / `#C8A84E` light. Old brand gold `#E8C547` is DEAD - was hardcoded in ~250 spots (tints/hovers/venue colors), all replaced portal-wide with `rgba(212,182,92,…)` / `#D4B65C`. Cosmetic all-tier change (V1 sees same chrome), no behavior change.
2. **Fonts = Home/prototype stack:** Plus Jakarta Sans (`--font-ui`) + Nunito big numbers (`--font-num`) + DM Mono technical. Applied to Assets + Calendar `.content` (+ `#cal-drawer`, `.cal-day-num`); topbar titles stay Archivo for now.
3. **Corners = rounded, LOCKED scale** 6/8/12/16/24/999 (`--r-xs/sm/md/lg/xl/full`). Normalized all odd radii (4,7,9,10,13,14,20) on the 3 pages. Buttons/inputs=8, small cards/toolbars=12, cards=16, modals=24.
4. **Detail views = right-side drawer only.** Calendar booking popup (bottom sheet) rewritten to use the `#cal-drawer` pattern (`bkOpenEvent` now populates cal-drawer; 👤 emoji avatar → initial letter). `bk-event-overlay` no longer exists.

## Also normalized (3 pages)
- New `:root` tokens in client-portal.html: `--font-ui`, `--font-num`, `--on-gold:#16140F` (text on gold fills, both themes).
- Off-token hues → tokens: `#7BC47F`→`--green`, `#e0654f` pill / `#e07070` bk-err→`--red`, `#4CAF50`→`--green` hue. NOTE: `#e0654f` still used 60+ times in OTHER views - out of scope, fix per-view later.
- Assets secondary buttons unified (transparent bg, `--border-med`, r-8, w-600); dropzone scrim `rgba(11,11,13,.85)`→`rgba(0,0,0,.85)`.

## Iteration protocol (the point of the system)
Change tokens.css + DESIGN.md FIRST (bump version/changelog) → mirror `client-portal.html` `:root` in the same commit → the 3 reference pages must always be 100% on-system → commit prefix `design-system:` → big-picture changes (gold/fonts/corner personality) need Zoran/Cole sign-off.

## Known debt (in DESIGN.md §9)
Other views still on legacy radii/hardcodes (disperse per-view); Home KPI catalog + Hawkeye feed + inbox bell emoji icons (now rule violations, swap to SVG next Home pass); Assets alert()/prompt() feedback; staff portal `src/tokens/tokens.js` separate palette (open decision).

## Gotchas
- client-portal.html `:root` and tokens.css MUST stay mirrored - drift breaks the system.
- The tour verifier (`node bam-portal/scripts/verify-client-portal-ui.mjs`) must pass after any client-portal.html edit - passed on this pass.
- Don't reintroduce `#E8C547` / `rgba(232,197,71,…)` - grep before merge.
