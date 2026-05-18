# Client Portal — Design System

Applied 2026-05-17, derived from the FullControl prototype at https://fullcontrol-prototype-six.vercel.app

Goal: bring the same warm, premium, gold-accent feel into `public/client-portal.html` without breaking any of the JavaScript flow logic.

## Brand pillars

1. **Gold is the North Star.** Every interactive or premium surface uses gold. One color does all the "look here" work.
2. **Warm, not stark.** No pure black, no pure white. Backgrounds are warm dark `#0F0E0C` (dark mode) or cream `#F8F7F5` (light mode). Text is warm too — almost-black brown `#1C1B18`, not `#000`.
3. **Rounded but not bubbly.** Cards 16–24px, buttons 12px, modals 24–28px, pills full-round.
4. **Layered surfaces.** Multiple tiers of surface (bg → surf → surf2 → surf3) with subtle shadows give depth.
5. **Snappy motion.** All transitions use `cubic-bezier(0.4, 0, 0.2, 1)` (snappy material-style). Celebrations use spring `cubic-bezier(0.34, 1.56, 0.64, 1)`.

## Color tokens

### Dark mode (default)

| Variable | Value | Used for |
|---|---|---|
| `--bg` | `#0F0E0C` | Page background |
| `--surface` | `#1A1916` | Card surfaces |
| `--surface-el` | `#222120` | Elevated surfaces, inputs |
| `--surface-3` | `#2C2B28` | Hover states, deeper surfaces |
| `--line` | `rgba(255,255,255,0.08)` | Standard borders |
| `--line-md` | `rgba(255,255,255,0.12)` | Stronger borders, focus states |
| `--text` | `#F0EDE8` | Primary text |
| `--text-sub` | `#A5A19A` | Secondary text |
| `--text-mute` | `#6E6B63` | Captions, eyebrows |
| `--gold` | `#D4B65C` | Primary accent |
| `--gold-l` | `#C8A84E` | Gold hover |
| `--gold-d` | `#E0C56A` | Gold highlight |
| `--gold-glow` | `rgba(212,182,92,0.12)` | Soft gold backgrounds |

### Light mode (`html[data-theme="light"]`)

| Variable | Value | Used for |
|---|---|---|
| `--bg` | `#F8F7F5` | Cream page background |
| `--surface` | `#FFFFFF` | White cards |
| `--surface-el` | `#FAFAF8` | Faint elevated |
| `--surface-3` | `#F0EFEC` | Hover states |
| `--line` | `rgba(0,0,0,0.07)` | Standard borders |
| `--line-md` | `rgba(0,0,0,0.12)` | Stronger borders |
| `--text` | `#1C1B18` | Warm near-black text |
| `--text-sub` | `#6E6B63` | Secondary text |
| `--text-mute` | `#A5A19A` | Captions |
| `--gold` | `#C8A84E` | Primary accent (slightly deeper for contrast on white) |
| `--gold-l` | `#D4B65C` | Gold hover |

### Semantic colors *(theme-aware)*

| Variable | Dark | Light | Used for |
|---|---|---|---|
| `--green` | `#4CC76A` | `#3EAF5C` | Success, active states |
| `--amber` | `#F0B84A` | `#E09D24` | Warning, in-progress |
| `--red` | `#F07060` | `#E05A42` | Errors, destructive |
| `--blue` | `#5A8FB8` | `#3B6FA0` | Info, neutral chips |

## Typography

```html
<link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&family=Nunito:wght@700;800;900&family=DM+Mono:wght@400;500&display=swap" rel="stylesheet" />
```

| Variable | Family | Used for |
|---|---|---|
| `--font-sans` | `'Plus Jakarta Sans'` | Body, buttons, inputs, most labels |
| `--font-display` | `'Nunito'` *(700–900)* | Big numbers, KPI values, hero headings |
| `--font-mono` | `'DM Mono'` | Timestamps, codes, ID refs, eyebrows |

### Scale

| Token | Size | Used for |
|---|---|---|
| `--fs-xs` | 11px | Captions, badges |
| `--fs-sm` | 13px | Small text, labels, body small |
| `--fs-md` | 14px | Body |
| `--fs-lg` | 16px | Body large |
| `--fs-xl` | 20px | Subheads |
| `--fs-2xl` | 24px | Section titles |
| `--fs-3xl` | 32px | Page titles |

### Letter spacing

- Body: `-0.01em` (slightly tightened)
- Large display: `-0.02em` to `-0.03em`
- Uppercase eyebrows: `0.12em`
- Nav labels: `0.16em`
- Badges: `0.08em` to `0.1em`

## Spacing scale

`--sp-xs: 4px` · `--sp-sm: 8px` · `--sp-md: 12px` · `--sp-lg: 16px` · `--sp-xl: 24px` · `--sp-2xl: 32px` · `--sp-3xl: 48px`

