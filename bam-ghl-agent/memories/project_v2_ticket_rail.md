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

## Wired 2026-07-21 (the W-waves; mockups locked with Zoran first)
- Client surfaces RESTORED (W0): root cause of the twice-shipped marketing-focus
  blank = two unclosed divs in #view-support swallowing the rest of the page.
  Every client-portal wave now runs a marketing-focus probe + div-balance check.
- Feedback (W1): lanes open V2 intakes (no toggle) → rail types fix/feature_idea,
  assignee backlog (Zoran triages; TYPE_ROLE fix→backlog). FC pill vocab:
  Sent/Being fixed/Fixed · Sent/Building/Shipped + gold "Your idea is live"
  card. scripts/feedback-backfill.mjs migrates portal_feedback (dry-run default).
  /v2-tickets skill reads the rail now.
- Website (W2+W4+W5): annotator submits real website_change tickets (context
  verbatim + intake.asset_ids via the review screen's Content Library picker);
  staff Website V2 Sandbox (search, picker, page iframe left / notes right,
  hover highlight); /website-fix skill implements in bam-client-sites.
- Marketing (W3): V2 Meta focus point-of-action Change spend + Remove +
  4-step New campaign wizard (funnel preview - the FREE TRIAL FUNNEL, never
  /enroll - angle reuse, budget chips, final check) → marketing_ask modes.

## Still to wire
- P6: notifications (4 Slack channels + client SMS on status change)
- Sandbox phase 2: one-click in-portal AI drafts
- Cut by Zoran: billing_fix + data_fix (data issues = feedback bugs)
