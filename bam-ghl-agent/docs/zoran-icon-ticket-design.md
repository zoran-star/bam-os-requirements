# The Zoran icon -> "Talk to our team" + V2 ticket system (design, 2026-07-18)

The client-facing Slack replacement, designed with Zoran during the onboarding
workshop and PARKED until onboarding ships. This doc banks the whole design so
the revisit starts here, not from memory. Build chunks tracked in
[`v2-master-build-list.md`](v2-master-build-list.md) Track 2.

## The idea

The lil Zoran icon (client portal, bottom-right) becomes the ONE front door for
everything a client needs from us. Tap -> 4 lanes + a free-typed chat below.
An orchestrating agent classifies whatever they type into a lane and slot-fills
the intake before any human sees it. Client-facing Slack channels die; staff
keep Slack internally as the notification rail (for now).

```
        ( Z )  <- tap
   +--------------------------+
   |  Where do I...?          |   1 - Navigator (AI answers now, deflects to self-serve)
   |  Get help from our team  |   2 - Support (human lane, agent pre-works)
   |  Report a problem        |   3 - Bug agent (structured intake)
   |  Suggest a feature       |   4 - Feature agent (structured intake)
   +--------------------------+
   |  ...or just type         |   orchestrator classifies + routes
   +--------------------------+
```

Every lane ends in one of three outcomes: answered now, a ticket created, or a
human conversation. Ticket status shows inline in the chat thread AND on a
tickets page (opens from the left circle).

**The deflection rule:** V2 owners have real controls (offer wizard, page
editor, member actions, staff tab). The Navigator's first job is "you can do
that yourself, right here" - only what genuinely needs us becomes a ticket.

## The ticket types (internal; client only ever sees the 4 simple lanes)

| # | Type | Example | Where triggered | How | Routes to | Resolution |
|---|---|---|---|---|---|---|
| 1 | Fix | "booking page won't load" | icon (any page) · staff portal on-behalf · later: health monitor auto-opens | button / classified chat / auto | Systems | config fix, or triage flips to product bug (staff queue) - client never chooses "fix vs bug" |
| 2 | Website change | "new team photos" | icon chat · INSIDE the page editor ("need more? send to team") | classified / Navigator hand-off / editor side door | Systems | page-edit skill -> publish |
| 3 | Billing fix | "parent charged twice" | icon chat · staff portal billing panel | classified / staff file | Systems (Stripe) | Stripe action + record fix |
| 4 | Data fix | "two contacts, same kid" | icon chat · import confirm screens (unresolved fuzzy matches auto-spawn) | classified / auto-spawn | Systems | merge/correct |
| 5 | Agent correction | "AI gave wrong time" | ON the Inbox conversation ("Flag this reply") · icon chat · staff escalation queue | point-of-action flag | Agent supervision | becomes a LESSON + optional takeover - every complaint trains the agent |
| 6 | Marketing ask | "push summer camp" | icon AND existing Marketing page (both doors, same kitchen) | either | existing marketing flow | existing two-stage flow |
| 7 | Content ask | raw clips + "make it hype" | same two surfaces | either | existing content flow | existing |
| 8 | Build ask | "can we sell gift cards?" | icon chat · staff · whiteboard | classified | triage (owner TBD) | scope -> build or backlog |
| 9 | Feature idea | "parents rating sessions" | icon button · chat · triage re-lane | button / classified / reclassify | Backlog, AUTOMATIC | "your idea shipped" SMS to the suggester |

Trigger patterns: (1) every type reachable from free-typed chat; (2) the best
triggers are point-of-action side doors (conversation, editor, import screen,
billing panel) - tickets born where the pain is arrive with context attached;
(3) triage can re-lane anything without breaking the client's thread.

## Notifications

Staff -> Slack (internal, for now). Clients -> SMS on status change (rides the
phone spine from onboarding) -> app push later. One thread, two surfaces.

## Staff side (proposal Zoran liked)

Same brain, staff superpowers: a command palette + workbench. "Jump anywhere"
navigator across clients; THE QUEUE where the orchestrator has pre-worked every
ticket (chased the client for missing details, drafted the reply/fix) and staff
approve or edit - the "agent drafts, staff approves" north star. Staff bug
filing = today's /v2-tickets queue, unified.

## Agent lineup

Orchestrator (routing + slot-fill) · Navigator (FC help) · structured-intake
agent with two forms (bug / feature) · support = human lane with agent pre-work.

## Still to define at build time (the "registry" work)

Per type: status models + client-visible states, notification moments, SLAs
(Zoran leaning statuses-only, no promised times), Build-ask triage owner,
whether marketing/content asks keep both doors. Plus the shared `tickets`
table underneath (type, client_id, status, assignee_role, intake jsonb, thread).

## Open questions Zoran left pending

1. Marketing/content: fold into the one front door, keep both doors, or icon-only?
2. Build tickets: triaged by Zoran personally or straight to systems?
3. KPI alerts day one: churn spike / CPL jump / booking drought / failed payments / agent stuck?
4. SLAs: promise response times or statuses only?

## Requirements LOCKED (co-work session 2026-07-20)

All 4 pending questions + the registry core resolved with Zoran. This section
supersedes the "pending" list above.

**Zoran's 4 questions:**
1. **Sequencing (not "both doors"):** marketing/content isn't built in V2 yet.
   Decision: **build the ticket rail FIRST.** A marketing/content ask is just one
   ticket type, routed to a human (Cam, marketing manager) for now; a real
   dedicated flow plugs into the same `tickets` table later. Nothing waits on it.
