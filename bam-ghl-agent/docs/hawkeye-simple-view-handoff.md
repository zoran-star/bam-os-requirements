# Hawkeye V2 + Sales Simple View - build handoff

**Status: DESIGN LOCKED 2026-07-08 via clickable mockup (v2, updated same day to the revised action model). Deck/cascade UI not built yet; the action-model backend changes ARE shipped.**
Mockup (open in browser, fully clickable): [`docs/hawkeye-simple-view-mockup.html`](hawkeye-simple-view-mockup.html)
Also hosted: https://claude.ai/code/artifact/7a9a5268-048a-4dda-9750-62d9f69a4150
Mockup v2 shows: kind-aware deck cards (Reply / Book it / Went quiet / Reschedule /
Ready to enroll / Follow-up plan / Suggested lost), per-agent move rows with
Unqualified everywhere, no Skip, reminders-in-config notes, stacked Closing cadence.

## What we're building (one sentence)
Redesign the V2 Sales page into a **simple pipeline strip** (no cards visible) with a
click-to-cascade per-stage view, and turn Hawkeye into a **Tinder-style one-card-at-a-time
focus page** plus a **popup modal** - replacing the 3 per-stage Hawkeye overlay buttons,
the Train Agent picker as a destination, and the scattered config entry points.

## The three surfaces

### 1. Simple view (the Sales tab default)
```
[Ghosted] [Nurture] [Booking] [Confirm] [Closing] [Member]   + gold [Hawkeye · N] button
```
- Strip only. NO cards visible by default. Counts on each pill ("5 need you" red / "18 enrolled").
- **Click a stage** -> that stage's cards CASCADE DOWN below the strip (staggered animation),
  other pills dim. Click again = collapse.
- **The clicked pill morphs**: fills SOLID in its stage colour, text disappears, shows an
  UP ARROW centered (click = collapse the cascade) + a small 3-LINE config icon (sliders)
  pinned TOP-RIGHT of the pill -> click it = that stage's configure page. (Zoran 2026-07-08,
  replaces the earlier gear-only morph.)
- Cascade layout depends on the stage's ENGINE (agent / automation / human - the
  entry-exit-engines model, see [[project_sales_focus_mode]]):
  - **Agent stage** (Booking/Confirm/Closing): cards slide LEFT, each needs-action card gets its
    Hawkeye action attached to its RIGHT (draft preview + Approve and send + Review). Clean cards
    ("agent handling it") are full-width rows below.
  - **Automation stage** (Ghosted/Nurture): enrolled people cascade straight down, single column,
    with per-person step status ("step 2 of 3 - SMS sends tomorrow").
  - **Human stage** (Member): plain cards straight down, "you run this stage - no bot".
- Gold ring/glow on a card = needs you. Click a glowing card = Hawkeye popup modal.
  Click a plain card = existing lead drawer.
- Visual language kept: agent = solid border, automation = DASHED border (guardrails doc).

### 2. Hawkeye focus page (gold button, top of simple view)
**Tinder-style deck. Agents only (Booking / Confirm / Closing) - automations never appear here.**
```
[ Booking 3 ] [ Confirm 2 ] [ Closing 1 ]   <- 3 tabs SPAN the top, gear on active tab
            ONE card at a time
       (next card peeks from behind)
```
- Card = contact header (avatar/name/athlete/stage/time) + entry context + chat thread +
  suggested reply in an EDITABLE textarea + teach-why field + big gold **Approve and send** +
  "Move the lead: Ghosted / Nurture / Unqualified" row + "1 of N" counter.
- **NO SKIP anywhere. Every Hawkeye action must be resolved** (Zoran 2026-07-08). Approve or move.
- **Approve** -> card flies RIGHT, next card slides up (auto-advance through the whole queue).
- **Move** -> card flies LEFT.
- **Mobile: real swipe gestures** - drag rotates the card, release past threshold commits
  (right = approve and send, left = move). Desktop = buttons only.
- Tab badges count down live; empty queue = green "All clear".
- ⚠️ OPEN ITEM: swipe-left has 3 destinations (Ghosted/Nurture/Unqualified) - real build should
  pop the 3 options before committing, not fly away blind. Confirm exact behavior with Zoran.

### 3. Hawkeye popup modal (from the simple view cascade)
Click a glowing card -> centered popup:
- **LEFT: contact info** - avatar, name, athlete, stage, phone, last active, entry context,
  and the move-the-lead buttons (Ghosted / Nurture / Unqualified).
- **RIGHT: the chat** - thread bubbles, gold "suggested reply" bubble, editable draft textarea,
  teach-why input (appears on edit, saved as a lesson), Approve and send + Save as lesson only.
- Approve **auto-advances to the next waiting action** in that stage ("1 of 5" counter) so the
  whole queue can be cleared without closing the popup.

### Configure (the gear, everywhere)
**Already live in prod** - it's focus mode (`_plOpenFocus`/`_plRenderFocus`, shipped 2026-07-06,
PR #1178): Entry points -> Engine -> Exit points per stage. Zoran chose **full page** (not drawer).
The gear on the morphed pill + the gear on the active Hawkeye tab both route there. Nothing new
to build for config itself.

