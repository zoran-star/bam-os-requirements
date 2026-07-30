# Design systems map

Decided 2026-07-12 (Zoran): the repo has exactly **two** canonical design systems. Everything else is a copy of one of them or a standalone tool's styles. Never point an agent at anything else as "the design system."

| System | Canonical file | Governs | Tokens |
|---|---|---|---|
| **V2 (LIVE PRODUCT)** | `bam-ghl-agent/bam-portal/design-system/tokens.css` (+ `DESIGN.md`) | Live staff + client portals. **BAM GTA runs on V2.** | gold `#D4B65C`, Plus Jakarta Sans + Nunito + DM Mono, dark-first |
| **Prototype (REFERENCE)** | `prototype/src/styles/theme.css` | FullControl reference prototype (spec/mockups, not shipped) | gold `#C8A84E`, Plus Jakarta Sans + DM Mono |

**NOT design systems (prototype-lineage copies / tool styles, never treat as canonical):**
- `prototype/bam-gta-phase1/bam-gta-staff/src/styles/theme.css`
- `prototype/bam-gta-phase1/bam-gta-parent/src/styles/theme.css` (minimal subset)
- `bam-ghl-agent/bam-gta-staff/src/styles/theme.css` (intentional own branding, see `bam-ghl-agent/CLAUDE.md` scope exceptions)
- `market-research/src/index.css` (standalone tool)

**No design system for V1 or V1.5**, deliberate (Zoran's call).

Every design-system CSS file carries a header comment stating which row it is. The full map also lives in repo-root `CLAUDE.md` under "Design systems". If a system is added, moved, or retired, update that table + the file headers in the same commit.

Watch-out: the two GTA-staff copies (`prototype/bam-gta-phase1/...` vs `bam-ghl-agent/bam-gta-staff/...`) have identical themes but diverged app code; the `bam-ghl-agent` one gets the recent work. Neither is deployed (no vercel.json); both are reference apps.

## Staff-side legibility bump (2026-07-28, Cam)
Muted text failed WCAG in BOTH staff token systems: JS `bam-ghl-agent/
bam-portal/src/tokens/tokens.js` T.dark.textMute #48484A (2.1:1) /
T.light.textMute #AEAEB2 (2.2:1), and V2 `design-system/tokens.css`
--text-mute light #A5A19A (2.6:1). All bumped to ~4.2:1 equivalents
(#74747A / #7C7C80 / #7C786F / #807C74). DELIBERATELY NOT mirrored to
client-portal.html's :root - Cam scoped this to the internal tool;
DESIGN.md carries the do-not-remirror warning. Open for Zoran: light-mode
gold-as-TEXT on V2 surfaces (2.3:1) - a --gold-text variant would fix it
without touching gold fills.
