# V2 Onboarding Wizard - the accepted design (2026-07-18)

The complete redesign of academy onboarding, workshopped end-to-end with Zoran
(session 2026-07-16 → 07-18). This is the SOURCE OF TRUTH for the build.
Clickable mock (kept current through the whole workshop):
https://claude.ai/code/artifact/7cbad936-72ba-4b10-8729-6375b4c7ea74
(committed copy: [`onboarding-wizard-mock.html`](onboarding-wizard-mock.html))

Read with [`../memories/project_v2_onboarding_model.md`](../memories/project_v2_onboarding_model.md)
(canonical model) + [`onboarding-flow-handoff.md`](onboarding-flow-handoff.md) (resume point).

## The shape

Paged wizard replacing the 20-step checklist: **5 sections** in a top bar
(battery segments that fill as sub-steps complete), each section a sub-rail of
pages, Back/Next walks the flat path, bar + rail jump anywhere. Opens on the
first incomplete step. It is a NEW VIEW over the SAME completion flags the old
checklist reads - which is why every academy (including mid-flow ones like
DETAIL) moves to it with progress already lit. One flow, no forks.

Design language: V2 tokens (design-system/tokens.css). No emojis, no em dashes.
Required questions: gold left bar + `required` chip + per-page count.
Conditionals indent with an amber "if X". System actions render as gold rows.
"Our team runs this" steps never block Next.

## Sections and steps (the full question set)

### 1 · Academy
- **Basics** (3 q, all req): Business name · Address · What does your academy
  offer? (single choice: Training - more types coming). Time zone DERIVED from
  address (confirmed later on Schedule, point of use). Legal name/EIN NOT here.
- **Locations** (min ONE required): per location Title* + Address* + Notes.
  Where sessions run - schedule + booking send people here.
- **Staff**: Owner card prefilled (from Add Academy) + "Add a staff member"
  module - Name/Email/Phone/Permissions ALL required per teammate.

### 2 · Brand
- **Look**: Colors = flexible list (picker + editable name + typed hex w/
  validation, add/remove - no fixed primary/secondary/accent slots). Fonts
  (display + body). Logos = Main logo (required) + labeled variations.
- **Your website** (the brief - what site + emails get WRITTEN from):
  - About: Why choose you over competitors?* · Dream athletes? · Your story ·
    Proof (results/credentials/stats). CUT: mission one-liner, vibe words,
    "what do you do" (all derivable/duplicative - AI drafts taglines, owner
    approves on the deck).
  - For the build: existing site link (pull copy/photos) + what did you like
    about it / want to keep (conditional) · reference sites + why · file drop
    for inspiration assets · "Did you build your own website?" switch → drop
    zone for their vibe-coded site. NO domain question (comes at flip), NO
    pages question (post-launch editor).
  - Submit = pings systems team, deck build starts.
- **Socials**: Instagram connect (optional).
- **Branding deck** (renamed from brand board): status lifecycle the owner
  watches (brief submitted → team building → ready) then APPROVES. That
  approval = the brand sign-off (brand_ok). Deck = the GTA-style board
  (fonts/colors/buttons/components) built per client by /brand-scan.

### 3 · Wired
- **Stripe**: one-click connect.
- **Contacts** (first import, people only - no custom values): "Are you using
  GoHighLevel?" toggle → YES: connect + auto-import (sub-account is ours as
  agency) · NO: file drop (CSV/spreadsheet, dedupe automatic).
- **Email**: sending domain + auto DNS check.
- **Texting**: "What should your academy text from?" 3 paths:
  1. **Switching from GoHighLevel** (only if GHL connected): number detected,
     WRAPPED into portal texting from day one, auto-switches to own Twilio when
     A2P clears. Zero paperwork, zero downtime, same number throughout.
  2. **New local number**: auto-picked from address, confirm only.
  3. **Carrier port**: number + carrier/account/PIN + bill upload (the only
     paperwork path).
  Plus A2P registration block: Legal business name* + EIN* + registered
  address* (must match IRS). The two slowest clocks (A2P days, ports weeks)
  start HERE, early, run in background; nothing switches until the end.
