-- RESTORE FILE (not a migration - never runs automatically).
--
-- The 46 per-academy stage_transitions rows as they stood on 2026-07-24, right
-- before migration 20260724_drop_seed_stage_transitions deleted them.
--
-- WHY THEY WERE DELETED: since the Phase 1 flip (2026-07-23) the router reads the
-- flow graph from the code MASTER (api/agent/presets.js via preset-master.js).
-- These rows were kept only as the emergency fallback. Every one of them was
-- is_seed=true AND enabled=true - byte-identical duplicates of the master, with
-- zero academy pause overrides and zero hand-authored edges. Keeping stale copies
-- of the single source of truth is exactly the drift this whole wave removed.
--
-- WHEN TO RUN THIS: only if a bug in the master reader (preset-master.js /
-- resolveEdge) makes master-sourced routing wrong and you need the DB fallback
-- back. Run this file, then set env PRESET_EDGE_SOURCE=db and redeploy so
-- resolveEdge serves these rows again.
--
-- Safe to re-run: ON CONFLICT DO NOTHING on the primary key.
--
-- BAM GTA      client 39875f07-0a4b-4429-a201-2249bc1f24df  offer 52a6285c-7832-44e1-b531-ab7ef9d8fc21  (23 rows)
-- BAM San Jose client 5576acf0-acd3-4c05-9f9f-ebfde8618154  offer 4d15a274-d7cd-4369-82e6-5ebe2f9056c2  (23 rows)

insert into public.stage_transitions
  (id, client_id, offer_id, from_stage_role, trigger, to_kind, to_stage_role, to_terminal, enabled, is_seed, sort_order)
