# FullControl V2 Design System

**Version 1.0 - 2026-07-05 | Living document: update it every time the UI evolves.**

> ⛔ **RULE FOR EVERY AGENT + HUMAN: read this file BEFORE any front-end work in the V2 portal.**
> Use the tokens in [`tokens.css`](tokens.css). Never hardcode a color, radius, font, or shadow that a token covers. If the design needs something the system doesn't have, ADD IT HERE FIRST (see "How to change this system" at the bottom), then use it.

## What this covers

| Surface | Status |
|---|---|
| **V2 client portal** (`bam-portal/public/client-portal.html`) | ✅ Canonical target |
| New V2 pages / standalone builds | ✅ Link `design-system/tokens.css` |
| `bam-gta-staff/` | ⛔ Keeps its own branding, do not apply |
| Marketing / editorial pages | Old brand guide `front-end/fullcontrol-brand.md` still applies there |

**Reference pages (the gold standard):** the V2 **Home** (`renderHomeV2`), **Assets**, and **Calendar** views inside `client-portal.html`. When in doubt, match those.

---

## 1 · Personality (the vibe in one row)

**Warm premium SaaS.** Dark-warm surfaces (or paper-warm in light mode), ONE gold accent, rounded-but-not-bubbly corners, soft lift shadows, snappy motion. Not stark, not glossy, not pastel, no gradients-as-decoration.

---

## 2 · Color

| Rule | Token |
|---|---|
| **One gold.** `#D4B65C` dark / `#C8A84E` light. Never `#E8C547` (dead - old brand). | `var(--gold)` |
| Gold tints: use rgba of the SAME hue | `var(--gold-glow)` `.12`, `var(--gold-sheen)` `.06`, `var(--accent-border)` `.25`, or `rgba(212,182,92,.NN)` |
| Text on gold fills is always the same near-black | `var(--on-gold)` |
| Success / warning / danger / info | `var(--green)` `var(--amber)` `var(--red)` `var(--blue)` + `-soft` washes |
| Text hierarchy: primary / secondary / muted | `var(--text)` `var(--text-sub)` `var(--text-mute)` |
| Overlays / scrims: plain black rgba | `rgba(0,0,0,.5-.88)` - never tinted near-blacks |

**Gold discipline:** gold marks THE most important thing on screen (primary action, active state, live indicator). If everything is gold, nothing is.

## 3 · Typography

| Role | Token | Notes |
|---|---|---|
| All UI text | `var(--font-ui)` Plus Jakarta Sans | 400-800 loaded |
| Big numbers + display titles | `var(--font-num)` Nunito | 700-900, e.g. stat values, card titles |
| Technical values (money, IDs, timestamps) | `var(--font-mono)` DM Mono | sparingly |

**Scale (px):** 10 micro-label · 11 label/badge · 12 meta · 13 body · 15 section title (700) · 18-22 stat value (800 Nunito) · 20 drawer title · 32 hero number.
**Micro-labels:** 10-11px, 600-700, uppercase, `letter-spacing:.04-.08em`, `--text-mute`.

## 4 · Radius scale (LOCKED)

| Token | px | Use |
|---|---|---|
| `--r-xs` | 6 | micro badges, tiny tags |
| `--r-sm` | 8 | **buttons, inputs, icon chips, calendar event chips** |
| `--r-md` | 12 | small cards/tiles, toolbars, tooltips, list chips |
| `--r-lg` | 16 | **main cards, panels** |
| `--r-xl` | 24 | modals |
| `--r-full` | 999 | pills, dots, avatars |

Nothing else. No 7, 9, 10, 13, 14, 20.

## 5 · Core components (recipes)

**Card (the base DNA):**
```css
background:var(--surface); border:1px solid var(--border);
border-radius:var(--r-lg); box-shadow:var(--shadow-card);
/* hover: */ transform:translateY(-2px); box-shadow:var(--shadow-hover);
transition:transform var(--t-med) var(--es), box-shadow var(--t-med);
```

