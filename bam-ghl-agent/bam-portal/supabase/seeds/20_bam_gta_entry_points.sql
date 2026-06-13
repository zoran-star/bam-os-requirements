-- Local development seed: BAM GTA lead-routing entry points.
-- These duplicate the production data shape after the historical entry-point
-- migrations, because those migrations no-op locally when the production
-- client row is absent during migration replay.
insert into public.entry_points (
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
  ghl_workflow_name
)
values
  (
    '39875f07-0a4b-4429-a201-2249bc1f24df',
    'website-form',
    'contact',
    'Website Contact Form',
    array['website-inquiry','contact form filled']::text[],
    null,
    null,
    true,
    '{
      "message": "q5d8vr3C9Vy5Xd9eQoDL",
      "player": "RqNojS2YaVGQNjMAo4HB"
    }'::jsonb,
    '52a6285c-7832-44e1-b531-ab7ef9d8fc21',
    'b3feffee-69a8-4c99-be20-7652a3206de6',
    'contact form filled in'
  ),
  (
    '39875f07-0a4b-4429-a201-2249bc1f24df',
    'website-form',
    'free-trial',
    'Website Free Trial',
    array['website-inquiry','free trial form filled']::text[],
    null,
    null,
    true,
    '{
      "athlete_first": "LkEMioBqJxuuBAI1C6JM",
      "athlete_last": "shug52YPjEznPlWNRXRB",
      "booked_date": "jtSUdhaCGn3d3oMXO8KW"
    }'::jsonb,
    '52a6285c-7832-44e1-b531-ab7ef9d8fc21',
    'b3f5337d-186a-487b-b1e2-86aa4c979908',
    'trial form filled in'
  ),
  (
    '39875f07-0a4b-4429-a201-2249bc1f24df',
    'ghl-form',
    'GLI35e0zHS4cFrft92le',
    'GHL Contact Form',
    array[]::text[],
    null,
    null,
    true,
    '{}'::jsonb,
    '52a6285c-7832-44e1-b531-ab7ef9d8fc21',
    null,
    null
  ),
  (
    '39875f07-0a4b-4429-a201-2249bc1f24df',
    'ghl-form',
    '00MuBSi1GxsRcSqklOkF',
    'GHL Free Trial Form',
    array[]::text[],
    null,
    null,
    true,
    '{}'::jsonb,
    '52a6285c-7832-44e1-b531-ab7ef9d8fc21',
    null,
    null
  ),
  (
    '39875f07-0a4b-4429-a201-2249bc1f24df',
    'calendar',
    'Cmw4bCVBhexgi0Oi0Dkf',
    'Booking Calendar: Group 1 (Elementary)',
    array[]::text[],
    null,
    null,
    true,
    '{}'::jsonb,
    '52a6285c-7832-44e1-b531-ab7ef9d8fc21',
    '188cb898-0159-464d-8e3c-3df5024d4929',
    'free trial booked'
  ),
  (
    '39875f07-0a4b-4429-a201-2249bc1f24df',
    'calendar',
    'G5y4QI0MsFq3159IhFU7',
    'Booking Calendar: Group 2 (High School)',
    array[]::text[],
    null,
    null,
    true,
    '{}'::jsonb,
    '52a6285c-7832-44e1-b531-ab7ef9d8fc21',
    '188cb898-0159-464d-8e3c-3df5024d4929',
    'free trial booked'
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
  updated_at = now();
