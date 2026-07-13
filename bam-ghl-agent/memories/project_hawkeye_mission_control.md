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
- 🔥 CLOSING FOLLOW-UPS ALWAYS SCHEDULED + CONFIGURABLE (2026-07-11, Zoran: Done-Trial
  cards had NO follow-up action showing). TWO bugs found: (1) the plan insert 409'd on
  `agent_closing_replies_one_active_per_contact` - it was unique on (client_id,
  ghl_contact_id) for active rows, so a multi-row followup_N plan could never insert
  (migration 20260711030000 widened it to include coalesce(step_key,'') - reply/enroll/
  lost/reignite all share the '' bucket = still one active card, but plan rows coexist).
  (2) the follow-up loop had a 24h silence GATE (`silenceDays < 1 -> "waiting on the
  lead"`), so a quiet lead sat card-less for a day. FIX: the plan now cards the MOMENT
  we're waiting (our msg last + no active card) - a Done-Trial lead ALWAYS has its next
  follow-up either scheduled or awaiting ✓. CADENCE is per-academy configurable at
  clients.ghl_kpi_config.closing_followups = { gaps:[1,2], lost_after:2 } (gaps[i] =
  days between follow-up i and the prior msg; default = next day "did you see my msg",
  then +2 days "still interested?", then Lost suggestion 2 quiet days after the last
  follow-up -> Nurture on approve). `closingFollowupStrategy(client)` in agent-closing.js;
  PLAN_TOOL is now buildPlanTool(gapsLeft) (dynamic count + per-field send timing);
  send_after stamped at DRAFT on the cadence (deck + V1.5 plan card show the real send
  DAY, not "Day 1/2/3"); approve-plan preserves spacing + slides forward if approved
  late. Config API: agent-config get/set-closing-followups (owner or staff). WORDING is
  the trainable closing_followup brain section (relabeled "Follow-up strategy", layer
  goal = GLOBAL/BAM-managed, GTA can edit as a global editor). NEW "Follow-ups" tab
  (closing agent only) in BOTH the focus-mode Engine tabs and the Train Agent view
  (`_taRenderFollowups`/`_taFuPaint`): a schedule timeline editor (day gaps + lost_after)
  + the wording editor (gated on section.editable). All "1 day apart" copy killed.
  Nothing auto-sends (GTA closing_mode=hawkeye, self-drive globally off) - safe. Applied
  to GTA (default cadence). NOT prod-verified end-to-end yet.
- 🔥 PER-STEP SEND DAY EDITABLE IN THE PLAN CARD (2026-07-12, Zoran: "edit the actual
  schedule of the follow ups too"). Each plan row now shows an inline `type=date` picker
  (pre-filled from `send_after.slice(0,10)`, min = tomorrow) NEXT to its message box, in
  BOTH the V2 hk2 deck (`.hk2-when` / `#hk2-plan-when-${i}`) and the V1.5 `_aclxPlanCard`
  (`#aclx-when-${id}`). Changing a date flips the confirm button to "Confirm edits and
  schedule" via `_hk2Edited(true)` but does NOT demand a teach-why note (schedule = logistics,
  like a slot change, not agent-error). approve-plan `edits[]` now carries an optional
  `send_at` (YYYY-MM-DD) - sent ONLY for rows the staff actually moved (compared to the
  prefill), so untouched rows keep the cadence spacing + late-approval slide. Backend stamps
  the override at `${send_at}T14:00:00Z` (matches followup_on/decision-date convention) and
  uses it as-is (no slide); quiet-hours `nextSendableTime` still applies. The stage-config
  gear stays the DEFAULT cadence; the card is the per-lead override. NOT prod-verified yet.
