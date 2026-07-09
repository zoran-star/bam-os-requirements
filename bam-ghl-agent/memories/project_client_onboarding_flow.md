# Client onboarding flow (V2 portal side page)

**Decision (2026-07-08, Zoran):** academy onboarding lives OUTSIDE the regular V2 pages as its own side page. Owners can leave any time (it never blocks the portal), and the navigation orb (the bottom-left circle, from now on called **navigation**) pops a "Finish your onboarding" entry with a live progress ring.

## Where it lives
All in `bam-portal/public/client-portal.html`, `_obf*` prefix (next to the domains wizard code):
- `_OBF_STEPS` - the step registry (key, title, sub, cta, `go` deep link)
- `_obfFetchState()` - auto-detects completion from LIVE data, never hand-checked:
  - `members` -> `/api/members?scope=client` roster non-empty
  - `email` -> `/api/email/domain-setup` status === 'live'
  - `website` -> `/api/website/domain-setup` status === 'live'
  - `ein` -> `ein_set` boolean added to the email domain-setup status response (rides that call - one fewer roundtrip)
- `_obfOpen()` - the flow page (24px-radius modal overlay, progress ring + step rows, gold check when done, CTA button when not, "Back to home" always visible)
- `_obfPopItem()` / `_obfPopRefresh()` - the navigation pop entry (both pop kinds, settings + info), 15px ring + "· n/N" count; hidden for non-V2 and when complete; refreshes in the background (2 min cache)
- Deep links are command-center aware (`_ccOpenClassic` vs `switchView`); member import goes Blueprint -> `_bbNavigate('member_onboarding')`

## Steps live today (Detail Miami's remaining list)
1. **Import your members** -> Blueprint Member Onboarding card
2. **Connect your email domain** -> Domains wizard
3. **Launch your new website** -> Domains wizard
4. **Send us your EIN** -> Messages (auto-completes when `clients.ein` is set)

## Steps to add (agreed backlog, academy-level vs per-offer split per Zoran)
Academy-level: locations · staff/team invites · branding/assets · Stripe Connect check · contact import · Meta/KPI wiring.
Per-offer (repeat per offer; Training is ONE type): offer wizard done · pricing matched/sellable · entry points · landing page · pipeline tied · automations/agent copy.
Later: Twilio number (GHL until then).

## Gotchas
- The pop only exists in command-center mode (the orb is `cc-mode` only); classic mode has no entry yet - add a sidebar nav item when non-CC academies reach V2.
- Completion is data-derived: a step can UN-complete if the underlying state regresses (that is intentional).
- When adding a step: add the registry row + a detector in `_obfFetchState()`; keep detectors to existing endpoints where possible.

## When to update this note
New steps, detector changes, moving the flow off the modal onto a routed view, or a classic-mode entry point.
