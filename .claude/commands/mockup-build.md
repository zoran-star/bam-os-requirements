---
description: Turn an approved HTML mockup into the real front end via an agent team - inspector diffs live vs mockup, designer plans, builder builds, the SAME inspector re-verifies in a loop until it matches
---

Run the mockup-to-build agent team. Use this whenever an approved mockup exists
(usually an HTML file in `bam-ghl-agent/bam-portal/public/mobile-*-mockup.html`)
and the matching live surface does not look like it yet.

## Inputs to collect first (ask if not given)

1. **Mockup file** - the approved HTML mockup path.
2. **Live surface** - which view/page implements it (e.g. `switchView('v15inbox')`
   in `client-portal.html`, a staff React view, a client-site page) and how to
   open it locally (mock mode `?mock=1` when it exists, else logged-in localhost).
3. **Viewport** - default 375x812 (phone). Desktop must stay untouched unless
   the user says otherwise.

## The team (chat is the orchestrator - agents never talk to each other, you relay)

Spawn each with the Agent tool. Give the inspector a **name** so it can be
messaged again later - its retained context IS the verification spec.

### 1. INSPECTOR (named, persistent, read-only)
Opens BOTH the mockup and the live surface in the browser at the target
viewport, screenshots each screen/state (including sheets, FABs, empty states,
dark mode), and produces a NUMBERED list of every difference: layout, spacing,
missing/extra elements, wrong copy, wrong behaviour. Numbered, because later
rounds reference items by number.

### 2. DESIGNER (one-shot)
Takes the inspector's numbered diff and produces an ordered implementation
plan: which diffs to fix, in what order, which are deliberate deviations to
KEEP (data constraints, existing machinery), and any conflicts with
`bam-portal/design-system/DESIGN.md` tokens. Flags anything the mockup got
wrong. Plan only - no code.

### 3. HUMAN GATE
Show the user the plan (AskUserQuestion). Do not build until approved.
The user may skip this gate explicitly.

### 4. BUILDER (worktree isolation)
Implements the approved plan in a fresh worktree. Standing rules:
- Read `bam-portal/design-system/DESIGN.md` first; tokens only.
- V1 surfaces are untouchable (repo hard rule). Gate everything by viewport
  and/or V2/V1.5 access exactly like the surrounding code.
- No em dashes in any person-facing output.
- Run `node bam-portal/scripts/verify-client-portal-ui.mjs` after any
  client-portal.html edit, plus the inline-script syntax check.
- Branch + push + PR. Never merge its own work.

### 5. VERIFY LOOP - SendMessage the SAME inspector
Message the round-1 inspector: builder is done, branch X, re-scan the same
screens against YOUR OWN numbered list. It reports each item pass/fail by
number. Failures go back to the builder (SendMessage, same builder). Loop
until the inspector passes everything or 3 rounds are spent - then surface
what is still failing to the user rather than looping forever.

The tester never built the thing: inspector and builder must stay separate
agents for the whole run.

### 6. SHIP
Final screenshots to the user, then merge on their word (or standing
instruction). Update the relevant memory note in the same pass.

## Known traps to hand the builder (learned 2026-07-31, mobile portal work)

- `.content` inside every focus overlay carries a transform: `position:fixed`
  children resolve against the scrolled card, not the viewport. Dock FABs and
  sheets on the backdrop or outside the overlay.
- `overflow-x:hidden` on body silently kills `position:sticky` everywhere.
- The Zoran orb is force-hidden while some views are open
  (`display:none !important`) - out-important it deliberately, never by accident.
- Verify in `?mock=1` at 375px AND desktop width before calling anything done.
- A `<button>` inside a `<button>` self-closes at parse time and breaks layout.