## Border radius

| Variable | Value | Used for |
|---|---|---|
| `--radius-sm` | 8px | Small buttons, tags |
| `--radius` | 12px | Standard buttons, inputs |
| `--radius-md` | 16px | Cards, modals |
| `--radius-lg` | 20px | Large cards, login card |
| `--radius-xl` | 24px | Big surfaces |
| `--radius-2xl` | 28px | Modals |
| `--radius-full` | 9999px | Pills, avatars |

## Shadows

| Variable | Value | Used for |
|---|---|---|
| `--shadow-sm` | `0 1px 3px rgba(0,0,0,0.20), 0 1px 2px rgba(0,0,0,0.15)` *(dark)* | Cards, inputs |
| `--shadow-md` | `0 4px 14px rgba(0,0,0,0.25), 0 2px 6px rgba(0,0,0,0.15)` | Hover, modals |
| `--shadow-lg` | `0 8px 28px rgba(0,0,0,0.35), 0 4px 12px rgba(0,0,0,0.20)` | Floating, drawers |
| `--shadow-gold` | `0 4px 18px rgba(212,182,92,0.18), 0 2px 8px rgba(212,182,92,0.10)` | Gold accent surfaces |

*(Light mode uses much subtler shadows — see CSS for exact values.)*

## Easing

| Variable | Value | Used for |
|---|---|---|
| `--es` | `cubic-bezier(0.4, 0, 0.2, 1)` | All standard transitions |
| `--espring` | `cubic-bezier(0.34, 1.56, 0.64, 1)` | Celebrations, milestones |

## Component patterns

### Card

```css
background: var(--surface);
border: 1px solid var(--line);
border-radius: var(--radius-lg);  /* 20px */
padding: 20px;
box-shadow: var(--shadow-sm);
transition: all 200ms var(--es);
```
Hover: `box-shadow: var(--shadow-md); transform: translateY(-2px);`

### Primary button (gold CTA)

```css
background: var(--gold);
color: #fff;
border: none;
border-radius: var(--radius);  /* 12px */
padding: 10px 22px;
font-weight: 700;
transition: all 180ms var(--es);
```
Hover: `background: var(--gold-l); transform: translateY(-1px); box-shadow: var(--shadow-md);`

### Input

```css
font-family: var(--font-sans);
font-size: 13px;
font-weight: 500;
color: var(--text);
background: var(--surface-el);
border: 1px solid var(--line);
border-radius: var(--radius);  /* 12px */
padding: 10px 16px;
transition: all 200ms var(--es);
```
Focus: `border-color: var(--gold); box-shadow: 0 0 0 3px var(--gold-glow);`

### Modal

```css
background: var(--surface);
border-radius: var(--radius-2xl);  /* 28px */
padding: 28px;
max-width: 640px;
box-shadow: var(--shadow-lg);
animation: pickerIn 0.3s var(--es);
```

### Nav item *(active)*

```css
background: var(--gold-glow);
color: var(--gold);
border-radius: var(--radius-sm);

/* Left accent bar */
&::before {
  content: "";
  width: 3px;
  height: 60%;
  background: var(--gold);
  border-radius: 0 3px 3px 0;
  position: absolute;
  left: 0;
}
```

### Pill / badge

```css
background: var(--surface-el);
border: 1px solid var(--line);
border-radius: var(--radius-full);
padding: 4px 12px;
font-size: 11px;
font-weight: 600;
letter-spacing: 0.08em;
text-transform: uppercase;
color: var(--text-sub);
```

## Distinctive signatures *(what makes it feel "FullControl")*

1. **Gold accent on left of selected items.** 3px rounded vertical bar.
2. **Nunito on big numbers.** KPI values, milestones — 800/900 weight, slightly negative letter-spacing.
3. **DM Mono for technical bits.** Timestamps, IDs, codes — modest doses.
4. **Layered cream/warm surfaces.** Never pure black, never pure white.
5. **Subtle shadow at rest, lifted shadow on hover.** Cards float up 2px on hover.
6. **Cubic-bezier snappy easing.** Not Material-style "linear ease," not bouncy by default. The bounce easing is reserved for celebrations.
7. **Uppercase letter-spaced eyebrows.** Tiny `--text-mute` labels above sections.
8. **Gold glow rings on focus.** `box-shadow: 0 0 0 3px var(--gold-glow)` instead of solid blue browser default.

## Things that didn't get copied across

The prototype has these patterns that we deliberately did NOT bring to the client portal *(out of scope for the visual refresh)*:

- Sage AI orb (40px+ gold gradient circle with pulsing animation)
- Typewriter cursor animations
- Kanban-style "Today" gradient cards
- KPI flip cards
- Staggered card-cascade entry animations

These can come later if any feature on the client portal needs them.
