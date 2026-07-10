-- Local development seed: synthetic parent-app fixture for BAM GTA.
--
-- This is intentionally not a production data dump. Prod currently has no
-- parent-domain rows and no active members; it only has historical
-- cancellation/audit activity plus pricing/offers. These rows preserve the
-- relationships and edge cases the parent app needs locally:
--
--   auth.users -> customer_profiles -> students -> academy_memberships
--   students -> member_links -> members
--
-- Local login credentials:
--   parent.alex.rivera@example.test / local-password
--   parent.jamie.chen@example.test / local-password
--   parent.taylor.morgan@example.test / local-password (preloaded, unclaimed)
--   parent.new.invited@example.test  / local-password (auth only; invite required)
--   staff.admin@example.test        / local-password

insert into auth.users (
  instance_id,
  id,
  aud,
  role,
  email,
  encrypted_password,
  email_confirmed_at,
  confirmation_token,
  recovery_token,
  email_change_token_new,
  email_change,
  phone_change,
  phone_change_token,
  email_change_token_current,
  email_change_confirm_status,
  reauthentication_token,
  raw_app_meta_data,
  raw_user_meta_data,
  created_at,
  updated_at
)
values
  (
    '00000000-0000-0000-0000-000000000000',
    'd353e2fd-23f9-49e3-925d-5cc7cf2b7c11',
    'authenticated',
    'authenticated',
    'parent.alex.rivera@example.test',
    extensions.crypt('local-password', extensions.gen_salt('bf')),
    now(),
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    0,
    '',
    '{"provider":"email","providers":["email"],"role":"parent"}'::jsonb,
    '{"first_name":"Alex","last_name":"Rivera"}'::jsonb,
    now(),
    now()
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    'ef6ef39e-0e94-4673-9544-25ee9c68b8cf',
    'authenticated',
    'authenticated',
    'parent.jamie.chen@example.test',
    extensions.crypt('local-password', extensions.gen_salt('bf')),
    now(),
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    0,
    '',
    '{"provider":"email","providers":["email"],"role":"parent"}'::jsonb,
    '{"first_name":"Jamie","last_name":"Chen"}'::jsonb,
    now(),
    now()
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    'f7a7d6e5-7c6d-4dd1-95c2-1c7f5d72e9a4',
    'authenticated',
    'authenticated',
    'parent.taylor.morgan@example.test',
    extensions.crypt('local-password', extensions.gen_salt('bf')),
    now(),
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    0,
    '',
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"first_name":"Taylor","last_name":"Morgan"}'::jsonb,
    now(),
    now()
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    'a8100000-0000-4000-8000-000000000001',
    'authenticated',
    'authenticated',
    'parent.new.invited@example.test',
    extensions.crypt('local-password', extensions.gen_salt('bf')),
    now(),
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    0,
    '',
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"first_name":"Jordan","last_name":"Lee"}'::jsonb,
    now(),
    now()
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    '8d3b7b5f-02e3-48f6-9a91-5a7d51e6c3f2',
    'authenticated',
    'authenticated',
    'staff.admin@example.test',
    extensions.crypt('local-password', extensions.gen_salt('bf')),
    now(),
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    0,
    '',
    '{"provider":"email","providers":["email"],"role":"staff"}'::jsonb,
    '{"first_name":"Local","last_name":"Admin"}'::jsonb,
    now(),
    now()
  )
on conflict (id) do update set
  email = excluded.email,
  encrypted_password = excluded.encrypted_password,
  email_confirmed_at = excluded.email_confirmed_at,
  confirmation_token = excluded.confirmation_token,
  recovery_token = excluded.recovery_token,
  email_change_token_new = excluded.email_change_token_new,
  email_change = excluded.email_change,
  phone_change = excluded.phone_change,
  phone_change_token = excluded.phone_change_token,
  email_change_token_current = excluded.email_change_token_current,
  email_change_confirm_status = excluded.email_change_confirm_status,
  reauthentication_token = excluded.reauthentication_token,
  raw_app_meta_data = excluded.raw_app_meta_data,
  raw_user_meta_data = excluded.raw_user_meta_data,
  updated_at = now();

