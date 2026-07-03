-- Local academy portal login:
--   academy.owner@example.test / local-password

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
values (
  '00000000-0000-0000-0000-000000000000',
  '72000000-0000-4000-8000-000000000001',
  'authenticated',
  'authenticated',
  'academy.owner@example.test',
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
  '{"provider":"email","providers":["email"],"role":"client"}'::jsonb,
  '{"first_name":"Academy","last_name":"Owner"}'::jsonb,
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
values (
  '72000000-0000-4000-8000-000000000001',
  '72000000-0000-4000-8000-000000000001',
  '72000000-0000-4000-8000-000000000001',
  '{"sub":"72000000-0000-4000-8000-000000000001","email":"academy.owner@example.test","email_verified":true,"phone_verified":false}'::jsonb,
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

insert into public.client_users (
  id,
  user_id,
  client_id,
  name,
  email,
  role,
  status
)
values (
  '72000000-0000-4000-8000-000000000101',
  '72000000-0000-4000-8000-000000000001',
  '39875f07-0a4b-4429-a201-2249bc1f24df',
  'Academy Owner',
  'academy.owner@example.test',
  'owner',
  'active'
)
on conflict (user_id, client_id) do update set
  id = excluded.id,
  name = excluded.name,
  email = excluded.email,
  role = excluded.role,
  status = excluded.status,
  updated_at = now();
