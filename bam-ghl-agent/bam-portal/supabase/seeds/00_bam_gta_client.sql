-- Local development seed: canonical BAM GTA client row used by the portal,
-- website funnel, entry points, and parent app work.
insert into public.clients (
  id,
  business_name,
  status,
  marketing_included,
  v2_access,
  allowed_domains,
  time_zone
)
values (
  '39875f07-0a4b-4429-a201-2249bc1f24df',
  'BAM GTA',
  'active',
  true,
  true,
  array['bam-gta.vercel.app'],
  'America/Toronto'
)
on conflict (id) do update set
  business_name = excluded.business_name,
  status = excluded.status,
  marketing_included = excluded.marketing_included,
  v2_access = excluded.v2_access,
  allowed_domains = excluded.allowed_domains,
  time_zone = excluded.time_zone,
  updated_at = now();
