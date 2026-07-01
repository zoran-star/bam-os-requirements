-- Local development seed: canonical BAM GTA client row used by the portal,
-- website funnel, entry points, and parent app work.
-- Mirrored from production-safe columns on 2026-06-29. Sensitive auth/GHL
-- token/phone columns are intentionally omitted.
insert into public.clients (
  id,
  business_name,
  status,
  marketing_included,
  v2_access,
  v4_access,
  v15_access,
  allowed_domains,
  time_zone,
  stripe_connect_account_id,
  stripe_connect_status,
  stripe_connect_connected_at,
  coachiq_enabled,
  coachiq_signup_url,
  scheduling_app,
  messaging_provider
)
values (
  '39875f07-0a4b-4429-a201-2249bc1f24df',
  'BAM GTA',
  'active',
  true,
  true,
  false,
  false,
  array['bam-gta.vercel.app','byanymeanstoronto.ca','www.byanymeanstoronto.ca'],
  'America/New_York',
  'acct_1P7kUCRxInSEtAh8',
  'connected',
  '2026-05-24 16:08:33.899+00'::timestamptz,
  false,
  'https://app.coachiq.io/bam-gta/athletes',
  'none',
  'ghl'
)
on conflict (id) do update set
  business_name = excluded.business_name,
  status = excluded.status,
  marketing_included = excluded.marketing_included,
  v2_access = excluded.v2_access,
  v4_access = excluded.v4_access,
  v15_access = excluded.v15_access,
  allowed_domains = excluded.allowed_domains,
  time_zone = excluded.time_zone,
  stripe_connect_account_id = excluded.stripe_connect_account_id,
  stripe_connect_status = excluded.stripe_connect_status,
  stripe_connect_connected_at = excluded.stripe_connect_connected_at,
  coachiq_enabled = excluded.coachiq_enabled,
  coachiq_signup_url = excluded.coachiq_signup_url,
  scheduling_app = excluded.scheduling_app,
  messaging_provider = excluded.messaging_provider,
  updated_at = now();