values
  ('87a1344d-bcdc-45d4-bb84-eb7d86b85ce6'::uuid,'39875f07-0a4b-4429-a201-2249bc1f24df'::uuid,'52a6285c-7832-44e1-b531-ab7ef9d8fc21'::uuid,null,'new_lead'::transition_trigger,'stage','responded',null,true,true,10),
  ('823ea6bf-788c-46ce-b30d-3e5930e30562'::uuid,'39875f07-0a4b-4429-a201-2249bc1f24df'::uuid,'52a6285c-7832-44e1-b531-ab7ef9d8fc21'::uuid,'responded','booked'::transition_trigger,'stage','scheduled_trial',null,true,true,11),
  ('7295eb59-663d-4675-a0ec-c609b5f067a6'::uuid,'39875f07-0a4b-4429-a201-2249bc1f24df'::uuid,'52a6285c-7832-44e1-b531-ab7ef9d8fc21'::uuid,'responded','not_interested'::transition_trigger,'stage','nurture',null,true,true,12),
  ('919183d2-c1bc-4ee3-a9b3-f234edbe243b'::uuid,'39875f07-0a4b-4429-a201-2249bc1f24df'::uuid,'52a6285c-7832-44e1-b531-ab7ef9d8fc21'::uuid,'responded','marked_unqualified'::transition_trigger,'terminal',null,'unqualified',true,true,13),
  ('537f8a9b-7223-4110-bb3d-0f08d6c87bc6'::uuid,'39875f07-0a4b-4429-a201-2249bc1f24df'::uuid,'52a6285c-7832-44e1-b531-ab7ef9d8fc21'::uuid,'responded','went_quiet'::transition_trigger,'stage','ghosted',null,true,true,14),
  ('bdefbff2-8944-4ce7-ac59-11c1f527d932'::uuid,'39875f07-0a4b-4429-a201-2249bc1f24df'::uuid,'52a6285c-7832-44e1-b531-ab7ef9d8fc21'::uuid,'responded','complaint_offtopic'::transition_trigger,'terminal',null,'human',true,true,15),
  ('f5351218-e7d9-4b53-aac1-e586a68ece43'::uuid,'39875f07-0a4b-4429-a201-2249bc1f24df'::uuid,'52a6285c-7832-44e1-b531-ab7ef9d8fc21'::uuid,'scheduled_trial','post_trial_good_fit'::transition_trigger,'stage','done_trial',null,true,true,20),
  ('939f8666-3275-448e-ae9e-bf0030ac7e2a'::uuid,'39875f07-0a4b-4429-a201-2249bc1f24df'::uuid,'52a6285c-7832-44e1-b531-ab7ef9d8fc21'::uuid,'scheduled_trial','post_trial_not_fit'::transition_trigger,'terminal',null,'unqualified',true,true,21),
  ('93808e58-c1a0-496c-8b98-1ef9ca0d35b4'::uuid,'39875f07-0a4b-4429-a201-2249bc1f24df'::uuid,'52a6285c-7832-44e1-b531-ab7ef9d8fc21'::uuid,'scheduled_trial','no_show'::transition_trigger,'stage','responded',null,true,true,22),
  ('d0bb0451-aae0-4ada-a5d7-459581f5e1cf'::uuid,'39875f07-0a4b-4429-a201-2249bc1f24df'::uuid,'52a6285c-7832-44e1-b531-ab7ef9d8fc21'::uuid,'scheduled_trial','cant_make_it'::transition_trigger,'stage','responded',null,true,true,23),
  ('f8761fef-248d-4594-89cd-f07e111f7057'::uuid,'39875f07-0a4b-4429-a201-2249bc1f24df'::uuid,'52a6285c-7832-44e1-b531-ab7ef9d8fc21'::uuid,'scheduled_trial','no_longer_wants'::transition_trigger,'stage','nurture',null,true,true,24),
  ('40adfccc-c59d-42e9-abf1-6e3a2c8e9ee2'::uuid,'39875f07-0a4b-4429-a201-2249bc1f24df'::uuid,'52a6285c-7832-44e1-b531-ab7ef9d8fc21'::uuid,'scheduled_trial','marked_unqualified'::transition_trigger,'terminal',null,'unqualified',true,true,25),
  ('c384a9fd-e276-4f6a-a1a6-26d9836e4de8'::uuid,'39875f07-0a4b-4429-a201-2249bc1f24df'::uuid,'52a6285c-7832-44e1-b531-ab7ef9d8fc21'::uuid,'scheduled_trial','complaint_offtopic'::transition_trigger,'terminal',null,'human',true,true,26),
  ('f561e901-c51b-4e35-af94-095f5d238415'::uuid,'39875f07-0a4b-4429-a201-2249bc1f24df'::uuid,'52a6285c-7832-44e1-b531-ab7ef9d8fc21'::uuid,'scheduled_trial','cancel_booking'::transition_trigger,'stage','responded',null,true,true,27),
  ('bbb1ffd1-35a9-49b5-9d6e-8075a72d6cae'::uuid,'39875f07-0a4b-4429-a201-2249bc1f24df'::uuid,'52a6285c-7832-44e1-b531-ab7ef9d8fc21'::uuid,'done_trial','enrolls'::transition_trigger,'terminal',null,'member',true,true,30),
  ('306790bd-5c61-4dde-af0e-d503aab2e7ee'::uuid,'39875f07-0a4b-4429-a201-2249bc1f24df'::uuid,'52a6285c-7832-44e1-b531-ab7ef9d8fc21'::uuid,'done_trial','says_no'::transition_trigger,'stage','nurture',null,true,true,31),
  ('cdcf95bc-a735-4f49-83c9-130ebf8fb992'::uuid,'39875f07-0a4b-4429-a201-2249bc1f24df'::uuid,'52a6285c-7832-44e1-b531-ab7ef9d8fc21'::uuid,'done_trial','marked_unqualified'::transition_trigger,'terminal',null,'unqualified',true,true,32),
  ('0972a2f9-e4c3-4749-9c05-1f0e533c063e'::uuid,'39875f07-0a4b-4429-a201-2249bc1f24df'::uuid,'52a6285c-7832-44e1-b531-ab7ef9d8fc21'::uuid,'done_trial','complaint_offtopic'::transition_trigger,'terminal',null,'human',true,true,33),
  ('88767ec7-20a7-4fb3-abc4-584af47522bf'::uuid,'39875f07-0a4b-4429-a201-2249bc1f24df'::uuid,'52a6285c-7832-44e1-b531-ab7ef9d8fc21'::uuid,'done_trial','ghosted_ran_out'::transition_trigger,'stage','nurture',null,true,true,34),
  ('bf7380bf-e5d2-446d-aefb-f6d187bb6fac'::uuid,'39875f07-0a4b-4429-a201-2249bc1f24df'::uuid,'52a6285c-7832-44e1-b531-ab7ef9d8fc21'::uuid,'ghosted','replied'::transition_trigger,'stage','responded',null,true,true,40),
  ('02546d1a-5e93-493e-8cc8-7b1f5cdf7713'::uuid,'39875f07-0a4b-4429-a201-2249bc1f24df'::uuid,'52a6285c-7832-44e1-b531-ab7ef9d8fc21'::uuid,'ghosted','ghosted_ran_out'::transition_trigger,'stage','nurture',null,true,true,41),
  ('a84cc8bd-bf8c-41aa-8bce-fe9712562d42'::uuid,'39875f07-0a4b-4429-a201-2249bc1f24df'::uuid,'52a6285c-7832-44e1-b531-ab7ef9d8fc21'::uuid,'nurture','replied'::transition_trigger,'stage','responded',null,true,true,50),
  ('9cfffe1c-e3ab-4724-b474-a01276eb8bb7'::uuid,'39875f07-0a4b-4429-a201-2249bc1f24df'::uuid,'52a6285c-7832-44e1-b531-ab7ef9d8fc21'::uuid,'nurture','ghosted_ran_out'::transition_trigger,'terminal',null,'unqualified',true,true,51),
  ('5facda95-1ec8-4040-9546-b144bf609b61'::uuid,'5576acf0-acd3-4c05-9f9f-ebfde8618154'::uuid,'4d15a274-d7cd-4369-82e6-5ebe2f9056c2'::uuid,null,'new_lead'::transition_trigger,'stage','responded',null,true,true,10),
  ('187e2647-208a-4612-8006-0d4a6a24c95a'::uuid,'5576acf0-acd3-4c05-9f9f-ebfde8618154'::uuid,'4d15a274-d7cd-4369-82e6-5ebe2f9056c2'::uuid,'responded','booked'::transition_trigger,'stage','scheduled_trial',null,true,true,20),
  ('319c62dc-de16-4fc7-bc04-308ddebd4046'::uuid,'5576acf0-acd3-4c05-9f9f-ebfde8618154'::uuid,'4d15a274-d7cd-4369-82e6-5ebe2f9056c2'::uuid,'responded','not_interested'::transition_trigger,'stage','nurture',null,true,true,30),
  ('478946fd-252a-430b-98d7-7d4586dd7a77'::uuid,'5576acf0-acd3-4c05-9f9f-ebfde8618154'::uuid,'4d15a274-d7cd-4369-82e6-5ebe2f9056c2'::uuid,'responded','marked_unqualified'::transition_trigger,'terminal',null,'unqualified',true,true,40),
  ('670a0409-0ca1-4729-b634-114a5fdbdea6'::uuid,'5576acf0-acd3-4c05-9f9f-ebfde8618154'::uuid,'4d15a274-d7cd-4369-82e6-5ebe2f9056c2'::uuid,'responded','went_quiet'::transition_trigger,'stage','ghosted',null,true,true,50),
  ('11bac35c-257f-432d-aadd-f4923a3c5112'::uuid,'5576acf0-acd3-4c05-9f9f-ebfde8618154'::uuid,'4d15a274-d7cd-4369-82e6-5ebe2f9056c2'::uuid,'responded','complaint_offtopic'::transition_trigger,'terminal',null,'human',true,true,60),
  ('c8734b14-b268-4c1e-9ae2-14f044626a8d'::uuid,'5576acf0-acd3-4c05-9f9f-ebfde8618154'::uuid,'4d15a274-d7cd-4369-82e6-5ebe2f9056c2'::uuid,'scheduled_trial','post_trial_good_fit'::transition_trigger,'stage','done_trial',null,true,true,70),
  ('433e4848-8ac8-4e2f-adfe-fc11574cc52f'::uuid,'5576acf0-acd3-4c05-9f9f-ebfde8618154'::uuid,'4d15a274-d7cd-4369-82e6-5ebe2f9056c2'::uuid,'scheduled_trial','post_trial_not_fit'::transition_trigger,'terminal',null,'unqualified',true,true,80),
  ('ab1b4023-56f1-431c-9811-8f90abf6761d'::uuid,'5576acf0-acd3-4c05-9f9f-ebfde8618154'::uuid,'4d15a274-d7cd-4369-82e6-5ebe2f9056c2'::uuid,'scheduled_trial','no_show'::transition_trigger,'stage','responded',null,true,true,90),
  ('10e254a1-78e6-465f-b664-1bb8a0870b97'::uuid,'5576acf0-acd3-4c05-9f9f-ebfde8618154'::uuid,'4d15a274-d7cd-4369-82e6-5ebe2f9056c2'::uuid,'scheduled_trial','cant_make_it'::transition_trigger,'stage','responded',null,true,true,100),
  ('055bc297-2448-45f6-a968-2dfe698bb537'::uuid,'5576acf0-acd3-4c05-9f9f-ebfde8618154'::uuid,'4d15a274-d7cd-4369-82e6-5ebe2f9056c2'::uuid,'scheduled_trial','cancel_booking'::transition_trigger,'stage','responded',null,true,true,110),
  ('2334fe9a-e5fb-4bae-8d97-b298fb82a798'::uuid,'5576acf0-acd3-4c05-9f9f-ebfde8618154'::uuid,'4d15a274-d7cd-4369-82e6-5ebe2f9056c2'::uuid,'scheduled_trial','no_longer_wants'::transition_trigger,'stage','nurture',null,true,true,120),
  ('2bfee67a-c74f-4b0e-9b44-cb25213cbf35'::uuid,'5576acf0-acd3-4c05-9f9f-ebfde8618154'::uuid,'4d15a274-d7cd-4369-82e6-5ebe2f9056c2'::uuid,'scheduled_trial','marked_unqualified'::transition_trigger,'terminal',null,'unqualified',true,true,130),
  ('0dfa46db-da90-4761-95b9-706d8df8e8c8'::uuid,'5576acf0-acd3-4c05-9f9f-ebfde8618154'::uuid,'4d15a274-d7cd-4369-82e6-5ebe2f9056c2'::uuid,'scheduled_trial','complaint_offtopic'::transition_trigger,'terminal',null,'human',true,true,140),
  ('722b56ec-f91f-4682-8485-00bc7f9147f2'::uuid,'5576acf0-acd3-4c05-9f9f-ebfde8618154'::uuid,'4d15a274-d7cd-4369-82e6-5ebe2f9056c2'::uuid,'done_trial','enrolls'::transition_trigger,'terminal',null,'member',true,true,150),
  ('a10fb539-693f-4baa-a52e-00901062c126'::uuid,'5576acf0-acd3-4c05-9f9f-ebfde8618154'::uuid,'4d15a274-d7cd-4369-82e6-5ebe2f9056c2'::uuid,'done_trial','says_no'::transition_trigger,'stage','nurture',null,true,true,160),
  ('624da000-d555-4662-b2b7-9b2a4a64d282'::uuid,'5576acf0-acd3-4c05-9f9f-ebfde8618154'::uuid,'4d15a274-d7cd-4369-82e6-5ebe2f9056c2'::uuid,'done_trial','ghosted_ran_out'::transition_trigger,'stage','nurture',null,true,true,170),
  ('014b49a5-c53e-4ed8-9aee-1e0e372ecaf9'::uuid,'5576acf0-acd3-4c05-9f9f-ebfde8618154'::uuid,'4d15a274-d7cd-4369-82e6-5ebe2f9056c2'::uuid,'done_trial','marked_unqualified'::transition_trigger,'terminal',null,'unqualified',true,true,180),
  ('2d204ae6-8701-4a57-a902-5c0faddd1c28'::uuid,'5576acf0-acd3-4c05-9f9f-ebfde8618154'::uuid,'4d15a274-d7cd-4369-82e6-5ebe2f9056c2'::uuid,'done_trial','complaint_offtopic'::transition_trigger,'terminal',null,'human',true,true,190),
  ('6ec6614d-ab25-4d1a-b376-1b40134fd23d'::uuid,'5576acf0-acd3-4c05-9f9f-ebfde8618154'::uuid,'4d15a274-d7cd-4369-82e6-5ebe2f9056c2'::uuid,'ghosted','replied'::transition_trigger,'stage','responded',null,true,true,200),
  ('bcbeecb9-9ce5-4ef0-81a3-66455841be4f'::uuid,'5576acf0-acd3-4c05-9f9f-ebfde8618154'::uuid,'4d15a274-d7cd-4369-82e6-5ebe2f9056c2'::uuid,'ghosted','ghosted_ran_out'::transition_trigger,'stage','nurture',null,true,true,210),
  ('92e3ce80-e87d-4228-9583-3f3e24938d5f'::uuid,'5576acf0-acd3-4c05-9f9f-ebfde8618154'::uuid,'4d15a274-d7cd-4369-82e6-5ebe2f9056c2'::uuid,'nurture','replied'::transition_trigger,'stage','responded',null,true,true,220),
  ('31552a45-643e-4d73-b14f-91506cf64213'::uuid,'5576acf0-acd3-4c05-9f9f-ebfde8618154'::uuid,'4d15a274-d7cd-4369-82e6-5ebe2f9056c2'::uuid,'nurture','ghosted_ran_out'::transition_trigger,'terminal',null,'unqualified',true,true,230)
on conflict (id) do nothing;
