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

## Related
[[project_v2_sales_audit_2026_07]] (backlog: "handoff doesn't cancel the dropped
booking"), [[project_confirm_agent]] (closing follow-up PLAN + isLiveMember guards),
[[project_hawkeye_mission_control]].
