# Signup cancels ALL sales outbound + Hawkeye hides paid members

2026-07-12 (Zoran). Fixes two related leaks: a lead who SIGNS UP could still (a) get
scheduled sales messages and (b) show up in Hawkeye. Trigger: Kartik signed up and
was still visible in Hawkeye. V2-agent only; V1 untouched (portal-native tables +
members table are empty for pure-GHL academies).

## The gap (before)
- A REPLY cancelled everything in one central sweep (both inbound webhooks).
- A SIGNUP (Stripe payment → member live) only did `exitEnrollment("converted")`
  (ghosted/nurture drip) + `markOpportunityWon`. It NEVER touched the four agent
  card queues or the reignition park. Those cleared only lazily via each agent's
  "left the stage" prune (needs the won-mark to have landed) or the closing
  `isLiveMember` net. **Worst hole: the returning-enroll SILENT path skips the
  won-mark, so the left-stage prune never fired → closing cards lingered.**

## Fix 1 - central cancel sweep on signup
- **New shared helper `api/agent/_cancel-outbound.js`** → `cancelAllSalesOutbound({ clientId, contactId, sendError, reigniteReason })`.
  Cancels pending+approved in `agent_followups`, `agent_ready_replies`,
  `agent_confirm_replies`, `agent_closing_replies` (incl. the approved follow-up
  PLAN) + `cancelReignitions`. Self-contained `sb`; fails soft per table.
- **Both reply webhooks refactored onto it** (`api/ghl/inbound-webhook.js`,
  `api/twilio/inbound-webhook.js`) - single source of truth so the queue list can't
  drift again (that drift WAS the root cause). Behavior identical (`sendError:"lead replied"`).
- **Stripe webhook calls it on conversion** (`api/stripe/webhook.js`): in
  `handleSubCreated` (external subs) AND `activatePortalOnboardingMember` (portal
  funnel + silent returning-enroll), each in its OWN try block right after the
  existing `exitEnrollment`, `sendError:"lead signed up"`. `activate...` also threads
  `sales_sweep` into its audit + return. This covers the silent path (the key fix).
- So all 6 queues now clear on signup: 4 agent card tables + reignitions (new) +
  automation_enrollments (already via exitEnrollment).

## Fix 2 - Hawkeye never shows a paid member (read-time, server-side)
- **New shared helper `api/agent/_live-members.js`** → `liveMemberContactIds(clientId)`
  = Set of `ghl_contact_id` for `members status=live` (one cheap query, fails open).
- Added a read-time "hide live members" filter to all three deck `list-ready`
  handlers (matches the existing left-stage gate shape, fail-open):
  - `api/agent-approvals.js` (Booking deck + ghost tab)
  - `api/agent-confirm.js` (Confirm deck, incl. synthesized post-trial form cards)
  - `api/agent-closing.js` (Closing deck)
  Fixing the 3 list-ready also fixes the sales-board "N need you" badges
  (`_plLoadNeedsAction` reuses them).
- **Sales board** (`api/ghl/pipelines.js`): after the existing members join, drop any
  open opp whose `contactId` is a LIVE member (reuses the already-fetched memberList,
  no extra query). Matched on `ghl_contact_id` only (same semantics as isLiveMember)
  so a sibling on a different contact still shows. THIS is the exact leak Kartik hit
  (paid member, opp still open because the won-mark missed).
- All server-side (no client-portal.html edit → no tour-verifier needed). Match key
  everywhere = `ghl_contact_id`.

## Files
`api/agent/_cancel-outbound.js` (new), `api/agent/_live-members.js` (new),
`api/ghl/inbound-webhook.js`, `api/twilio/inbound-webhook.js`, `api/stripe/webhook.js`,
`api/agent-approvals.js`, `api/agent-confirm.js`, `api/agent-closing.js`,
`api/ghl/pipelines.js`.

## Fix 3 - reconcile safety net (2026-07-13, Zoran: Bashir + Amir + Kartik still in pipeline)
Fixes 1+2 key on `ghl_contact_id` (Fix1 cancels on the signup EVENT; Fix2 hides at
read time) so they miss two real cases, all three found live on GTA:
- **DUP CONTACT**: member on one contact/email, open opp + closing cards on ANOTHER
  (different id AND email) - nothing connects "open opp" to "paid member". Bashir
  Popal (member bashpopal@gmail.com / opp superarmaan2012@gmail.com, same phone +
  athlete Armaan). Agent texted "still interested?" a family enrolled since Jul 1.
- **ALREADY-STUCK opp**: enrolled BEFORE the won-mark covered portal-native opps
  (Amir Jul 7, Kartik Jul 12). The signup event never re-runs; the closing detector's
  per-lead O6 auto-won only evaluates leads it is actively carding, so a quiet
  enrolled lead's opp sits open forever.
- Root cause of the miss: all 3 went through `activatePortalOnboardingMember`
  (markOpportunityWon allowContactSearch:true) but recorded NO won outcome - the
  won-mark couldn't resolve/close their portal-native opp (GHL-era won-mark, no
  linked opp id; Kartik's opp has null ghl_opportunity_id). handleSubCreated path
  is worse: `allowContactSearch:false` = only closes an already-linked opp.
- **NEW `api/agent/_reconcile-members.js` → `reconcileLiveMembers(clientId)`**: scans
  OPEN agent-stage opps (responded/scheduled_trial/done_trial) and closes any whose
  person is a LIVE member → won + pipeline_outcome (idempotent) + `cancelAllSalesOutbound`.
  Match = ghl_contact_id / portal contact_id / email (all 1:1) OR **phone+athlete-name
  together** (catches dup-contact same-athlete WITHOUT closing a sibling's separate
  opp on the same parent phone). Portal-provider gated + fail-soft; V1 untouched.
- Wired at the TOP of `agent-closing.js` detectForClient (BEFORE the mode gate) so
  every `v2_access` academy is swept each ~15-min closing cron even with closing off.
- Match logic validated vs prod: catches all 3, 0 false-positives. The 3 stuck GTA
  opps were also hand-closed (won + outcome + cards canceled) 2026-07-13.
- ⚠️ Still up to ~15 min to auto-close (safety net, not instant). Possible follow-up:
  make the signup event path itself dup-contact-aware (match member↔opp by
  phone+athlete/email, not just contact id) for INSTANT close. Not built - the
  reconcile net + human-approved Hawkeye sends make 15 min acceptable. NOT prod-verified
  (ships on merge to main; branch pushes don't build bam-portal).

## Related
[[project_v2_sales_audit_2026_07]] (backlog: "handoff doesn't cancel the dropped
booking"), [[project_confirm_agent]] (closing follow-up PLAN + isLiveMember guards),
[[project_hawkeye_mission_control]].
