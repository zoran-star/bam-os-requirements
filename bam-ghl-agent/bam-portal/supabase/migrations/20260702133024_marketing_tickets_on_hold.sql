-- Staff-only "On hold" flag for marketing tickets.
-- Deliberately NOT a status value: the client portal keys its tabs/pills off
-- status ('in-progress'/'completed'/'cancelled'), and a hold must be invisible
-- to clients. Staff UI groups on_hold tickets into their own tab and excludes
-- them from Active/Client Dependent/Overdue.
alter table public.marketing_tickets
  add column if not exists on_hold boolean not null default false;
