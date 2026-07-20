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

**T-scope ran 2026-07-20 (same day):** three ticket FAMILIES (systems /
marketing / content), greenfield `v2_tickets` architecture (V1/V1.5 legacy
tables untouched), Content Library (Assets reborn w/ structured taxonomy tied
to contacts + client_users), presets = guide-card ANGLES. Full outcome in
[`zoran-icon-ticket-design.md`](zoran-icon-ticket-design.md) "T-SCOPE OUTCOME".
The T1-T6 chunks are superseded by the approved P1-P6 bundle:

| # | Chunk | Status |
|---|---|---|
| T2-a | Icon popout FE template + bug/feature lanes bridged to old feedback modal | ✅ built 2026-07-20 (PR #1504) |
| P1 | Content Library: taxonomy migration + rename + V2 BB focus card + circle menu + conditional tagging UI + "keep adding" nudge | ✅ built 2026-07-20 (PR #1504) |
| P2 | Library search (api/content-library.js) + staff-side browser | later |
| P3a | RAIL CORE (v2_tickets + v2_ticket_messages + api/v2-tickets.js, notify stubbed) + client ad request in the Meta creative modal: pick angle (offer guide card) → guide → Content Library picker (filter/multi-select) + upload → content_ask ticket. Entry = Marketing → Meta ads → campaign → +add / replace creative (`_mmc`). | ✅ built 2026-07-20 (PR #1504) |
| P3-restructure | **Ad request speaks Offer · Sales preset · Angle** (not angle/guide/campaign). Tie campaign->offer_id, store the offer's sales_preset (set at offer init), author angles on the offer (guide tied by offer_id, not title). Ad-request intake = offer_id + sales_preset + angle. **TAG AT EVERY CONTENT IMPORT**: route the Meta creative flow "add footage" (`_mmcUploadNewFiles` - currently uploads untagged, a P3a gap) + all P3b content-adds through the P1 tagging popup; brand-slot uploads auto-tag from context. Small data-model change - run align-core-data-model first. | ⬅ before P3b build |
| P3b | Staff side of the ad flow: staff V2 queue view (role tabs, ticket detail showing **Offer · Sales preset · Angle**, shared thread, status/assign) · angle authoring on the offer + content_types · **content->marketing handoff** (Send to marketing spawns a linked marketing_ask, mirrors V1.5) · **Mark live** closes it + notifies client · **auto-archive the finished ad to Content Library `category:'ads'`** (new category + Ads filter) · optional per-request client-review gate (default off) · **assignment = reuse Cam's V1.5 routing as-is** (resolveContentAssignee ladder -> ads=Cam; marketing_ask -> client Scaling Manager + ping Ximena; reuse existing columns/resolvers, keep admin reassign) · **client surfaces: Home attention card (hidden at zero) + orb popout summary row tapping STRAIGHT into a Support focus mode (left rail grouped by status, gold action card, thread)** · **request-from-client (reply / upload / approval - upload opens the P1 library popup with the team's note, files land tagged in library + on the ticket)** · **three creative doors NEW / EDIT / REPLACE with tile buttons matched to verdict chips (Edit = note-only, same ad updated)** · no finished-creative fast-track (one pipeline) · **7 ticket types** (content: new/edit/replace - edit takes note + optional content; marketing: post/budget/remove/new-campaign) · **Post-the-ad has a Download-creative action** (marketing pulls the file, uploads to Meta by hand) · **LANDING-PAGE GUARDRAIL**: New campaign auto-spawns a Systems ticket + blocks Launch until Systems marks the page live, then auto-unblocks + pings marketing (needs a ticket dependency link) · **3 verdict-driven client modals New/Edit/Replace, as a STEPPED WIZARD** (angle → playbook → content → brief → review → sent; convert P3a's single-scroll `_mmc` modal; Edit/Replace reuse screens 2-5, open on the ad first) · **content approvals show the piece inline** (video plays, images zoom - view before approving) · client focus mode "+ Add content" always available on content tickets · ads only, no organic. | after restructure |
| P4 | Systems wiring: _v2Submit/_mmcSubmit → rail · staff V2 queue view · portal_feedback backfill · /v2-tickets repoint | after P3 |
| P5 | Icon popout LIVE: real reads + realtime, lanes create tickets | after P3 |
| P6 | Notifications (T3 decision): 4 function channels (#systems/#marketing/#content/#other) + client SMS on status change · retrofit WS7/WS3 per-client channels | after P3-P5 |

Still parked: orchestrator/navigator lanes (T2-b), non-editor side doors (old
T4), staff command palette (old T5), Notion pipes (old T6). The T3 decision
(4 function Slack channels #systems/#marketing/#content/#other, not per-client)
is captured in the P6 row above + track2-handoff.md.

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
