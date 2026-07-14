# V2 Support Tickets + Staff V2 Systems page (PLAN - not built yet)

Planned 2026-07-05 with Zoran. One-click "Request a change" button on V2
module views (client portal) -> a dedicated V2-only ticket queue in the
STAFF portal. Separate from the existing marketing_tickets / content_tickets
flow on purpose.

## Decisions locked (Zoran 2026-07-05)
- **Storage: NEW `v2_support_tickets` table** (not reusing marketing_tickets /
  Asana). Purpose-built so the auto-captured context snapshot lives with it.
- **Staff page: PER-MODULE tabs** (Landing Page, Meta Ads, Dashboard/KPIs, ...
  extensible). Each tab = its own kanban across all clients.
- **Fulfillment: staff-manual first.** GHL agent drafting the change is a
  LATER phase, not launch.

## Meta Ads creative requests (front end built 2026-07-05)
The marketing-machine creatives section (`_mmRenderMetaFocus`) has per-creative
**replace** + per-ad-set **+ add a new creative** buttons. They open a centered
modal (`#mmCreativeModal`, `_mmcOpen('add'|'replace', idx)` / `_mmcRender` /
`_mmcSubmit` in client-portal.html), built on design-system v1.5 (`.mmc-*`
classes, tokens). Fields: format picker (9:16/4:5/1:1/16:9), asset upload + Drive
link, brief. Replace mode pre-loads the losing creative (thumb + cpl/hook/freq/
spend + the verdict's why-note) and reframes the brief as "what to keep, what to
beat". Context maps `window._MMC_REP` / `_MMC_ADD` (rebuilt each render) carry
campaign/ad set/offer + the creative being replaced into the payload. Submit is
MOCKED (`console.log('[v2-creative] MOCK submit')` + toast) until
v2_support_tickets lands, same pattern as the landing-page flow. Locked with
Zoran: centered modal (not drawer), assets+brief required, mock backend. The
**delete** button is still the old `_mmCreativeAction` toast stub.
Confirmed flow before building (Zoran asked to). Decisions via popup:
modal / assets+brief / mock-now.

## The one-click trigger (client side)
Button `Request a change` on every V2 module view. One click opens a slim
modal that has ALREADY captured context; client only picks change/add/fix +
1-2 sentences. No forms about which page/metrics - auto-attached.

## Where the tracker lives (Zoran 2026-07-05, built)
The support-ticket TRACKER does NOT live on the marketing/landing focus view.
It lives on the **Systems page** (`#view-systems`, "Systems Support Tickets",
the existing real ticket list off the `tickets` global). The landing focus view
instead shows a **nudge** (`_v2TicketsNudgeHtml` in client-portal.html) that
renders ONLY when there are live (non-terminal) tickets: gold + "N to reply"
badge when any are awaiting_client/final_review, neutral "in progress"
otherwise, hidden when nothing is live. Click -> `_v2GoToTickets()` =
closeLandingMachine() + switchView('systems'). The old mock "Your requests"
list (_V2_REQUESTS / _v2ActionItemsHtml) was removed.

## Page annotation flow (Landing Page view - Zoran 2026-07-05)
V2 landing pages are OUR OWN pages (bam-client-sites), NOT GHL - so a LIVE
IFRAME works (no X-Frame-Options block; we control the headers). UX must be
dead simple:
- Portal opens the live V2 landing page in an iframe in "annotate mode".
- Hovering a SECTION highlights it; clicking it pops out a note input anchored
  to that section.
- Each note = {section id/label + note text}; they accumulate and ride along
  with the ticket context (page URL + metric snapshot + flagged leak).
- Needs an annotation BRIDGE in bam-client-sites (separate repo): mark sections
  with a stable id/label, and on ?annotate=1 (or postMessage handshake) add
  hover-highlight + post the clicked section back to the parent via
  postMessage. Portal side listens and renders the note popover. CROSS-REPO
  dependency - portal side can ship first with the listener; pages light up
  once the bridge lands.

## Ticket structure (v2_support_tickets)
id, client_id, module (landing-page/meta-ads/...), request_type
(change|add|fix), title, description, context (metric snapshot + flagged
leak + page URL + screenshot), priority, status (new->triaged->in_progress->
shipped->closed; also rejected/on_hold), assignee, source
(v2_portal_oneclick), created_by, created_at, staff_notes/thread,
resolution, shipped_at.

## End-to-end flow
1. Client clicks "Request a change" on a V2 module view
2. Slim modal: pick change/add/fix + 2 lines (page/metrics/leak/screenshot auto-attached)
3. Save to v2_support_tickets + Slack ping to staff
4. Lands on the staff V2 Systems page (per-module tab queue)
5. Staff triage, assign, build (agent may draft in a later phase)
6. Ship -> client notified, ticket closes (client sees "done")

## Build order
1. table + submit API + one-click modal on the Landing Page view
2. staff V2 Systems page (per-module tabs, statuses)
3. notifications (Slack now; client status visibility)
4. LATER: GHL agent drafts the change from ticket context for staff approval

## Annotator = INLINE dropdown (Zoran 2026-07-05, revised)
Reworked from a modal to an INLINE collapsible on the landing focus view:
- "Request a change to this page" is a gold DROPDOWN bar (`_v2Toggle` / `_V2_OPEN`
  / chevron); expands a panel in place (`_v2InlineHtml`, `_v2Sync` restores
  open state across a focus re-render).
- Change/Add/Fix picker at top; 2-col body = LIVE iframe of the real page (left)
  + notes stacked on the RIGHT; footer = optional description + "Send request"
  bottom-right.
- The iframe loads the REAL landing page from `page.url` (marketing.js meta-
  machine now builds it: most-common page_view path from funnel_events.url +
  the client's preferred allowed_domain, skipping *.vercel.app/www). GTA =
  https://www.byanymeanstoronto.ca/free-trial (frameable, no X-Frame-Options).
- Each note editable (pencil / click text -> note popover) + deletable (x);
  parent-side click overlay drops numbered pins over the iframe.

## Status (2026-07-05)
FRONTEND SHIPPED, backend stubbed (Zoran chose "skip the table for now" because
core repo Full-Control/fc-core-srvc is inaccessible - "Repository not found" for
the zoran-star account, so align-core-data-model could not run). In
client-portal.html (V2 landing focus view):
- "Request a change to this page" button + `#v2ReqModal` annotator: live iframe
  (`_MM.page.url` / `window._V2_PAGE_URL`) with a parent-side click overlay that
  drops numbered pins + note popover (`_v2PinAt` / `_v2NoteSave` / `_v2RenderNotes`).
  Change/Add/Fix picker + optional description. `_v2Submit` MOCKS the POST
  (console.log payload + optimistic row) - TODO real `POST /api/v2-support-tickets`.
- `_v2ActionItemsHtml()` renders "Your requests" (V1-style status list) from the
  `_V2_REQUESTS` MOCK array - swap for a fetch once the table lands.
- postMessage listener (`type:'fc-annotate'`) is LIVE. The bam-client-sites
  bridge (`clients/bam-gta/gta/annotate.js`, merged PR #54) outlines sections on
  hover + posts `section-click` (label from `data-fc-section` or heading, coords,
  html2canvas thumbnail). GOTCHA fixed 2026-07-13 (sites PR #67): the bridge was
  only `<script>`-tagged on `free-trial.html`, so the contact page (and all
  others) were un-clickable. Now `gta/shared.jsx` auto-injects `annotate.js` on
  EVERY GTA page in annotate mode, so no page can be missed. Portal now stamps
  `offer_id`+`funnel_id` on the submit payload (bam-os PR #1391) to tie a request
  to its offer.
STILL TODO (needs core access): v2_support_tickets table + submit API + wire the
mocks to it; staff V2 Systems page.

## When building
- New persistent table => run the `align-core-data-model` skill first (fc-core-srvc).
- V2-only (V2-gated); no V1 impact. Staff page lives in bam-portal/src/views.
- Context came out of the Marketing Machine landing-page waterfall work
  ([[project_marketing_machine_dashboard]]).
