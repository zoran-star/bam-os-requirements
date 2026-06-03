# Full Control — Deck & Collateral Design System

> **How to build slides, decks, one-pagers, and pitch collateral in the Full Control design language.**
> Derived from the [Brand Knowledge Document](fullcontrol-brand.md) and the live app (`prototype/src/styles/theme.css`).
> Goal: every slide should read like it was drawn by the same hand as the product.

**Positioning:** *The Operating System for Elite Sport.* · **Tagline:** Navigate · Command · Lead.

---

## 0 · TL;DR — the one-screen brief

| | |
|---|---|
| **Feeling** | Editorial · premium · disciplined. A yacht's bridge console crossed with a Massimo Vignelli annual report. |
| **Backbone** | Dark ink slides, warm paper for contrast moments. Gold earns its place — one gold moment per slide. |
| **Type** | Space Grotesk (titles + numbers) · Inter (body) · JetBrains Mono (labels/data). |
| **Shape** | Hairline rules, not shadows. Corners `0 / 3 / 4px`. No glossy, no gradients, no emoji. |
| **Data** | Big number in Space Grotesk, mono label beneath, gold delta. Numbers carry the story. |
| **Voice** | Nautical / flight-deck. Verbs over adjectives. "Set course," not "Let's get started!" |

If a slide reads like a generic SaaS pitch (Stripe/Linear/pastel gradients) — it's wrong.

---

## 1 · Color

### Deck core (dark — default slide background)

| Token | Hex | Role on slides |
|---|---|---|
| Ink | `#0A0A0B` | Default slide background |
| Ink 2 | `#131316` | Alt section background, sidebars, footers |
| Ink 3 | `#1C1C21` | Cards, stat tiles, callout boxes |
| Line | `#2A2A31` | **Hairline dividers** — the workhorse separator |
| Line 2 | `#383842` | Stronger rules, table borders |

### Paper (light — contrast / "breathe" slides)

| Token | Hex | Role on slides |
|---|---|---|
| Paper | `#F5F1E8` | Warm off-white slide bg (quote slides, section breaks) |
| Paper 2 | `#EBE4D3` | Secondary paper panels |
| Paper 3 | `#E0D7C1` | Parchment cards, print one-pagers |
| Line light | `#D4C9AD` | Dividers on paper |

> Alternate dark and paper slides to create rhythm. Don't run 20 identical dark slides.

### Gold (the single accent)

| Token | Hex | Role |
|---|---|---|
| **Signal Gold** | `#E8C547` | Primary accent on dark — the one stat, the CTA, the live dot, the active item |
| Champagne | `#C9A55C` | Gradients on avatar/orb placeholders, counterweights |
| Deep Gold | `#8B6F2A` | Gold text **on paper** (passes AA on light bg) |
| Gold highlight | `#F4D788` | Hover/focus lift only |

**Gold discipline:** one gold moment per slide. If three things are gold, two are wrong.

### Pace (status — muted on purpose, used rarely in decks)

| Token | Hex | Role |
|---|---|---|
| Go | `#9FD88A` | Positive / growth |
| Stop | `#E87560` | Risk / problem / churn |
| Flow | `#5A8FB8` | Neutral info, secondary data series |

> **In-app note:** the live product runs a warmer, rounder variant (gold `#C8A84E`, cream `#F8F7F5`, Plus Jakarta Sans, 8–20px radius, soft shadows). Use that only when a slide shows a literal product screenshot. For everything else, the editorial palette above is the deck standard.

---

## 2 · Typography

Load via Google Fonts:

```
Space Grotesk 300/400/500/600/700 · Inter 400/500/600/700 · JetBrains Mono 400/500 · Fraunces 400/500 italic
```

| Role | Family | Use on slides |
|---|---|---|
| **Display** | Space Grotesk 300/500/600 | Slide titles, hero statements, big stat numbers, wordmark. Tracking `-0.02em` to `-0.055em` |
| **Body** | Inter 400/500/600 | Bullet text, captions, paragraph copy, footnotes |
| **Technical** | JetBrains Mono 400/500 | Kickers, labels, page numbers, data tags, status. UPPERCASE + `0.10–0.20em` tracking |
| **Serif** | Fraunces 400/500 italic | Rare. Pull-quotes / testimonial slides only |

### Deck type scale

| Element | Font / size | Notes |
|---|---|---|
| Cover headline | Space Grotesk 300, **80–140px** | tracking `-0.05em`, line-height `0.9` |
| Section divider title | Space Grotesk 500, **56–72px** | tracking `-0.02em` |
| Slide title (H1) | Space Grotesk 500, **40–48px** | one line where possible |
| Sub-head | Space Grotesk 500, **24–28px** | |
| Body / bullets | Inter 400, **18–22px** | line-height `1.5`, max ~3 bullets/slide |
| Stat number | Space Grotesk 500, **64–96px** | gold or paper |
| Kicker / label | JetBrains Mono, **12–14px** | UPPERCASE, `0.18em` tracking, 0.5 opacity |
| Page number / footer | JetBrains Mono, **11px** | `§ 04 / 18` style |

Rule: **titles in Space Grotesk 500, labels in mono uppercase, numbers big.** That alone reads as Full Control.

---

## 3 · Slide grammar

### The section-head pattern (use on most content slides)

```
KICKER (mono, uppercase)        ·  e.g. "§ 02 / THE PROBLEM"
TITLE  (Space Grotesk 500)      ·  e.g. "Academies are flying blind."
META   (mono, right-aligned)    ·  e.g. "Q2 · 2026"
─────────────────────────────────  ← single 1px hairline rule
```

Hairline rule under the head, then content. No boxes, no shadows.

### The 6 slide archetypes