insert into auth.identities (
  id,
  provider_id,
  user_id,
  identity_data,
  provider,
  last_sign_in_at,
  created_at,
  updated_at
)
values
  (
    'd353e2fd-23f9-49e3-925d-5cc7cf2b7c11',
    'd353e2fd-23f9-49e3-925d-5cc7cf2b7c11',
    'd353e2fd-23f9-49e3-925d-5cc7cf2b7c11',
    '{"sub":"d353e2fd-23f9-49e3-925d-5cc7cf2b7c11","email":"parent.alex.rivera@example.test","email_verified":true,"phone_verified":false}'::jsonb,
    'email',
    now(),
    now(),
    now()
  ),
  (
    'ef6ef39e-0e94-4673-9544-25ee9c68b8cf',
    'ef6ef39e-0e94-4673-9544-25ee9c68b8cf',
    'ef6ef39e-0e94-4673-9544-25ee9c68b8cf',
    '{"sub":"ef6ef39e-0e94-4673-9544-25ee9c68b8cf","email":"parent.jamie.chen@example.test","email_verified":true,"phone_verified":false}'::jsonb,
    'email',
    now(),
    now(),
    now()
  ),
  (
    'f7a7d6e5-7c6d-4dd1-95c2-1c7f5d72e9a4',
    'f7a7d6e5-7c6d-4dd1-95c2-1c7f5d72e9a4',
    'f7a7d6e5-7c6d-4dd1-95c2-1c7f5d72e9a4',
    '{"sub":"f7a7d6e5-7c6d-4dd1-95c2-1c7f5d72e9a4","email":"parent.taylor.morgan@example.test","email_verified":true,"phone_verified":false}'::jsonb,
    'email',
    now(),
    now(),
    now()
  ),
  (
    'a8100000-0000-4000-8000-000000000001',
    'a8100000-0000-4000-8000-000000000001',
    'a8100000-0000-4000-8000-000000000001',
    '{"sub":"a8100000-0000-4000-8000-000000000001","email":"parent.new.invited@example.test","email_verified":true,"phone_verified":false}'::jsonb,
    'email',
    now(),
    now(),
    now()
  ),
  (
    '8d3b7b5f-02e3-48f6-9a91-5a7d51e6c3f2',
    '8d3b7b5f-02e3-48f6-9a91-5a7d51e6c3f2',
    '8d3b7b5f-02e3-48f6-9a91-5a7d51e6c3f2',
    '{"sub":"8d3b7b5f-02e3-48f6-9a91-5a7d51e6c3f2","email":"staff.admin@example.test","email_verified":true,"phone_verified":false}'::jsonb,
    'email',
    now(),
    now(),
    now()
  )
on conflict (provider_id, provider) do update set
  user_id = excluded.user_id,
  identity_data = excluded.identity_data,
  last_sign_in_at = excluded.last_sign_in_at,
  updated_at = now();

insert into public.staff (
  id,
  user_id,
  name,
  role,
  email,
  booking_url
)
values (
  'b946db12-f498-48ef-bc6d-40613a7b5345',
  '8d3b7b5f-02e3-48f6-9a91-5a7d51e6c3f2',
  'Local Admin',
  'admin',
  'staff.admin@example.test',
  'http://localhost:3000/local-booking'
)
on conflict (id) do update set
  user_id = excluded.user_id,
  name = excluded.name,
  role = excluded.role,
  email = excluded.email,
  booking_url = excluded.booking_url,
  updated_at = now();

insert into public.customer_profiles (
  id,
  supabase_user_id,
  first_name,
  last_name,
  email,
  phone,
  profile_type,
  claimed_at
)
values
  (
    '361f1ae0-901a-45bd-a3fa-3d136fcda7f0',
    'd353e2fd-23f9-49e3-925d-5cc7cf2b7c11',
    'Alex',
    'Rivera',
    'parent.alex.rivera@example.test',
    '+14165550101',
    'PARENT',
    now()
  ),
  (
    '43608c82-9957-4a42-b206-e2af3d7a3f37',
    'ef6ef39e-0e94-4673-9544-25ee9c68b8cf',
    'Jamie',
    'Chen',
    'parent.jamie.chen@example.test',
    '+14165550102',
    'PARENT',
    now()
  ),
  (
    '7c269b89-17df-4f7d-9258-c2d442f1b6df',
    null,
    'Taylor',
    'Morgan',
    'parent.taylor.morgan@example.test',
    '+14165550103',
    'PARENT',
    null
  )
