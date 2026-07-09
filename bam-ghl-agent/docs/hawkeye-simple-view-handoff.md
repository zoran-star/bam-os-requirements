# Hawkeye V2 + Sales Simple View - build handoff

**Status: BUILT 2026-07-08 (steps 1 + 3). The DECK (`_hk2*`, `_PL_SV='hawkeye'`, `#pl-hawkeye`) and the SIMPLE VIEW (`_plRenderOverview` rewritten: colour pills + cascade highlights + pill morph + gold Hawkeye button, `_plo2*`) are in client-portal.html, V2-gated; `_PL_NEEDS` now spans all 3 agents on V2. V1.5 untouched (legacy overlays + booking-only needs). No skip anywhere on V2 (step 4: `skip-ready` backend kept for V1.5). Swipe gestures = the one open item (buttons only; layouts are mobile-ready). Remaining: GTA prod verification + swipe decision.**
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
  - **Agent stage** (Booking/Confirm/Closing): single-column lead rows, NO actions on this
    page (Zoran 2026-07-08, supersedes the split cards-left/actions-right layout). Gold ring =
    needs Hawkeye, with a short status line ("reply - draft ready", "picked Sat 10am").
    Clicking a glowing lead OPENS THE HAWKEYE PAGE with that lead's card on top.
  - **Automation stage** (Ghosted/Nurture): enrolled people cascade straight down, single column,
    with per-person step status ("step 2 of 3 - SMS sends tomorrow").
  - **Human stage** (Member): plain cards straight down, "you run this stage - no bot".
- Gold ring/glow on a card = needs you. Click a glowing card = the Hawkeye page opens on
  that lead's card (the popup modal is RETIRED for now). Click a plain card = existing lead drawer.
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

### 3. Hawkeye popup modal - RETIRED (Zoran 2026-07-08, later same day)
The simple view carries no Hawkeye actions at all: a glowing cascade card now routes into
the Hawkeye PAGE on that lead's card instead of opening a popup. The deck is the single
Hawkeye surface. (Original popup spec kept below for reference only.)
Click a glowing card -> centered popup:
- **LEFT: contact info** - avatar, name, athlete, stage, phone, last active, entry context,
  and the move-the-lead buttons (Ghosted / Nurture / Unqualified).
- **RIGHT: the chat** - thread bubbles, gold "suggested reply" bubble, editable draft textarea,
  teach-why input (appears on edit, saved as a lesson), Approve and send + Save as lesson only.
- Approve **auto-advances to the next waiting action** in that stage ("1 of 5" counter) so the
  whole queue can be cleared without closing the popup.

### Configure (the 3-line icon + tab gear, everywhere) - PER STAGE
**Already live in prod** - it's focus mode (`_plOpenFocus`/`_plRenderFocus`, shipped 2026-07-06,
PR #1178): Entry points -> Engine -> Exit points per stage. Zoran chose **full page** (not drawer).
The 3-line icon on the morphed pill + the gear on the active Hawkeye tab route to THAT stage's
config - including the AUTOMATION stages (Zoran 2026-07-08): Ghosted shows its day 1/3/7
sequence (copy editable per step) + exit strategy (reply -> Booking, silent -> Nurture); Nurture
shows its week 1/3/5/8 sequence + reply -> Booking. Confirm's config carries the reminder
templates; Closing's config has NO automations section; Member = human, no config. Nothing new
to build for the page itself - just per-stage routing.

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
| 2026-07-08 | Book-it cards = PICKERS, not free text: a Calendar select limited to the calendars tied to the lead's OFFER + a Slot select (that calendar's open slots, with spots-left counts). Switching either = an edit (mandatory note) |
| 2026-07-08 | The popup modal shares the deck card's kind-aware guts: Book-it popup shows the same Calendar + Slot pickers, ghost/plan kinds swap the reply box, and the same edited-label + mandatory-note rule applies |
| 2026-07-08 | LATER SAME DAY: simple view = highlights only. Cascade shows plain lead rows (gold ring + status); clicking a glowing lead opens the Hawkeye PAGE on that card. Popup modal RETIRED - the deck is the only Hawkeye surface |
| 2026-07-08 | Configure is PER STAGE, automations included: every 3-line icon / tab gear opens that stage's own focus-mode page (Ghosted + Nurture show their editable step sequences; Member = human, no config) |
| 2026-07-08 | Scheduled Trial has TWO engines: the Confirm AGENT + the POST-TRIAL FORM (coach fills it; it routes the lead). The form lives in the stage's engine config for now; making it configurable comes later |
| 2026-07-08 | BUILT: the deck (step 1) in client-portal.html - _hk2* module, kind-aware cards, Other + morphing confirm, mandatory teach-why, calendar/slot pickers via new agent-approvals book-options action, plan grouping, deep-link from board badges, tab gear -> focus mode. Digest SMS retired || 2026-07-08 | BUILT: the simple view (step 3) - _plRenderOverview rewritten to colour-coded pills (agent solid / automation dashed, N need you), click = in-place cascade of highlight rows (needy first, gold ring, deep-links into the deck; plain rows open the drawer), pill morph (up arrow + 3-line -> focus mode), gold Hawkeye button with the cross-agent count. _PL_NEEDS merged across all 3 agents on V2. Board still reachable via Expand board |