- STILL TO DO: swipe gestures (open decision), GTA prod verification of the whole batch
  incl. reignition + always-scheduled closing follow-ups end-to-end.
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
- HOME <-> HAWKEYE SYNC PASS 2 (2026-07-11, Zoran: home didn't match Hawkeye -
  leads listed twice, convos went stale, feed != deck, deck didn't live-update).
  All in client-portal.html. FIXED:
  * Inbox listed a lead TWICE: `/api/ghl/inbox` merges SMS+email+social+DM stores
    (own-store academies like GTA) + GHL can return >1 thread/contact, no dedupe.
    New `_hmDedupeConvos`/`_hmContactKey` in `_hmLoadInboxPreview` collapse to ONE
    row per contact (contactId -> last-10 phone -> lc name), keep newest message
    in the server-sorted slot, OR-in unread; hawk flag is contact-keyed so no
    flagged lead drops. Dedupe runs BEFORE the slice(0,8) + flagged-swap.
  * Stale convos (Tara): inbox preview + Hawkeye feed loaded once on mount.
    `_hmStartScoreRefresh` now also runs `_hmRefreshLive` on the 60s tick +
    `_hmBindLiveRefresh` refreshes both on focus/visibilitychange. Inbox refresh
    gated to `window._hmActiveTab==='inbox'` + home visible.
  * Feed != deck: `_hmLoadRailBottom`/`_hmRenderHawkFeed` rendered agent-followups
    (RETIRED, never deck cards) -> extra rows past the count/deck. Now render
    EXACTLY the 3 deck queues (booking+confirm+closing, followup_N collapsed);
    total==rows==deck; reignite/reignite_due labeled. agent-followups DROPPED from
    the feed (`_apxSplit` no longer used here). Supersedes the "scheduled
    followups render but don't count" line above.
  * Deck didn't live-update (had to exit+reopen): NEW `_hk2Poll` (30s +
    focus/visibility) re-reads the 3 queues while open and MERGES only new cards
    onto queue backs + refreshes tab counts (`_hk2TabsHtml` extracted). Non-
    destructive: never re-renders the open card / in-progress DOM edit unless the
    active tab was empty. Resurrection guard = per-open `_HK2.seen` set (seeded in
    `_hk2Refresh`) + the `_HAWK_PENDING` skip, so a just-resolved card that
    list-ready still echoes during its 6s commit is never re-added. Started in
    `_hk2Refresh`, stopped in `_hk2Back`+`closeSalesFocus`; `_hk2IsOpen` = overlay
    `_SF_OPEN==='hawkeye'` or inline `_PL_SV==='hawkeye'`. Known low edge: a plan
    re-created for the same contact within one open session shares key
    `plan:<cid>` and waits for reopen (self-heals). NOT prod-verified on GTA yet.
  * 2 REVIEW FIXES (adversarial pass on this diff, both were real): (a) dedupe
    key must NOT merge on a non-identifying sentinel - `_hmContactKey` only
    merges on a REAL name now; unnamed rows ("Lead" from DM/social stores,
    "Unknown" from GHL, bare number/email) fall to `id:<convId>` so two distinct
    nameless leads don't collapse into one. (b) `_hmRefreshLive` visibility gate
    was `home-v2.style.display==='none'` which never trips (classic view hides
    the ANCESTOR `#view-home` via a class) - now `hv.offsetParent === null` +
    a 3s debounce so focus+visibilitychange don't double-fetch. Deck-poll pass
    (resurrection/edit-wipe/lifecycle/null-derefs) reviewed clean.
