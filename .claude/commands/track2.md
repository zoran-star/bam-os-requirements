---
description: Pick up Track 2 - the Zoran icon / V2 ticket system (the client-facing Slack replacement). Starts by CO-WORKING the user requirements with Zoran, not building.
---

Resume Track 2: the **Zoran icon / V2 ticket system**, the client-facing Slack
replacement. Onboarding (Track 1) is fully shipped; this is the next big build.

## ⛔ Mode: co-work the requirements FIRST. Do NOT build yet.

The design is a strong sketch, not a locked spec. Zoran wants to workshop the
user requirements WITH you before any code. Lock the requirements question by
question, THEN plan-confirm-build chunk by chunk.

## Do this, in order

1. **Read the handoff doc**:
   [`bam-ghl-agent/docs/track2-handoff.md`](../../bam-ghl-agent/docs/track2-handoff.md).
   It has the mode, what's already true, the requirements agenda, the build
   chunks (T1-T6), and what's parked (B1 needs a rethink, B2/KPI-alerting is
   later). Follow it.
2. **Read the design**:
   [`bam-ghl-agent/docs/zoran-icon-ticket-design.md`](../../bam-ghl-agent/docs/zoran-icon-ticket-design.md).
3. **Confirm current reality**: what the Zoran icon / feedback widget does today
   in `bam-ghl-agent/bam-portal/public/client-portal.html` - design on reality.
4. **Catch Zoran up** in ~5 visual lines (what Track 2 is, what's decided,
   what's open), then open the requirements agenda ONE question at a time.
5. **Do not build** until requirements are locked and he says go.

## Style (non-negotiable)

Short + visual, tables/boxes, one decision per message. AskUserQuestion popups
for choices. Never an em dash. Serbia fun fact at the end of every message.
Worktree + PR + squash-merge when you do get to building. Keep the master build
list ([`v2-master-build-list.md`](../../bam-ghl-agent/docs/v2-master-build-list.md))
Track 2 rows current as chunks ship.
