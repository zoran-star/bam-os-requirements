---
name: Client Portal First-Login Tour
description: 8-step guided spotlight tour that fires on first login to teach new clients how to use the portal. Shipped 2026-05-18.
type: project
---

8-step product tour shipped to `bam-portal/public/client-portal.html`. Fires automatically the first time a client logs in (when `clients.onboarding_completed_at IS NULL`). Skippable + restartable via "Take the tour" sidebar link.

## Why this exists
New clients used to land directly in the Systems tickets view with zero orientation. Tour teaches them what the portal IS without asking for any data (no intake fields). Zoran explicitly scoped against data collection: "i just want clients to learn about whats currently on the client portal."

## The 8 steps
1. **Welcome** (centered modal). Personalized with owner first name.
2. **Systems ticket types** (spotlight on `.ticket-types`). Explains Error/Change/Build.
3. **Live tickets + Action Needed example** (spotlight on `#ticket-list-live`). Demo "⏳ Action Needed" row is injected so the example is visible even with zero real tickets.
4. **Switch to Marketing** (spotlight on `.nav-item[onclick*="marketing"]`, view stays on Systems). Transition step that points at the sidebar nav before flipping the view.
5. **+ Add New Campaign** (spotlight on `.btn-add-campaign`).
6. **Change Campaign** (spotlight on `.btn-change-campaign`, tooltip placed left). Demo campaign card injected if no real campaign exists.
7. **Pending requests + Action Needed example** (spotlight on `#marketing-request-list-pending`). Demo action-required marketing request injected.
8. **Done** (centered modal).

Modal steps (1 + 8) are centered cards with a `.tour-vis` bullet list. Spotlight steps (2-7) use a floating `.tour-tooltip` with arrow, anchored to the target.

## Technical design

### Spotlight technique
The pulse ring (`.tour-pulse-ring`) has a layered `box-shadow`:
```
0 0 0 3px gold (the ring itself)
0 0 0 8px rgba(gold, 0.22) (gold halo)
0 0 0 9999px rgba(black, 0.55) (page-wide dim outside the ring)
```
The 9999px outer shadow is what creates the dim. Since box-shadow only paints OUTSIDE the element's border, the target inside the ring stays sharp and undimmed. No SVG mask, no backdrop-filter, no overlay div. The tour-overlay itself is `background: transparent` in spotlight mode and just intercepts clicks.

### Tooltip auto-positioning
`_positionSpotlight(step)` reads target `getBoundingClientRect()` and positions the tooltip on `top` / `bottom` / `left` / `right`. Auto-flips if it would clip the viewport (e.g., `top` flips to `bottom` if there's no room above). Clamps to viewport edges with 12px padding. Reposition fires on resize + scroll.

### Demo data injection
`TOUR_DEMO_CONTAINERS` config lists 3 containers (`#ticket-list-live`, `#marketing-request-list-pending`, `#marketing-campaigns-container`). On tour start, each container's `innerHTML` is stashed in `dataset.tourOriginal` and replaced with the demo. On tour close, originals are restored. The campaign demo only injects if no `.campaign-card` is already present (`onlyIfMissing` config). Demo elements carry `class="tour-demo"` for inspector clarity.

### Persistence
Skip or "Got it" calls `POST /api/clients?action=complete-onboarding` (added this session). Auth via Bearer token, scoped to the caller's own `auth_user_id`. The endpoint sets `clients.onboarding_completed_at = now()`. If the call fails (no token / network), the tour just shows again next login. Cheap idempotent retry.

### Preview mode
`?preview=tour` URL param fires the tour without login. Hides the login-overlay. `_markOnboardingComplete()` no-ops when no Bearer token, so preview doesn't write to any DB row.

## Key files
- `bam-portal/public/client-portal.html` — all tour code (CSS, HTML, JS, sidebar link, boot trigger). ~340 lines added.
- `bam-portal/api/clients.js` — `?action=complete-onboarding` POST handler (~40 lines added).

## Existing clients
Zoran chose "let them see it too" (vs marking existing clients done now). DETAIL Miami etc. will see the tour on their next login.

## Constraints learned
- Zoran rule: **never em dashes** anywhere. Audited every line of tour code (CSS, JS, HTML, comments) to be em-dash-free. Pre-existing em dashes in the rest of `client-portal.html` (118 of them) were left alone, flagged as separate work.
- Zoran rule: **short + visual**. Each tooltip body is one sentence + at most one supporting sentence. Welcome modal body is 4 words plus 2-bullet visual.
- Zoran rule: **don't blur focused content**. First spotlight build used `backdrop-filter: blur(2px)` which blurred the highlighted target too. Replaced with the box-shadow ring approach that keeps the target sharp.

## Related notes
- [[project_client_auth]] — how clients are authed (auth_user_id linkage powers the `complete-onboarding` boundary)
- [[project_session_2026_05_17_polish]] — design system that the tour reuses (intake-screen tokens, gold accent, mono caps eyebrow)
