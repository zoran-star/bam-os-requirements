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
