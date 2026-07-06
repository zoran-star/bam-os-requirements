# Command Center (beta) - sidebar-less one-page flow

**2026-07-05 - SKELETON SHIPPED (hidden).** The Figma vision: no side nav, the whole business on one scrolling page with a left bubble rail, floating dock (Info / Business blueprint / Settings), and per-section focus modes. Built as a parallel mode in `bam-portal/public/client-portal.html` - the classic nav is untouched and stays the default.

## How to enter / exit
- `?cc=1` on the portal URL enters (persists via `localStorage.bam_cc_mode`); `?cc=0` or Settings dock > "Exit command center beta" exits. **V2 academies only** (checked at boot landing dispatch).
- Boot hook: landing dispatch in `boot()` calls `openCommandCenter()` instead of `switchView(_landingView())` when flagged.

## Architecture (the plop-in contract)
- `#view-cc` view container holds 5 stacked `<section class="cc-sec" id="cc-sec-<key>">` shells.
- `_ccSections()` registry (key, kicker, label, mount) - **to replace a section (e.g. Zoran's new Sales build), swap its mount() and keep the section id.** Nothing outside a mount references section internals.
- Module is ALL function declarations (no top-level const/let) - deliberate, TDZ-proof.
- `body.cc-mode` hides `.sidebar` + `.mobile-nav`; `body.cc-classic` = a classic view opened from inside the flow, shows the gold "‹ Command center" back pill (`_ccReturn()`).
- `switchView` guard at the top: in cc-mode, mapped views (home/pipelines/members/marketing/assets) scroll to their section (`_ccScrollTo`); anything else opens classically + back pill. `window._CC_BYPASS` lets dock/quick buttons open classic views deliberately (`_ccOpenClassic`).
- Bubble rail: `.cc-rail` fixed left, dots enlarge+gold when their section is most visible (IntersectionObserver, root `.main`); sections fade-rise in (`.cc-visible`).
- CSS injected by `_ccStyle()`; design-system tokens throughout.

## Pass 2 (2026-07-05, Cole feedback)
- Flow = Home / Sales / Members / Marketing only (Resources SECTION removed; training home ignored for now). Kickers (the section-symbol + 01/02 labels) removed - titles only.
- **Quick links widget** on the Home right rail (the red-circle spot): Resources / Assets / Calendar / Support via `_ccOpenClassic` (`#cc-res-widget`, injected by `_ccMountHome` after renderHomeV2).
- **Members section = sketch layout**: KPI strip, then two cards (Unread member messages `_ccLoadMemberMsgs` = /api/ghl/inbox filtered to roster by ghl_contact_id/name, own `.cc-ib-row` markup | Member action items `_ccLoadMemberActions` = roster-derived chips: payment_failed/payment_method_required red, pause_scheduled_for + cancelling amber, click -> openMemberPopup) + "See all members" -> `_ccMemberListOpen()` popup (z 8800, UNDER the member drawer so drill-in works; client-side search) + agent chat bar at the BOTTOM -> focus mode.
- **Scroll recede** `_ccInitRecede`: sections blur/fade/scale back as they exit the top (like the home hero), rAF-throttled, reduced-motion safe. Section heads are click-to-focus (scrollIntoView).

## Pass 3 (2026-07-05, Cole picks)
- **Dock = glass speed-dial orb**: one 46px `.cc-orb` (frosted `color-mix` + backdrop-blur `.cc-glass`, gold plus icon rotates to X); click fans out 3 icon circles (Info popover / Blueprint / Settings popover) with stagger; labels slide out on hover; auto-tucks on scroll down, returns on scroll up (`.cc-dock.tuck`).
- **Rail FX**: magnetic dot scaling near cursor (`_ccRailFx` gaussian), scroll-progress ring around the active dot (SVG `rfg` dashoffset), label flash ~1.7s on section lock-in, drag-to-scrub the page along the rail (pointer events, click-swallow after drag), keyboard ArrowUp/Down + 1-4 (`_ccKeys`, skipped in inputs/classic/focus mode), tick pop animation (`ccTick`), idle fade to 35% after 2.8s (wakes on scroll or mouse near left edge), **red alert dot** `.cc-dot.alert` via `_ccSetBadge(key,n)` - members = roster action items, sales = `_hmHawkTotal` (8s interval).
- **Active dot is computed in the scroll handler** (section under the 45% viewport line, containment first, last-crossed fallback) - NOT IntersectionObserver ratios (misfire when sections are shorter than the viewport). Observer only handles reveal now.

## Daily win = never empty (2026-07-05)
`_hv2WinLoad`: STRONG wins show outright (client joined today, 2+ trials today, $500+ yesterday). Anything modest (+1 trial, small revenue, weekly momentum) joins a POOL with `_hv2StateWins()` standing wins (kpis-v15 members 30d: active count, 0 cancellations, payments collected, longest tenure, clean books) and the day-of-year rotation picks one - a different card every day, label 'On the board'. Floor: "Your command center is live". Bare "Hello" impossible. Applies to classic V2 Home too (same card).

## Focus-mode warp pan (2026-07-05)
- Transition retimed 3s -> .55s expo-out (`cubic-bezier(0.16,1,0.3,1)`) with 80ms wind-up (was 280), close hide 700ms (was 3200). Applies to ALL focus pages (marketing + members, classic view included).
- Depth: `html.mm-focus-open .main/.sidebar` now also `scale(.965)` + `blur(5px)` (the page you leave recedes). Seam glint keyframe on landing; `.mm-modal-card > *` blocks cascade up (mmRise, staggered .18-.40s). All reduced-motion safe.
- **HUD readout**: `_ccFocusHud(modalId)` injects `FOCUS · <SECTION> · LIVE` mono line (pulsing gold dot) into every focus card. Injected by `_mmOpenFocus` + `_ccOpenFocusPage` (guarded try, idempotent).
- **Esc ejects** from any focus page (`_ccFocusCloseOpen` resolves the right closer by open modal id; bound in `_ccKeys`).
- **Two-finger swipe** `_ccInitSwipe`: trackpad wheel deltaX accumulator (>170 in a 450ms window) or two-finger touch drag (80px). Swipe left in Members section -> member agent, in Marketing -> marketing machine; swipe right inside any focus page -> exit. Guards: cc active, not classic, deltaX must dominate deltaY.

## Focus FX pass (2026-07-05, Cole picks T2+T3+B1+B2)
- Vignette REMOVED (both layers). Focus background = blueprint grid (44px graph paper via layered gradients + gold intersection dots every 220px, tokens only) + **data wallpaper**: `_ccFocusWallpaper` draws the academy's cumulative member-growth curve (12 months from roster join dates) as a huge faint gold SVG area+line behind the card, line draws itself in 1.4s. Skipped when roster empty. Card z-index 1 above `.cc-wall` z 0.
- Seam now GROWS bottom-up like a rising chart (mmSeamGrow) then glints. HUD types itself in (`_ccHudType`, 16ms/char) on every entry. Member-agent KPI grid numbers count up via existing `_hmCountUp`.
- All reduced-motion safe.

## Members pass 2 + wiring fix (2026-07-05)
- **CRITICAL FIX**: `_MEMBERS_ALL` is a top-level `let` = NOT a window property. All roster reads now go through `_ccRoster()` (bare identifier hits the global lexical binding). `window._MEMBERS_ALL` reads silently returned undefined in production = the "no data wired" bug. In page-context tests assign BARE `_MEMBERS_ALL = [...]`, not window.
- Members section: KPI skeleton shimmer + one 5s retry, trend deltas (+N / +$N this month from 30d joins), 6-month growth sparklines, roster **pulse strip** (dot per member by status), action items with **$/mo at risk** sorted by weight + **milestone chips** (3/6/12/18/24-month anniversaries within 14d, gold), alive empty states ("All N members are current." / "Inbox clear."), **quick reply** on message rows (POST /api/ghl/send-message type SMS + contactId, fallback link to inbox), **Sage bar** ported from prototype SageBar (pill + gradient gold icon + drawerUp entrance + typewriter prompt rotation `_ccSageType`), member popup with segment tabs (All/Live/Paused/Issues) + hover Message action.
- Light theme v1.4: prototype cream #F8F7F5, neutral borders, prototype grays (was #EFEAE0, read too yellow). Mirrored in tokens.css.
- **Radar/ticker spans the whole flow**: `.hm-ticker-bg` reparented to #view-cc with `.cc-full` (fixed, 100vw/100vh, z0; cc-content z1). Reparent avoids transformed-ancestor breakage from section recede.

## Charcoal + sound pass (2026-07-05, Cole picks)
- **Dark = true charcoal (design-system v1.5)**: global hex swap #131416 bg/ink/on-gold, #1B1D1F surface, #232629 elevated, #2B2E32 hover. Mirrored in tokens.css. Light stays prototype cream (v1.4).
- **Win card loading state**: pulsing green dot + typed "READING THE BUSINESS..." label (`_hv2BootType`) + `cc-skel2` shimmer bars (defined in _hv2Style so classic home gets it too); `_hv2WinLoad` replaces when data lands.
- **Sound design** (all Cole's picks except confirm-tone): new _SFX methods tick/whooshOut/sent/typeTap/thud/rollClick/sparkle/zip/boot + reused whoosh/kaching/fanfare/chime. Wired: rail lock tick, focus in/out whooshes, revenue-win kaching (once/session), orb pop, quick-reply sent, HUD type taps, red-items thud vs milestone fanfare (once/session), count-up roll clicks (700ms throttle), unread-member chime (once/session), perfect-day sparkle, scrub zip (70ms throttle, pitch=position), CC boot chord. `_SFX._isMuted()` now returns true on <=768px (all portal sounds off on mobile) + "Sounds: on/off" toggle in the dock Settings popover (hm_sfx_muted).

## Coworker pass (2026-07-05, Cole picks 1,2,3,4,5,7)
- Member agent focus mode made "a coworker, not a dashboard": presence header (avatar orb + "Roster agent" + status line), status line types what it is doing, conversational openers rotate, reply cards slide in as chat bubbles, suggestion chips under the composer, wallpaper opacity lowered. Names title-cased everywhere via `_ccCapName` (also fixes lowercase GHL contact names in messages + actions).

## Actions redesign (2026-07-05, Cole picks A1+A2+A4, B1, P2)
- **A1 grouping**: `_ccLoadMemberActions` splits roster into probs (payment_failed/payment_method_required red, pause_scheduled_for/cancelling amber) + miles (gold milestones), groups probs by `cls|label`; duplicates collapse into one `.cc-act-group` row with stacked avatars (`.cc-act-avs`, first 3), "N members", $total/mo, chevron; click toggles `.cc-act-exp` subrows (each opens `openMemberPopup`).
- **A2 quiet rows**: rows are avatar + name + $amt sub-line + soft colored `.cc-act-tag` pill on the right (no loud chip backgrounds).
- **A4 risk in header**: card header is `Actions` + `#cc-act-risk` ("$N/mo at risk", red) filled from the probs sum. The old in-card "See all members" button is gone.
- **B1 header link**: `_ccHead(label, sub, right)` grew a third `right` param rendering `.cc-head-right` (stopPropagation so the click-to-focus head doesn't fire). Members head uses it for the gold "All members ›" link -> `_ccMemberListOpen()`.
- **P2 health bar**: `_ccPulseRender` now renders `.cc-hb`, a full-width segmented bar (green live / amber issues / red critical / gray paused, proportional widths) + label "N live · N paused · N issues ›". Whole thing is a button -> `_ccMemberListOpen()`; hover scales the bar. Replaces the per-member pulse dots (looked funky).

## Focus polish (2026-07-06, Cole feedback)
- Win-card boot label copy: "READING THE BUSINESS..." (was BOARD).
- Focus pages (`.mm-focus-page`, so marketing + members) now run on the design system fonts: `--font-ui` body/inputs/buttons, `--font-num` 800 for `.modal-title` (they were inheriting legacy Inter/Archivo).
- Focus background dropped way down: blueprint grid lines at 45% of `--border` via color-mix, gold dots at 10% gold; growth-curve wallpaper area .035 -> .018, line .11 -> .055, highlight pulse .5 -> .28.

## KPI picker fix + inbox capitalization (2026-07-06)
- **"Choose Your KPIs" gear was dead-looking**: the modal appends to document.body but ALL its CSS was scoped `#home-v2 .hm-kpi-*`, so it rendered unstyled/invisible. Fixed by de-scoping the 28 selectors to `.hm-kpi-*` + giving `.hm-kpi-body` the design-system fonts directly (body-level nodes can't see #home-v2's --ff/--fn vars).
- `_ccCapName` now skips anything containing '@' (emails stay verbatim). Applied to the home inbox card rows (`_hmInboxRow`) and the v15 inbox list (`_ibSmartName` person branch).
- Scoreboard periods (as built): New Leads + Trials Booked = this week Mon-today (ring vs last week); MRR Growth = month-to-date from /kpis revenue; Revenue = yesterday only. Time-period options are an open decision with Cole.

## KPI defaults + sound trim (2026-07-06, Cole picks)
- Scoreboard defaults now `leads, trials, mrr, newmembers`. MRR = ONGOING (roster-derived via `_ccMemberKpis`, falls back to /kpis month-to-date); New Members = joins this month (ring vs last month); Revenue stays in the catalog but reads last 7 days (was yesterday, always $0). Active Members + Rev/Member also wired from roster. Selected metrics with no data render '-' instead of eternal skeleton. Wired: leads/trials/mrr/newmembers/rev/members/revmember; still stub: replies/churn/attendance/conversion.
- Portal :root now has `--font-mono` (DM Mono, mirrors tokens.css); `.mm-focus-page` redefines `--mono: var(--font-mono)` so all focus telemetry (HUD, PULLED THIS SESSION, pins) is DM Mono not Geist.
- **Sounds trimmed to 5 impactful moments** (Cole: prevent annoyance): boot chord, focus whoosh in/out, revenue kaching, actions thud/fanfare, quick-reply sent. Unwired (methods kept in _SFX): rail tick, orb pop, HUD typeTap, count-up rollClick, unread chime, perfect-day sparkle, scrub zip.
- Focus-mode background = OPEN: Cole dislikes the blueprint grid, wants something more unique; options pending his pick.

## Section mounts (current skeleton)
| Section | Mount | Content |
|---|---|---|
| home | `_ccMountHome` | REPARENTS `#home-v2` (all CSS scoped to it, renders identically) + greeting head |
| sales | `_ccMountSales` | quick stats (trials today live via calendars-v15; 7-day sales + closing rate = placeholders), Open sales board, Hawkeye. **Zoran's slot: `#cc-sales-mount`** |
| members | `_ccMountMembers` | agent bar (opens members focus mode) + roster KPIs computed client-side (`_ccMemberKpis`: live/paused counts, MRR + rev/member = monthlyized `pricing.amount_cents`, tax-inclusive approx) |
| marketing | `_ccMountMarketing` | REPARENTS `#marketing-machine-card` + `#landing-machine-card` (mm CSS is global; focus modals live at body level so marketing focus mode works unchanged) |
| resources | `_ccMountResources` | 4 quick buttons (Calendar/Contacts/Inbox/Support) + assets library via `_ASSETS_HOST_ID='cc-assets-content'` host-override |

## Members focus mode (member agent, rule-based skeleton)
- `openMembersFocus()` → `#membersMachineModal` (injected on first open) with the same camera-pan as marketing (`_ccOpenFocusPage` = clone of `_mmOpenFocus` WITHOUT its `_MM` guard - members must open even if marketing never loaded). Close via `_mmCloseFocus` (no guard there).
- Chat: `.mma-*` classes. `_mmaHandle` routes: KPI keywords → `_mmaKpis()` grid; name match vs `_MEMBERS_ALL` (`_mmaMatchMembers`, stopword-filtered scoring) → 1 hit = card "This the one?", 2-4 hits = pick list; else help. Cards reuse `_memberAvatar`/`_memberStatusPill`/`_memberPriceLabel` (price label returns HTML - do NOT escape it) + "Open card" → `openMemberPopup` (drawer z bumped above focus page via `html.mm-focus-open #member-drawer{z-index:9600}`).
- **TODO(LLM):** replace `_mmaHandle` router with the real member-agent endpoint. Contract: user text + roster + KPI snapshot in → reply text + optional member ids to card out.

## Gotchas
- `_mmOpenFocus` has an `if (!_MM) return` guard - never use it for non-marketing focus pages; use `_ccOpenFocusPage`.
- Reparenting: home + marketing DOM nodes MOVE into CC sections. Exit beta = `location.reload()` restores everything. Classic marketing/home unreachable inside cc-mode by design (mapped to scroll).
- `switchView('assets')` resets `_ASSETS_HOST_ID` - fine (mapped to scroll in cc-mode).
- Smoke test: `scratchpad cc_smoke2.mjs` pattern - serve `public/` locally, `openCommandCenter()` via console; boot splash covers everything in offline envs (remove `#boot-splash` for screenshots).
- Tour verifier still passes; V1/V1.5 completely unaffected (flag + V2 check).

## Next steps (agreed with Cole)
1. Zoran plops his new Sales section into `#cc-sales-mount` (then Marketing rebuild).
2. Wire the real LLM member agent.
3. Motion pass: weave sections together with transitions/graphics (deliberately bare-bones now).
4. Later offers (teams/tournaments/leagues) = additional home flows branching from the training flow.
