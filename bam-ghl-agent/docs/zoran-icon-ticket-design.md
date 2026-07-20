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

---

## T-SCOPE OUTCOME (co-worked + approved 2026-07-20) - supersedes the build
chunks above with the P1-P6 bundle

The scoping pass ran same-day. Full plan approved by Zoran (plan-mode session;
plan file mirrored below in essentials). Codebase scans grounded everything.

**The V2 reframe: three ticket FAMILIES + greenfield architecture.**
- V2 ticket architecture is NEW (Zoran: "we don't have to have the same ticket
  architecture as V1/V1.5... even new front ends / Claude skills"). V1/V1.5
  keep legacy `tickets`, `marketing_tickets`, `content_tickets` + ContentView/
  MarketingView queues UNTOUCHED. No migration - tier split.
- Families: **systems** (fix, website_change, billing_fix, data_fix),
  **marketing** (marketing_ask), **content** (content_ask = "make-something"
  asks - new ads now, more later), plus feature_idea → Zoran (backlog).
- Sales/member-mgmt coverage deliberately thin: clients use the feature-idea
  lane to "bug Zoran" while he finalizes presets; automations text is already
  client-editable self-serve.

**Content Library (P1 spine):** the live Assets feature (client_assets table)
renamed + upgraded. Placement: V2 Business Blueprint focus card + the
bottom-left circle menu (no left-nav item). NEW structured taxonomy (NOT free
tags): content_type action|coaching|culture|testimonial with conditional
fields - action → athlete(s) from CONTACTS + skill presets (6 defaults:
ball-handling, shooting, game-iq, defense, athleticism, passing + client
custom) + highlight/lowlight; coaching → staff (client_users; name-only
add-staff mini modal OK); culture/testimonial → athletes + staff. Uploads are
self-serve (no ticket); constant "keep adding content" nudge.

**Presets = ANGLES.** The client-facing "ad preset" = an angle of their offer's
guide card (guide_cards.angles jsonb; Training has 3: Free session /
Testimonial / Transformation). Flow: in offer → pick angle (+ Other) → angle
guide content → OPTIONAL library attach ("feel free to select anything you
specifically want") or tagged upload → content_ask ticket. The other 9 guide
cards park until their offer types exist. Angles declare `content_types` (jsonb
key added, Cam authors via the staff guide-card editor) → library picker
pre-filters.

**Architecture (approved):** `v2_tickets` + `v2_ticket_messages` (real thread,
realtime, system-author rows double as the status log), `api/v2-tickets.js`
(create/list/thread/reply/status/reassign - ALL mutations through it so T3
notifications get one choke point), `api/content-library.js` (search/skills/
tag), taxonomy tables `client_asset_people` (athlete→contacts,
staff→client_users, display_name snapshots) + `client_content_skills` +
`client_asset_skills`. Existing mock call sites `_v2Submit` (website_change)
and `_mmcSubmit` (content_ask) wire straight in. assignee_role gains
**content**; source gains **offer-flow**.

**The P1-P6 bundle (locked priority Library → ads → systems → icon):**
| P | Ships |
|---|---|
| P1 | Content Library: taxonomy migration + rename + V2 BB card + circle menu + conditional tagging UI + nudge |
| P2 | Library search API + staff-side browser |
| P3 | Ad request flow (rail core rides in here: v2_tickets/messages + API, notify stubbed) |
| P4 | Systems wiring: _v2Submit/_mmcSubmit → rail, staff queue view, portal_feedback backfill, /v2-tickets repoint |
| P5 | Icon popout live (real reads + realtime, bug/feature lanes create tickets) |
| P6 | Notifications T3 (4 channels + client SMS; retrofit WS7/WS3 per-client-channel code) |

Parked still: orchestrator/navigator (T2-b), non-editor side doors (T4), staff
command palette (T5), Notion pipes (T6), B1 rethink, B2 later.

**Interim bridge (shipped with T2-a):** the popout's bug/feature lanes open the
OLD feedback modal (kind preselected) until P5 - V2 academies lose nothing.

**Content <-> Marketing handoff + Ads archive (LOCKED 2026-07-20, from the
V1.5 two-stage flow).** V1.5 had `content_tickets` -> `send-to-marketing`
(`spawnOrUpdateMarketingFromContent`) -> `marketing_tickets` -> `mark-completed`
= ad live, plus `mirrorFilesToAssets` copying ticket files into `client_assets`
(generic `source='ticket'` rows). Bring this onto the V2 rail:
- **Handoff = spawn a linked marketing_ask.** The content team uploads the
  finished creative to the `content_ask`, hits **Send to marketing** -> the
  content_ask completes and spawns a NEW `marketing_ask` ticket (linked back)
  in the Marketing lane with the creative + brief attached. Mirrors V1.5's
  two-table pattern but on the one `v2_tickets` table (linked via a
  `context.origin_ticket_id` or a column). Each lane keeps a clean queue.
- **Marketing posts -> Mark live** closes the marketing_ask and notifies the
  client the ad is running.
- **Auto-archive on Mark live:** the final creative is saved to `client_assets`
  under a NEW **`ads`** category (add to `_ASSET_CATS`), linked to the ticket +
  campaign, VISIBLE to the academy (not the hidden `source='ticket'` rows).
  Add an "Ads" filter to the Content Library so academies browse posted ads and
  the content team reuses winners. Finished ads are OUTPUTS: `category='ads'`,
  no content_type required (content_type stays for raw material).
- **Client-approval gate = OPTIONAL per request, default OFF** (locked
  2026-07-20). Mirrors V1.5 `send-for-review`: the content/marketing team can
  flip "send for client review" on a given ticket; if on, the client approves
  the finished creative before it posts; if off, it goes straight to live. Not
  every ad waits on the client.
These fold into P3b (staff side).

**RESTRUCTURE - the three things an ad request communicates (LOCKED 2026-07-20):
OFFER · SALES PRESET · ANGLE.** Not "angle / guide / campaign" (my P3a mockup
mislabeled them). Correct model:
- **Offer** = what the academy sells (offers table row, e.g. Training).
- **Sales preset** = the funnel/pipeline the offer runs (e.g. Free Trial). It is
  **derived from the offer and chosen when the offer is initialized** (onboarding
  apply-preset). NOT a separate pick at ad-request time - it comes along with the
  offer. Must be stored ON the offer (verify the offer row records its applied
  preset; if not, add it).
- **Angle** = the creative direction (Free session / Testimonial / Transformation),
  authored on the OFFER (via its guide card), NOT matched by title string.
- **Guide (card)** = the INTERNAL container that holds an offer's angles + filming
  tips. Cam authors it. It is NOT a surfaced chip; the angle's tips stay as the
  producer's reference inside the ticket detail.
- **Campaign** = where it runs (secondary context, not one of the three).

Data ties to build (replaces P3a's loose strings): campaign -> real offer_id;
offer -> sales_preset (from init); offer -> angles (guide tied by offer_id).
Ad-request intake stores `offer_id` + `sales_preset` + `angle` (drop the
funnel-name + guide-by-title matching). The ticket, the client creative flow,
and the Content Library all speak Offer · Sales preset · Angle. This is a small
data-model change (offer stores its preset; guide/angles tie to offer) - run
align-core-data-model before building it. Folds into P3b.

**Assignment / routing = REUSE Cam's V1.5 system as-is (LOCKED 2026-07-20).**
The machinery already exists; the V2 rail just points at it. `v2_tickets`
already has `assignee_role` (the lane) + `assigned_to` (the person).
- **content_ask** auto-routes on create via the existing ladder
  (`resolveContentAssignee`): (1) explicit per-ticket admin override, else
  (2) the client's per-channel roster (`clients.content_assignee_ads_id` /
  `_organic_id`), else (3) global default: ads -> Cam (`marketing_manager`),
  organic -> Eli (first `content_executor`), funnel -> Cam. So an ads creative
  arrives already owned by Cam unless overridden. The ticket's "assign" button
  is really "reassign".
- **marketing_ask** (spawned on Send to marketing) is owned by the client's
  Scaling Manager (`clients.scaling_manager_id`, via `clientScalingManager`),
  and pings the marketing executor Ximena (`marketing_executor`) who posts the
  ad (there's an SLA note on her turnaround).
- Reuse the columns + resolver fns directly (resolveContentAssignee,
  clientScalingManager, marketingManagerStaffId, organicDefaultStaffId,
  marketingExecutorSlackId). No new assignment design.

**Client-side surfaces + request-client-action (LOCKED 2026-07-20, mockup
session):**
- **Three zoom levels, one rail:** (A) V2 HOME gets a "Support" attention card -
  simple count + "Needs you" rows, HIDDEN when zero. (B) The ORB POPOUT keeps
  the 4 lanes but its tickets area is just a summary row ("Your requests - 1
  needs you") that taps STRAIGHT into focus mode - no mini-thread in the popout.
  (C) **Support FOCUS MODE** = the house focus-overlay pattern (breadcrumb
  FOCUS - SUPPORT - LIVE): left rail lists their tickets grouped Needs you / In
  progress / Done; main pane = the ticket with a gold "YOUR TEAM NEEDS
  SOMETHING" action card on top + answer box + the shared thread. Mobile stacks
  (list first, tap in). Home = notice it, popout = glance, focus = deal with it.
- **Request-from-client = ONE mechanism, three types:** staff pick "a reply"
  (free question) / "an upload" (content request) / "an approval" (the review
  gate). Sets status waiting_client ("Needs you") + SMS; the request rides the
  shared thread as a highlighted card; client response flips back to
  in_progress. Unifies V1.5 request-client-action + send-for-review.
- **"An upload" opens the SAME Content Library upload popup** (P1 frame) inside
  the support focus mode, with the team's note pinned on top ("CAM ASKED FOR:
  3-5 clips of game footage..."). Files land in the library (taxonomy-tagged as
  usual) AND attach to the ticket. One upload popup everywhere.
- **Staff ticket layout:** reply composer sits BELOW the thread (chat style);
  primary actions above it (Send to marketing - Request from client).

**Three creative doors: NEW / EDIT / REPLACE (LOCKED 2026-07-20).**
- NEW "I want another ad": angle + content + brief -> team produces -> new ad
  posted -> Ads library.
- **EDIT "close, tweak it" (new door):** verdict-driven (Marketing Machine chip
  = edit). Client sends JUST A NOTE - usually no new content. Content team
  adjusts the EXISTING creative; marketing updates the SAME ad (keeps its
  learning); new version replaces it in the Ads library. Intake mode 'edit'.
- REPLACE "retire it": verdict = replace. Client sees what failed (the
  Replacing card), gives new angle + content; old ad stays archived, fresh one
  posted.
- **Tile buttons match the verdict chips:** edit verdict -> "edit this ad"
  button; replace verdict -> "replace". The machine steers the client to the
  right door. The dial: Edit needs ~no new material, New some, Replace most.

**Ticket-type refinements (LOCKED 2026-07-20, mockup session pt 2):**
- **Ads only for now - Organic is OUT.** The content lane types are New / Edit /
  Replace (all ads). Funnel content still routes to Systems. No organic ticket.
- **Edit creative takes a NOTE + OPTIONAL content** (not note-only). Client can
  attach library picks / uploads for the tweak; the ad keeps its learning.
- **7 ticket types total:** content = new / edit / replace; marketing = post /
  budget / remove / new-campaign.
- **Marketing "Post the ad" gets a Download action.** The marketing team
  downloads the finished creative to their device, uploads it into Meta
  manually, then Mark live. (We don't push to Meta's API for creatives; the
  human uploads.)
- **LANDING-PAGE GUARDRAIL - Systems <-> Marketing dependency (LOCKED,
  auto-spawn + auto-unblock).** A campaign's Meta destination must point at a
  real, built landing page (part of the sales preset's funnel). When marketing
  sets up a New campaign for an offer whose landing page isn't live:
  (1) auto-spawn a Systems ticket to build the page, (2) BLOCK the campaign's
  Launch (status Blocked, linked to the Systems ticket), (3) when Systems marks
  the page live, the campaign auto-unblocks + pings marketing. Needs a ticket
  dependency link (e.g. `context.blocked_by` = the Systems ticket id) on the
  rail. No pointing Meta at a dead URL.

**Client-side creative flows (LOCKED 2026-07-20 pt 2):**
- **Three client modals, verdict-driven: New / Edit / Replace.** Which door the
  client sees follows the ad's Marketing Machine verdict chip: keep -> nothing,
  edit -> "Tweak this ad" (note + optional content, SAME ad, no angle change),
  replace -> "Swap for a fresh one" (new angle + content). "New creative" is
  always available from the campaign for more variety.
- **Client focus mode: "+ Add content" is ALWAYS available on any content
  ticket** -> opens the P1 upload popup. Clients can add more content anytime,
  not only when asked.
- **Content approvals show the actual piece IN the window (LOCKED).** Anywhere a
  client is asked to approve content (the review gate / "an approval" request),
  the finished creative is VIEWABLE inline - video plays, images zoom - before
  they can approve. Never approve blind. Approve -> marketing posts; Request
  changes -> back to the content team with the note. Applies to every content
  approval surface (focus mode, the approval request card, the review gate).

**TAG AT EVERY CONTENT IMPORT (LOCKED 2026-07-20).** The content taxonomy must
be applied by the client at EVERY place they import content-for-ads/socials
(clips, footage, reels, graphics). Rule: every "add content" affordance opens
the SAME P1 Content Library upload popup (tag-on-upload), never a raw file
input. Surfaces to route through it: Content Library popup (already tags);
**the Meta creative flow "add new footage"** (currently uploads PLAIN rows -
`_mmcUploadNewFiles` - a P3a GAP to fix); the request-from-client "upload"; the
focus-mode "+ Add content"; the content-ticket "respond with files". 
**Brand-slot uploads AUTO-tag from context** (NOT the taxonomy popup): staff
headshot -> staff tag, location photo -> location tag, offer asset -> offer tag,
logo -> logo category. Mostly already handled by the `asset_bank` uploaders
(offer_id/staff_id/location_id); ensure every non-content upload path sets its
context tag automatically so nothing lands untagged. Boundary: taxonomy popup =
ad/social content; auto-tag = brand-slot assets.

**Content types -> production weight (design note):** action = raw clips,
editors cut, most work; coaching = light trim; culture = B-roll that layers
into any angle; testimonial = lightest edit, strongest ad. **No finished-
creative fast-track (LOCKED):** even ready-to-post uploads pass the content
team (brand/format check) then marketing. One pipeline, no exceptions. Every
path lands files in the Content Library tagged.
