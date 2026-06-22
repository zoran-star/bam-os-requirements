-- Per-type monthly organic content credits (V1 hard cap, no billing).
-- A client gets X videos and Y graphics of organic content per calendar month.
-- NULL = unlimited (existing clients unaffected → V1-safe); 0 = none allowed
-- (e.g. a graphics-only client has video credits = 0).
-- "Used" is derived by counting this-month non-cancelled organic content_tickets
-- of that type (counted at request; cancelling frees one). No counter column to drift.
alter table public.clients
  add column if not exists organic_video_credits_per_month   integer,
  add column if not exists organic_graphic_credits_per_month integer;

comment on column public.clients.organic_video_credits_per_month is
  'Monthly organic VIDEO creative allowance. NULL = unlimited, 0 = none. Enforced at request time in api/marketing.js (count this-month non-cancelled organic video tickets).';
comment on column public.clients.organic_graphic_credits_per_month is
  'Monthly organic GRAPHIC creative allowance. NULL = unlimited, 0 = none. Enforced at request time in api/marketing.js (count this-month non-cancelled organic graphic tickets).';