- **Ads** (optional, skippable, never blocks launch): "Who runs your ads?"
  → You run them for me: guided grant link (Leadsie NOW → BAM Connect after
  Meta App Review clears) - account/pixel/billing stay THEIRS, we get partner
  access via our Business Manager System User token · I run my own: their
  OAuth (needs App Review) · Not yet: skip, lives in Settings.

### 4 · Offer (wraps the existing training-offer wizard - 6 steps)
- **General info** (5 q): Title* · Short description · Program structure (how
  you train, what a week looks like - moved from killed Value step) · Assets ·
  notes. NO age/skill/gender/location/capacity here - **the class is the
  atom**; offer-level values are ROLLUPS derived from classes.
- **Schedule**: timezone confirm row (point of use) · Classes builder (per
  class: Title* · Age* · Skill · Gender · Max athletes/session* · Location*
  from saved locations · weekly times w/ per-slot location override ·
  irregular-schedule fork) · Season block · NO booking go-live toggle -
  **slots go bookable automatically when pricing lands**.
- **Pricing** (launch must-have): options builder (title/type/price/billing/
  commitments) + Stripe match panel (legacy rates).
- **Policy**: the typed rules (cancellation/pause/refund/makeup) + Extra notes
  ("anything else for the agreement") + **View your agreement - plain draft**
  (instant, unbranded, rules-check only). CUT: parents watching, under-18,
  holiday schedule. The branded/signable agreement is a TEAM-BUILT artifact
  (skill + localhost) because freeform notes need human clause-writing.
- **Sales** (launch must-have): 16 questions → **preset picker + 2**. Pick
  Free Trial preset (only one for now; more coming card greyed) + Staff in
  charge + Info to collect from new leads. Everything else stamped by the
  preset or handled by the team during funnel build. Applying = funnel build
  triggers silently (no "pings our team" copy anywhere owner-facing).
