---
name: v2-sales-audit-2026-07
description: 2026-07-10 full V2 sales audit (9-reviewer sweep + adversarial verify) - what was FIXED in the same-night batch, the verified-but-unfixed backlog, and the design questions awaiting Zoran's calls.
type: project
---

# V2 sales audit - 2026-07-10 (post-trial-form session, Zoran asked for a full FE+BE pass)

Method: 9 parallel subsystem reviewers (booking/confirm/closing backends, shared
infra, webhooks+post-trial, deck FE, pills/home FE, flow consistency, training
loop) -> dedup -> 2 adversarial verifiers per high/medium finding. 24 confirmed,
22 verifier-died (self-verified inline where fixed), 3 refuted, 38 low/copy.

## FIXED in the same-night batch (see the audit-batch commit for full detail)
Backend: booking queue got the Twilio SMS recency overlay (GTA replies now card;
was the #1 flow bug) + draftForContact conversationId hoist (Twilio drafts
crashed); confirm mass-cancel guard (idsTrusted - a GHL blip no longer cancels
every card); rebooked leads get trial-#2 scripted reminders (same-trial scoping
in fireScriptedStep); one form card per lead; confirm send hardened (atomic
claim + passed-trial gate + placeholder guard - all 3 agents got the placeholder
guard); escalation/overdue cards seed EMPTY drafts (were one-tap sendable
internal notes); self-drive auto-sends pass clientId (provider seam) in confirm
+closing; booking flush respects mutes+passedTrial and keeps human attribution
(auto_sent only for self-drive); after-hours human approvals now audit-logged
(status 'scheduled') + lesson saved; hawkeye-ready push counts every card kind;
closing reactive path cancels stale cards for OLDER inbounds (fresh message
finally gets answered; same-inbound card survives = no churn); confirm-enroll
guarded (Done-Trial stage + not-already-a-member); automations form-intro
rollover stamps stage_role 'interested' (was 'ghosted' - reply-bounce guards
never matched); automation 'sending' jobs reclaim after 15 min (crashed worker
no longer stalls enrollments forever); GHL inbound webhook reads the portal
store for the reply-bounce (was frozen GHL board); Twilio webhook got the
'Liked' tapback rule; post-trial first message rides the provider seam (was raw
GHL - wrong number on Twilio academies); upsertThread no longer nulls
ghl_contact_id/contact_name on merge; moveStage/setStatus log 0-row PATCHes +
KPI only on a real move. Em dashes stripped from person-facing error strings;
emoji toast fixed.
Front end: teach-why posts the CARD's agent (was current tab at flush time -
lessons landed on the wrong agent after auto-jump); double-tap re-entry guard on
confirm/move (double SMS); _hk2Refresh flushes the pending undo first + resolve/
unresolve match by id (refresh mid-undo resurrected cards); 'N need you' counts
PENDING only, new _PL_HELD set keeps parked sends off the stuck list; stuck list
renders nothing until needs+enrollment maps actually loaded (false red flash);
Sales overlay pills/cascade/trials group pipeline-level opps per stage (view
showed 0 everywhere); board post-trial form copy matches the real 3-way routing.

## VERIFIED-BUT-UNFIXED backlog (next session; ordered by value)
1. cant_make_it handoff never cancels the dropped trial_bookings row -> once the
   slot passes, passedTrialContactIds claims the lead and a bogus form card
   appears for a trial they told us they'd miss. Fix: cancel_trial_booking RPC
   in confirm-handoff (mirror post-trial's set_trial_outcome pattern).
2. Post-trial good-fit stage-move failure is silent: review row saved (kills the
   never-expiring card) but the lead stays in Scheduled-Trial; toast says
   "Routed to Done Trial". Return moved:false + surface it.
3. Post-trial escalation cron scans GHL calendars only - portal trials never
   escalate (decide vs Q: is the never-expiring form card the replacement?).
4. Closing auto-won (paying member) writes no pipeline_outcomes/kpi row - wins
   undercounted vs other terminal paths.
5. Automation worker never checks agent_mutes - muted leads still get sequences.
6. GHL webhook duplicate deliveries re-fire owner/agent notify SMS (dedup insert
   result unchecked).
7. Training-loop drift (medium, design-y): staff sandbox not per-agent
   (agent-sandbox.js), approved 'general' lesson promotions have NO runtime
   reader (agent-learnings.js), lessons have no cap (every teach rides every
   prompt forever), sandbox Brain editor writes global sections as per-client
   overrides. Needs a design pass with Zoran (see questions).
8. Low/cleanup pile: A3 overdue scans only top-10 leads; _hawkDefer collapse
   animation not cancelled on fast undo; session-long bookOpts cache; 8s hawk
   poll never pauses on hidden tabs; _hk2Resolve drops _PL_NEEDS while another
   card exists; deck/board form field drift; dead code (requireStaff,
   loadBrainConfig, agent-followups CRUD on a dead table); resend webhook not
   Sentry-wrapped + can null thread contact link on transient miss;
   passedTrialContactIds ignores schedule_slots.is_cancelled; automations
   same-position steps skipped; findOpenOpp provider tie-break differs.

## TOP DESIGN QUESTIONS for Zoran (full list in the audit output; distilled)
- Mute vs approved-hold: staff mutes a lead AFTER a human approved a parked
  send - deliver at 8am or cancel? (Booking flush now cancels; confirm the rule.)
- Overnight reply kills a parked handoff ack ('lead replied' webhook cancel) -
  intended (booking agent answers fresh) or should the ack survive?
- Quiet hours are hardcoded Toronto (QUIET_TZ) - per-academy time_zone before
  the first non-Toronto academy. Also an Onboarding Data Points DB candidate.
- Skip semantics: a skipped card suppresses redrafting until the lead texts
  again - is skip 'never answer this message' on purpose?
- Book-card slot changes REQUIRE a teach-why lesson (logistics, not agent error)
  - keep mandatory?
- Which count is THE Hawkeye number (deck cards vs pending rows vs sum)? Now
  pills=deck=pending; the home bar preview logic still booking-first.
- agent-followups: dead table with a live every-minute cron + full UI - retire?
- Lesson lifecycle: no cap, verbatim forever, one per edit - consolidation
  policy? What should a 'general' promotion DO at runtime? kind='good' rows are
  loaded-but-filtered vestige.
- Teach rights vs approve rights: deck demands the note from every approver,
  agent-train accepts it only from can_train_agent users - align which way?
- V1.5 _acx overlay allows no-lesson edits while V2 mandates them - intentional
  V2-only training?

## See also
[[project_hawkeye_mission_control]] (the deck + form card work this audit
followed), [[project_confirm_agent]], [[project_sales_crew_guardrails]].