on conflict (id) do update set
  supabase_user_id = excluded.supabase_user_id,
  first_name = excluded.first_name,
  last_name = excluded.last_name,
  email = excluded.email,
  phone = excluded.phone,
  profile_type = excluded.profile_type,
  claimed_at = excluded.claimed_at,
  updated_at = now();

insert into public.students (
  id,
  parent_id,
  first_name,
  last_name,
  date_of_birth,
  notes
)
values
  (
    '531a0580-56c6-4029-a72f-c42221e17bfb',
    '361f1ae0-901a-45bd-a3fa-3d136fcda7f0',
    'Maya',
    'Rivera',
    '2013-04-12',
    'Synthetic local fixture: active training member.'
  ),
  (
    '5c0bf246-1612-4e82-8aca-4fba43e13f6e',
    '361f1ae0-901a-45bd-a3fa-3d136fcda7f0',
    'Leo',
    'Rivera',
    '2011-09-22',
    'Synthetic local fixture: paused member.'
  ),
  (
    'ccfd4c6a-9e7a-41f4-8d7a-8f6e80e69825',
    '43608c82-9957-4a42-b206-e2af3d7a3f37',
    'Noah',
    'Chen',
    '2014-01-18',
    'Synthetic local fixture: payment issue member.'
  ),
  (
    'fe899a4d-e7cb-4c39-bd8d-345c7316e789',
    '7c269b89-17df-4f7d-9258-c2d442f1b6df',
    'Avery',
    'Morgan',
    '2015-06-08',
    'Synthetic local fixture: trial-eligible child with no paid academy membership.'
  )
on conflict (id) do update set
  parent_id = excluded.parent_id,
  first_name = excluded.first_name,
  last_name = excluded.last_name,
  date_of_birth = excluded.date_of_birth,
  notes = excluded.notes,
  updated_at = now();

insert into public.members (
  id,
  client_id,
  athlete_name,
  archetype,
  trainer,
  group_num,
  plan,
  status,
  engagement,
  skill_notes,
  parent_name,
  parent_archetype,
  parent_email,
  parent_phone,
  stripe_customer_id,
  stripe_subscription_id,
  ghl_contact_id,
  coachiq_member_id,
  joined_date,
  avatar_url,
  stripe_price_id,
  stripe_joined_at,
  pause_scheduled_for,
  billing_mode
)
values
  (
    '5e0c5f1d-98ee-4674-975f-63b6b7f7f6a7',
    '39875f07-0a4b-4429-a201-2249bc1f24df',
    'Maya Rivera',
    'Developing guard',
    'Mike',
    1,
    '1/wk',
    'live',
    'consistent',
    'Works on ball handling and finishing through contact.',
    'Alex Rivera',
    'highly engaged',
    'parent.alex.rivera@example.test',
    '+14165550101',
    'cus_local_maya_rivera',
    'sub_local_maya_1wk',
    'ghl_local_maya_rivera',
    'coachiq_local_maya_rivera',
    current_date - interval '120 days',
    null,
    'plan_ToNwa96lQ5I1Bs',
    now() - interval '120 days',
    null,
    'subscription'
  ),
  (
    'e53d4d4b-72c9-48c5-a121-604d4a9e7407',
    '39875f07-0a4b-4429-a201-2249bc1f24df',
    'Leo Rivera',
    'Advanced wing',
    'Mike',
    2,
    '2/wk',
    'paused',
    'consistent',
    'Strong shooter; pause is temporary for school schedule.',
    'Alex Rivera',
    'highly engaged',
    'parent.alex.rivera@example.test',
    '+14165550101',
    'cus_local_leo_rivera',
    'sub_local_leo_2wk',
    'ghl_local_leo_rivera',
    'coachiq_local_leo_rivera',
    current_date - interval '210 days',
    null,
    'plan_ThYK86w2Zd8fp3',
    now() - interval '210 days',
    current_date - interval '7 days',
    'subscription'
  ),
  (
    'c72b32c8-01a8-4cd6-8f25-e244126cb7bf',
    '39875f07-0a4b-4429-a201-2249bc1f24df',
    'Noah Chen',
    'New athlete',
    'Rosano',
    1,
    '3/wk',
    'payment_method_required',
    'at_risk',
    'New signup with payment collection pending.',
    'Jamie Chen',
    'needs reminders',
    'parent.jamie.chen@example.test',
    '+14165550102',
    'cus_local_noah_chen',
    'sub_local_noah_3wk',
    'ghl_local_noah_chen',
    null,
    current_date - interval '14 days',
    null,
    'plan_U3CUUJkzgyTjel',
    now() - interval '14 days',
    null,
    'subscription'
  )
