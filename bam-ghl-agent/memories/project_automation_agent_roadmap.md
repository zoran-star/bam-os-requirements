# Automation + Sales Agent Roadmap (decided 2026-06-11)

Goal: replace GHL-native automations with portal-native ones; an AI sales
agent handles replies. GHL shrinks to the messaging pipe + inbox.

## Build phases
1. **Spine** — GHL inbound-message webhook → portal (instant reply events).
   Shared by nudges + agent. No blockers.
2. **Nudge engine** ("sms ghosted" first): enroll when a website lead lands
   at "interested"; strict-schedule texts/emails; instant exits (reply via
   webhook, booking via our endpoint, stage-leave). BLOCKED ON: Zoran's
   message copy + timings. Owner-flag ledger: ENGINE → AGENT → HUMAN; flip
   cancels pending sends atomically; fire-time recheck kills races.
3. **Agent (co-pilot)** — on first reply the agent owns the thread: full
   convo history + lead context, tools = check availability, book slot,
   move pipeline card, schedule_followup (reschedules on every event),
   escalate. Sends via GHL so replies stay in the team inbox.
4. **Agent auto + retire GHL workflows** (escalation rails stay).

## Training rollout (Zoran's 5 steps)
1. Draft the shared system prompt together (seed: sales-conversation-agents/
   conversation-ai-booking-agent-bam-gta.txt, versioned).
2. Sandbox: Zoran texts it as a fake parent; corrections → first lessons.
3. Live for GTA: agent self-rates confidence; unsure → escalation queue
   (Slack ping + portal queue; final UI spot TBD). Zoran's answer + "why"
   is sent AND saved as a lesson.
4. Trusted trainers (Mike + chosen clients) get the same queue via a
   trainer role flag.
5. All academies.

## Agent config = 3 layers
1. Shared brain (one versioned template, all academies inherit upgrades)
2. Academy variables (auto-filled from clients/entry_points/calendars/
   onboarding data — {{PLACEHOLDER}} style)
3. Local lessons (never copied across academies)

## Local vs global lessons: "born local, earns global"
Every lesson is local by default. Weekly promotion queue: AI clusters
similar lessons across academies → BAM approves promotion into the shared
brain (new version). BAM staff can mark global at write time when obvious.

## Success metric
Agent conversations → booked-trial rate (we own the booking event), per
academy and per brain version; plus escalation rate and trainer edit rate.

## Related GHL facts discovered
- GHL API can list workflows (76 at GTA) and add/remove a contact to/from a
  workflow, but CANNOT read which workflows a contact is in — visibility
  needs status tags or our own ledger.
- Agent training UI = Playbook (3 layers) / Review (lessons) / Sandbox tabs.

## When to update
- Any phase ships → update status here
- The local/global promotion mechanism changes
- Trainer roles or metric definitions change
