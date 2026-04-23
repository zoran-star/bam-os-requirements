# Client Portal — User Flow

Single-page app (`client-portal.html`). All views live in one file — no iframes.

## Systems Page (default view)
Sidebar on left with nav. Main area shows:
- **Open a new request** — 3 tiles:
  - Fix something broken
  - Adjust something existing
  - Build something new
- **Track what's in flight** — Live Tickets / Approved tabs with ticket list

---

## Tile 1: Fix something broken → Error Form
Fields:
- Where is the error happening? (textarea + file + voice)
- How should it work instead? (textarea + voice)
- Is this blocking your business right now? (urgent toggle)

Submit → Confirmation.

---

## Tile 2: Adjust something existing → Change Form
Fields:
- What do you want to change? (textarea + file + voice)
- How should it look or read instead? (textarea + voice)

Submit → Confirmation.

---

## Tile 3: Build something new → Menu Selector
Pick exactly one of 10 items:
1. Branding
2. Gym Rental
3. Player Intake
4. New Hire
5. Youth Academy
6. Internal Tournament
7. Sponsor Inquiry
8. Camps/Clinics
9. Upsells
10. I want to build something else

Submit →

### If menu item 1–9 selected
Next page asks questions specific to that menu item (questions live in Supabase — TBD).

Submit → Confirmation.

### If "I want to build something else" selected
Next page asks them to describe what they want to build (textarea + file + voice).

Submit → Confirmation.

---

## Back navigation
From any form → ← Back returns to Systems page (tiles + track list).
From menu-item form → ← Back returns to Menu Selector.

---

## Theme
Light and dark modes, toggled from sidebar. All views must support both.

## Branding
Follows `docs/fullcontrol-brand.md` — Full Control dark-first: `#0A0A0B` ink, `#E8C547` signal gold, Space Grotesk + Inter + JetBrains Mono, corners `0/3/4px`, hairline 1px dividers, no shadows, no gradients. Light mode via `html[data-theme="light"]` (paper `#F5F1E8`, gold becomes `#8B6F2A`).
