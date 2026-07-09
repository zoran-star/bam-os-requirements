-- Local development seed: BAM GTA funnels (landing pages that host direct
-- entry points). Mirrors the 20260708180000_funnels.sql prod backfill, which
-- no-ops locally because the prod client row is absent during migration
-- replay. Fixed UUIDs so 20_bam_gta_entry_points.sql can reference them.

update public.entry_points set funnel_id = null
where client_id = '39875f07-0a4b-4429-a201-2249bc1f24df';

delete from public.funnels
where client_id = '39875f07-0a4b-4429-a201-2249bc1f24df';

insert into public.funnels (id, client_id, offer_id, key, label, is_primary, enabled)
values
  (
    'f0000000-0000-4000-8000-000000000001',
    '39875f07-0a4b-4429-a201-2249bc1f24df',
    '52a6285c-7832-44e1-b531-ab7ef9d8fc21',
    'free-trial',
    'Free trial landing page',
    true,
    true
  ),
  (
    'f0000000-0000-4000-8000-000000000002',
    '39875f07-0a4b-4429-a201-2249bc1f24df',
    '52a6285c-7832-44e1-b531-ab7ef9d8fc21',
    'contact',
    'Contact page',
    false,
    true
  ),
  (
    'f0000000-0000-4000-8000-000000000003',
    '39875f07-0a4b-4429-a201-2249bc1f24df',
    '52a6285c-7832-44e1-b531-ab7ef9d8fc21',
    'enroll',
    'Enrollment funnel',
    false,
    true
  )
on conflict (client_id, key) do update set
  offer_id = excluded.offer_id,
  label = excluded.label,
  is_primary = excluded.is_primary,
  enabled = excluded.enabled,
  updated_at = now();
