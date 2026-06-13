-- Local development seed: the existing BAM GTA training offer referenced by
-- entry_points.offer_id in production history.
insert into public.offers (
  id,
  client_id,
  type,
  title,
  status,
  data,
  sort_order
)
values (
  '52a6285c-7832-44e1-b531-ab7ef9d8fc21',
  '39875f07-0a4b-4429-a201-2249bc1f24df',
  'training',
  'Training',
  'published',
  '{}'::jsonb,
  0
)
on conflict (id) do update set
  client_id = excluded.client_id,
  type = excluded.type,
  title = excluded.title,
  status = excluded.status,
  data = excluded.data,
  sort_order = excluded.sort_order,
  updated_at = now();