- **Onboarding**: form fields (always-asked + toggles + custom) · Active
  members: file drop ANY layout → columns auto-mapped → matched to plan +
  Stripe sub (confident matches auto-attach; unmatched import badged "needs
  billing") → cleanup → live roster · Cancelled members: STRIPE-pulled, not a
  file (subs ended on offer prices live+legacy → add more prices → match to
  contacts → clean cancel dates) - MUST write `cancellations` rows per
  memories/project_cancellations_contract.md (contacts-only today = KPI
  invisible). Imports NEVER gate the build.

### 5 · Launch
- **Build & review** (merged build-status + review): every artifact lands
  here with status + trigger note + preview link: General site · Sales funnel
  + emails · Onboarding funnel + emails · Email templates · Enrollment
  agreement · Your leads (GHL academies - pipeline sort status). ONE Accept
  moment (site_accepted).
- **Go live**: the launch checklist (computed: pricing, preset, deck approved,
  site accepted) + Flip the domain (wizard: records → their registrar →
  verify; staff concierge for non-technical owners).

## The build pipeline (staff side)

Every owner section-completion triggers a team build chunk, silently
(owner sees status, never "we pinged our team"):

| Trigger (owner) | Team builds (skill + localhost + publish) | Reviewed at |
|---|---|---|
| Website brief submitted | Branding deck (/brand-scan) | Brand > deck approve |
| Deck PUBLISHED (team, not owner approval) | Core pages (site-build phase 1) | Build & review |
| Preset applied | Sales funnel + emails (phase 2) | Build & review |
| Pricing+policy+form all in | Onboarding funnel + emails (phase 3) | Build & review |
| Deck published | Email templates (new skill) | Build & review |
| Policy done + legal name in | Branded agreement (new skill) | Build & review |

Chunk triggers are DATA PRECONDITION SETS, not step flags. Copy-proof
checkbox is DEAD - the team's localhost review before publish IS the proof.
Readiness gate manual sign-offs = brand_ok + site_accepted only (both owner
artifacts; MANUAL list shrinks from the 2026-07-15 three).

## Staff work (the A-list, settled)

9 jobs: 6 artifact builds above + GHL pipeline co-working (fuzzy-match their
stages onto preset → sort every card → INITIALIZE each card's engine state so
agents resume conversations correctly → reconcile) + phone ops (file A2P, run
wrap/port/switch, chase port rejections, test text) + Meta ops (managed only:
verify grant, wire account, pixel/CAPI; create account if never ran ads).
Member imports + DNS = owner-driven, staff exception/concierge only.

## The front door: "Add academy" (staff-initiated)

One staff screen, 4 fields (academy name, owner name/email/phone) + optional
GHL sub-account dropdown. Auto-initializes 7 switches that are manual today:
v2_access on · Slack channel created + wired (today silently no-ops if
forgotten) · welcome ping · ghl_location_id link · owner invite (resend cron
exists) · bam-client-sites scaffold (new-client.mjs at creation, so the site
silo exists before the brief) · wizard state. Deliberately NOT initialized:
Stripe (owner), Meta (Ads step), phone (Texting step), Hawkeye (arming gates).

## Launch (PROPOSED, not final - Zoran parked it)

Launch = the domain flip, one owner-pressed moment. Everything else arms
silently when ITS gate goes green: booking (pricing lands) → pipeline flip
(reconcile clean) → phone switch (A2P clears, invisible thanks to wrap) →
agent go-live (pipeline + engine states + booking + texting all green; agents
work IMPORTED leads before launch = soft launch). Born-on-V2 caveat: no wrap,
so agents wait on A2P. Revisit before build of the Go live page.

## Deferred / parked decisions

- **How the academy pays BAM** - no home in the flow yet (the one open design hole)
- Launch definition final sign-off (proposal above)
- V2 support ticket system + Zoran-icon Slack replacement - full design banked
  in [`zoran-icon-ticket-design.md`](zoran-icon-ticket-design.md); build after
  onboarding as Track 2 of [`v2-master-build-list.md`](v2-master-build-list.md)
- Member import: confirm auto-attach behavior on confident Stripe matches
- KPI alerting + agent escalation queue (B-bucket new builds)
- Multi-offer types (Teams/Camps/etc.) - Basics shows Training only

## The 7 build workstreams

1. **Wizard UI** - the pager + modules + question set (client-portal.html)
2. **Schema deltas** - brand_data extensions, per-class location/capacity,
   rollups, file storage for drops
3. **Trigger + status machinery** - precondition detection → Slack pings,
   per-chunk statuses on website_setup, Build & review page, gate to 2 sign-offs
4. **Skills** - /brand-scan trigger+status wiring · /site-build split into 3
   phases · NEW email-templates skill · NEW agreement skill · GHL migration
   skill (fuzzy match + engine prep)
5. **Imports** - contact file-drop path · member import Stripe auto-attach ·
   cancelled import Stripe-driven + cancellations contract
6. **Integrations** - Leadsie link in Ads step · START Meta App Review (long
   calendar clock, zero eng - kick off immediately) · BAM Connect after ·
   phone wrap wiring (rides V1.5 texting path)
7. **Front door** - Add Academy screen + 7 auto-initializations

Build order: 1+2 together → 3 → 4 → 5 → 6/7 (6's App Review clock starts
day one regardless; 7 is small and standalone - can go anytime).

## Decision log (why questions died - so they stay dead)

- entity_type: zero consumers in code → cut
- Legal name/EIN: only consumer is A2P → moved to Texting
- Time zone: derived from address, confirmed at Schedule (point of use)
- Mission/vibe words: no independent consumer ("story is the anchor, mission/
  vibe ride along") - AI drafts, owner approves on deck
- "What do you do": duplicated Basics offer-type + offer descriptions
- Keep/replace website question: fake choice, we build regardless
- Sales path + trial terms: the preset IS the path
- Offer-level age/skill/gender/location/capacity: class is the atom, rollups
- Booking go-live toggle: automatic on pricing
- Parents watching / under-18 / holiday: cut from Policy (agent facts, not clauses)
- copy_ok: publish is the proof
- Member tag (GHL): fully-off-GHL flow
- Slack for clients: dissolved - portal chat + SMS (staff keep Slack internally)
