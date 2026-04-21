# Full Control — Brand Knowledge Document

> **How to build frontend interfaces in the Full Control design language.**
> This is the canonical reference. Any new component, screen, or page in the BAM OS / client portal must read like it was drawn by the same hand.

Source of truth: `Full Control — Brand Identity v1.0` (April 2026, Internal Review Build). Tagline: **Navigate · Command · Lead.** Positioning: *The Operating System for Elite Sport.*

---

## 1 · The Feeling

Full Control is **editorial, premium, disciplined**. It draws from:

- **Navigation instruments** — compasses, sextants, coordinate readouts, heading / holding-line language
- **Luxury print** — serif numerals, hairline rules, generous white (black) space, no shadows
- **Aerospace / command dashboards** — mono labels, pulsing indicators, precise deltas
- **Swiss design grids** — 1px dividers instead of borders + shadows, strict column grids

It is **not**: rounded, glossy, bubbly, SaaS-pastel, gradient-heavy, emoji-driven, or playful. When in doubt, **remove** visual weight — a hairline rule beats a drop shadow; uppercase mono beats bold sans.

Three one-word filters every surface must pass:
1. **Commanding** — authority, not noise
2. **Precise** — every number has a unit, every label has a role
3. **Quiet** — gold is earned, not applied

---

## 2 · Color Tokens

### Primary (dark — default surface)

| Token | Hex | Role |
|---|---|---|
| `--ink` | `#0A0A0B` | Canonical dark surface (page bg, primary panels) |
| `--ink-2` | `#131316` | Raised surface / alt section bg |
| `--ink-3` | `#1C1C21` | Cards, elevated elements, inputs |
| `--line-dark` | `#2A2A31` | Dividers, hairline borders on dark |
| `--line-dark-2` | `#383842` | Stronger dividers, focus borders |

### Paper (light — inverse surface, used for quote blocks, collateral, sections that breathe)

| Token | Hex | Role |
|---|---|---|
| `--paper` | `#F5F1E8` | Canonical light surface. Warm off-white. |
| `--paper-2` | `#EBE4D3` | Secondary paper |
| `--paper-3` | `#E0D7C1` | Parchment. Cards, print collateral. |
| `--line-light` | `#D4C9AD` | Dividers on paper |
| `--line-light-2` | `#B8A77F` | Stronger dividers on paper |

### Gold (accent system)

| Token | Hex | Role |
|---|---|---|
| `--gold` | `#E8C547` | **Signal Gold.** Primary accent on dark. CTAs, emphasis, live dots, active nav. |
| `--gold-2` | `#C9A55C` | Champagne. Gradients, counterweights. |
| `--gold-3` | `#8B6F2A` | Deep Gold. AA body on paper. Use when gold sits on light bg. |
| `--gold-highlight` | `#F4D788` | Hover/focus lift only. |

**Gold discipline:** one gold moment per screen whenever possible. The active nav item. The one stat that matters. The CTA. The live indicator. If a screen has three gold things fighting for attention, two of them are wrong.

### Pace (semantic status colors — used sparingly)

| Token | Hex | Role |
|---|---|---|
| `--pace-go` | `#9FD88A` | Positive signals. Success. Completed. |
| `--pace-stop` | `#E87560` | Alerts, errors, destructive. |
| `--pace-flow` | `#5A8FB8` | Info, links, data neutrals. |

Pace colors are **muted on purpose** — they must not out-shout Signal Gold. If a success toast looks more important than the primary CTA, desaturate further.

---

## 3 · Typography

Four families. Load each explicitly via Google Fonts.

```html
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@300;400;500;600;700&family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&family=Fraunces:ital,wght@0,400;0,500;0,600;1,400&display=swap" rel="stylesheet">
```

```css
--display: "Space Grotesk", "Inter", sans-serif;   /* Role 01 — hero, titles, stat numbers */
--sans:    "Inter", system-ui, sans-serif;         /* Role 02 — body, UI, forms */
--mono:    "JetBrains Mono", ui-monospace, monospace; /* Role 03 — labels, meta, data */
--serif:   "Fraunces", Georgia, serif;             /* Role 04 — editorial pull-quotes only */
```

### Role assignments

| Role | Family | Usage |
|---|---|---|
| **Display** | Space Grotesk 300 / 500 / 600 | Hero titles, section titles, stat numbers, wordmark, page H1s, sidebar nav items. Tracking `-0.02em` to `-0.055em`. |
| **Interface** | Inter 400 / 500 / 600 / 700 | Body copy, paragraph text, form fields, card descriptions, inline text. The platform runs on this. |
| **Technical** | JetBrains Mono 400 / 500 | UI labels, section kickers, metadata, coordinates, deltas, status strings. Always `text-transform:uppercase` + letter-spacing `0.10em–0.20em`. |
| **Serif** | Fraunces 400 / 500 italic | Rare. Pull-quotes, editorial call-outs, marketing moments. Never in UI chrome. |