| # | Archetype | Layout |
|---|---|---|
| 1 | **Cover** | Ink bg + soft radial gold haze (8% opacity). Centered wordmark, mono tag, gold pulse line. |
| 2 | **Section divider** | Full ink or paper slab. `§ 0X` kicker + one large title. Nothing else. |
| 3 | **Stat slide** | 1–4 stat tiles on a 1px hairline grid. Big number + mono label + gold delta. |
| 4 | **Content / list** | Section head + ≤3 bullets or a 2-col split. Generous negative space. |
| 5 | **Quote / proof** | Paper bg, Fraunces italic pull-quote, mono attribution. |
| 6 | **Closing / CTA** | Ink bg, single gold CTA line ("Take the helm."), contact in mono. |

### Layout rules

- **One idea per slide.** If it needs a paragraph, it needs two slides.
- **Hairlines, never shadows.** Multi-tile layouts = 1px gap on a `--line` background so the gap becomes the divider.
- **Corners `0 / 3 / 4px`.** Slabs are square; cards/buttons get 3–4px. Nothing rounder.
- **Margins breathe.** ~80px outer padding feel; don't fill edge-to-edge with text.
- **Readout line** somewhere on data slides: `HEADING 347° · COHORT 14→26 · N=247` in mono.

---

## 4 · Components for slides

### Stat tile (the signature)

```
186            ← Space Grotesk 500, big, paper or gold
ACTIVE TODAY   ← JetBrains Mono 10–12px, uppercase, 0.5 opacity
↑ 12 vs last wk ← JetBrains Mono, gold
```
1px border in `--line`, 16–24px padding, square-ish (4px radius), ink bg.

### Buttons / CTAs (on slides, treat as a label)
Solid gold fill, ink text, 3px radius, Space Grotesk 600. Never a pill, never a gradient.

### Live / status dot
Single 6px gold dot, optionally pulsing, beside `LIVE` / `ACTIVE` / a status word in mono caps.

### Charts & data viz
- Background ink, gridlines in `--line` (very low contrast).
- Primary series = **gold**. Secondary = Flow blue `#5A8FB8`. Risk = Stop `#E87560`.
- Labels in mono uppercase. No 3D, no glossy bars, no rainbow palettes.
- Every axis number has a unit.

### Icons & imagery
- Monochrome line icons, 1.25–1.5px stroke. Paper on dark / ink on paper. No multicolor icon packs.
- Photography: high-contrast, desaturated or duotone toward ink+gold. Athletes in motion > stock smiles.
- App screenshots: show the real product (warm in-app theme is fine here), framed by a thin `--line` border.

---

## 5 · Voice & microcopy (slide text)

Nautical / flight-deck. Plain, precise, confident. Strip adjectives, prefer verbs.

| Do say | Don't say |
|---|---|
| Navigate · Command · Holding line · On course · Heading · Drift · Signal | Effortlessly · Seamlessly · Revolutionary · Delightful · Game-changing |

- Kicker: `§ 01 · OVERVIEW` (not "Welcome!")
- CTA: `Take the helm` / `Set course` (not "Get started today")
- Stat caption reads like telemetry, not marketing.
- Symbols: `§` sections · `›` breadcrumbs · `·` separator · `↑↓` deltas · `°` bearings. **No emoji in chrome.**

---

## 6 · Do / Don't

**Do**
- 1px hairlines for every separation.
- Let gold earn its spot — one CTA, one active stat, one live dot per slide.
- Numbers in Space Grotesk 500, labels beneath in mono uppercase.
- Alternate ink and paper slides for rhythm.
- Keep one idea per slide; let it breathe.

**Don't**
- No drop shadows on cards. No gradients (except the splash gold haze / avatar orb).
- No rounded-12+ corners. No SaaS pastel competing with gold.
- No emoji in titles, nav, or buttons.
- No multi-color icon sets. No clip-art, no glossy 3D charts.
- No walls of text — if it reads like a document, it's not a slide.

---

## 7 · Pre-ship checklist (every slide)

- [ ] Background is `--ink` or `--paper`, nothing in between
- [ ] Dividers are solid 1px `--line`, not shadows
- [ ] Title is Space Grotesk 500, `-0.02em`
- [ ] Labels are Mono UPPERCASE `0.12–0.18em`
- [ ] Corners are `0 / 3 / 4px`
- [ ] Gold appears ≤ 1 time as the focal moment
- [ ] Any hero stat has a gold delta/caption beneath it
- [ ] One readout line on data slides (coords / heading / N=)
- [ ] No emoji, no drop shadows, no gradients
- [ ] One idea on the slide — would it survive being split in two?

> If it still reads like Stripe or Linear, it's not there yet.

---

## 8 · Quick reference card (copy/paste tokens)

```
/* Color */
--ink:#0A0A0B  --ink-2:#131316  --ink-3:#1C1C21  --line:#2A2A31  --line-2:#383842
--paper:#F5F1E8  --paper-2:#EBE4D3  --paper-3:#E0D7C1  --line-light:#D4C9AD
--gold:#E8C547  --gold-2:#C9A55C  --gold-3:#8B6F2A  --gold-hi:#F4D788
--go:#9FD88A  --stop:#E87560  --flow:#5A8FB8

/* Type */
--display:"Space Grotesk"  --sans:"Inter"  --mono:"JetBrains Mono"  --serif:"Fraunces"

/* Shape */
radius: 0 / 3 / 4px   ·   dividers: 1px solid   ·   no shadows, no gradients
```

---

*This is the deck/collateral layer of the Full Control system. For in-product UI, defer to [`fullcontrol-brand.md`](fullcontrol-brand.md) §5 and `prototype/src/styles/theme.css`.*
