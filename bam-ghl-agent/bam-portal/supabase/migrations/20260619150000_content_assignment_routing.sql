-- Content routing / assignment. Each content_ticket gets an owner on the content
-- team; clients carry a per-channel default content person (organic vs ads) that
-- the admin roster manages. Routing precedence at ticket-create time:
--   ticket.assigned_to (explicit admin override)
--     else client.content_assignee_<channel>_id (admin roster)
--       else the global channel default (env: organic -> Eli, ads -> Cam).
-- Assignee is STAFF-INTERNAL: it is never surfaced to the client portal.
-- All columns are additive and nullable -> zero impact on V1 academies.

-- Per-creative owner. Mirrors marketing_tickets.assigned_to. on delete set null
-- so archiving/removing a staff member leaves the ticket (falls back to default).
alter table public.content_tickets
  add column if not exists assigned_to uuid references public.staff(id) on delete set null;

create index if not exists content_tickets_assigned_to_idx
  on public.content_tickets(assigned_to);

comment on column public.content_tickets.assigned_to is
  'Content-team owner of this creative (staff.id). Set at create time by channel-routing (see clients.content_assignee_* + env defaults); admin can override per ticket. Internal — never sent to the client portal.';

-- Per-client, per-channel default content person managed by the admin roster.
-- NULL -> fall through to the global channel default.
alter table public.clients
  add column if not exists content_assignee_organic_id uuid references public.staff(id) on delete set null,
  add column if not exists content_assignee_ads_id     uuid references public.staff(id) on delete set null;

comment on column public.clients.content_assignee_organic_id is
  'Admin-roster override: staff.id who owns this client''s ORGANIC content. NULL = use the global organic default.';
comment on column public.clients.content_assignee_ads_id is
  'Admin-roster override: staff.id who owns this client''s ADS (digital marketing) content. NULL = use the global ads default.';
