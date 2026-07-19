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
