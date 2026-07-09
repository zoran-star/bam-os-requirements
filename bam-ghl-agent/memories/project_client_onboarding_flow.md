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

## Grouped structure (2026-07-09, Zoran: separate general from the training offer)
Steps carry a `group`; `_OBF_GROUPS` renders them in sections with a per-group n/N:
- **Academy setup (general)**: business tax ID, email domain, website domain
- **Training offer**: member import (lives under the offer - it maps the roster onto the offer's plans; reuses the Member Onboarding card UI)
As more offer types come online each gets its own group; general steps stay shared. Detectors unchanged (live-data), still deep-link to the real UIs.

## Steps live today
1. **Add your business tax ID** (general) -> Blueprint General. Auto-completes when `clients.ein` is set. **Skippable** (`skippable:true`): Canadian businesses without an EIN/BN click "Not applicable - skip for now" (localStorage `bam_obf_skip_<clientId>`, cleared automatically once a real EIN lands) so the flow can still reach 100%.
2. **Connect your email domain** (general) -> Domains wizard
3. **Launch your new website** (general) -> Domains wizard. Detector also recognizes **pre-wizard hand-wired sites** (GTA): when `website_setup` is empty it probes `clients.allowed_domains` against the sites Vercel project.
4. **Import your members** (training offer) -> Blueprint Member Onboarding card

## Custom values tied end to end (offer.js, 2026-07-09)
The offer wizard writes lead/member custom questions to `custom_field_defs` (offer_id + `section` = sales|onboarding; academy-core defs have offer_id null). `api/website/offer.js` now reads them and returns:
- `intake_fields` = training defaults + legacy `offer.data.onboarding.intake_form_fields` + academy-core + **onboarding** defs (the join/enroll form - enroll.jsx already renders `intake_fields`, so member custom fields flow live; CORE_SKIP dedupes the contact basics)
- `lead_fields` = academy-core + **sales** defs (the lead-capture form; generated/future sites consume it - Detail's hardcoded miami-lead form does not yet)
`cfDefToField`/`cfDefType` map the owner's chosen type to the funnel vocab (text/email/tel/date/select/textarea). leads.js persists submitted values via `writePortalFieldValues` keyed by `custom_field_defs`.

## Steps to add (agreed backlog, academy-level vs per-offer split per Zoran)
Academy-level: locations · staff/team invites · branding/assets · Stripe Connect check · contact import · Meta/KPI wiring.
Per-offer (repeat per offer; Training is ONE type): offer wizard done · pricing matched/sellable · entry points · landing page · pipeline tied · automations/agent copy.
Later: Twilio number (GHL until then).

## Navigation cascade (2026-07-08, same day)
Zoran: the navigation orb's CASCADE (the fan that springs up from the circle) is the home for these entries, not floating buttons:
- **Academy switcher moved into the cascade** (`#cc-fan-acct`, layers icon + count badge). The old standalone `#cc-acct-btn` circle above the orb is GONE; `#cc-acct` now only anchors the pop list. Still Zoran/Mike-only + multi-academy-only (`_ccAcctSync` drives the fan button).
- **Onboarding circle in the cascade** (`#cc-fan-obf`): the progress ring IS the icon, label shows "Finish onboarding · n/N", hides when complete or non-V2 (`_obfFanSync`, called from `_obfFetchState` + dock build).
- Fan cascade delays extended to 5 children; `.cc-fan-count` badge style added.
- Gotcha: the acct pop's click-outside closer must ignore `#cc-fan-acct` or the fan click instantly re-closes it.

## Gotchas
- The pop only exists in command-center mode (the orb is `cc-mode` only); classic mode has no entry yet - add a sidebar nav item when non-CC academies reach V2.
- Completion is data-derived: a step can UN-complete if the underlying state regresses (that is intentional).
- When adding a step: add the registry row + a detector in `_obfFetchState()`; keep detectors to existing endpoints where possible.

## When to update this note
New steps, detector changes, moving the flow off the modal onto a routed view, or a classic-mode entry point.
