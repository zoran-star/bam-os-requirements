-- Local development seed: BAM GTA lead-routing entry points mirrored from prod
-- on 2026-06-29.
--
-- These duplicate the production data shape after the historical entry-point
-- migrations, because those migrations no-op locally when the production
-- client row is absent during migration replay.

delete from public.entry_points
where client_id = '39875f07-0a4b-4429-a201-2249bc1f24df';

insert into public.entry_points (
  id,
  client_id,
  type,
  key,
  label,
  tags,
  pipeline_name,
  stage_name,
  enabled,
  field_map,
  offer_id,
  ghl_workflow_id,
  ghl_workflow_name,
  created_at,
  updated_at
)
values
  (
    '6229a5ae-09fb-42d3-b7b6-688b88ffa871',
    '39875f07-0a4b-4429-a201-2249bc1f24df',
    'website-form',
    'free-trial',
    'Website Free Trial',
    array['website-inquiry','free trial form filled']::text[],
    'TRAINING PIPELINE',
    'scheduled trial',
    true,
    '{
      "athlete": "RqNojS2YaVGQNjMAo4HB",
      "athlete_age": "YV4VHWIN0yQM2RxCZG2K",
      "athlete_first": "LkEMioBqJxuuBAI1C6JM",
      "athlete_last": "shug52YPjEznPlWNRXRB",
      "booked_date": "jtSUdhaCGn3d3oMXO8KW",
      "near_oakville": "8npLyk6pibYGhOjuFhJQ",
      "start_when_ghl": "9LyXPRWb3XN7ASy4amoB"
    }'::jsonb,
    '52a6285c-7832-44e1-b531-ab7ef9d8fc21',
    'b3f5337d-186a-487b-b1e2-86aa4c979908',
    'trial form filled in',
    '2026-06-11 21:11:26.180602+00'::timestamptz,
    '2026-06-12 16:27:35.107256+00'::timestamptz
  ),
  (
    '64cec7fe-626e-4f69-a093-7d3bd0197179',
    '39875f07-0a4b-4429-a201-2249bc1f24df',
    'website-form',
    'contact',
    'Website Contact Form',
    array['website-inquiry','contact form filled']::text[],
    'TRAINING PIPELINE',
    'interested',
    true,
    '{
      "message": "q5d8vr3C9Vy5Xd9eQoDL",
      "player": "RqNojS2YaVGQNjMAo4HB"
    }'::jsonb,
    '52a6285c-7832-44e1-b531-ab7ef9d8fc21',
    'b3feffee-69a8-4c99-be20-7652a3206de6',
    'contact form filled in',
    '2026-06-11 21:11:26.180602+00'::timestamptz,
    '2026-06-11 22:25:28.781+00'::timestamptz
  ),
  (
    '87ae3fdd-e5bf-46dd-9871-c46bd169ee9b',
    '39875f07-0a4b-4429-a201-2249bc1f24df',
    'calendar',
    'G5y4QI0MsFq3159IhFU7',
    'Booking Calendar: Group 2 (High School)',
    array[]::text[],
    'TRAINING PIPELINE',
    'scheduled trial',
    true,
    '{}'::jsonb,
    '52a6285c-7832-44e1-b531-ab7ef9d8fc21',
    '188cb898-0159-464d-8e3c-3df5024d4929',
    'free trial booked',
    '2026-06-11 21:11:26.180602+00'::timestamptz,
    '2026-06-11 23:34:22.502+00'::timestamptz
  ),
  (
    '8c2fbade-7ff8-498a-86cf-38c172513ae8',
    '39875f07-0a4b-4429-a201-2249bc1f24df',
    'calendar',
    'Cmw4bCVBhexgi0Oi0Dkf',
    'Booking Calendar: Group 1 (Elementary)',
    array[]::text[],
    'TRAINING PIPELINE',
    'scheduled trial',
    true,
    '{}'::jsonb,
    '52a6285c-7832-44e1-b531-ab7ef9d8fc21',
    '188cb898-0159-464d-8e3c-3df5024d4929',
    'free trial booked',
    '2026-06-11 21:11:26.180602+00'::timestamptz,
    '2026-06-11 23:34:16.266+00'::timestamptz
  ),
  (
    'e9e91d47-fcb9-4656-ab3b-872bd099b789',
    '39875f07-0a4b-4429-a201-2249bc1f24df',
    'website-form',
    'adapt',
    'ADAPT intake form',
    array['adaptformfilled']::text[],
    null,
    null,
    true,
    '{}'::jsonb,
    null,
    null,
    null,
    '2026-06-17 14:06:17.557594+00'::timestamptz,
    '2026-06-17 14:06:17.557594+00'::timestamptz
  )
on conflict (client_id, type, key) do update set
  label = excluded.label,
  tags = excluded.tags,
  pipeline_name = excluded.pipeline_name,
  stage_name = excluded.stage_name,
  enabled = excluded.enabled,
  field_map = excluded.field_map,
  offer_id = excluded.offer_id,
  ghl_workflow_id = excluded.ghl_workflow_id,
  ghl_workflow_name = excluded.ghl_workflow_name,
  updated_at = excluded.updated_at;

-- Link direct entry points to their funnels (seeded in 15_bam_gta_funnels.sql):
-- free-trial page hosts the trial form + both calendars; contact page hosts
-- the contact form. ADAPT intake stays unlinked (no funnel yet).
update public.entry_points ep
   set funnel_id = f.id
  from public.funnels f
 where ep.client_id = '39875f07-0a4b-4429-a201-2249bc1f24df'
   and f.client_id = ep.client_id
   and f.key = case
         when ep.type = 'calendar' then 'free-trial'
         when ep.type = 'website-form' and ep.key = 'free-trial' then 'free-trial'
         when ep.type = 'website-form' and ep.key = 'contact' then 'contact'
       end;
