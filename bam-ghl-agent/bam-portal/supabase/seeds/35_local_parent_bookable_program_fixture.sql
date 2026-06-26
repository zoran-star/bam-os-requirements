-- Local development seed: parent-owned bookable program fixture for BAM GTA.
--
-- A bookable program is the access target that entitlements grant and
-- schedule slots belong to. Training MVP uses one program for BAM GTA.

insert into public.bookable_programs (
  id,
  tenant_id,
  source_program_key,
  title,
  program_type,
  status,
  description,
  sort_order,
  config
)
values (
  '80000000-0000-4000-8000-000000000001',
  '39875f07-0a4b-4429-a201-2249bc1f24df',
  'bam-gta-training',
  'BAM GTA Training',
  'TRAINING',
  'ACTIVE',
  'Training classes and shooting sessions for BAM GTA.',
  10,
  '{"seed":"local-parent-bookable-program"}'::jsonb
)
on conflict (tenant_id, source_program_key) do update set
  title = excluded.title,
  program_type = excluded.program_type,
  status = excluded.status,
  description = excluded.description,
  sort_order = excluded.sort_order,
  config = excluded.config,
  updated_at = now();
