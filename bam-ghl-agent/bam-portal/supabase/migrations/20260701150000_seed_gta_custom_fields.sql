-- Pre-seed BAM GTA's custom_field_defs with the WORKING SET the live portal
-- actually uses (Custom Fields, P4b). Applied to prod via MCP; this file is the
-- record + local-replay parity. Guarded: skips if the GTA client row is absent
-- (seeds run after migrations on fresh local replay), same pattern as
-- 20260611211126_entry_points.sql. Idempotent (on conflict do nothing).
--
-- These 11 are the fields the portal reads/writes today: website form field_map
-- (athlete name/age, free-trial date, close-to-Oakville, start-timing, inquiry),
-- the athlete-name resolver (v15_config.athlete_name_field_ids), and the
-- post-trial writes (showed-up, lead sales person). ghl_field_id is set so the
-- value fold-in maps existing blob values onto them.

do $$
declare gta uuid := '39875f07-0a4b-4429-a201-2249bc1f24df';
begin
  if not exists (select 1 from public.clients where id = gta) then
    raise notice 'BAM GTA client row absent - skipping custom-field seed (local replay).';
    return;
  end if;

  insert into public.custom_field_defs (client_id, key, label, type, options, position, ghl_field_id) values
    (gta,'athlete_full_name','Athlete''s Full Name','text','[]'::jsonb,0,'RqNojS2YaVGQNjMAo4HB'),
    (gta,'athlete_first_name','Athlete''s First Name','text','[]'::jsonb,1,'LkEMioBqJxuuBAI1C6JM'),
    (gta,'athlete_last_name','Athlete''s Last Name','text','[]'::jsonb,2,'shug52YPjEznPlWNRXRB'),
    (gta,'player_full_name','Player Full Name','text','[]'::jsonb,3,'qH9pZCyQN00vV9tj1wuJ'),
    (gta,'athlete_age','Athlete''s Age','number','[]'::jsonb,4,'YV4VHWIN0yQM2RxCZG2K'),
    (gta,'free_trial_date','Free Trial Date','date','[]'::jsonb,5,'jtSUdhaCGn3d3oMXO8KW'),
    (gta,'close_to_oakville','Are You Close to Oakville?','multiselect','["Yes","No"]'::jsonb,6,'8npLyk6pibYGhOjuFhJQ'),
    (gta,'start_training_when','When would you be able to start training?','select','["Immediately","After 2 weeks","After 2 months"]'::jsonb,7,'9LyXPRWb3XN7ASy4amoB'),
    (gta,'inquiry','Inquiry','text','[]'::jsonb,8,'q5d8vr3C9Vy5Xd9eQoDL'),
    (gta,'did_athlete_show_up','Did the Athlete show up?','select','["Yes","No"]'::jsonb,9,'9axjoaPOTmXmrxOsYNjq'),
    (gta,'lead_sales_person','Lead Sales Person','select','["Flip","Zoran"]'::jsonb,10,'wywIrmeQI6NJyHH6Xg4C')
  on conflict (client_id, key) do nothing;

  -- Fold existing GHL blob values onto the seeded defs.
  perform public.fold_custom_field_values(gta);
end $$;
