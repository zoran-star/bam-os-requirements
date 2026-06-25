---
name: V2 Sales Board + Home Dashboard (GTA)
description: 2026-06-24 — the V2 Training-Pipeline board (Responded cockpit, Hawkeye, ghost engine, duplicate detector, stage card rules) + the new V2 Home dashboard. All in client-portal.html, gated _plIsV2(). V1.5 = plain GHL mirror.
type: project
---

# V2 Sales Board + Home Dashboard (BAM GTA)

Big session (2026-06-24) building out the **V2 sales command center** in
`bam-portal/public/client-portal.html`. All board behavior is gated on `_plIsV2()`
(V2_ACCESS); **V1.5 academies see a plain GHL mirror** (no glows/agent/sorting -
the other session shipped that in #746/#747).

## Agent / Hawkeye flow (the brains)
See [[project_followup_forcing_function]] for the quiet-lead → Ghosted model (the
canonical doc). Board surfaces:
- **Responded stage = the day-to-day cockpit.** Per-card badge shows the *actual*
  next action: 💬 Reply / 👻 Send to Ghosted / 🚫 Confirm lost / 📅 Book (from
  `_PL_NEEDS`, loaded via `agent-approvals list-ready`). No badge = clean card,
  sorted to the bottom. 🔄 Scan button fires `detect-now` on both engines.
  Auto-scan on board open (debounced 5 min); cards grey out while scanning.
- **Drawer = inline Hawkeye.** Open a Responded card → the agent suggestion renders
  at the BOTTOM of the message thread (`#pl-d-agent-inline` inside `#pl-d-thread`),
  scrolling as part of the chat. Proposed reply is an editable textarea + a "teach
  why" field that appears on edit. Same actions as the Hawkeye overlay. 📞 call
  button (opens GHL contact) top-right of the drawer header.
- **Hawkeye overlay** (`_apxOpen`): tabs 👻 Went quiet · 💬 Ready · 🚫 Lost · ⏰
  Follow-ups. Cards always carry the conversation snapshot (incl. escalation cards).

## Stage card rules
- **Interested:** card glows RED if no text/email in 5 days (not contacted; uses
  `_PL_LASTMSG` from the GHL inbox list). Permanent.
- **Scheduled Trial:** cards PARTITIONED by phase into groups → today (glowing) /
  〜past〜 / 〜upcoming〜 / no-date, each group rendered whole with its squiggle
  divider in front (`_plUpcomingDivider`). Never strand a card on the wrong side.
  Post-trial form shows only `_plIsScheduledTrialStage(s) && trialStarted` (trial
  already happened), not on upcoming trials.
- **Done Trial:** no Won/Abandon/Lost buttons on the card (in drawer). Shows last
  message time; glows gold only when the LEAD messaged last (inbound). Glow clears
  instantly when staff reply (`_plMsgSend` updates `_PL_LASTMSG`). Lead-last cards
  sort to the top.
- 📨 Special button removed from ALL board cards (still in the drawer).
- Lost/Abandon/Ghost from the drawer play a full-drawer confirmation flash
  (`_plDrawerConfirm`, 1.8s) + remove/move the card optimistically.

## Duplicate detector (V2)
`_PL_DUPS` (computed in `_renderPipelineBoard`): two open opps sharing a phone
(last 10 digits) or athlete name → "⚠ Possible duplicate" banner → `_plResolveDup`
modal lets staff close the redundant card (mark Abandoned). Does NOT merge GHL
contacts (manual). Pair with GHL setting: block duplicate contacts, match by phone.

## V2 Home dashboard
`renderHomeV2()` (branch in `openHomeView`, takes precedence over V15/generic;
container `#home-v2`). Home tab was previously HIDDEN for V2 - now un-hidden
(`_homeHiddenForMe` returns false). Four animated count tiles (hover lift + gold
pulse on non-zero, count-up):
- 📅 Trials today (`calendars-v15?action=trials-today`) → pipeline
- 💬 Done-trial replies waiting (Done-Trial opps whose last inbox msg is inbound) → pipeline
- 👁 Hawkeye actions (followups + list-ready split) → opens pipeline THEN Hawkeye popup (× → pipeline)
- ✉️ Unread messages (inbox `counts.unread`) → inbox

## Post-trial form
New "First message to the parent" field. Backend (`api/ghl/post-trial.js`) composes
`[first message]` + blank line + **bare sign-up URL** (URL only when "add sign-up
link" is on). Sends if note OR link present; never for a no-show.

## Related
- [[project_followup_forcing_function]] — the quiet-lead → Ghosted engine (canonical)
- [[project_client_agent_training]] — Hawkeye queue + brain training
