# V2 master build list (2026-07-18)

Everything buildable that came out of the onboarding redesign workshop, in one
place with status - so nothing lives only in a chat. Sources:
[`onboarding-wizard-spec.md`](onboarding-wizard-spec.md) (the wizard + pipeline),
[`zoran-icon-ticket-design.md`](zoran-icon-ticket-design.md) (the Slack
replacement). Update statuses here as PRs land.

## Track 1 - Onboarding (ACTIVE - plan-confirm-build with Zoran)

| # | Workstream | Status |
|---|---|---|
| 1 | Wizard UI - paged shell | **PR-1 SHIPPED** (#1489, 2026-07-18) - shell live for all V2 academies |
| 1b | Wizard UI - collection pages (Contacts GHL-fork, Texting number+A2P, Ads) | **SHIPPED** (#1491) + design-system pass |
| 1c | Wizard UI - offer wrap-in-place + Brand/General card audits | **SHIPPED** (PR-3) - offer editor mounts inside the flow; brand story block = why-us/dream-athletes/proof; entity type cut. Offer-config class-atom rollups ride WS2 |
| 2 | Schema deltas (brand_data extensions, per-class location/capacity, rollups, drop storage) | rides 1b/1c |
| 3 | Trigger + status machinery | **SHIPPED** (WS3 PR) - chunk statuses on website_setup.chunks, triggers evaluate in setup-status (owner-activity driven) + Slack pings, brief Submit moment, Launch chunk board, Activation chunk controls, gate = 2 owner sign-offs (copy_ok retired) |
| 4 | Skills | **SHIPPED** (bam-client-sites #89 + portal PR) - /brand-scan RENAMED /branding-deck (wizard-brief gathering, closes its chunk) · site-build --phase core|sales|onboarding · NEW /email-templates + /agreement skills · scripts/mark-chunk.mjs closes every loop · ghl-pipeline-import gained the engine-prep launch-safety step · Slack ping names the new runbooks |
| 5 | Imports (contact file-drop path · member import Stripe auto-attach · cancelled import Stripe-driven + cancellations contract) | **SHIPPED** (feat/imports-plan5, 2026-07-18) - cancelled import writes `cancellations` rows (chains fold plan switches, came-backs excluded, flags default OUT of churn until a human counts them in) · member promote adopts live subs (origin=fullcontrol-import, billing_portal_owned) · NEW api/contacts/import.js + wizard file-drop · unknown-column fates everywhere (create field / archive on record / skip) |
| 6 | Integrations (Leadsie link in Ads step · BAM Connect post-App-Review · phone wrap wiring) | queued |
| 7 | Front door - "Add academy" (4 fields + GHL dropdown → 7 auto-initializations: v2_access, Slack channel, welcome ping, GHL link, invite, sites scaffold, wizard state) | **SHIPPED** (feat/add-academy + bam-client-sites #90, 2026-07-19) - clients.js action=create-academy (idempotent = the checklist's Retry) · Add Academy modal replaces New client (plain-row escape hatch stays) · Slack conversations.create + staff kickoff ping · GHL name→locationId from GHL_LOCATIONS_JSON (the ONE flag driving the wizard's has_ghl forks, already wired since PR-2) · scaffold robot = workflow_dispatch new-client.yml. ⚠ Needs Zoran one-time: Slack app channels:manage scope + GITHUB_DISPATCH_TOKEN in Vercel (see Clocks) |

## Track 2 - The Zoran icon / V2 ticket system (IN PROGRESS)

Full design in [`zoran-icon-ticket-design.md`](zoran-icon-ticket-design.md).
**Requirements LOCKED with Zoran 2026-07-20** (see the "Requirements LOCKED"
section in the design doc). Handoff: [`track2-handoff.md`](track2-handoff.md).
Replaces client-facing Slack.

**Locked decisions (headline):** ticket rail first (marketing/content later, an
ask routes to Cam for now) · build asks straight to Systems (Rosano) · KPI alerts
parked (Track 3) · statuses-only, no SLA clock · one shared 5-state ladder
(Received/Working on it/Needs you/Done/Closed) for all 9 types · SMS on
Received/Needs you/Done/Closed, Slack on new + client-reply · real conversation
thread (Slack replacement) · 4-lane door replaces today's feedback modal,
`portal_feedback` migrates into `tickets`.

**The door reshaped:** the icon popout shows live tickets FIRST, then the 4 lanes,
then the free-type box (folds the old "tickets page" into the popout).

Build order (revised): FE template first, then a support-ticket scoping pass
BEFORE wiring, then wire lanes on the scoped foundation.

| # | Chunk | Status |
|---|---|---|
| T2-a | Icon popout FE template: live tickets list (mock) + 4 lanes + free-type + thread view. V2-gated, replaces feedback modal visually. No backend. | ✅ built 2026-07-20 (PR pending) |
| T-scope | Support-ticket system scoping pass (how tickets get worked, staff queue + agent pre-work, wiring per lane) | ⬅ NEXT (requirements, before any wiring) |
| T1 | Unified tickets table + statuses + real tickets list behind the popout | after scope |
| T2 | Orchestrator (classify + slot-fill) + bug/feature intake agents wired to the lanes | after scope |
| T3 | Notification rail: staff Slack pings + client SMS on status change (rides the phone spine) | later |
| T4 | Point-of-action side doors (flag-this-reply on Inbox, editor send-to-team, import leftovers, billing panel) | later |
| T5 | Staff side: command palette + pre-worked queue (agent drafts, staff approves) | later |
| T6 | Pipes: feature ticket → Notion Backlog · ship → "your idea is live" SMS | later |

## Track 3 - Running-the-business builds (B-bucket, standalone, schedule anytime)

| # | Build | Why | Status |
|---|---|---|---|
| B1 | **Agent escalation queue** - agent-unsure / off-script conversations surface to staff with context + drafted reply | today someone has to notice; this makes it a queue | ⚠ NEEDS RETHINK (Zoran 2026-07-19: framing doesn't make sense; overlaps Track 2 ticket type 5 "agent correction" - revisit as its own conversation, do not build against it) |
| B2 | **KPI alerting** - thresholds ping staff (churn spike, CPL jump, booking drought, failed payments) | replaces "Zoran stares at dashboards" | LATER (small standalone, schedule after Track 2) |

## Clocks and decisions (not code)

| Item | Owner | Note |
|---|---|---|
| **START Meta App Review** | Zoran/staff | THE long calendar clock (weeks), zero eng to start, unlocks BAM Connect + self-serve ads. Kick off ASAP |
| **Front-door env, one-time** | Zoran | (1) Slack app: add `channels:manage` bot scope + reinstall, else channel creation fails with a clear amber row. (2) Vercel bam-portal env: `GITHUB_DISPATCH_TOKEN` = fine-grained PAT, actions:write on zoran-star/bam-client-sites, else scaffold falls back to the Slack paste command |
| How the academy pays BAM | Zoran | The one open design hole in onboarding - no home in the flow yet |
| Launch definition final call | Zoran | Proposal in the spec (domain flip = the moment, everything else arms silently) |
| Member import auto-attach behavior | DECIDED + shipped (WS5) | confident match with a live sub = billing attaches itself (sub adopted); fuzzy stays badged |
| Imported cancels in churn-rate math | decided-ish | flagged rows default OUT until a human counts them in (WS5); rate-denominator detail still per cancellations contract note |