## Decision log
| Date | Decision |
|---|---|
| 2026-07-07 | One mission-control surface replaces the 3 board Hawkeye buttons + Train Agent picker |
| 2026-07-07 | Hawkeye page = agents only; automations reachable from the pipeline only |
| 2026-07-07 | Glowing card click = lead drawer -> superseded 07-08: glowing card = popup modal |
| 2026-07-07 | Configure = full page (the existing focus mode), not a drawer |
| 2026-07-08 | Simple view: strip with NO cards; click stage = cascade below; pill morphs solid + gear |
| 2026-07-08 | Agent stages split (cards left, actions right); automation/human = single column |
| 2026-07-08 | NO Skip - every Hawkeye action gets resolved; approve auto-advances |
| 2026-07-08 | Hawkeye page = Tinder deck: 3 tabs across top, one card at a time, swipe on mobile |
| 2026-07-08 | "Abandon" button renamed "Unqualified" everywhere (SHIPPED in overlays) |
| 2026-07-08 | Booking follow-up nudges RETIRED - quiet lead always = "Send to Ghosted" proposal (tab removed) |
| 2026-07-08 | Confirm reminders are step-CONFIG, never Hawkeye cards (approve templates once, they self-send) |
| 2026-07-08 | Reschedule approve = handoff AND Booking's first rebook action queues (was already wired; now canon) |
| 2026-07-08 | Done Trial has NO automations - post-trial form (trainer note + optional sign-up link + coach notes) is the only preplanned touch; scripted closing sequence + its editor REMOVED |
| 2026-07-08 | Closing deck = stacked cards: 1 Reply (enroll = reply with link embedded in draft) -> 2 Follow-up plan -> 3 Suggested Lost after 3 unanswered follow-ups (agent prompt told: silence alone is never lost) |
| 2026-07-08 | EVERY agent can mark Unqualified: confirm-abandoned action added to agent-confirm + agent-closing (opp abandoned + role unqualified + GHL tag, no nurture); Unqualified button on all Confirm/Closing cards incl. the follow-up plan card |
| 2026-07-08 | Morphed pill = up arrow centered (collapse) + 3-line config icon top-right (was: gear only) |
| 2026-07-08 | Deck card footer = TWO buttons: "Other" (bottom left, cascades UP to every other option) + confirm (bottom right; label flips to "Confirm edits and send/book/..." the moment the user edits anything) |
| 2026-07-08 | Book-it cards expose EDITABLE booking detail fields (day + time, location, group) - the agent's guess, staff can correct before booking |
| 2026-07-08 | Teach-why note is MANDATORY for any change away from the agent's guess (draft, plan message, booking detail) - confirm is blocked until the note is filled. Applies to every Hawkeye surface in the real build |

## Action model per agent (revised 2026-07-08, SHIPPED end to end)
Mobile reference page (design-system styled): `bam-portal/public/hawkeye-actions.html`
(live at portal.byanymeansbusiness.com/hawkeye-actions.html once on main).
- **Booking (Responded)**: Reply / Book it / Went quiet / Suggested Lost. NO follow-up
  nudge cards (tab removed; nothing creates agent_followups rows). Moves: Ghosted,
  Nurture (Lost), Unqualified.
- **Confirm (Scheduled Trial)**: Reply / Reschedule / Suggested Lost. Reminders =
  step config only. Reschedule approve also queues Booking's rebook opener.
  Moves: Rebook (back to Responded), Nurture (Lost).
- **Closing (Done Trial)**: stacked - Reply (enroll = reply with sign-up link in the
  draft) -> Follow-up plan (3 msgs, 1/day) -> Suggested Lost after 3 unanswered.
  NO stage automations; post-trial form = only preplanned touch (trainer first
  message + optional link + coach notes -> contact memory). Moves: Nurture (Lost).

## What already exists (reuse, don't rebuild)
- **Focus mode config page** - `_plOpenFocus`/`_plRenderFocus` in `bam-portal/public/client-portal.html`
- **Sales overview strip + single-stage takeover** - shipped PR #1178 (the simple view evolves this)
- **Hawkeye queues/APIs** - `agent-approvals list-ready`, `agent-confirm`, `agent-closing`
  (`_apx*`/`_acx*`/`_aclx*` overlay code = the data plumbing to reuse; their overlay UI gets replaced)
- **Inline drawer suggestion** on lead cards - STAYS as-is
- **stage_transitions router + engines model** - see [[project_sales_focus_mode]]
- **Design system** - `bam-portal/design-system/DESIGN.md` + `tokens.css` (gold #D4B65C, no emojis,
  radius scale). The mockup already uses the real tokens.

## Suggested build order
1. **Hawkeye deck page** (new view in client-portal.html, V2-gated) reading the 3 agents'
   ready queues; retire the `_apx`/`_acx`/`_aclx` overlay buttons.
2. **Popup modal** (shared component; deck and cascade both use its guts).
3. **Simple view interactions**: pill morph + cascade panels + agent split rows.
4. **Remove Skip** from all Hawkeye surfaces (decide: keep `skip-ready` backend action or kill).
5. Mobile pass IN THE SAME PR (Zoran hard rule: mobile parity same pass) - swipe gestures here.

## Rules that bite
- NO em dashes anywhere person-facing. NO emojis in product UI (SVG icons only).
- V2-gated only (`_plIsV2()`); V1/V1.5 untouched.
- Read `bam-portal/design-system/DESIGN.md` before any front-end work.

---

## Prompt for the next session (paste this)

> We're building the Hawkeye V2 + Sales simple view redesign in the BAM portal.
> Read `bam-ghl-agent/docs/hawkeye-simple-view-handoff.md` first - it has the locked design,
> decision log, and build order. Open `bam-ghl-agent/docs/hawkeye-simple-view-mockup.html`
> in a browser to see the exact interactions (clickable). Also skim
> `bam-ghl-agent/memories/project_hawkeye_mission_control.md` and
> `project_sales_focus_mode.md` for what already exists (focus-mode config page is LIVE -
> do not rebuild it). Work in `bam-ghl-agent/bam-portal/public/client-portal.html`, V2-gated,
> using the design system tokens. Start with build-order step 1 (the Tinder-style Hawkeye
> deck page) unless I say otherwise. Before coding, confirm the one open item with me:
> what swipe-left does on mobile (it has 3 possible destinations).