| 2026-07-08 | Teach-why note is MANDATORY for any change away from the agent's guess (draft, plan message, booking detail) - confirm is blocked until the note is filled. Applies to every Hawkeye surface in the real build |
| 2026-07-09 | HOME = the pill strip too: the command-center home Sales section renders the simple-view pills in place of the old stage cards (shared _plo2Pills/_plo2Cascade; home keeps its own open state _CC2_OPEN). Cascade opens in place on home; config / glowing lead / drawer / +N more leave cc-mode into the classic Sales view first (_ccPipeFocus/_cc2Lead/_cc2Card/_ccPipeStage) |
| 2026-07-09 | Pill ORDER locked everywhere (_plo2Order): Nurture, Ghosted, Booking, Confirm, Closing. NO Member pill - terminal stages never render in the strip (home + Sales overview) |
| 2026-07-09 | ~~Strip restyled to the design system (3px top bar, soft tint active)~~ REVERTED same day - Zoran wanted the original pill look back. SUPERSEDED later same day by the full redesign below |
| 2026-07-09 | PILL REDESIGN (Zoran): stage name TOP-LEFT; engine wording under it ("Nurture automation" / "Closing agent"); total cards under that; Hawkeye "N need you" badge centered on the RIGHT. GOLD is the only colour (per-stage palette killed); dashed border still = automation. Chevron arrows between pills show the left-to-right flow. Open pill = gold fill + up arrow + config icon |
| 2026-07-09 | Automation cascade rows = name + "enrolled · step N of M", NEWEST entries into the automation on top (new automations.js action `active-enrollments` -> _PL_ENR map) |
| 2026-07-09 | Deck is TINDER now: acting on a card advances to the next card immediately (tab badges update instantly; empty queue auto-jumps to the next agent with cards). The API work still rides the 6s undo - undo puts the card back on top. Inputs are captured at click time |
| 2026-07-09 | Deck thread messages no longer cut off (thread_tail cap 320 -> 2000 chars in all 3 agent APIs; thread max-height raised). Config gear now on EVERY agent tab (right side), not just the active one |
| 2026-07-09 | Back from Hawkeye = the HOME page's Sales section with all cascades closed (_hk2Back), not the standalone Sales page |
| 2026-07-09 | Home Sales section: "Open sales board" button REMOVED; Recent movement restyled lowkey (muted, smaller, no gold arrow) |
| 2026-07-09 | BUG FIX: back from a classic view left home blurry - the scroll-linked recede effect (inline blur/opacity on .cc-sec) freezes while view-cc is hidden. _ccReturn now clears frozen recede styles and re-fires the scroll recompute |

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

## Pre-build lead-flow gap analysis (2026-07-08, code-verified)

Verified WIRED end to end: intro automations own first touch (no reply -> auto-roll to
Ghosted); reply -> Booking reactive drafts (webhook cancels stale drafts on every new
inbound); Approve & book -> portal RPC or GHL appt (confirm-book already accepts
calendar_id + slot_at overrides for the deck pickers) -> Scheduled Trial; reminders from
config; reschedule -> rebook chain; post-trial form 3-way router + escalation cron;
closing opener (A6) -> follow-up plan -> lost after 3; enroll link tracking params read
by stripe/webhook.js + isLiveMember auto-won safety net; Ghosted/Nurture are portal
automations (editable steps) with ran-out -> Nurture; reply from Ghosted/Nurture ->
webhook exits enrollment + moves to Responded + SMS-notifies the owner.

GAPS to close or decide:
| # | Sev | Gap | Suggested fix |
|---|---|---|---|
| G1 | HIGH | The daily digest SMS (agent-approvals cron-digest) counts ONLY the Booking queue; Confirm + Closing cards land silently. With no-skip + the deck replacing the 3 buttons, unseen cards rot | Make the digest sum all 3 ready queues; consider push notification when a card lands |
| G2 | DECIDE | Serial no-show loop: no-show -> rebook -> books -> no-show... has NO cap; a chronic no-show cycles forever | e.g. 2nd no-show -> suggest Lost or Unqualified card |
| G3 | DECIDE | Unqualified is a true dead end: if that person texts back later there is no pipeline re-entry and no flag that they were unqualified | Decide: stay dead, or surface "unqualified lead replied" to a human |
| G4 | DECIDE | Nurture ends silently at week 8: dormant leads are never resurfaced (no list, no seasonal re-run) | A "dormant" view or periodic re-enroll is a later feature; confirm intentional |
| G5 | LOW | The Booking "re-engaged" scripted opener never fires (no caller writes that entry note; the reactive reply engine answers instead). Config advertises 3 openers, one is dead | Drop it from the config UI or wire it as a fallback |
| G6 | BUILD | Deck Book-it pickers need a data source: "calendars tied to the lead's offer + that calendar's open slots". Machinery exists (agent/booking.js availability + calendarForGroup) but no staff-facing list action | Add a small `book-options` action to agent-approvals |
| G7 | BUILD | Unqualified on a card with no open opp returns 200 + {error} and the UI still toasts success (pre-existing pattern) | Check resp.error in the _hawkDefer runs during the deck build |
| G8 | VERIFY | Not prod-verified on GTA: closing scripted retirement, follow-up loop for form-opened leads, no-show rebook chain (Phase B-E), booking followups tab removal | Verify batch on GTA before/with the deck build |

## Suggested build order
1. **Hawkeye deck page** (new view in client-portal.html, V2-gated) reading the 3 agents'
   ready queues; retire the `_apx`/`_acx`/`_aclx` overlay buttons.
2. ~~Popup modal~~ RETIRED 2026-07-08 - glowing cascade cards deep-link into the deck instead.
3. **Simple view interactions**: pill morph + cascade panels (highlight rows + deck deep-link).
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