**Buttons:**
| Variant | Recipe |
|---|---|
| Primary | `background:var(--gold); color:var(--on-gold); border-radius:var(--r-sm); font-weight:700` |
| Secondary | `background:transparent; color:var(--text); border:1px solid var(--border-med); border-radius:var(--r-sm); font-weight:600; hover: border-color gold` |
| Ghost/text | gold text, transparent, hover `background:var(--gold-sheen)` |

**Pills (filters, statuses):** `border-radius:var(--r-full)`; active = gold fill + `var(--on-gold)` text.
**Toolbar:** `sticky top:0; background:var(--surface); border:1px solid var(--border); border-radius:var(--r-md)`.
**Detail views:** ONE idiom - the **right-side drawer** (`#cal-drawer` pattern: overlay `rgba(0,0,0,.55)` + blur, 460px max, full-width on mobile). No bottom sheets.
**Modals (confirm/pick):** centered, `--r-xl`, `--shadow-pop`, overlay `rgba(0,0,0,.5)`.
**Empty states:** centered, dashed `--border-med` box (or icon at `opacity:.3`) + 1-line muted message + one CTA button.
**Icons:** feather-style stroke SVGs (`stroke-width:2, round caps`). **No emoji in UI chrome** (nav, buttons, card headers, badges). Emoji OK inside user-generated content only.

## 6 · Motion

- Micro (color/border): `var(--t-fast)` · Hover lift: `var(--t-med)` + `translateY(-2px)`
- Entrances: fade-rise `.42s var(--es)` with 30-60ms stagger per card
- Always gate loops/entrances behind `@media(prefers-reduced-motion:reduce)`

## 7 · Copy rules

- ⛔ **Never an em dash** in anything person-facing. Use `-` or restructure.
- Sentence case for labels + buttons; uppercase only for micro-labels.
- Plain, confident, athletic. No "seamlessly / effortlessly / delightful".

## 8 · Do / Don't

| ✅ Do | ⛔ Don't |
|---|---|
| `var(--gold)` + same-hue tints | `#E8C547`, `rgba(232,197,71,…)` - dead gold |
| Radii from the locked scale | Any in-between radius |
| `var(--on-gold)` on gold fills | `#0B0B0D`, `#000`, ad-hoc blacks |
| Right-side drawer for detail views | Bottom sheets, second modal idioms |
| Tokens for semantic colors | Near-miss hexes (`#e07070`, `#7BC47F`, `#4CAF50`) |
| SVG stroke icons | Emoji in chrome |
| New CSS classes for repeated patterns | Long inline `style="…"` chains for reusable UI |

## 9 · Known debt (safe to fix when touched)

- `client-portal.html` still has many legacy radii/hardcodes OUTSIDE Home/Assets/Calendar - normalize per-view as each view gets its consistency pass ("disperse to the rest of V2").
- Home KPI catalog + Hawkeye feed still use emoji icons (`_HM_KPI_CATALOG`, feed rows) - swap to `_HV2_ICONS`-style SVGs in a future pass.
- Assets page uses native `alert()/prompt()` for feedback - needs the shared toast/banner pattern.
- Hardcoded gold tints (`rgba(212,182,92,.NN)`) don't shift in light mode - acceptable (hues are close); prefer `--gold-glow`/`--gold-sheen`/`color-mix` in new code.
- Staff portal (`bam-portal/src/tokens/tokens.js`) is a separate palette - fold in later or keep deliberately distinct (open decision).

## 10 · How to change this system (iteration protocol)

1. **Change the token/recipe HERE first** (tokens.css + this doc), bump the version + changelog below.
2. **Mirror in `client-portal.html`'s `:root`** in the same commit (its inline tokens must match tokens.css).
3. Apply to the three reference pages first - they must always be 100% on-system.
4. Commit message prefix: `design-system:`.
5. Big-picture changes (new fonts, new gold, corner personality) = ask Zoran first.

## Changelog

| Date | v | Change |
|---|---|---|
| 2026-07-05 | 1.0 | Initial system extracted from V2 Home / Assets / Calendar. Killed stale gold `#E8C547` portal-wide, locked radius scale, unified fonts (Plus Jakarta Sans + Nunito) across the 3 reference pages, added `--on-gold`/`--font-ui`/`--font-num` tokens, converted calendar booking popup to the right-drawer idiom, normalized off-token greens/reds on the 3 pages. |
