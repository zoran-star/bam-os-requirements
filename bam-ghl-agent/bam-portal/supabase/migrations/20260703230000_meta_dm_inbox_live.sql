-- Meta DM spine (4/4): inbox_live gate. status='active' only means the webhook
-- STORES what Meta delivers; under Standard Access that is app-role senders
-- only, so real leads' IG/FB DMs still live in GHL until App Review grants
-- Advanced Access. Serving dm_threads in the inbox (and deduping the GHL
-- social passthrough) before then would hide real leads' threads - the exact
-- regression the passthrough fixed. inbox_live=true is the explicit cutover
-- switch: flip it per academy once App Review passes AND a real lead's DM is
-- proven to land in dm_threads. Instant rollback: flip it back.
alter table public.client_meta_messaging_config
  add column if not exists inbox_live boolean not null default false;
comment on column public.client_meta_messaging_config.inbox_live is
  'true = inbox serves dm_threads and drops IG/FB from the GHL passthrough. Flip only after App Review passes and real-lead DMs are proven to arrive. status=active alone just stores webhook deliveries.';