### Display type scale (Space Grotesk)

`96 / 64 / 48 / 32 / 24 / 18 / 14` — use the discrete values, don't interpolate.

- Marketing hero: **200px** weight 300 tracking `-0.055em` line-height `0.82`
- Section title: **56px** weight 500 tracking `-0.02em` line-height `1`
- Sub-section / card title: **24–32px** weight 500 tracking `-0.01em`
- Stat number: **28–40px** weight 500 tracking `-0.02em`
- Sidebar brand name: **16–18px** weight 600 tracking `-0.01em`

### Interface scale (Inter)

`11 / 12 / 13 / 14 / 15 / 16` — 14px is the default body size.

- Body: 14–15px weight 400 line-height `1.5`
- Secondary / muted: 13px weight 400 opacity `0.55–0.7`
- Nav label: 13px weight 500
- Tiny / captions: 11–12px

### Technical scale (JetBrains Mono)

`10 / 11 / 12 / 13`. Always uppercase. Always tracked.

- Section kicker: 11px tracking `0.18em`
- Field label: 10–11px tracking `0.12em`
- Status readout: 10–11px tracking `0.15em`
- Deltas / coords: 11–13px tracking `0.1em` (not uppercase when showing numerals + glyphs)

---

## 4 · Layout Grammar

### Frame

- Page max-width **1440px**, centered. The design ships inside a bounded canvas — not fluid to viewport.
- Section padding: **120px vertical / 80px horizontal** on marketing pages. App chrome uses tighter 32–48px.
- Section dividers: single **1px solid var(--line-dark)** (or `--line-light` on paper). No shadows.

### Section head pattern

Every major block uses a three-part head:

```
KICKER (mono, 11px, 0.18em uppercase)  ·  TITLE (display, 56px, -0.02em)  ·  META (mono, 11px, right-aligned)
```

Example:

```html
<header class="section-head">
  <div class="section-kicker">§ 01 / Overview</div>
  <h2 class="section-title">Your academy, at a glance.</h2>
  <div class="section-meta">Q2 · 2026</div>
</header>
```

Bordered by a single 1px bottom rule, `padding-bottom:24px`, `margin-bottom:64px`.

### Grid discipline

- Multi-cell layouts use **1px gap on a `--line-dark` background** to create hairlines between tiles. Each tile has `background:var(--ink)` or `var(--ink-2)` — the "gap" becomes the divider.
- Mockup-style blocks use `border:1px solid var(--line-dark)` + `border-radius:4px`. Radius stays in the **0–6px** range app-wide. **Rounded-12+ is wrong.**
- Corner radii allowed: `0` (marketing slabs), `3px` (buttons), `4px` (cards, mockups), `22%` (app icon boxes only).

### Spacing

- Element gap inside cards: `12–16px`
- Section kicker to title: `16–24px`
- Card inner padding: `24–32px` (not the 20px we use elsewhere — give it room)
- Stat cards: `16–20px` padding; they're meant to feel like measurement instruments, not plush cards

---

## 5 · Component Patterns

### 5.1 · Stat Card

The signature BAM / Full Control data tile. Rectangular, hairline-bordered, big number in display, mono label, gold delta.

```html
<div class="stat">
  <div class="n">186</div>
  <div class="l">Active Today</div>
  <div class="d">↑ 12 vs. last Monday</div>
</div>
```

```css
.stat { border:1px solid var(--line-dark); padding:16px; border-radius:4px; background:var(--ink); }
.stat .n { font-family:var(--display); font-size:28px; font-weight:500; letter-spacing:-0.02em; }
.stat .l { font-family:var(--mono); font-size:10px; opacity:0.5; letter-spacing:0.12em; text-transform:uppercase; margin-top:4px; }
.stat .d { font-family:var(--mono); font-size:11px; color:var(--gold); margin-top:8px; }
```

### 5.2 · Sidebar Navigation

App sidebar is **220px wide**, border-right hairline, organized into **named sections** in mono caps. Signature grouping: `NAVIGATE` / `COMMAND`.

```html
<aside class="sidebar">
  <div class="nav-section">NAVIGATE</div>
  <a class="nav-item active"><span class="bullet"></span>Overview</a>
  <a class="nav-item">Roster</a>
  <a class="nav-item">Schedule</a>

  <div class="nav-section">COMMAND</div>
  <a class="nav-item">Coaches</a>
  <a class="nav-item">Reports</a>
</aside>
```

