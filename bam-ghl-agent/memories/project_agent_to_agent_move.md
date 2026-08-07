# Any agent to any agent: "Move the lead" in Hawkeye

Built 2026-08-07 from a real BAM GTA lead (**Ala Babiker**): her closing row was
closed lost on 2026-07-15 and she was sitting in the Booking agent. Staff could
see the wrong agent had her and had no button to say so.

## What it is

Every Hawkeye card's **"Move the lead"** section now offers the two agents that
do NOT hold this lead. One tap arms it and lights the note box (`Why are they
moving?`), the second tap commits. The move then:

1. moves the opportunity to the destination agent's stage,
2. writes an `agent_contact_notes` row naming who moved them and why (this is the
   ONLY way the receiving agent learns anything about it: `contact-memory.js`
   injects active notes into its prompt),
3. drafts the receiving agent's first card **inline** and shows it for review in
   the same modal,
4. cancels the source agent's cards, its `agent_followups`, and any park.

**Nothing sends.** Every card a move produces is `pending`. No path here touches
`shouldAutoSend`.

## Where it lives

| Piece | File |
|---|---|
| Shared move + request handler | `bam-portal/api/agent/_agent-move.js` |
| Booking's inline drafter (pre-existing) | `draftAndQueueRebook`, `api/agent-approvals.js` |
| Confirm's inline drafter (new) | `draftAndQueueConfirm`, `api/agent-confirm.js` |
| Closing's inline drafter (new) | `draftAndQueueClosing`, `api/agent-closing.js` |
| Action, all three APIs | `b.action === "move-agent"` |
| Buttons + overlay | `_hk2Moves` / `_hk2Move` / `_hk2DoAgentMove`, `public/client-portal.html` |
| Test (paper, 5 negative controls) | `node bam-portal/api/_agent-move.test.mjs` |

## Rules that are easy to break

- **Confirm to Booking is NOT a `mv:` button.** It is the older `handoff` op
  (`confirm-handoff`), which does strictly more: it also voids the dropped trial
  booking and files a `rebook` pipeline outcome. Never add a second button for it.
- **No router.** `confirm-handoff` asks `routeTransition` where the academy's
  authored flow sends a "can't make it". A manual move must NOT, because a human
  picked the destination by name and an authored edge could disagree.
- **Failures are loud.** Missing destination stage or no open opportunity returns
  an error and leaves the card in the deck. `confirm-handoff` swallows these on
  purpose (its note is what must land); here the move IS the request.
- **The outcome row is `reopened`, not a status of its own.** `cc_qualified_trials`
  reads the LATEST `pipeline_outcomes` row and scores `lost`/`nurture` as lost. A
  hand-moved lead is back in play, which is exactly what `api/agent/_reopen.js`
  means. A novel `moved_to_*` status would have produced the same number by
  accident.
- **`.hk2-other.open` max-height.** It was 240px and already clipped the 6th
  button before this change. Measured against real markup: Booking's 8-button
  list needs 532px. Now 900px + `overflow-y:auto`. Adding buttons means
  re-measuring, not guessing.

## Not verified

Nothing was run against a live academy. The stage move, the inline draft, and the
`reopened` row are all unexercised against real GHL/Supabase.
