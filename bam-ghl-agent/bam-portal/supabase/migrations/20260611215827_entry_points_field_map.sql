-- Per-entry-point mapping of submission field keys → GHL custom field IDs.
-- The leads API copies any matching fields payload values into the GHL
-- contact's custom fields on sync.
alter table public.entry_points add column if not exists field_map jsonb not null default '{}'::jsonb;

update public.entry_points set field_map = '{
  "message": "q5d8vr3C9Vy5Xd9eQoDL",
  "player":  "RqNojS2YaVGQNjMAo4HB"
}'::jsonb
where client_id = '39875f07-0a4b-4429-a201-2249bc1f24df' and type = 'website-form' and key = 'contact';

update public.entry_points set field_map = '{
  "athlete_first": "LkEMioBqJxuuBAI1C6JM",
  "athlete_last":  "shug52YPjEznPlWNRXRB",
  "booked_date":   "jtSUdhaCGn3d3oMXO8KW"
}'::jsonb
where client_id = '39875f07-0a4b-4429-a201-2249bc1f24df' and type = 'website-form' and key = 'free-trial';;
