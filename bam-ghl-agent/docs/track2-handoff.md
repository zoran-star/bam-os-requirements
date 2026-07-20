# Track 2 handoff - the Zoran icon / V2 ticket system

**For: a fresh Fable chat picking up Track 2.** Onboarding (Track 1) is fully
built and shipped as of 2026-07-19. This is the next big build. Everything you
need to start is here or one link away. Entry point: run `/track2`.

---

## ⛔ Mode for this chat: CO-WORK THE REQUIREMENTS FIRST. DO NOT BUILD YET.

Zoran wants to **workshop the user requirements with you** before a line of code.
The design ([`zoran-icon-ticket-design.md`](zoran-icon-ticket-design.md)) is a
strong sketch, not a locked spec. Your first job is to turn it into locked
requirements WITH Zoran, question by question, in his style:

- Short + visual. Tables, boxes, one decision per message. He has ADHD, is a
  visual learner, hates walls of text.
- Never an em dash anywhere. Hyphens only. (Repo-wide hard rule.)
- Use the AskUserQuestion popup for choices, not "reply 1 or 2" prose.
- One open question at a time. Propose a recommendation, let him react, record
  the decision, move on. This is the same plan-confirm-build rhythm the whole
  onboarding build ran on.

Only AFTER the requirements are locked do you plan + build, chunk by chunk
(T1-T6 below), each one: plain-English plan + user stories -> he confirms ->
build -> PR -> squash-merge.

---

## What Track 2 is (30-second version)

The **lil Zoran icon** (client portal, bottom-right) becomes the ONE front door
for everything a client needs from us. Tap -> 4 simple lanes + free-typed chat.
An orchestrating agent classifies the ask and slot-fills the intake before any
human sees it. **Client-facing Slack dies.** Staff keep Slack internally as the
notification rail. Every ask ends one of three ways: answered now, ticket
created, or a human conversation. Full design + the 9 internal ticket types +
the agent lineup are in [`zoran-icon-ticket-design.md`](zoran-icon-ticket-design.md)
- read it before the first message.

**The deflection rule** (the heart of it): V2 owners have real self-serve
controls now (offer wizard, page editor, member actions). The Navigator's first
job is "you can do that yourself, right here." Only what genuinely needs us
becomes a ticket.

---

## What's already true (don't re-derive this)

- **Onboarding is done.** WS1 wizard, WS3 pipeline+chunks, WS4 skills, WS5
  imports, WS7 Add Academy front door all shipped. See
  [`v2-master-build-list.md`](v2-master-build-list.md) +
  [`memories/project_v2_onboarding_model.md`](../memories/project_v2_onboarding_model.md).
- **The phone spine exists.** Client SMS on ticket status change (T3) rides the
  onboarding texting number. It is real, not hypothetical.
- **`/v2-tickets` is today's staff-side bug queue.** Track 2 unifies it into
  one `tickets` table. That skill is the seed of the staff workbench (T5).
- **The client portal is one big file:** `bam-portal/public/client-portal.html`
  (page-scoped `let` vars, `_obf*`/`_cx*`/`_cimp*` families, V2-gated). After
  ANY edit run `node bam-portal/scripts/verify-client-portal-ui.mjs`.
- **The Zoran icon already renders** on the client portal (feedback widget /
  `portal_feedback`). Track 2 grows it from a feedback button into the 4-lane
  front door - confirm current state in the file before designing on top of it.

---

## Decided already - do NOT re-litigate

**Staff notifications = 4 TEAM channels by function, not per-client (Zoran, 2026-07-20).**
Clients are off Slack in V2, so a channel-per-client has nobody in it but us.
Replace `clients.slack_channel_id` (per-client) with a fixed set of team
channels resolved by name (bot needs `channels:read`, NOT `channels:manage`).

| Ping | Channel |
|---|---|
| Build pipeline (deck, pages, templates, agreement) + new-academy kickoff | `#systems` |
| Marketing asks | `#marketing` |
| Content asks | `#content` |
| Support / billing / data fixes / feature ideas / agent corrections | `#other` |

