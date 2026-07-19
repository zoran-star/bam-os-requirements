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
| 3 | Trigger + status machinery (section-complete → team pings, per-chunk build statuses, Build & review reads them, gate → 2 owner sign-offs) | queued |
| 4 | Skills (brand-scan trigger wiring · site-build 3-phase split · NEW email-templates skill · NEW agreement skill · GHL migration skill w/ fuzzy match + engine prep) | queued |
| 5 | Imports (contact file-drop path · member import Stripe auto-attach · cancelled import Stripe-driven + cancellations contract) | queued |
| 6 | Integrations (Leadsie link in Ads step · BAM Connect post-App-Review · phone wrap wiring) | queued |
| 7 | Front door - "Add academy" (4 fields + GHL dropdown → 7 auto-initializations: v2_access, Slack channel, welcome ping, GHL link, invite, sites scaffold, wizard state) | queued, standalone - can go anytime |

## Track 2 - The Zoran icon / V2 ticket system (DESIGNED, build after onboarding)

Full design in [`zoran-icon-ticket-design.md`](zoran-icon-ticket-design.md).
Replaces client-facing Slack. Build chunks when we pick it up:

| # | Chunk |
|---|---|
| T1 | Unified tickets table + statuses + the tickets page (left circle) |
| T2 | The icon front door: 4 lanes + orchestrator (classify + slot-fill) + bug/feature intake agents |
| T3 | Notification rail: staff Slack pings + client SMS on status change (rides the phone spine) |
| T4 | Point-of-action side doors (flag-this-reply on Inbox, editor send-to-team, import leftovers, billing panel) |
| T5 | Staff side: command palette + pre-worked queue (agent drafts, staff approves) |
| T6 | Pipes: feature ticket → Notion Backlog · ship → "your idea is live" SMS |

## Track 3 - Running-the-business builds (B-bucket, standalone, schedule anytime)

| # | Build | Why |
|---|---|---|
| B1 | **Agent escalation queue** - agent-unsure / off-script conversations surface to staff with context + drafted reply | today someone has to notice; this makes it a queue |
| B2 | **KPI alerting** - thresholds ping staff (churn spike, CPL jump, booking drought, failed payments) | replaces "Zoran stares at dashboards" |

## Clocks and decisions (not code)

| Item | Owner | Note |
|---|---|---|
| **START Meta App Review** | Zoran/staff | THE long calendar clock (weeks), zero eng to start, unlocks BAM Connect + self-serve ads. Kick off ASAP |
| How the academy pays BAM | Zoran | The one open design hole in onboarding - no home in the flow yet |
| Launch definition final call | Zoran | Proposal in the spec (domain flip = the moment, everything else arms silently) |
| Member import auto-attach behavior | workshop at WS5 | confirm confident-match auto-attach vs "needs billing" badge |
| Imported cancels in churn-rate math | decided-ish | count in calculations post-clean; rate-denominator detail per cancellations contract note |
