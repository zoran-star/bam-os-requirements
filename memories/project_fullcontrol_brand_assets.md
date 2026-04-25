---
name: Full Control Brand Assets
description: Where the Full Control logo/brand system lives and the 4 size-tiered mark variants
type: project
originSessionId: f32a92c5-2a99-4706-b1e6-39ea58b68f93
---
## Canonical brand guide
Two sources, aligned:
- **Markdown spec:** `/Users/zoransavic/bam-ghl-agent/docs/fullcontrol-brand.md` — tokens, type, layout, radii, usage rules
- **Shareable HTML (visual):** `/Users/zoransavic/Downloads/Full Control Brand - Shareable.html` — Claude artifact, 868KB bundled React. Contains actual logo SVG generators inside the JS bundle.

## Logo system — compass/star with F-letterform needle
Four size-tiered variants, gold `#E8C547` on ink `#0A0A0B`:

| Variant | Size | Notes |
|---|---|---|
| **Primary** | ≥ 64px | Full 72-tick degree ring, F-shaped gold needle north, dim south counterweight, E/W crossbars |
| **Simplified** | 24–64px | Clean circle (no ticks), same F needle, slim E/W bars |
| **Monogram** | 16–48px (favicon) | Solid gold disc, **inverted** — black F needle + black south counter on gold |
| **Single-color** | Emboss / Foil / Etch | Outline-only for physical production |

## SVG generators (inside the shareable HTML bundle)
The bundle defines `MARKS.primary`, `MARKS.primarySimple`, `MARKS.monogram`, `MARKS.appIcon` — each returns SVG string. To extract for use in `client-portal.html`:
1. Read the bundle, grep for `MARKS\.(primary|primarySimple|monogram|appIcon) = \(opts\) =>`
2. Extract and save as static SVG files under `/Users/zoransavic/bam-ghl-agent/assets/`
3. Reference from `client-portal.html` sidebar (Simplified fits the ~40px sidebar logo slot; Monogram for favicon)

Do this when UI polish phase starts — not during functional form work.
