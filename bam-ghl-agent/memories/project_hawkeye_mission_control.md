---
name: hawkeye-mission-control
description: 2026-07-08 Hawkeye V2 BUILT + MERGED to main (PR #1298) - the _hk2* deck + _plo2* simple view in client-portal.html, revised action model shipped in the agent APIs. Open: swipe gestures decision + GTA prod verification.
type: project
---

# Hawkeye V2 + Sales simple view - BUILT + MERGED 2026-07-08 (PR #1298)

**SOURCE OF TRUTH = [`docs/hawkeye-simple-view-handoff.md`](../docs/hawkeye-simple-view-handoff.md)**
(full spec, decision log, build order, next-session prompt). Clickable mockup:
[`docs/hawkeye-simple-view-mockup.html`](../docs/hawkeye-simple-view-mockup.html) +
hosted at https://claude.ai/code/artifact/7a9a5268-048a-4dda-9750-62d9f69a4150

## The design in 6 lines
1. **Simple view** = pipeline strip ONLY (no cards). Click a stage -> cards CASCADE down;
   the pill morphs to a solid-colour gear button -> existing focus-mode config page.
2. Cascade shape by ENGINE: agent stages = cards left + Hawkeye action right per card;
   automation/human stages = single column.
3. **Hawkeye page** (gold button) = TINDER DECK: 3 agent tabs span the top (Booking/Confirm/
   Closing, gear on active), ONE card at a time, next peeks behind, approve flies right,
   move flies left, swipe on mobile, buttons on desktop. Automations never appear here.
4. **Popup modal RETIRED (2026-07-08 later)**: the cascade shows highlight rows only (no
   actions); clicking a glowing lead opens the Hawkeye PAGE on that lead's card. The deck
   is the single Hawkeye surface.
5. **NO SKIP anywhere** - every Hawkeye action must be resolved (approve or move).
6. Configure page = the LIVE focus mode (Entry->Engine->Exit, PR #1178) - reuse, don't rebuild.

## Replaces
`_apx`/`_acx`/`_aclx` Hawkeye overlay buttons · Train Agent picker as a destination ·
scattered autonomy/config entry points. KEEPS: inline drawer suggestion on lead cards.

## Action model revision (Zoran 2026-07-08) - SHIPPED end to end
- "Abandon" -> "Unqualified" on every Hawkeye button (overlays updated).
- Booking follow-up nudges RETIRED: Follow-ups tab removed from the _apx overlay;
  nothing creates agent_followups rows (quiet lead = "Send to Ghosted" proposal).
- Confirm reminders = step config only (approved templates self-send; never Hawkeye).
- Reschedule approve = handoff + Booking rebook opener queues (Entry: Rebook note).
- Done Trial: NO automations. agent-closing.js scripted sequence + automations-get/set
  + focus-mode editor REMOVED; post-trial form (trainer msg + optional link + coach
  notes) is the only preplanned touch. Proactive path restructured: opener (A6-guarded)
  -> follow-up loop for ANY engaged lead (incl. form-opened) -> Lost card after 3
  unanswered. Prompt told: silence alone is never lost.
- Enroll = reply with the sign-up link EMBEDDED in the draft (buildEnrollUrl at detect
  time; confirm-enroll appends only if the edited draft lost the link).
- Closing deck order: Reply -> Follow-up plan (stacked next) -> Suggested Lost.
- EVERY agent can mark Unqualified: `confirm-abandoned` now exists on /api/agent-confirm
  and /api/agent-closing too (mirrors agent-approvals': setStatus abandoned+role
  unqualified, markUnqualified tag, pipeline_outcomes, clears that agent's cards).
  UI: Unqualified button on all Confirm/Closing cards (_acxUnqualified/_aclxUnqualified/
  _aclxUnqualifiedPlan), 6s undo via _hawkDefer.
- Reference page: bam-portal/public/hawkeye-actions.html (+ claude.ai artifact).
- Mockup REBUILT to v2 (same file + same artifact URL): kind-aware deck cards, per-agent
  move rows incl. Unqualified, stacked Closing cadence, config screen notes per agent.
- Deck card footer LOCKED (2026-07-08): two buttons - "Other" (left, cascades up to the
  move options) + confirm (right, flips to "Confirm edits and ..." on any edit). Book-it
  cards = Calendar picker (offer-tied calendars only) + Slot picker (open slots with
  spots-left); switching either = edit. Teach-why note
  is MANDATORY on any change away from the agent's guess (confirm blocked until filled).
  Pill morph = up arrow center (collapse) + 3-line config icon top-right.
⚠️ NOT prod-verified on GTA yet (live behavior change if GTA had closing autos approved).

## BUILD STATUS (2026-07-08)
- STEP 1 BUILT: the deck lives in client-portal.html as the `_hk2*` module (V2-gated).
  View state: `_PL_SV='hawkeye'` + host `#pl-hawkeye` (sibling of pl-focus). Cards are
  kind-aware (reply/book/ghost/handoff/enroll/plan/lost), footer = Other + morphing
  confirm, teach-why MANDATORY on any edit (agent-scoped lesson via agent-train),
  Book-it uses the NEW `book-options` action on agent-approvals (trial calendars +
  open slots), closing followup_N rows group into one plan card, board badges deep-link
  (_hk2Open(null, contactId)), tab gear -> _plOpenFocus for that stage. All commits ride
  _hawkDefer (6s undo). V2 entries repointed (_hv2OpenHawkeye/_plEngineHawk/board
  hawk buttons/scanBtn); V1.5 keeps _apx/_acx/_aclx overlays. 2-hourly digest SMS retired.
- Scheduled Trial = TWO engines: Confirm agent + post-trial form (in engine config for
  now; configurable later). Mockup config screen shows both.
- STEP 3 BUILT: _plRenderOverview rewritten to the simple view (_plo2* helpers): KPI row
  kept; colour pills per stage role (_plo2Color; automation = dashed), "N need you" from
  _plStageSignals; click = in-place cascade (_plo2Cascade: needy rows first w/ gold ring
  -> _hk2Open(null, contactId); plain rows -> _plOpenCard drawer; 30-row cap -> board);
  active pill morphs (up arrow = collapse, 3-line icon -> _plOpenFocus); gold Hawkeye
  button w/ cross-agent count; Expand board kept. _plLoadNeedsAction now merges confirm +
  closing ready queues into _PL_NEEDS on V2 (V1.5 stays booking-only).
- HOME STRIP (2026-07-09): the command-center home Sales section renders the SAME
  simple-view pills (shared _plo2Pills/_plo2Cascade; home state = _CC2_OPEN,
  _cc2Render into #cc-sal-strip). Cascade opens in place on home; deeper actions
  leave cc-mode first (_ccPipeFocus config, _cc2Lead -> deck, _cc2Card -> drawer,
  _ccPipeStage -> board). Old stage cards (_ploStripCells) = V1.5 fallback only.
- PILL ORDER locked (_plo2Order, home + overview): Nurture, Ghosted, Booking,
  Confirm, Closing. NO Member pill - terminal stages never render in the strip.
- PILL DESIGN (2026-07-09, Zoran's redesign - current): stage name TOP-LEFT,
  engine wording under it ("Nurture automation" / "Closing agent"), total cards
  under that, gold "N need you" badge centered right. GOLD ONLY (per-stage
  palette killed; _plo2Color removed); dashed border = automation; chevrons
  between pills show the left-to-right flow; open pill = gold fill + up arrow
  + config icon. History: a design-system restyle shipped and was reverted
  earlier the same day - always confirm before restyling.
- CASCADE (automation stages): rows show "enrolled · step N of M", newest
  entries first, via automations.js `active-enrollments` -> _PL_ENR map
  (loaded by _plLoadActiveAutomations; home kicks it too).
- DECK = TINDER (2026-07-09): _hk2Confirm/_hk2Move capture inputs at click,
  resolve the card ~0.5s later (badges update, empty queue auto-jumps to the
  next agent with cards) while the API rides the 6s undo (_hk2Unresolve puts
  it back). thread_tail cap now 2000 chars (was 320 - messages were cut off).
  Config gear on EVERY deck tab. _hk2Back = home Sales section, cascades closed.
- Home Sales section: "Open sales board" button gone; Recent movement lowkey.
  Cascade width:100% (home container .cc-pipe-strip is flex). _ccReturn clears
  the frozen scroll-recede blur (the "back from classic = blurry home" bug).
- HOME = THE SALES PAGE (2026-07-09 wireframe): two KPI cards (Trials today
  w/ name list from calendars-v15 trials-today - portal path reads
  trial_bookings; close rate + weekly sales w/ names) + ONE pipeline panel:
  gold HAWKEYE bar (all-3-agent count via _ccSalesHawk, gold fill when work
  waits) over the pill strip + lowkey feed. Hawk bench/card removed.
- STANDALONE SALES PAGE RETIRED on V2: Hawkeye + config open as mm-focus
  overlays (#salesMachineModal; hosts reparented into #sf-body; _sfOpen/
  closeSalesFocus; _plSVApply skips host displays while _SF_OPEN). Cascade
  "+N more" expands in place (_plo2ShowAll) - board not a V2 destination.
- POST-TRIAL FORM = Confirm-tab deck card (kind post_trial -> 'form'):
  synthesized server-side in agent-confirm list-ready (portal provider:
  trial_bookings BOOKED, slot past, no post_trial_reviews row, open opp,
  NO upcoming rebooked slot); deck form submits /api/ghl/post-trial (3-way
  router). No Other btn. NO EXPIRY (Zoran 2026-07-10, was <=7d): the card
  stays until the form is filled or the opp closes.
- 'Liked' TAPBACK RULE: isRealInbound (agent/_stage.js) - inbound text
  starting with "Liked" never wakes an agent, never bounces Ghosted/Nurture
  (ghl/inbound-webhook), never enters the Meta store, never reaches agent
  thread context.
- DETECTOR STARVATION FIX (2026-07-09, all 3 agents): each detector did
  `queue.slice(0, DETECT_CAP)` on a NEWEST-first queue, so once the top N cards
  were carded the tail (oldest-quiet leads) NEVER got a card - Done-Trial leads
  sat with us as last message and nothing queued. Fixes: closing filters
  proactive carded leads + sorts LONGEST-SILENT first before the slice
  (agent-closing.js ~529); confirm filters carded leads only, order kept
  (appointment-time driven, agent-confirm.js ~531); ghost skips carded +
  mid-intro leads in the candidate builder so DRAFT_CAP only counts new cards
  (agent-followups.js ~136). Stable order + skip-carded => frontier advances
  each run, whole backlog queues over a few 15-min cron cycles. Cron drains
  automatically; no manual trigger.
- REMAINING stuck buckets are CONFIG, not code: custom-named stage (no role
  match = no engine), Interested lead whose intro finished while Ghosted
  automation OFF, quiet Responded coverage needs booking agentMode ON + a
  configured ghosted_workflow. Must be verified per academy for full confidence.
- SAFETY NET "not flowing" list (2026-07-09): home Sales panel shows a red
  list (#cc-sal-stuck, _ccStuckCards/_ccRenderStuck) of any OPEN opp with NO
  Hawkeye action (_PL_NEEDS), NO active automation enrollment (_PL_ENR), not
  terminal, idle >= _CC_STUCK_IDLE_DAYS (3). Catches the config gaps above so
  nothing is EVER silently stuck - read-only, client-side, oldest-idle first,
  each row opens the lead drawer. Only renders when count > 0.
- DECK HEADER NAMES (2026-07-09, Zoran): card header is now TWO lines - athlete
  on top (hk2-who), parent + confidence underneath (hk2-sub) - instead of a lone
  "Lead". Names come from a batched `deck-names` action on agent-approvals
  (trial_bookings parent_name/athlete_name first, contacts read table backfill);
  _hk2Load stamps parent_name/athlete_name onto every card. No athlete name =
  old single-name + confidence look. post_trial cards already carried athlete_name.
- BOOKING HANDS OFF PASSED TRIALS (2026-07-09, Zoran): a Responded lead whose
  BOOKED trial time has passed (<=7d, no post_trial_reviews row) no longer gets a
  Booking reply card - they belong to the post-trial form on the Confirm tab.
  New `passedTrialContactIds(clientId)` helper in agent-approvals (uses
  bookingProviderOf, portal-only) drives: detector skips + cancels their pending
  Booking cards ("trial ran - handed to post-trial form"); list-ready read gate
  hides them; both fail open. Root cause found: agent-confirm `loadClient` was NOT
  selecting `booking_provider`, so the post_trial gate (`client.booking_provider
  === "portal"`) was ALWAYS false and the form card never generated. FIXED by
  adding booking_provider + time_zone to that select (post-trial cards + correct
  TZ now work). Data-verified on GTA (Josh MCGILVERY, trial Jul 7, still a Booking
  reply pre-fix).
- CONFIRM HANDS OFF PASSED TRIALS TOO (2026-07-09, later): same rule applied to
  the Confirm agent's OWN cards - Josh's pre-trial reply card ("see you Tuesday
  at 8pm!") was still deck card 1 of 7 on Jul 9 because nothing retired confirm
  cards when the trial ran (the stage prune only fires when the lead LEAVES
  Scheduled-Trial, and no review = never leaves; it also blocked the A3 overdue
  card). `passedTrialContactIds` MOVED to agent/booking.js (shared export; both
  agents import it). agent-confirm now: detector skips passed-trial leads
  (reactive included) + prunes their pending cards + quiet-flush cancels their
  held sends ("trial ran - handed to post-trial form") + A3 overdue pass skips
  them (real ptf card covers portal academies); list-ready read-gates this
  agent's own stale rows BEFORE appending ptf form cards, so the form card is
  the ONE card per passed-trial lead, instantly. Non-portal academies: empty
  set, zero change. NO EXPIRY (Zoran 2026-07-10): passedTrialContactIds + the
  form synthesis dropped the 7-day window - an unreviewed trial stays carded
  until the form lands or the opp closes. EXCEPTION baked into both: a contact
  with an UPCOMING BOOKED slot (rebooked) leaves the set, so an old unfilled
  form never starves the new trial's confirmations; the new trial cards itself
  after it runs. (Backups beyond the deck were verified dead for portal
  academies: A3 overdue + 15-min escalation SMS both read GHL calendars only;
  the red Home "not flowing" list was the lone catch-all.)
- QUIET-HOURS AUDIT (2026-07-10, Zoran asked): reply-card approvals, scripted
  reminders, ghost send-now, self-drive and every automation step all HOLD to
  the 8:00am-9:30pm Toronto window (agent/_quiet.js, flushed by the 15-min
  detect crons). FIXED: confirm-handoff's warm ack now parks too (after-hours
  ✓ = notes + bounce run NOW, ack rides the ready row as approved+send_after;
  the confirm flush exempts kind confirm_handoff from its stage/passed-trial
  gates since the bounce is intentional). STILL SEND IMMEDIATELY on after-hours
  ✓ (Zoran's call: leave for now): lost-card warm goodbyes (all 3 agents),
  closing enroll-link message, post-trial form first message (+link).
- PROPOSED TIMES = STRUCTURED HAWKEYE FIELDS (2026-07-10, Zoran: "I approve all
  of the proposed times to book"): the booking agent's propose_reply tool got
  propose_group/propose_slot_at ("never name a time you have not verified as an
  open slot via check_availability"); normalizeProposal validates (future +
  real calendar) and stamps the reply card's book_* columns (kind stays
  'reply' - nothing books on send). Deck reply cards with a proposed slot show
  the SAME Calendar/Slot pickers as Book-it ("Proposed time - a verified open
  slot"); the send action records the final pick (proposed_slot_at/calendar_id
  patch). Audit result: every time-proposal path was ALREADY Hawkeye-gated
  (reply cards, Book-it, rebook/no-show openers); scripted confirm reminders
  state the BOOKED time only (approved-once templates, self-send by design).
- POST-BOOKING MESSAGE CHAIN (locked 2026-07-10): Book-it approve = slot
  claimed + confirmation text sends instantly (with Apple/Google calendar
  links appended server-side) + a kind=confirm_auto step_key=confirm marker
  row (status sent, trial_at=slot) is written so the confirm agent's scripted
  IMMEDIATE "Booking confirmation" step does NOT self-send a second
  confirmation minutes later. The scripted same-day 9am check-in still fires
  (different step_key). Lead replies at any point -> scripted stops, AI
  confirm agent takes over (an AI confirm-kind card about the same trial
  blocks ALL scripted steps for that trial - fireScriptedStep line ~389).
- BOOK-IT NOW TEXTS THE PARENT (2026-07-10, Mike Sandhu case): on portal-booking
  academies confirm-book claimed the slot but sent NOTHING (GHL academies get
  GHL's toNotify; portal leads who said "yes please" heard silence until the
  next confirm card was approved). FIXED: portal branch sends the card's
  confirmation text right after booking (deck's edited box via b.reply, falls
  back to the detector draft; immediate send, same exemption as lost goodbyes).
  Deck book cards now SHOW an editable "Confirmation text - sends the moment
  you book it" box (edits demand the teach note like any message edit). Cards
  with a FUTURE trial_at render a gold "✓ Trial on the books: <local time>"
  bar so a reviewer can tell "we texted about a time" from "the slot is
  actually claimed" - the exact confusion behind Zoran's report. Lesson saved
  for the booking agent (clear yes on a time -> Book-it action, never words).
- MOVE + MESSAGE IN ONE (2026-07-10, Zoran: "write a message and mark someone
  unqualified at the same time"): deck Nurture/Unqualified moves now SEND the
  message box when it has text - labels flip live to "Send message + Nurture"/
  "Send message + Unqualified" (empty box = silent move, ghost move never
  sends). Backend: confirm-abandoned takes optional `reply` on ALL 3 agent APIs
  (additive - V1.5 overlays omit it, silent close unchanged); goodbye sends
  BEFORE the close like confirm-lost, quiet-hours exempt (matches lost-card
  goodbyes, Zoran's standing call). Two-tap arm flow kept ("Confirm: Send
  message + Unqualified"); optional teach lesson logs the sent text.
- AGENT CONTEXT BLINDNESS (2026-07-10, found via Zoran's "didn't card in Hawkeye"
  report): the GHL history import's channelOf read numeric `type` first, but in
  GHL 1=CALL, 2=SMS, 3=EMAIL - so 12,763 real imported SMS rows sat channel
  'other' and 712 calls sat 'sms'. readStoreThreadAgent (ALL 3 agents + ghost
  detector) reads channel=eq.sms only -> every draft for a pre-cutover GTA lead
  was near-blind (Dhananjay: agent saw 2 of 13 msgs, re-sent a "still
  interested?" ignoring his Jun 30 "on hold" reply -> his "Don't send repeat
  message" complaint). FIXED: import maps messageType-string first (TYPE_SMS/
  TYPE_EMAIL/TYPE_CALL; reaction != sms), prod rows relabeled by raw->>
  'messageType' (12,763 sms + 712 call), inbox unaffected (no channel filter).
  GOTCHA: never trust GHL's numeric message `type`; sms_messages.channel is the
  agents' context gate.
- FAKE-'SENT' SWEEPS FIXED (2026-07-10, same session): confirm-lost/abandoned/
  ghost swept a lead's pending cards to status 'sent' + sent_at even when
  NOTHING was texted (deck "Not interested: Nurture" sends reply:'') - looked
  like sent messages in the DB and poisons draft-vs-sent training data. Now:
  acted-on row is 'sent' only when a goodbye actually went out, everything else
  'canceled' + send_error ('marked lost'/'marked unqualified'/'sent to
  ghosted'), approved_by kept for attribution. All 3 agent endpoints.
- WHY MESSAGES "DIDN'T POP UP" (2026-07-10 diagnosis, for the record): they DID
  card - Revathy carded 7 min after her text and Zoran deck-moved her to Nurture
  2 min later; Dhananjay carded on the next 15-min cron, 2 min AFTER Zoran's
  screenshot. Perception gap = detector cadence (up to ~15 min inbound->card) +
  the inbox never shows a "handled in Hawkeye" state on a thread. Open UX ideas:
  handled-badge in the inbox, instant reactive carding on webhook.
- PORTAL SEND-GUARD BUG (2026-07-10, caught live by Zoran on GTA): _stage.js
  contactInRespondedStage's portal branch HARDCODED role "responded", but the
  helper also guards Confirm (scheduled_trial) + Closing (done_trial) drafts
  and sends - so on a pipeline_provider='portal' academy EVERY Confirm/Closing
  approve 409'd "no longer in the ... stage" (store row has stage_role
  done_trial/scheduled_trial, never responded). FIX: helper takes ctx.role
  (default "responded"); the 5 Confirm/Closing call sites pass their role.
  GHL route matches stage id, role-agnostic - non-portal academies unaffected.
  GOTCHA: despite its name, contactInRespondedStage guards ALL THREE stages -
  pass ctx.role for anything portal-side that isn't Responded.
- 🔥 REIGNITION (2026-07-10, Zoran's design via Q&A): a lead in ANY agent stage who
  says "yes, but later / after summer" gets PARKED IN PLACE with a pre-written
  re-engagement message that fires as a Hawkeye card at the date. Locked decisions:
  both auto-detect + manual "Reignite later" deck move · lead STAYS in its stage ·
  card returns to the agent who parked it · message PRE-WRITTEN at park time (edits
  teach) · ack sends at park (editable, empty = silent) · auto-cancel on real
  inbound / book / enroll / lost / unqualified / ghosted / left-stage · AI resolves
  vague dates ("after summer" = Sep 01, bare "later" = ~30d), human confirms.
  BUILD: table `agent_reignitions` (migration 20260710210000, APPLIED to prod;
  one scheduled row per contact - partial unique idx; statuses scheduled/carded/
  done/canceled) + reignite_at/reignite_message cols on all 3 replies tables +
  kinds 'reignite' (park card) / 'reignite_due' (fired card). Shared helper
  api/agent/_reignite.js (normalizeReigniteAt: bare date -> T14:00Z ≈ 10am
  Toronto, future-only, <=550d; scheduleReignition supersedes old park;
  reigniteContactIdSet = proactive-skip set; dueReignitions/markReignition;
  cancelReignitions best-effort). All 3 agents: propose_reply gained reignite_at
  + reignite_message (+ trailer guidance; closing distinguishes it from
  followup_on = decide-soon vs start-later), detector queues kind='reignite'
  (never auto-sends), fires due parks into kind='reignite_due' on its own deck
  (fire guards cancel on muted/left-stage; booking also passed-trial; confirm
  deliberately NOT passed-trial - its confirm-reignite VOIDS upcoming portal
  slots like confirm-handoff so no bogus post-trial form spawns), proactive
  passes skip parked leads (openers/rebook/ghost builder/scripted confirms/
  overdue/followup loop), reactive path cancels the park + replies normally.
  `confirm-reignite` action on ALL 3 APIs (ack sends immediately - Zoran's
  lost-goodbye exemption; optional lesson; sweeps other cards 'parked for
  reignition'). agent-approvals also has `list-reignitions` + `cancel-reignition`
  (cross-agent reads). Both inbound webhooks (ghl + twilio) cancel on real reply.
  FRONT-END: _HK2_KIND reignite/reignite_due, park card = ack box + date input
  (min tomorrow; date change = logistics, no teach note) + future-message box,
  "Reignite later" in every card's Other menu (flips the card via
  _hk2ReigniteMode; Back to the card undoes; plan cards ride rows[0].id),
  reignite_due = reply card + gold "Reignition day" bar, _PL_REIGN map loaded in
  _plLoadNeedsAction (list-reignitions), cascade rows show "reignite Sep 1 ·
  parked until then", contact drawer gets a gold chip + Cancel
  (_cdReigniteChip), stuck list exempts parked leads. NOT prod-verified yet.
- STILL TO DO: swipe gestures (open decision), GTA prod verification of the whole batch
  incl. reignition end-to-end.
- HOME <-> HAWKEYE ALIGNMENT (2026-07-10, Zoran: "make sure the home inbox lines up
  with hawkeye + lil hawkeye buttons"): V2 Home inbox preview rows whose contact has
  a pending deck card get a gold eye chip (`hm-ib-hawk`, hover twin `hm-ib-act-hawk`)
  that deep-links `_hk2Open(agent, contactId)`; flagged convos are guaranteed a slot
  in the 8-row preview (oldest non-flagged row swapped out). Shared fetch
  `_hmHawkFetch()` (5s-coalesced, same 3 list-ready queues as `_hk2Load`) +
  `_hmHawkIndex()` map. Right-rail "Hawkeye activity" feed now includes confirm +
  closing queues (was booking-only - counts drifted from the deck); `_hmHawkTotal` =
  deck-card count (pending booking rows + confirm rows + closing cards, plans
  collapsed; scheduled followups render but don't count) and each feed row
  deep-links to its card.

## Open item (ask Zoran before building)
Swipe RIGHT commits the card's main action (can SEND) - confirm it's instant-commit.
Swipe LEFT destinations differ per agent: Booking Ghosted/Nurture/Unqualified ·
Confirm Rebook/Nurture · Closing Nurture. Pop options vs default+undo vs buttons-only.

## See also
[[project_sales_focus_mode]] (focus mode + engines model + router, what's already live) ·
[[project_sales_crew_model]] (the crew) · [[project_sales_crew_guardrails]] (solid vs dashed
visual language) · [[project_v2_sales_board]] (board surfaces being replaced/kept).
