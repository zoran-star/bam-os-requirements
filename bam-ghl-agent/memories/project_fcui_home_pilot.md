# FCUI Home Pilot - prototype look on the live V2 owner Home (2026-07-31)

The client portal V2 owner Home rebuilt to match the FullControl prototype's light
command-center design, behind a preview flag. Built by a mockup-build agent team
(inspector 48-point diff -> designer plan -> Cole-approved -> builder -> 2 verify
rounds, final 48/48 pass or ruled N-A). Cole approved plan + design rulings.

## The flag

`_fcuiOn()` in `bam-portal/public/client-portal.html`: ON when URL has `?fcui=1`,
localStorage `fcui`='1', or mock mode (`?mock=1`). `?fcui=0` forces OFF even in mock.
Flag OFF = the shipped command-center home, byte-identical. V1/V1.5 untouched.
Mobile untouched (keeps the cc mobile flow + bottom tab bar).

## What the flag turns on (desktop)

Fixed 240px sidebar (MAIN nav wired to real switchView, PREVIEW Member App item,
Messages preview + unread badge, user footer) · compact greeting header (date,
search + ⌘K, location filter, stat chips) · hero row ("Best thing" card + "#1
priority" card whose CTA opens the Hawkeye deck) · AI task bar wired to the real
member agent · Action Items | Today's Schedule · Monthly Progress radials
(reuses scoreboard rings, Customize opens the KPI picker) · Milestones & Streaks ·
activity feed + weekly challenge · messages right-drawer over v15 inbox data
(channel filter chips, LEAD/MEMBER tags, sort, mark-all-read) · MRR-style toasts.
Retired under the flag: scroll-snap sections, dot rail, giant greeting, texture,
right rail, shortcut cards, quick links, "+" FAB. Kept: banners (compact, under
header), support orb, SUPPORT attention card, Hawkeye activity in the feed.

## Approved design rulings (Cole 2026-07-31)

Nunito stays for card titles/stat values (tokens win over mockup font) · giant
greeting retired · flat cream background (no graph-paper texture) · NO purple -
mockup purple maps to blue/gold · gold uppercase eyebrows ONLY on the two hero
cards · no emojis (stroke SVGs) · no em dashes (mockup copy restructured).

## Mock demo seed

`__MOCK_FCUI__` block + mockApi routes seed a rich demo academy (4 classes with
fills, 4 action items, radials, $8.2k MRR / 42 members chips, milestones, streaks,
activity, 5 unread messages). Demo: `localhost:5174/client-portal.html?mock=1`.

## Builder traps confirmed real (for the next pages)

Calendar overlay is a modal-backdrop, not a .view - its Back skips switchView, so
the sidebar highlight derives from a MutationObserver on view classes + #view-calendar.
Right-rail loaders write by ID (#hm-score-grid etc.) - mounts kept/guarded. Reveal
observers root on .main (.hm-bubble starts opacity:0). Messages panel DOM has three
hidden selects - automated checks must target `.fcui-msgp-sortw`.

## Rollout state - DIRECTION DECIDED 2026-08-01

**Cole + Zoran both prefer the V2 command center (full-bleed scroll) as the
product's face.** The prototype's sidebar look is retired as a direction; this
pilot stays PARKED behind its flag (merged, harmless, flag off everywhere).
Do NOT extend it to more pages. Its best pieces (progress radials, messages
drawer with sort/mark-all-read, milestones card) may be folded into the V2
command center later as individual features.

Gotcha: mock mode (`?mock=1`) AUTO-ONS the fcui flag, so demos/screenshots of
the real product need `&fcui=0`. If the pilot stays parked long-term, flip the
mock default to off (one-line change in `_fcuiOn()`).

Screenshots: scratchpad/home-pilot/ (round1/2/3, build).
