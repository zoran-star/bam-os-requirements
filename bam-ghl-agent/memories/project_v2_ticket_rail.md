# V2 Ticket Rail (Track 2)

Greenfield V2 ticket system (Track 2 P3, 2026-07-20). V1/V1.5 legacy `tickets` /
`marketing_tickets` / `content_tickets` are UNTOUCHED - V2 academies ride this
rail. Full design: `docs/zoran-icon-ticket-design.md` "T-SCOPE OUTCOME".

## Tables (migration `20260720180000_v2_tickets_rail.sql`, applied to prod)
- **`v2_tickets`**: type (fix/website_change/billing_fix/data_fix/agent_correction/
  marketing_ask/content_ask/build_ask/feature_idea/general), status (new →
  in_progress → waiting_client → resolved → closed), assignee_role (systems/
  agent_supervision/marketing/content/backlog), assigned_to→staff, title,
  created_by→client_users / created_by_staff→staff, source (icon-chat/inbox-flag/
  editor/import/billing/staff/offer-flow), intake jsonb, context jsonb,
  close_reason, legacy_feedback_id, timestamps. Realtime-published.
- **`v2_ticket_messages`**: the real thread. author_kind client/staff/agent/
  **system** (system rows = the status log), body, attachments jsonb, internal
  bool (staff-only, stripped for clients). Trigger touches v2_tickets.updated_at.
- RLS: staff all; client select/insert own; NO client UPDATE on tickets (status
  moves via API). Client sees internal=false messages only.

## API `api/v2-tickets.js`
Every mutation flows through here (one hook point for P6 notifications, stubbed
as `notifyTicketEvent`). Actions: create / list / thread / reply / status.
`TYPE_ROLE` maps type→assignee_role server-side. resolveUser clones the
marketing.js pattern (Bearer token → owner/membership validation, no IDOR).

## First consumer (P3a): Meta creative flow
Marketing → Meta ads → campaign → "+ add a new creative" / "replace" opens the
`_mmc` modal (client-portal.html ~59006). Now: pick ANGLE (from the campaign's
offer guide card via `_fetchGuideCards`/`_cardAngles`, matched by offer title,
else default card) → shows the angle's guide → **Content Library picker**
(`_mmcLoadLibrary`, filter by content_type, multi-select) + upload (new files
land in client-assets too) → brief → `_mmcSubmit` POSTs
`/api/v2-tickets?action=create` a `content_ask` (source='editor'). The old
`_v2Submit` (page-annotator) + icon popup are still on the mock/FE path (P4/P5).

## Still to wire
- P3b: staff angle content_types authoring + staff V2 queue view
- P4: page-annotator `_v2Submit` → rail; portal_feedback backfill; /v2-tickets repoint
- P5: icon popout live on the rail
- P6: notifications (4 Slack channels + client SMS)