- 🐞 BUG SWEEP (2026-07-11, 41-agent adversarial review of the 2026-07-10 batch;
  27 confirmed). FIXED this pass:
  * CRIT: silent parks self-canceled every detector cron - a park with an empty
    ack (or a failed ack) stays inbound-last on the ORIGINAL "later" text, and all
    3 detectors canceled on mere queue membership. Now compare item.last_at to the
    park's created_at (new `reigniteParkMap`/`repliedAfterPark` in _reignite.js);
    no fresh inbound => keep the park + skip drafting.
  * HIGH: booking+closing fire loops canceled due parks against an UNTRUSTED/empty
    stage set (a GHL blip = permanent park death). Added `idsTrusted` to
    computeQueue/computeClosingQueue + `stageSetTrusted` gate (confirm already had it).
  * HIGH/MED send-honesty: confirm-lost/abandoned/reignite now return
    goodbye_sent/ack_sent + record the send error on the row; the deck toasts the
    TRUTH ("Done, but the message did NOT send") instead of "Message sent" off the
    payload. Book/reignite/reignite_due cards no longer send their prefilled box on
    a silent-labeled Nurture/Unqualified move (reply capture gated to the same
    hasMsg kinds). Cleared Book-it confirmation box no longer resurrects the draft.
  * HIGH: post-trial form card wedge - the two form validations leaked the
    _hk2Busy latch (all later taps dead). Reset on every early-return.
  * HIGH: close-rate popup rows/chips passed lead-typed names into an inline
    onclick (apostrophe broke taps; crafted name = click XSS). Now dataset + safe
    handler (same pattern as the deck name-link).
  * HIGH: applyPreset silently corrupted a live pipeline (duplicate enabled edges,
    nondeterministic routing). Added an edge-conflict guard that refuses by default
    + a `--force` clean-replace (deletes the offer's edges first).
  * MED: post-trial "Mark lost"/"Mark unqualified" claimed success on a failed
    close - added lost_ok/unqualified_ok flags; deck warns instead.
  * MED: deck name-tap drawer showed "no phone on file" + hid the composer for its
    own hydrated contact - backfill phone/email onto _CDRAWER.contact after hydration.
  * MED (infra): cc_qualified_trials/cc_qualified_close_rate were applied to prod
    but never committed - any migration-built env 500'd cc-sales-kpis. Committed
    both as migrations (20260710224022 + 20260711013742).
  * LOW: channelOf dropped campaign/custom SMS variants to 'other' (agent blindness)
    - now matches the whole SMS/EMAIL/CALL family (reaction still excluded first).
    Date-only trialDate parsed as UTC midnight (not-flowing exemption expired the
    evening before) - use _plTrialInfo end-of-day. Close-rate default To showed
    yesterday. Deck had no Back in the cc-opted-out inline path. Drawer Cancel
    failed on the 'fresh' placeholder id (now returns/resolves the real id).
  * ALSO shipped (original Tara report): scheduled-send bubbles in inbox threads
    (read-thread.js scheduledStoreMessages + 3 renderers), a quiet-hours bar on the
    deck (list-ready returns `quiet`), and a pagehide/visibilitychange flush of the
    6s undo so backgrounding the app never drops an approved send.
  * SECOND PASS (2026-07-11, the deferred 8 - all fixed): #3 Book-it card copy is
    now provider-aware (list-ready returns booking_provider; GHL academies see "GHL
    sends the confirmation" instead of an editable box that got dropped). #10 fired
    confirm reignite_due cards are exempt from the passed-trial prune/list-ready
    gate/send guard (kind reignite_due survives a lingering passed slot). #11
    Book-it now also sends the "Your free trial is booked!" EMAIL on portal
    academies (resolveContactInfo + sendOn), not just the SMS. #12 normalizeProposal
    is async + verifies the proposed slot against a live freeSlots read (drops the
    structured proposal if it isn't genuinely open - no more "verified open slot"
    label on a hallucinated time). #20 the send action + 8am flush refuse/cancel a
    proposal whose stamped book_slot_at already passed. #19 website/leads.js +
    website/trial-booking.ts cancel a scheduled reignition on a self-serve booking
    (parent-app path books with null contact, can't link). #23 contact-memory no
    longer greets the parent by the athlete's name when contacts.name == athlete_name
    (ADAPT-minted) - falls to a nameless warm greeting. #27 scheduleStepJob returns
    an ok flag; enrollContact/advance exit the enrollment with a visible reason
    instead of leaving a phantom-active enrollment with zero pending jobs.

- 🐞 TWO GTA LIVE BUGS (2026-07-11, Yaz/Tara + Kartik):
  * BOOKED LEAD COULD GET A SECOND BOOK-IT (double-booking risk): the Booking
    detector guarded PASSED trials (`passedTrialContactIds`) but had NO guard for a
    lead with an UPCOMING BOOKED trial - a stage-move hiccup leaving them in Responded
    re-queued another Book-it. NEW `upcomingBookedContactIds(clientId)` in
    agent/booking.js (portal-only, mirrors passedTrial; BOOKED trials whose slot is
    still future). agent-approvals uses it in 3 places: detector per-contact skip,
    prune loop ("already booked - has an upcoming trial"), list-ready read gate. The
    Confirm agent deliberately does NOT use it (a booked lead belongs in confirm land).
    NOTE on Tara/Yaz specifically: NO double-book existed - she corrected "Jul 13 not
    14", the webhook canceled the Jul-14 card, the detector drafted a valid Jul-13 8pm
    card (that's the "card came back"); the guard prevents the SECOND card once she's
    actually booked. No stale slot to clean.
  * POST-TRIAL FORM CARD RESURRECTS AFTER A GOOD SUBMIT: list-ready keys reviewed
    trials on trial_booking_id; a review saved with NULL trial_booking_id is dropped
    from reviewedBookings -> the trial stays "unreviewed" -> the form card comes back.
    Null happened when post-trial.js's BOOKED-only resolve query returned nothing (a
    2nd submit: the 1st stamped the trial SHOWED) or threw. FIX (a, primary):
    post-trial.js now resolves trials with status IN (BOOKED,SHOWED,NO_SHOW) and stamps
    `reviewTrialId` = most recent passed trial of ANY status (trialBookingTarget stays
    BOOKED-only for the SHOWED/NO_SHOW outcome stamp) -> trial_booking_id is never null
    when a passed trial exists + stays stable across resubmits. FIX (b, net):
    agent-confirm list-ready also suppresses a synthesized card when a NULL-trial review
    exists for that opp filed at/after the trial ran (`reviewedNullOppAt`; rebook-safe -
    a newer trial post-dates the old review). Kartik's own row was NON-null (his submit
    fully succeeded: moved to done_trial, signup text sent) - his reported "error" was
    NOT this bug; get the exact error text. His trial is now SHOWED so a plain review
    delete will NOT regenerate the card (synthesis needs BOOKED).

## Open item (ask Zoran before building)
Swipe RIGHT commits the card's main action (can SEND) - confirm it's instant-commit.
Swipe LEFT destinations differ per agent: Booking Ghosted/Nurture/Unqualified ·
Confirm Rebook/Nurture · Closing Nurture. Pop options vs default+undo vs buttons-only.

## See also
[[project_sales_focus_mode]] (focus mode + engines model + router, what's already live) ·
[[project_sales_crew_model]] (the crew) · [[project_sales_crew_guardrails]] (solid vs dashed
visual language) · [[project_v2_sales_board]] (board surfaces being replaced/kept).
