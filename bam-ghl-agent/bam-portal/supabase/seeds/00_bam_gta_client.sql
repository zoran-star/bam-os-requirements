-- Local development seed: canonical BAM GTA client row used by the portal,
-- website funnel, entry points, and parent app work.
insert into public.clients (
  id,
  business_name,
  status,
  marketing_included,
  v2_access,
  allowed_domains,
  time_zone,
  stripe_connect_account_id,
  stripe_connect_status,
  stripe_connect_connected_at
)
values (
  '39875f07-0a4b-4429-a201-2249bc1f24df',
  'BAM GTA',
  'active',
  true,
  true,
  array['bam-gta.vercel.app'],
  'America/New_York',
  'acct_1P7kUCRxInSEtAh8',
  'connected',
  '2026-05-24 00:00:00+00'::timestamptz
)
on conflict (id) do update set
  business_name = excluded.business_name,
  status = excluded.status,
  marketing_included = excluded.marketing_included,
  v2_access = excluded.v2_access,
  allowed_domains = excluded.allowed_domains,
  time_zone = excluded.time_zone,
  stripe_connect_account_id = excluded.stripe_connect_account_id,
  stripe_connect_status = excluded.stripe_connect_status,
  stripe_connect_connected_at = excluded.stripe_connect_connected_at,
  updated_at = now();
