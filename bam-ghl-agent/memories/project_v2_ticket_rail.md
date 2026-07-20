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

## Staff pages (built 2026-07-20)
Two NEW staff-portal pages on the V2 rail, V2 design system (tokens.css), nav
keys `content-v2` + `marketing-v2` (App.jsx), gated by canSeeContent/
canSeeMarketing. Legacy ContentView/MarketingView UNTOUCHED.
- Shared primitives: `src/components/v2rail/` (V2Page, StatusPill, StatusLadder,
  QueueRow, TicketDrawer, v2rail.css).
- `src/views/ContentV2View.jsx` + `contentv2/` - queue (New/In progress/Needs
  client/Done) + workbench drawer: Offer/Preset/Angle chips, client content,
  upload-finished, request-from-client (reply/upload/approval), send-to-marketing
  (+ review gate), thread w/ internal notes.
- `src/views/MarketingV2View.jsx` + `marketingv2/` - queue by mode (post/budget/
  remove/new-campaign) + per-mode drawer: Download creative + Mark live (post),
  spend/reason (budget), remove, new-campaign with the landing-page GUARDRAIL
  (context.blocked_by -> disabled Launch + Ping Systems).
- Reads via supabase-js + realtime; mutations via /api/v2-tickets (Bearer token).
- API (api/v2-tickets.js) actions added: auto-assign on create (Cam ladder),
  upload-final, send-to-marketing (spawns linked marketing_ask), mark-live
  (+ archive finals to client_assets category 'ads'), request-client-action,
  reassign.

## Audio-as-assets (2026-07-20)
Content Library + upload flows accept ALL audio formats (accept image/video/
audio, audio/* -> category 'audio', "Audio" filter tab, audio assets render as
`<audio controls>` in the grid/tag-popup/creative-picker + the staff drawers via
an isAudio branch). Migration `20260720210000_ticket_files_allow_audio.sql`
widens the ticket-files bucket MIME allowlist (client-assets is unrestricted).

## Still to wire
- P3b: staff angle content_types authoring + staff V2 queue view
- P4: page-annotator `_v2Submit` → rail; portal_feedback backfill; /v2-tickets repoint
- P5: icon popout live on the rail
- P6: notifications (4 Slack channels + client SMS)
