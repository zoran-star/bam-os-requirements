-- Organic content support.
-- 1) content_tickets gets a `channel` so the same table serves both pipelines:
--    'ads'     → client → content → marketing → Meta (existing)
--    'organic' → client → content → client review → creative bank (new)
alter table public.content_tickets
  add column if not exists channel text not null default 'ads';

-- 2) per-client flag (staff turns Organic on for clients who have it)
alter table public.clients
  add column if not exists organic_content boolean not null default false;;