on conflict (id) do update set
  client_id = excluded.client_id,
  athlete_name = excluded.athlete_name,
  archetype = excluded.archetype,
  trainer = excluded.trainer,
  group_num = excluded.group_num,
  plan = excluded.plan,
  status = excluded.status,
  engagement = excluded.engagement,
  skill_notes = excluded.skill_notes,
  parent_name = excluded.parent_name,
  parent_archetype = excluded.parent_archetype,
  parent_email = excluded.parent_email,
  parent_phone = excluded.parent_phone,
  stripe_customer_id = excluded.stripe_customer_id,
  stripe_subscription_id = excluded.stripe_subscription_id,
  ghl_contact_id = excluded.ghl_contact_id,
  coachiq_member_id = excluded.coachiq_member_id,
  joined_date = excluded.joined_date,
  avatar_url = excluded.avatar_url,
  stripe_price_id = excluded.stripe_price_id,
  stripe_joined_at = excluded.stripe_joined_at,
  pause_scheduled_for = excluded.pause_scheduled_for,
  billing_mode = excluded.billing_mode,
  updated_at = now();

insert into public.academy_memberships (
  id,
  academy_id,
  customer_id,
  student_id,
  stripe_customer_id,
  status,
  joined_at,
  ghl_contact_id
)
values
  (
    '8f4f7dc6-a0ab-4549-95e5-7e6e32c2da8f',
    '39875f07-0a4b-4429-a201-2249bc1f24df',
    null,
    '531a0580-56c6-4029-a72f-c42221e17bfb',
    'cus_local_maya_rivera',
    'ACTIVE',
    now() - interval '120 days',
    'ghl_local_maya_rivera'
  ),
  (
    '6543bff1-4f54-4760-a82f-2c0d210ec27d',
    '39875f07-0a4b-4429-a201-2249bc1f24df',
    null,
    '5c0bf246-1612-4e82-8aca-4fba43e13f6e',
    'cus_local_leo_rivera',
    'SUSPENDED',
    now() - interval '210 days',
    'ghl_local_leo_rivera'
  ),
  (
    'a5ac9fd2-8d34-456a-8b56-1ae457f256f4',
    '39875f07-0a4b-4429-a201-2249bc1f24df',
    null,
    'ccfd4c6a-9e7a-41f4-8d7a-8f6e80e69825',
    'cus_local_noah_chen',
    'ACTIVE',
    now() - interval '14 days',
    'ghl_local_noah_chen'
  ),
  (
    '2fba5d9d-5f08-4b65-9f98-6bbd604d4908',
    '39875f07-0a4b-4429-a201-2249bc1f24df',
    '7c269b89-17df-4f7d-9258-c2d442f1b6df',
    null,
    null,
    'SUSPENDED',
    now(),
    'ghl_local_taylor_morgan'
  )
on conflict (id) do update set
  academy_id = excluded.academy_id,
  customer_id = excluded.customer_id,
  student_id = excluded.student_id,
  stripe_customer_id = excluded.stripe_customer_id,
  status = excluded.status,
  joined_at = excluded.joined_at,
  ghl_contact_id = excluded.ghl_contact_id;