```css
.sidebar { width:220px; padding:24px 20px; border-right:1px solid var(--line-dark); display:flex; flex-direction:column; gap:4px; }
.nav-section { font-family:var(--mono); font-size:10px; letter-spacing:0.18em; text-transform:uppercase; opacity:0.45; padding:20px 12px 8px; }
.nav-item { padding:10px 12px; font-size:13px; color:rgba(245,241,232,0.6); display:flex; align-items:center; gap:10px; border-radius:4px; text-decoration:none; }
.nav-item.active { background:rgba(232,197,71,0.08); color:var(--gold); }
.nav-item .bullet { width:4px; height:4px; border-radius:50%; background:currentColor; }
```

### 5.3 · Top Bar / Breadcrumbs

```html
<div class="topbar">
  <div class="topbar-left">
    <div class="bc-logo">[mark] <span class="bc-wordmark">Full<em>C</em>ontrol</span></div>
    <div class="crumbs">Atlas Academy <span class="sep">›</span> Operations <span class="sep">›</span> Roster</div>
  </div>
  <div class="crumbs">⌘K</div>
</div>
```

Breadcrumbs are **mono 11px 0.5 opacity** with the `›` separator at 0.3 opacity. The breadcrumb says *where you are* — treat it like a coordinate readout.

### 5.4 · Readout Line

Under a page title, show a mono status line in the voice of an instrument:

```
HEADING 347° · HOLDING LINE · LAST SYNC 09:41
Q2 RETENTION · COHORT 14 → 26 · N = 247
```

```css
.readout { font-family:var(--mono); font-size:11px; letter-spacing:0.12em; text-transform:uppercase; opacity:0.5; }
```

### 5.5 · Primary Button (`btn-gold`)

Solid gold, ink text, almost no radius, Space Grotesk weight 600. **Not** a rounded pill. **Not** a gradient.

```css
.btn-gold {
  background: var(--gold);
  color: var(--ink);
  padding: 12px 24px;
  border: none;
  border-radius: 3px;
  font-family: var(--display);
  font-size: 13px;
  font-weight: 600;
  letter-spacing: 0;
  cursor: pointer;
  transition: filter 0.15s ease, transform 0.15s ease;
}
.btn-gold:hover { filter: brightness(1.06); }
.btn-gold:active { transform: translateY(1px); }
```

Secondary button: **outlined ghost** — transparent bg, 1px solid `--line-dark`, paper text. Tertiary: text-only with mono label.

### 5.6 · Field (form input, command-line style)

Inputs feel like a bridge console, not a Material field. **Hairline bottom border only.**

```html
<div class="field">
  <label>EMAIL</label>
  <div class="val">coach@atlas.academy</div>
</div>
```

```css
.field { border-bottom: 1px solid var(--line-dark); padding: 12px 0; }
.field label { font-family: var(--mono); font-size: 10px; letter-spacing: 0.12em; text-transform: uppercase; opacity: 0.5; display: block; }
.field .val, .field input { font-size: 14px; margin-top: 4px; background: transparent; border: 0; outline: 0; color: var(--paper); width: 100%; }
.field:focus-within { border-bottom-color: var(--gold); }
```

### 5.7 · Pulse / Live Indicator

A single 6px gold dot, pulsing. Use next to "LIVE", "ACTIVE", or connection status text.

```css
.dot-pulse { width: 6px; height: 6px; border-radius: 50%; background: var(--gold); display: inline-block; animation: pulse 2.4s ease-in-out infinite; }
@keyframes pulse { 0%,100% { opacity: 1; } 50% { opacity: 0.3; } }
```

### 5.8 · Status Pill

Rare. Use mono 10px uppercase with colored dot. **Do not** use large pill shapes with colored fills — that reads as SaaS.

```html
<span class="status"><span class="status-dot"></span>Holding</span>
```

```css
.status { font-family: var(--mono); font-size: 10px; letter-spacing: 0.15em; text-transform: uppercase; display: inline-flex; align-items: center; gap: 6px; }
.status-dot { width: 6px; height: 6px; border-radius: 50%; background: var(--pace-go); }
```

### 5.9 · Loader

160px hairline track, gold sliver that loops left-to-right. No spinners.

```css
.loader { width: 160px; height: 2px; background: var(--line-dark); border-radius: 2px; overflow: hidden; }
.loader::after { content:""; display:block; width:40%; height:100%; background:var(--gold); animation: load 1.8s ease-in-out infinite; }
@keyframes load { 0%{margin-left:-40%} 100%{margin-left:100%} }
```

### 5.10 · Splash Screen

Centered wordmark, mono tag underneath, gold pulse loader below that. Background `--ink` with a **soft radial gold haze** (8% opacity, ~50% radius).

