# V2 Design System (living)

**2026-07-05 - v1.3.** (v1.3 = copy rule: NO dash-as-pause in person-facing copy, not even a hyphen; restructure with period/comma/colon. Win card + command center + home empty-state copy swept.) (v1.1 = emoji rule tightened: NO emojis at all in product UI/copy, SVG icons only. v1.2 = emoji purge executed on Home + mobile More: `_HV2_ICONS` +9 icons, KPI catalog/Hawkeye feed/inbox bell/perfect-day star/preview-as glyphs all SVG now.) Canonical system extracted from the three "good skin" V2 pages (Home `renderHomeV2`, Assets, Calendar) in `bam-portal/public/client-portal.html`.

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
Other views still on legacy radii/hardcodes (disperse per-view); emoji icons in OTHER views (staff blueprint checkboxes, notif drawer, modal opts.icon, mreq icons - swap per-view); Assets alert()/prompt() feedback; staff portal `src/tokens/tokens.js` separate palette (open decision).

**2026-07-27 staff-portal Clients pass (Cole):** staff portal now actually LOADS the fonts (index.html: Plus Jakarta Sans + Nunito + DM Mono; the old `Inter` @import was replaced portal-wide - Login/SetPassword/PublicTicket too). ClientsCombinedView de-emojied (SVG stroke icons via local `_ico` helpers), radii moved to 8 controls / 12 cards / 16 modals, and it got module-level `showToast()`/`uiConfirm()` + `ToastHost`/`ConfirmHost` styled replacements for window.alert/confirm (pattern to reuse in other views); ActivationTab's window.prompt is now a real modal. Roster: clickable stat filters, URL-persisted q/cstatus/csort, brand-logo avatars (`ClientAvatar`), Last-seen column (presence RPC already returned last_seen_at), hover quick actions, skeleton rows (`.bp-skel` in index.css), hidden-in-setup hint. Other staff views still carry the old patterns - migrate per-view.

**2026-07-27 staff Inbox pass (Cole):** InboxView rebuilt - All/Unread toggle, avatars (`ClientAvatar` moved to `src/components/ClientAvatar.jsx`, shared) + presence dots, `?conv=` URL-persisted thread, owner-name search, sender-prefixed previews ("You:" / first name - needs migration `20260727150000_conversations_last_author_kind.sql`: `conversations.last_message_author_kind` + trigger update; API falls back gracefully until applied), richer thread header with "Open client →" (`goNav("clients", id)`), keyboard arrows+Enter, skeletons, live timestamps, "+ New message" client picker (every client has a guaranteed `general` conversation via DB trigger), narrow <800px list<->thread mode. NEW: sidebar Inbox unread badge in App.jsx (realtime on conversations + conversation_reads, 60s fallback).

**2026-07-27 staff Systems pass (Cole):** dialogs EXTRACTED to `src/components/dialogs.jsx` (`showToast`/`uiConfirm`/`ToastHost`/`ConfirmHost` - ClientsCombinedView + SystemsView both import it now; use this in every view, mount the two hosts at the view root). SystemsView: emoji sweep (🔴📋📎🔔⏳⚠ gone), radius 8, URL-persisted `?stab=` + `?ticket=` (tickets deep-linkable), search+academy filter on ALL tabs, "Just mine" manager toggle, overdue-first sort + due chips on cards + red overdue dot on tab labels, avatars on cards/rows (api/tickets.js now returns clients.brand_data), skeletons, new-ticket realtime toast, TicketModal: Esc/overlay close with an unsaved-changes guard.

## Gotchas
- client-portal.html `:root` and tokens.css MUST stay mirrored - drift breaks the system.
- The tour verifier (`node bam-portal/scripts/verify-client-portal-ui.mjs`) must pass after any client-portal.html edit - passed on this pass.
- Don't reintroduce `#E8C547` / `rgba(232,197,71,…)` - grep before merge.