insert into public.member_links (
  id,
  student_id,
  member_id,
  matched_by,
  confirmed_at
)
values
  (
    'e7bd3482-df10-4ecf-8b41-f468e740506a',
    '531a0580-56c6-4029-a72f-c42221e17bfb',
    '5e0c5f1d-98ee-4674-975f-63b6b7f7f6a7',
    'email',
    now() - interval '119 days'
  ),
  (
    '632fcded-1938-43b8-b66c-46d33a18ef0c',
    '5c0bf246-1612-4e82-8aca-4fba43e13f6e',
    'e53d4d4b-72c9-48c5-a121-604d4a9e7407',
    'email',
    now() - interval '209 days'
  ),
  (
    '8a884530-7e1d-49a1-b4ac-75674622d221',
    'ccfd4c6a-9e7a-41f4-8d7a-8f6e80e69825',
    'c72b32c8-01a8-4cd6-8f25-e244126cb7bf',
    'phone',
    now() - interval '13 days'
  )
on conflict (id) do update set
  student_id = excluded.student_id,
  member_id = excluded.member_id,
  matched_by = excluded.matched_by,
  confirmed_at = excluded.confirmed_at;

insert into public.cancellations (
  id,
  client_id,
  member_id,
  athlete_name,
  archetype,
  parent_name,
  type,
  pause_start,
  pause_end,
  reason,
  stripe_subscription_id,
  stripe_customer_id,
  activated_at
)
values (
  'f7c57fb3-7b40-41ec-bba7-eb25e7265f22',
  '39875f07-0a4b-4429-a201-2249bc1f24df',
  'e53d4d4b-72c9-48c5-a121-604d4a9e7407',
  'Leo Rivera',
  'Advanced wing',
  'Alex Rivera',
  'pause',
  current_date - interval '7 days',
  current_date + interval '21 days',
  'Synthetic local fixture: temporary school schedule pause.',
  'sub_local_leo_2wk',
  'cus_local_leo_rivera',
  now() - interval '7 days'
)
on conflict (id) do update set
  member_id = excluded.member_id,
  athlete_name = excluded.athlete_name,
  archetype = excluded.archetype,
  parent_name = excluded.parent_name,
  type = excluded.type,
  pause_start = excluded.pause_start,
  pause_end = excluded.pause_end,
  reason = excluded.reason,
  stripe_subscription_id = excluded.stripe_subscription_id,
  stripe_customer_id = excluded.stripe_customer_id,
  activated_at = excluded.activated_at;

insert into public.member_audit_log (
  id,
  client_id,
  member_id,
  action_type,
  args,
  performed_by,
  performed_by_name,
  db_changes
)
values
  (
    'aeeebd97-0bdf-4550-af50-e1f87246d23a',
    '39875f07-0a4b-4429-a201-2249bc1f24df',
    '5e0c5f1d-98ee-4674-975f-63b6b7f7f6a7',
    'intake-stripe-link',
    '{"source":"local_seed","stripe_price_id":"plan_ToNwa96lQ5I1Bs"}'::jsonb,
    'b946db12-f498-48ef-bc6d-40613a7b5345',
    'Local Admin',
    '{"members":{"status":"live","linked":true}}'::jsonb
  ),
  (
    'dcf43bda-6a04-463f-90a8-44bc1bf604b1',
    '39875f07-0a4b-4429-a201-2249bc1f24df',
    'e53d4d4b-72c9-48c5-a121-604d4a9e7407',
    'pause',
    '{"source":"local_seed","pause_days":28}'::jsonb,
    'b946db12-f498-48ef-bc6d-40613a7b5345',
    'Local Admin',
    '{"members":{"status":{"from":"live","to":"paused"}}}'::jsonb
  ),
  (
    'ef6531d4-d9e1-45df-958e-f7b5728093da',
    '39875f07-0a4b-4429-a201-2249bc1f24df',
    'c72b32c8-01a8-4cd6-8f25-e244126cb7bf',
    'payment-link',
    '{"source":"local_seed","reason":"payment_method_required"}'::jsonb,
    'b946db12-f498-48ef-bc6d-40613a7b5345',
    'Local Admin',
    '{"members":{"status":"payment_method_required"}}'::jsonb
  )
on conflict (id) do update set
  member_id = excluded.member_id,
  action_type = excluded.action_type,
  args = excluded.args,
  performed_by = excluded.performed_by,
  performed_by_name = excluded.performed_by_name,
  db_changes = excluded.db_changes;