---

## 6 · Voice & Microcopy

The language is **nautical / flight-deck**. Plain, precise, confident. Strip adjectives. Prefer verbs.

**Do say:** Navigate · Command · Holding line · On course · Heading · Last sync · Drift · Bearing · Signal · Overview · Roster
**Don't say:** Effortlessly · Seamlessly · Revolutionary · Delightful · Empowering · Game-changing

**Labels** are nouns in mono caps. **Actions** are verbs in display. **Status** reads like telemetry, not marketing.

Examples:
- Section kicker: `§ 01 · OVERVIEW` (not "Welcome back!")
- Button: `Take the helm` / `Set course` / `Submit report` (not "Click here")
- Empty state: `No signals yet. Your first cohort will appear here.` (not "Nothing to show 😊")
- Error: `Signal lost. Check connection and retry.` (not "Oops! Something went wrong")

**Symbols:** `§` for section numbers. `›` for breadcrumbs. `·` (middle dot) as soft separator. `↑ ↓` for deltas. `°` for bearings. Avoid emoji in chrome.

---

## 7 · Do / Don't

### Do

- Use **1px hairlines** for separation. Everywhere.
- Let **gold earn its spot** — one CTA, one active state, one live dot per screen.
- Set numbers in **Space Grotesk weight 500**, labels beneath them in **JetBrains Mono 10px uppercase**.
- **Uppercase + track** any metadata or label.
- Keep corners at `0 / 3 / 4px`. Icons are the only exception.

### Don't

- **No drop shadows** except on floating app-icon boxes (`0 20px 40px rgba(0,0,0,0.4)`) and elevated business-card mocks.
- **No gradients** except: dark ink gradient on splash backgrounds, or `--gold → --gold-3` on avatar placeholders.
- **No rounded-lg or rounded-xl** (`border-radius > 6px`) anywhere in UI chrome. Pill chips at `999px` allowed only for very small status tokens.
- **No emoji** in primary UI. Emoji is OK inside user-generated content (chat messages, ticket descriptions) but never in nav, buttons, or headings.
- **No soft pastel accents** competing with gold. The supporting palette is muted on purpose.
- **No multi-color icon sets.** If you use icons, they should be monochrome strokes at 1.25–1.5px weight, paper color on dark / ink color on paper.

---

## 8 · Implementation Template

Drop this at the top of any new HTML file to inherit the system:

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>— Full Control</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@300;400;500;600;700&family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
  <style>
    :root {
      /* Ink */
      --ink:          #0A0A0B;
      --ink-2:        #131316;
      --ink-3:        #1C1C21;
      --line-dark:    #2A2A31;
      --line-dark-2:  #383842;
      /* Paper */
      --paper:        #F5F1E8;
      --paper-2:      #EBE4D3;
      --paper-3:      #E0D7C1;
      --line-light:   #D4C9AD;
      --line-light-2: #B8A77F;
      /* Gold */
      --gold:         #E8C547;
      --gold-2:       #C9A55C;
      --gold-3:       #8B6F2A;
      --gold-hi:      #F4D788;
      /* Pace */
      --pace-go:      #9FD88A;
      --pace-stop:    #E87560;
      --pace-flow:    #5A8FB8;
      /* Type */
      --display: "Space Grotesk", "Inter", sans-serif;
      --sans:    "Inter", system-ui, sans-serif;
      --mono:    "JetBrains Mono", ui-monospace, monospace;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    html, body {
      background: var(--ink);
      color: var(--paper);
      font-family: var(--sans);
      font-size: 14px;
      line-height: 1.5;
      -webkit-font-smoothing: antialiased;
      font-feature-settings: "ss01", "cv11";
    }
  </style>
</head>
<body>
  <!-- Your app -->
</body>
</html>
```

---

## 9 · Quick Checklist Before Shipping a Screen

Before you send a screen to Zoran:

- [ ] Background is `--ink`, not any alpha-black
- [ ] Any divider is a **solid 1px line** in `--line-dark`, not a box-shadow
- [ ] Labels are **Mono 10–11px UPPERCASE 0.12em**
- [ ] Titles are **Space Grotesk 500, -0.02em tracking**
- [ ] Corners are `0 / 3 / 4px`, nothing rounder in chrome
- [ ] Gold appears ≤ 1 time as a CTA + ≤ 1 time as an active state
- [ ] Stat numbers have a **delta line in gold mono** beneath them
- [ ] The page has one **readout line** somewhere (coords / heading / sync time)
- [ ] No emoji in nav, buttons, or headings
- [ ] No drop shadows on cards

If it still reads like Stripe or Linear — it's not there yet. It should read like a yacht's bridge console crossed with a Massimo Vignelli annual report.
