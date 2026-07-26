-- Meta Conversions API config, per client.
--
-- Meta only counts a landing page view or a lead when the pixel fires in the
-- visitor's browser, and on mobile ad traffic the pixel is blocked or fails for
-- a large share of real people. BAM GTA's funnel read 212 ad clicks -> 84 Meta
-- "landing page views" while our own first-party beacon recorded 173 distinct
-- fbclids in the same window. Sending the same events server side closes that
-- gap; api/_meta-capi.js stamps each one with the event_id the browser pixel
-- used, so Meta dedupes the pair instead of double counting.
--
-- Shape:
--   {
--     "pixels": [{ "id": "<pixel id>", "token": "<CAPI access token>" }],
--     "test_event_code": "TEST12345"   -- optional, Events Manager testing only
--   }
--
-- NULL (the default) means no server-side events are sent for that client -
-- nothing breaks, the browser pixel just stays the only source. Generate the
-- token in Events Manager > Settings > Conversions API > Generate access token.
--
-- Holds a secret, so it stays service-role only: the clients table's existing
-- RLS already restricts reads, and no client-facing select list includes it.
alter table public.clients
  add column if not exists meta_capi jsonb;

comment on column public.clients.meta_capi is
  'Meta Conversions API config: { pixels: [{ id, token }], test_event_code? }. Service-role only - contains access tokens. NULL = server-side events disabled.';
