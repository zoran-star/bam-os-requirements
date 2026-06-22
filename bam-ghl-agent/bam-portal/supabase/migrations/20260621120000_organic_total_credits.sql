-- Combined monthly organic pool: most content clients get N creatives/month they
-- can split between video and graphic however they want (e.g. Jeremy Major = 12,
-- any mix). The existing per-type columns stay as optional HARD CAPS for restricted
-- clients (e.g. graphics-only = video cap 0). A request must pass BOTH the pool
-- (if set) AND the per-type cap (if set). NULL = no combined limit -> V1-safe.
alter table public.clients
  add column if not exists organic_total_credits_per_month integer;

comment on column public.clients.organic_total_credits_per_month is
  'Combined monthly organic creative pool (video + graphic draw from it). NULL = no combined limit. Enforced at request time in api/marketing.js alongside the per-type caps.';