Every ping carries the academy name in the message text. This IS the staff side
of the notification rail (T3) - design T3 around it. Building it also lets us
retrofit the shipped Add Academy front door (WS7) + onboarding build pings (WS3):
drop the per-client `conversations.create`, repoint to `#systems`. That removes
the Slack `channels:manage` scope requirement entirely. One-time setup: Zoran
creates the 4 channels + invites the BAM bot; resolve ids by name. Surface it as
a plan first (plan-confirm-build), do not silently build.

---

## The requirements agenda (co-work these WITH Zoran)

These are the open questions the design left pending. This is your session
agenda - resolve each one before build.

**Zoran's 4 pending questions:**
1. Marketing/content asks: fold into the one icon front door, keep both doors
   (icon AND the existing Marketing page), or icon-only?
2. Build tickets ("can we sell gift cards?"): triaged by Zoran personally, or
   straight to systems?
3. KPI alerts on day one? (Note: KPI alerting is Track 3 / B2, which Zoran
   parked for LATER - so likely "no, not in Track 2." Confirm and move on.)
4. SLAs: promise response times, or show statuses only? (He was leaning
   statuses-only.)

**The "registry" work to define per ticket type** (the T1 foundation):
- Status model + client-visible states for each of the 9 types
- Notification moments (which status changes fire a staff Slack ping / client SMS)
- The shared `tickets` table shape: `type, client_id, status, assignee_role,
  intake jsonb, thread` (+ whatever the workshop adds)
- Build-ask triage owner (ties to Q2)
- Whether marketing/content keep both doors (ties to Q1)

---

## The build chunks (AFTER requirements lock) - Track 2 T1-T6

| # | Chunk |
|---|---|
| T1 | Unified `tickets` table + statuses + the tickets page (opens from the left circle) |
| T2 | The icon front door: 4 lanes + orchestrator (classify + slot-fill) + bug/feature intake agents |
| T3 | Notification rail: staff Slack pings + client SMS on status change (rides the phone spine) |
| T4 | Point-of-action side doors: flag-this-reply on Inbox, editor send-to-team, import leftovers, billing panel |
| T5 | Staff side: command palette + pre-worked queue (agent drafts, staff approves) - unifies `/v2-tickets` |
| T6 | Pipes: feature ticket -> Notion Backlog · ship -> "your idea is live" SMS |

Recommended order is T1 first (the table everything hangs off), then T2 (the
door), then the rest can flex. But let the locked requirements set the order.

---

## Explicitly OUT of scope for this chat (parked)

- **B1 - Agent escalation queue: NEEDS A RETHINK.** Zoran said the current
  framing doesn't make sense to him. Do NOT build it or design against it.
  When it's revisited it's a separate conversation. (It overlaps ticket type 5,
  "agent correction" - that overlap is probably why it feels off. Flag it if it
  comes up, but don't solve it here.)
- **B2 - KPI alerting: LATER.** Separate small build, scheduled after Track 2.
  Not part of this work.

---

## House rules (same as the whole V2 build)

- **Design system:** V2 is the live product. Read
  [`bam-portal/design-system/DESIGN.md`](../bam-portal/design-system/DESIGN.md)
  before any portal UI. One gold `var(--gold)`, locked radius scale, no emojis
  in product UI, no dash-as-pause in copy.
- **V1 hard rule:** never change V1 behavior. Gate everything V2/V1.5.
- **Worktrees + PRs:** work in a git worktree, PR + squash-merge, keep
  [`project_v2_onboarding_model.md`](../memories/project_v2_onboarding_model.md)
  and this repo's memories current in the same commits.
- **Stale env warning:** `bam-portal/.env.local` SUPABASE_SERVICE_KEY is STALE.
  Use the Supabase MCP or a fresh key.
- **Two-way source of truth:** prototype (`prototype/src/`) and Notion stay in
  sync with what's built. Nudge Zoran to mirror requirement changes into Notion.
- End every message with a Serbia fun fact (Zoran's standing request).

---

## First move for the new chat

1. Read this doc + [`zoran-icon-ticket-design.md`](zoran-icon-ticket-design.md).
2. Confirm the Zoran icon's CURRENT state in `client-portal.html` (what the
   feedback widget does today) so you design on reality.
3. Catch Zoran up in ~5 visual lines: what Track 2 is, what's decided, what's open.
4. Open the requirements agenda above, one question at a time, and co-work it.
5. Do NOT build until the requirements are locked and he says go.
