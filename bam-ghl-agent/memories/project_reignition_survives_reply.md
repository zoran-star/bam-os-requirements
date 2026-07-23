# A scheduled reignition ("Reignite later") outranks the follow-up plan

**Date:** 2026-07-23 · **Trigger:** Mike Sandhu (BAM GTA, contact `OPnNy8YOBIfH2L0FASGQ`)

## What went wrong

| When | What happened |
|---|---|
| Jul 16 17:02 | Zoran manually parked Mike, reignite date **Jul 28**. The 2 pending closing follow-up cards were correctly cancelled. |
| Jul 21 23:05 | Mike sent a **logistics** reply ("Ranjit can't make today, he'll be there Thursday"). The inbound webhook's `cancelAllSalesOutbound` **deleted the park** (`cancel_reason: "lead replied before the reignition date"`). |
| Jul 22 13:33 | Closing detector saw no park -> queued a fresh **2-message follow-up plan** (`followup_1` + `followup_2`) in Hawkeye. Exactly what the park existed to prevent. |

Root cause: the park was treated as disposable on ANY inbound. Every proactive
engine keys off "is there a scheduled park?", so deleting it silently re-opened
the lead to the follow-up cadence.

## The rule now

**A scheduled reignition IS that lead's next follow-up.** Nothing may stack a
multi-message follow-up plan on top of it.

- A **reply** cancels the queued CARDS but **keeps the park**
  (`cancelAllSalesOutbound({ keepReignition: true })` from both inbound webhooks).
- A parked lead who replies still gets **answered** (reactive draft runs) - the
  park just stays, so the PROACTIVE branches stay suppressed.
- Only a **terminal move** clears a park: enroll, lost, unqualified, ghosted,
  already-a-paying-member, leaving the stage, bot mute, or the park firing on its
  date. Conversion callers (Stripe signup, `_reconcile-members`) still cancel it -
  a paying member must never get a parked re-engagement.
- `hasScheduledReignition(clientId, contactId)` in [`api/agent/_reignite.js`](../bam-portal/api/agent/_reignite.js)
  is the hard gate at the top of `maybeFollowUpOrNurture` (the plan drafter in
  [`api/agent-closing.js`](../bam-portal/api/agent-closing.js)). It **fails CLOSED**:
  if we cannot prove the lead is unparked, draft nothing.

## Files

`api/agent/_reignite.js` (new `hasScheduledReignition`), `api/agent/_cancel-outbound.js`
(`keepReignition` opt), `api/ghl/inbound-webhook.js`, `api/twilio/inbound-webhook.js`,
`api/agent-closing.js`, `api/agent-confirm.js`, `api/agent-approvals.js`.

Related: [[project_signup_cancel_sweep]], [[project_hawkeye_mission_control]].
