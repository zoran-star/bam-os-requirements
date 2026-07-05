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

## The one-click trigger (client side)
Button `Request a change` on every V2 module view. One click opens a slim
modal that has ALREADY captured context; client only picks change/add/fix +
1-2 sentences. No forms about which page/metrics - auto-attached.

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

## When building
- New persistent table => run the `align-core-data-model` skill first (fc-core-srvc).
- V2-only (V2-gated); no V1 impact. Staff page lives in bam-portal/src/views.
- Context came out of the Marketing Machine landing-page waterfall work
  ([[project_marketing_machine_dashboard]]).