2. **Build asks** ("can we sell gift cards?") route **straight to Systems
   (Rosano).** He scopes/builds and escalates to Zoran only if it's bigger than
   one academy. No personal-triage bottleneck.
3. **KPI alerts stay parked** (Track 3 / B2). Track 2 is human-initiated tickets
   only. The table leaves room for a future health monitor to auto-open tickets;
   we build none of that now.
4. **Statuses only, no SLA clock.** Client sees where the ticket is + gets an SMS
   when it changes. No promised response times.

**Registry:**
- **Status model = one shared 5-state ladder for all 9 types** (no per-type
  ladders):
  `new/triaging → in_progress → waiting_client → resolved → closed`
  Client-visible labels: **Received · Working on it · Needs you · Done · Closed**
  (Closed carries a reason note). A shipped feature idea flips to resolved and
  fires the "your idea is live" SMS.
- **Notification moments:**
  - Client **SMS** on: Received, Needs you, Done, Closed. **Skip** "Working on it"
    (noise). 3-4 useful texts max per ticket.
  - Staff **Slack** on: new ticket created (ping the assignee role), and when a
    client replies to a `waiting_client` ticket (ball back in staff court).
- **`tickets` table shape:** `type, client_id, created_by, status, assignee_role
  (systems·agent-supervision·marketing·backlog), intake jsonb, context jsonb
  (page+click breadcrumbs, same as portal_feedback today), source
  (icon-chat·inbox-flag·editor·import·billing·staff), close_reason, timestamps
  (created/updated/resolved)`.
- **Thread = a REAL conversation** (own `ticket_messages` table: client + staff +
  agent post back and forth on the ticket), NOT a status log. This is the actual
  client-facing-Slack replacement. Log-only was rejected because it keeps Slack
  alive.
- **Existing feedback widget:** the 4-lane door **replaces** today's "Got
  feedback?" modal on the same icon. Bug lane = today's Bug, Feature lane =
  today's Feature. Existing `portal_feedback` rows **migrate into `tickets`**;
  `/v2-tickets` reads the new table.

**The door itself (reshaped from the design sketch):** tapping the icon shows the
client's **live tickets list FIRST** (status pills, tap opens the thread), THEN
the 4 lanes to start something new, THEN the free-type box. This folds the
design's separate "tickets page" into the popout - one support home in reach.
The 4 lanes stay as designed: 1 Where do I…? (Navigator) · 2 Get help from our
team (Support) · 3 Report a problem (Bug) · 4 Suggest a feature (Feature).

**T3 notification rail - staff channels LOCKED (Zoran, via onboarding chat
2026-07-20). Carry this; do NOT build until T3.**
Staff notifications go to a fixed set of **4 TEAM channels by FUNCTION**, NOT a
Slack channel per client. Clients are off Slack in V2 (the whole point of the
Zoran icon), so a channel-per-client has nobody in it but us.
- Channels: **#systems · #marketing · #content · #other**
- Routing:
  - Build-pipeline pings (deck, pages, templates, agreement) + new-academy
    kickoff → **#systems**
  - Marketing asks → **#marketing**
  - Content asks → **#content**
  - Support / **bug reports (Fix, "report a problem")** / billing fixes / data
    fixes / feature ideas / agent corrections → **#other**
- **#other = every client-reported ticket born from the icon.** The channel is
  WHO GETS NOTIFIED, separate from WHO DOES THE WORK: a bug still gets fixed by
  Systems, a billing fix still runs through Stripe by Systems, etc. #other is the
  "a client reported/asked something" announcement rail; #systems stays the
  proactive build/onboarding pipeline. (Bug routing to #other locked with Zoran
  2026-07-20; his instinct, consistent with the rest of the icon lanes.)
- Every ping carries the **academy name in the message text** (the channel is no
  longer per-academy).
- Replaces `clients.slack_channel_id` (per-client) with 4 channel ids resolved by
  NAME. Bot needs `channels:read`, NOT `channels:manage`.
- **Retrofit when built:** already-shipped onboarding code creates/uses
  per-client channels - the Add Academy front door (WS7,
  `api/clients.js action=create-academy`) and the build-pipeline pings (WS3,
  `api/offers/setup-status.js evaluateChunks`). Drop the per-client
  `conversations.create`, repoint pings to #systems. That removes the
  `channels:manage` scope entirely (one less one-time setup).
- One-time setup (when built): Zoran creates the 4 channels + invites the BAM
  bot; resolve ids by name.
- **Design T3 around these 4 function channels + client SMS**, never per-client
  channels. Surface it as a plan (plan-confirm-build) when T3 comes up, or sooner
  if the front door / onboarding pings get touched.

**Build path agreed:**
1. **NOW:** front-end-ONLY popout template (live tickets list with MOCK data + 4
   lane buttons + free-type box). Visual only, no backend, no agent. Replaces the
   feedback modal visually. Design-system compliant, V2-gated.
2. **NEXT:** a dedicated **scoping pass on the support-ticket system** (how a
   support ticket actually gets worked, the staff queue + agent pre-work / T5,
   what wiring each lane needs) BEFORE wiring anything. Zoran flagged that much of
   the door's real behavior depends on this and it isn't scoped yet.
3. **THEN:** wire the lanes one at a time on the scoped foundation (T1 real table,
   T2 orchestrator, T3 notifications, etc.).
