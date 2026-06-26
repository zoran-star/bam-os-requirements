-- Local development seed: synthetic parent schedule fixture for BAM GTA.
--
-- Mirrors the schedule shape from fc-mobile's parent demo fixtures while using
-- date-relative slots so local read-only schedule APIs keep returning useful
-- upcoming and past data after any db reset.

insert into public.locations (
  id,
  client_id,
  title,
  address,
  notes,
  sort_order
)
values
  (
    '71000000-0000-4000-8000-000000000001',
    '39875f07-0a4b-4429-a201-2249bc1f24df',
    'Linbrook Court',
    '1079 Linbrook Rd, Oakville, ON L6J 2L2',
    'Synthetic local fixture: use the front doors on the left side of the building.',
    10
  ),
  (
    '71000000-0000-4000-8000-000000000002',
    '39875f07-0a4b-4429-a201-2249bc1f24df',
    'BAM Shooting Lab',
    '1080 Linbrook Rd, Oakville, ON L6J 2L2',
    'Synthetic local fixture: check in at the side entrance.',
    20
  )
on conflict (id) do update set
  client_id = excluded.client_id,
  title = excluded.title,
  address = excluded.address,
  notes = excluded.notes,
  sort_order = excluded.sort_order,
  updated_at = now();

with seed_context as (
  select
    c.id as academy_id,
    bp.id as bookable_program_id,
    '52a6285c-7832-44e1-b531-ab7ef9d8fc21'::uuid as source_offer_id
  from public.clients c
  join public.bookable_programs bp
    on bp.tenant_id = c.id
   and bp.source_program_key = 'bam-gta-training'
  where c.id = '39875f07-0a4b-4429-a201-2249bc1f24df'
),
seed_templates (
  id,
  source_offer_class_key,
  name,
  slot_type,
  description,
  default_location,
  default_capacity,
  default_start_time,
  default_end_time,
  default_credit_cost,
  location_id
) as (
  values
    (
      '72000000-0000-4000-8000-000000000001'::uuid,
      'mon-younger',
      'Monday Younger',
      'GROUP_CLASS',
      'Skills training for younger athletes.',
      '1079 Linbrook Rd, Oakville, ON L6J 2L2',
      15,
      '19:00'::time,
      '20:00'::time,
      1,
      '71000000-0000-4000-8000-000000000001'::uuid
    ),
    (
      '72000000-0000-4000-8000-000000000002'::uuid,
      'mon-older',
      'Monday Older',
      'GROUP_CLASS',
      'Skills training for older athletes.',
      '1079 Linbrook Rd, Oakville, ON L6J 2L2',
      15,
      '20:00'::time,
      '21:00'::time,
      1,
      '71000000-0000-4000-8000-000000000001'::uuid
    ),
    (
      '72000000-0000-4000-8000-000000000003'::uuid,
      'tue-younger',
      'Tuesday Younger',
      'GROUP_CLASS',
      'Skills training for younger athletes.',
      '1079 Linbrook Rd, Oakville, ON L6J 2L2',
      15,
      '19:00'::time,
      '20:00'::time,
      1,
      '71000000-0000-4000-8000-000000000001'::uuid
    ),
    (
      '72000000-0000-4000-8000-000000000004'::uuid,
      'tue-older',
      'Tuesday Older',
      'GROUP_CLASS',
      'Skills training for older athletes.',
      '1079 Linbrook Rd, Oakville, ON L6J 2L2',
      15,
      '20:00'::time,
      '21:00'::time,
      1,
      '71000000-0000-4000-8000-000000000001'::uuid
    ),
    (
      '72000000-0000-4000-8000-000000000005'::uuid,
      'wed-younger',
      'Wednesday Younger',
      'GROUP_CLASS',
      'Skills training for younger athletes.',
      '1079 Linbrook Rd, Oakville, ON L6J 2L2',
      15,
      '19:00'::time,
      '20:00'::time,
      1,
      '71000000-0000-4000-8000-000000000001'::uuid
    ),
    (
      '72000000-0000-4000-8000-000000000006'::uuid,
      'wed-older',
      'Wednesday Older',
      'GROUP_CLASS',
      'Skills training for older athletes.',
      '1079 Linbrook Rd, Oakville, ON L6J 2L2',
      2,
      '20:00'::time,
      '21:00'::time,
      1,
      '71000000-0000-4000-8000-000000000001'::uuid
    ),
    (
      '72000000-0000-4000-8000-000000000007'::uuid,
      'thu-younger',
      'Thursday Younger',
      'GROUP_CLASS',
      'Skills training for younger athletes.',
      '1079 Linbrook Rd, Oakville, ON L6J 2L2',
      15,
      '19:00'::time,
      '20:00'::time,
      1,
      '71000000-0000-4000-8000-000000000001'::uuid
    ),
    (
      '72000000-0000-4000-8000-000000000008'::uuid,
      'thu-older',
      'Thursday Older',
      'GROUP_CLASS',
      'Skills training for older athletes.',
      '1079 Linbrook Rd, Oakville, ON L6J 2L2',
      15,
      '20:00'::time,
      '21:00'::time,
      1,
      '71000000-0000-4000-8000-000000000001'::uuid
    ),
    (
      '72000000-0000-4000-8000-000000000009'::uuid,
      'sat-younger',
      'Saturday Younger',
      'GROUP_CLASS',
      'Weekend skills training for younger athletes.',
      '1079 Linbrook Rd, Oakville, ON L6J 2L2',
      15,
      '11:30'::time,
      '12:30'::time,
      1,
      '71000000-0000-4000-8000-000000000001'::uuid
    ),
    (
      '72000000-0000-4000-8000-000000000010'::uuid,
      'sat-older',
      'Saturday Older',
      'GROUP_CLASS',
      'Weekend skills training for older athletes.',
      '1079 Linbrook Rd, Oakville, ON L6J 2L2',
      15,
      '12:30'::time,
      '13:30'::time,
      1,
      '71000000-0000-4000-8000-000000000001'::uuid
    ),
    (
      '72000000-0000-4000-8000-000000000011'::uuid,
      'sun-shooting',
      'Sunday Shooting',
      'SHOOTING',
      'Shooting session, open to all ages.',
      '1080 Linbrook Rd, Oakville, ON L6J 2L2',
      20,
      '08:30'::time,
      '10:00'::time,
      1,
      '71000000-0000-4000-8000-000000000002'::uuid
    ),
    (
      '72000000-0000-4000-8000-000000000012'::uuid,
      'sat-all-levels',
      'Saturday All Levels',
      'GROUP_CLASS',
      'All-levels weekend skills training.',
      '1079 Linbrook Rd, Oakville, ON L6J 2L2',
      20,
      '10:00'::time,
      '11:00'::time,
      1,
      '71000000-0000-4000-8000-000000000001'::uuid
    ),
    (
      '72000000-0000-4000-8000-000000000013'::uuid,
      'thu-advanced',
      'Thursday Advanced',
      'GROUP_CLASS',
      'Advanced skills training for older athletes.',
      '1079 Linbrook Rd, Oakville, ON L6J 2L2',
      15,
      '20:00'::time,
      '21:00'::time,
      1,
      '71000000-0000-4000-8000-000000000001'::uuid
    )
)
insert into public.slot_templates (
  id,
  tenant_id,
  name,
  slot_type,
  description,
  default_location,
  default_capacity,
  recurrence_rule,
  default_start_time,
  default_end_time,
  default_credit_cost,
  is_active,
  location_id,
  bookable_program_id,
  source_offer_id,
  source_offer_class_key
)
select
  t.id,
  c.academy_id,
  t.name,
  t.slot_type,
  t.description,
  t.default_location,
  t.default_capacity,
  null,
  t.default_start_time,
  t.default_end_time,
  t.default_credit_cost,
  true,
  t.location_id,
  c.bookable_program_id,
  c.source_offer_id,
  t.source_offer_class_key
from seed_templates t
cross join seed_context c
on conflict (id) do update set
  tenant_id = excluded.tenant_id,
  name = excluded.name,
  slot_type = excluded.slot_type,
  description = excluded.description,
  default_location = excluded.default_location,
  default_capacity = excluded.default_capacity,
  recurrence_rule = excluded.recurrence_rule,
  default_start_time = excluded.default_start_time,
  default_end_time = excluded.default_end_time,
  default_credit_cost = excluded.default_credit_cost,
  is_active = excluded.is_active,
  location_id = excluded.location_id,
  bookable_program_id = excluded.bookable_program_id,
  source_offer_id = excluded.source_offer_id,
  source_offer_class_key = excluded.source_offer_class_key,
  updated_at = now();

with seed_context as (
  select
    c.id as academy_id,
    bp.id as bookable_program_id,
    coalesce(nullif(c.time_zone, ''), 'America/New_York') as time_zone,
    '52a6285c-7832-44e1-b531-ab7ef9d8fc21'::uuid as source_offer_id
  from public.clients c
  join public.bookable_programs bp
    on bp.tenant_id = c.id
   and bp.source_program_key = 'bam-gta-training'
  where c.id = '39875f07-0a4b-4429-a201-2249bc1f24df'
),
seed_dates as (
  select
    (
      current_date +
      case
        when extract(isodow from current_date)::integer = 1 then 7
        else 8 - extract(isodow from current_date)::integer
      end
    )::date as next_monday
),
seed_slots (
  id,
  slot_template_id,
  source_offer_class_key,
  day_offset,
  name,
  description,
  slot_type,
  location_label,
  capacity,
  credit_cost,
  start_local,
  end_local,
  location_id,
  is_cancelled
) as (
  values
    (
      '73000000-0000-4000-8000-000000000001'::uuid,
      '72000000-0000-4000-8000-000000000001'::uuid,
      'mon-younger',
      0,
      'Monday Younger',
      'Skills training for younger athletes.',
      'GROUP_CLASS',
      '1079 Linbrook Rd, Oakville, ON L6J 2L2',
      15,
      1,
      '19:00'::time,
      '20:00'::time,
      '71000000-0000-4000-8000-000000000001'::uuid,
      false
    ),
    (
      '73000000-0000-4000-8000-000000000002'::uuid,
      '72000000-0000-4000-8000-000000000002'::uuid,
      'mon-older',
      0,
      'Monday Older',
      'Skills training for older athletes.',
      'GROUP_CLASS',
      '1079 Linbrook Rd, Oakville, ON L6J 2L2',
      15,
      1,
      '20:00'::time,
      '21:00'::time,
      '71000000-0000-4000-8000-000000000001'::uuid,
      false
    ),
    (
      '73000000-0000-4000-8000-000000000003'::uuid,
      '72000000-0000-4000-8000-000000000003'::uuid,
      'tue-younger',
      1,
      'Tuesday Younger',
      'Skills training for younger athletes.',
      'GROUP_CLASS',
      '1079 Linbrook Rd, Oakville, ON L6J 2L2',
      15,
      1,
      '19:00'::time,
      '20:00'::time,
      '71000000-0000-4000-8000-000000000001'::uuid,
      false
    ),
    (
      '73000000-0000-4000-8000-000000000004'::uuid,
      '72000000-0000-4000-8000-000000000004'::uuid,
      'tue-older',
      1,
      'Tuesday Older',
      'Skills training for older athletes.',
      'GROUP_CLASS',
      '1079 Linbrook Rd, Oakville, ON L6J 2L2',
      15,
      1,
      '20:00'::time,
      '21:00'::time,
      '71000000-0000-4000-8000-000000000001'::uuid,
      false
    ),
    (
      '73000000-0000-4000-8000-000000000023'::uuid,
      '72000000-0000-4000-8000-000000000004'::uuid,
      'tue-older',
      1,
      'Tuesday Waitlist Test',
      'Synthetic full class for testing the parent waitlist flow.',
      'GROUP_CLASS',
      '1079 Linbrook Rd, Oakville, ON L6J 2L2',
      1,
      1,
      '20:30'::time,
      '21:30'::time,
      '71000000-0000-4000-8000-000000000001'::uuid,
      false
    ),
    (
      '73000000-0000-4000-8000-000000000005'::uuid,
      '72000000-0000-4000-8000-000000000005'::uuid,
      'wed-younger',
      2,
      'Wednesday Younger',
      'Skills training for younger athletes.',
      'GROUP_CLASS',
      '1079 Linbrook Rd, Oakville, ON L6J 2L2',
      15,
      1,
      '19:00'::time,
      '20:00'::time,
      '71000000-0000-4000-8000-000000000001'::uuid,
      false
    ),
    (
      '73000000-0000-4000-8000-000000000006'::uuid,
      '72000000-0000-4000-8000-000000000006'::uuid,
      'wed-older',
      2,
      'Wednesday Older',
      'Skills training for older athletes.',
      'GROUP_CLASS',
      '1079 Linbrook Rd, Oakville, ON L6J 2L2',
      2,
      1,
      '20:00'::time,
      '21:00'::time,
      '71000000-0000-4000-8000-000000000001'::uuid,
      false
    ),
    (
      '73000000-0000-4000-8000-000000000007'::uuid,
      '72000000-0000-4000-8000-000000000007'::uuid,
      'thu-younger',
      3,
      'Thursday Younger',
      'Skills training for younger athletes.',
      'GROUP_CLASS',
      '1079 Linbrook Rd, Oakville, ON L6J 2L2',
      15,
      1,
      '19:00'::time,
      '20:00'::time,
      '71000000-0000-4000-8000-000000000001'::uuid,
      false
    ),
    (
      '73000000-0000-4000-8000-000000000008'::uuid,
      '72000000-0000-4000-8000-000000000008'::uuid,
      'thu-older',
      3,
      'Thursday Older',
      'Skills training for older athletes.',
      'GROUP_CLASS',
      '1079 Linbrook Rd, Oakville, ON L6J 2L2',
      15,
      1,
      '20:00'::time,
      '21:00'::time,
      '71000000-0000-4000-8000-000000000001'::uuid,
      false
    ),
    (
      '73000000-0000-4000-8000-000000000009'::uuid,
      '72000000-0000-4000-8000-000000000009'::uuid,
      'sat-younger',
      5,
      'Saturday Younger',
      'Weekend skills training for younger athletes.',
      'GROUP_CLASS',
      '1079 Linbrook Rd, Oakville, ON L6J 2L2',
      15,
      1,
      '11:30'::time,
      '12:30'::time,
      '71000000-0000-4000-8000-000000000001'::uuid,
      false
    ),
    (
      '73000000-0000-4000-8000-000000000010'::uuid,
      '72000000-0000-4000-8000-000000000010'::uuid,
      'sat-older',
      5,
      'Saturday Older',
      'Weekend skills training for older athletes.',
      'GROUP_CLASS',
      '1079 Linbrook Rd, Oakville, ON L6J 2L2',
      15,
      1,
      '12:30'::time,
      '13:30'::time,
      '71000000-0000-4000-8000-000000000001'::uuid,
      false
    ),
    (
      '73000000-0000-4000-8000-000000000011'::uuid,
      '72000000-0000-4000-8000-000000000011'::uuid,
      'sun-shooting',
      6,
      'Sunday Shooting',
      'Shooting session, open to all ages.',
      'SHOOTING',
      '1080 Linbrook Rd, Oakville, ON L6J 2L2',
      20,
      1,
      '08:30'::time,
      '10:00'::time,
      '71000000-0000-4000-8000-000000000002'::uuid,
      false
    ),
    (
      '73000000-0000-4000-8000-000000000012'::uuid,
      '72000000-0000-4000-8000-000000000002'::uuid,
      'mon-older',
      7,
      'Monday Older',
      'Skills training for older athletes.',
      'GROUP_CLASS',
      '1079 Linbrook Rd, Oakville, ON L6J 2L2',
      15,
      1,
      '20:00'::time,
      '21:00'::time,
      '71000000-0000-4000-8000-000000000001'::uuid,
      false
    ),
    (
      '73000000-0000-4000-8000-000000000013'::uuid,
      '72000000-0000-4000-8000-000000000008'::uuid,
      'thu-older',
      10,
      'Thursday Older',
      'Skills training for older athletes.',
      'GROUP_CLASS',
      '1079 Linbrook Rd, Oakville, ON L6J 2L2',
      15,
      1,
      '20:00'::time,
      '21:00'::time,
      '71000000-0000-4000-8000-000000000001'::uuid,
      false
    ),
    (
      '73000000-0000-4000-8000-000000000014'::uuid,
      '72000000-0000-4000-8000-000000000011'::uuid,
      'sun-shooting',
      13,
      'Sunday Shooting',
      'Shooting session, open to all ages.',
      'SHOOTING',
      '1080 Linbrook Rd, Oakville, ON L6J 2L2',
      20,
      1,
      '08:30'::time,
      '10:00'::time,
      '71000000-0000-4000-8000-000000000002'::uuid,
      false
    ),
    (
      '73000000-0000-4000-8000-000000000015'::uuid,
      '72000000-0000-4000-8000-000000000002'::uuid,
      'mon-older',
      14,
      'Monday Older',
      'Skills training for older athletes.',
      'GROUP_CLASS',
      '1079 Linbrook Rd, Oakville, ON L6J 2L2',
      15,
      1,
      '20:00'::time,
      '21:00'::time,
      '71000000-0000-4000-8000-000000000001'::uuid,
      false
    ),
    (
      '73000000-0000-4000-8000-000000000016'::uuid,
      '72000000-0000-4000-8000-000000000012'::uuid,
      'sat-all-levels',
      -9,
      'Saturday All Levels',
      'All-levels weekend skills training.',
      'GROUP_CLASS',
      '1079 Linbrook Rd, Oakville, ON L6J 2L2',
      20,
      1,
      '10:00'::time,
      '11:00'::time,
      '71000000-0000-4000-8000-000000000001'::uuid,
      false
    ),
    (
      '73000000-0000-4000-8000-000000000017'::uuid,
      '72000000-0000-4000-8000-000000000013'::uuid,
      'thu-advanced',
      -11,
      'Thursday Advanced',
      'Advanced skills training for older athletes.',
      'GROUP_CLASS',
      '1079 Linbrook Rd, Oakville, ON L6J 2L2',
      15,
      1,
      '20:00'::time,
      '21:00'::time,
      '71000000-0000-4000-8000-000000000001'::uuid,
      false
    ),
    (
      '73000000-0000-4000-8000-000000000018'::uuid,
      '72000000-0000-4000-8000-000000000002'::uuid,
      'mon-older',
      -14,
      'Monday Older',
      'Skills training for older athletes.',
      'GROUP_CLASS',
      '1079 Linbrook Rd, Oakville, ON L6J 2L2',
      15,
      1,
      '20:00'::time,
      '21:00'::time,
      '71000000-0000-4000-8000-000000000001'::uuid,
      false
    ),
    (
      '73000000-0000-4000-8000-000000000019'::uuid,
      '72000000-0000-4000-8000-000000000013'::uuid,
      'thu-advanced',
      -18,
      'Thursday Advanced',
      'Advanced skills training for older athletes.',
      'GROUP_CLASS',
      '1079 Linbrook Rd, Oakville, ON L6J 2L2',
      15,
      1,
      '20:00'::time,
      '21:00'::time,
      '71000000-0000-4000-8000-000000000001'::uuid,
      false
    ),
    (
      '73000000-0000-4000-8000-000000000020'::uuid,
      '72000000-0000-4000-8000-000000000011'::uuid,
      'sun-shooting',
      -8,
      'Sunday Shooting',
      'Shooting session, open to all ages.',
      'SHOOTING',
      '1080 Linbrook Rd, Oakville, ON L6J 2L2',
      20,
      1,
      '08:30'::time,
      '10:00'::time,
      '71000000-0000-4000-8000-000000000002'::uuid,
      false
    ),
    (
      '73000000-0000-4000-8000-000000000021'::uuid,
      '72000000-0000-4000-8000-000000000012'::uuid,
      'sat-all-levels',
      -16,
      'Saturday All Levels',
      'All-levels weekend skills training.',
      'GROUP_CLASS',
      '1079 Linbrook Rd, Oakville, ON L6J 2L2',
      20,
      1,
      '10:00'::time,
      '11:00'::time,
      '71000000-0000-4000-8000-000000000001'::uuid,
      false
    ),
    (
      '73000000-0000-4000-8000-000000000022'::uuid,
      '72000000-0000-4000-8000-000000000005'::uuid,
      'wed-younger',
      -12,
      'Wednesday Younger',
      'Skills training for younger athletes.',
      'GROUP_CLASS',
      '1079 Linbrook Rd, Oakville, ON L6J 2L2',
      15,
      1,
      '19:00'::time,
      '20:00'::time,
      '71000000-0000-4000-8000-000000000001'::uuid,
      false
    )
)
insert into public.schedule_slots (
  id,
  tenant_id,
  name,
  description,
  slot_type,
  location_label,
  capacity,
  credit_cost,
  start_time,
  end_time,
  slot_template_id,
  is_cancelled,
  location_id,
  bookable_program_id,
  source_offer_id,
  source_offer_class_key
)
select
  s.id,
  c.academy_id,
  s.name,
  s.description,
  s.slot_type,
  s.location_label,
  s.capacity,
  s.credit_cost,
  ((d.next_monday + s.day_offset) + s.start_local) at time zone c.time_zone,
  ((d.next_monday + s.day_offset) + s.end_local) at time zone c.time_zone,
  s.slot_template_id,
  s.is_cancelled,
  s.location_id,
  c.bookable_program_id,
  c.source_offer_id,
  s.source_offer_class_key
from seed_slots s
cross join seed_context c
cross join seed_dates d
on conflict (id) do update set
  tenant_id = excluded.tenant_id,
  name = excluded.name,
  description = excluded.description,
  slot_type = excluded.slot_type,
  location_label = excluded.location_label,
  capacity = excluded.capacity,
  credit_cost = excluded.credit_cost,
  start_time = excluded.start_time,
  end_time = excluded.end_time,
  slot_template_id = excluded.slot_template_id,
  is_cancelled = excluded.is_cancelled,
  location_id = excluded.location_id,
  bookable_program_id = excluded.bookable_program_id,
  source_offer_id = excluded.source_offer_id,
  source_offer_class_key = excluded.source_offer_class_key,
  updated_at = now();

with seed_context as (
  select '39875f07-0a4b-4429-a201-2249bc1f24df'::uuid as academy_id
),
seed_reservations (
  id,
  slot_id,
  membership_id,
  student_id,
  status,
  location_id,
  ghl_appointment_id
) as (
  values
    (
      '74000000-0000-4000-8000-000000000001'::uuid,
      '73000000-0000-4000-8000-000000000002'::uuid,
      '8f4f7dc6-a0ab-4549-95e5-7e6e32c2da8f'::uuid,
      '531a0580-56c6-4029-a72f-c42221e17bfb'::uuid,
      'CONFIRMED',
      '71000000-0000-4000-8000-000000000001'::uuid,
      'local-ghl-appt-maya-mon-older-1'
    ),
    (
      '74000000-0000-4000-8000-000000000002'::uuid,
      '73000000-0000-4000-8000-000000000008'::uuid,
      '8f4f7dc6-a0ab-4549-95e5-7e6e32c2da8f'::uuid,
      '531a0580-56c6-4029-a72f-c42221e17bfb'::uuid,
      'CONFIRMED',
      '71000000-0000-4000-8000-000000000001'::uuid,
      'local-ghl-appt-maya-thu-older-1'
    ),
    (
      '74000000-0000-4000-8000-000000000003'::uuid,
      '73000000-0000-4000-8000-000000000011'::uuid,
      '8f4f7dc6-a0ab-4549-95e5-7e6e32c2da8f'::uuid,
      '531a0580-56c6-4029-a72f-c42221e17bfb'::uuid,
      'CONFIRMED',
      '71000000-0000-4000-8000-000000000002'::uuid,
      'local-ghl-appt-maya-sun-shooting-1'
    ),
    (
      '74000000-0000-4000-8000-000000000004'::uuid,
      '73000000-0000-4000-8000-000000000012'::uuid,
      '8f4f7dc6-a0ab-4549-95e5-7e6e32c2da8f'::uuid,
      '531a0580-56c6-4029-a72f-c42221e17bfb'::uuid,
      'CONFIRMED',
      '71000000-0000-4000-8000-000000000001'::uuid,
      'local-ghl-appt-maya-mon-older-2'
    ),
    (
      '74000000-0000-4000-8000-000000000005'::uuid,
      '73000000-0000-4000-8000-000000000013'::uuid,
      '8f4f7dc6-a0ab-4549-95e5-7e6e32c2da8f'::uuid,
      '531a0580-56c6-4029-a72f-c42221e17bfb'::uuid,
      'CONFIRMED',
      '71000000-0000-4000-8000-000000000001'::uuid,
      'local-ghl-appt-maya-thu-older-2'
    ),
    (
      '74000000-0000-4000-8000-000000000006'::uuid,
      '73000000-0000-4000-8000-000000000014'::uuid,
      '8f4f7dc6-a0ab-4549-95e5-7e6e32c2da8f'::uuid,
      '531a0580-56c6-4029-a72f-c42221e17bfb'::uuid,
      'CONFIRMED',
      '71000000-0000-4000-8000-000000000002'::uuid,
      'local-ghl-appt-maya-sun-shooting-2'
    ),
    (
      '74000000-0000-4000-8000-000000000007'::uuid,
      '73000000-0000-4000-8000-000000000015'::uuid,
      '8f4f7dc6-a0ab-4549-95e5-7e6e32c2da8f'::uuid,
      '531a0580-56c6-4029-a72f-c42221e17bfb'::uuid,
      'CONFIRMED',
      '71000000-0000-4000-8000-000000000001'::uuid,
      'local-ghl-appt-maya-mon-older-3'
    ),
    (
      '74000000-0000-4000-8000-000000000008'::uuid,
      '73000000-0000-4000-8000-000000000006'::uuid,
      '8f4f7dc6-a0ab-4549-95e5-7e6e32c2da8f'::uuid,
      '531a0580-56c6-4029-a72f-c42221e17bfb'::uuid,
      'CONFIRMED',
      '71000000-0000-4000-8000-000000000001'::uuid,
      'local-ghl-appt-maya-wed-older-full'
    ),
    (
      '74000000-0000-4000-8000-000000000009'::uuid,
      '73000000-0000-4000-8000-000000000006'::uuid,
      'a5ac9fd2-8d34-456a-8b56-1ae457f256f4'::uuid,
      'ccfd4c6a-9e7a-41f4-8d7a-8f6e80e69825'::uuid,
      'CONFIRMED',
      '71000000-0000-4000-8000-000000000001'::uuid,
      'local-ghl-appt-noah-wed-older-full'
    ),
    (
      '74000000-0000-4000-8000-000000000010'::uuid,
      '73000000-0000-4000-8000-000000000016'::uuid,
      '8f4f7dc6-a0ab-4549-95e5-7e6e32c2da8f'::uuid,
      '531a0580-56c6-4029-a72f-c42221e17bfb'::uuid,
      'ATTENDED',
      '71000000-0000-4000-8000-000000000001'::uuid,
      'local-ghl-appt-maya-sat-all-levels-past'
    ),
    (
      '74000000-0000-4000-8000-000000000011'::uuid,
      '73000000-0000-4000-8000-000000000017'::uuid,
      '8f4f7dc6-a0ab-4549-95e5-7e6e32c2da8f'::uuid,
      '531a0580-56c6-4029-a72f-c42221e17bfb'::uuid,
      'ATTENDED',
      '71000000-0000-4000-8000-000000000001'::uuid,
      'local-ghl-appt-maya-thu-advanced-past'
    ),
    (
      '74000000-0000-4000-8000-000000000012'::uuid,
      '73000000-0000-4000-8000-000000000018'::uuid,
      '8f4f7dc6-a0ab-4549-95e5-7e6e32c2da8f'::uuid,
      '531a0580-56c6-4029-a72f-c42221e17bfb'::uuid,
      'ATTENDED',
      '71000000-0000-4000-8000-000000000001'::uuid,
      'local-ghl-appt-maya-mon-older-past'
    ),
    (
      '74000000-0000-4000-8000-000000000013'::uuid,
      '73000000-0000-4000-8000-000000000019'::uuid,
      '8f4f7dc6-a0ab-4549-95e5-7e6e32c2da8f'::uuid,
      '531a0580-56c6-4029-a72f-c42221e17bfb'::uuid,
      'NO_SHOW',
      '71000000-0000-4000-8000-000000000001'::uuid,
      'local-ghl-appt-maya-thu-advanced-no-show'
    ),
    (
      '74000000-0000-4000-8000-000000000014'::uuid,
      '73000000-0000-4000-8000-000000000020'::uuid,
      '8f4f7dc6-a0ab-4549-95e5-7e6e32c2da8f'::uuid,
      '531a0580-56c6-4029-a72f-c42221e17bfb'::uuid,
      'ATTENDED',
      '71000000-0000-4000-8000-000000000002'::uuid,
      'local-ghl-appt-maya-sun-shooting-past'
    ),
    (
      '74000000-0000-4000-8000-000000000015'::uuid,
      '73000000-0000-4000-8000-000000000021'::uuid,
      '6543bff1-4f54-4760-a82f-2c0d210ec27d'::uuid,
      '5c0bf246-1612-4e82-8aca-4fba43e13f6e'::uuid,
      'ATTENDED',
      '71000000-0000-4000-8000-000000000001'::uuid,
      'local-ghl-appt-leo-sat-all-levels-past'
    ),
    (
      '74000000-0000-4000-8000-000000000016'::uuid,
      '73000000-0000-4000-8000-000000000022'::uuid,
      '6543bff1-4f54-4760-a82f-2c0d210ec27d'::uuid,
      '5c0bf246-1612-4e82-8aca-4fba43e13f6e'::uuid,
      'ATTENDED',
      '71000000-0000-4000-8000-000000000001'::uuid,
      'local-ghl-appt-leo-wed-younger-past'
    ),
    (
      '74000000-0000-4000-8000-000000000017'::uuid,
      '73000000-0000-4000-8000-000000000023'::uuid,
      'a5ac9fd2-8d34-456a-8b56-1ae457f256f4'::uuid,
      'ccfd4c6a-9e7a-41f4-8d7a-8f6e80e69825'::uuid,
      'CONFIRMED',
      '71000000-0000-4000-8000-000000000001'::uuid,
      'local-ghl-appt-noah-tue-waitlist-test-full'
    )
)
insert into public.reservations (
  id,
  tenant_id,
  slot_id,
  membership_id,
  student_id,
  status,
  booked_at,
  cancelled_at,
  ghl_appointment_id,
  location_id
)
select
  r.id,
  c.academy_id,
  r.slot_id,
  r.membership_id,
  r.student_id,
  r.status,
  now() - interval '3 days',
  null,
  r.ghl_appointment_id,
  r.location_id
from seed_reservations r
cross join seed_context c
on conflict (id) do update set
  tenant_id = excluded.tenant_id,
  slot_id = excluded.slot_id,
  membership_id = excluded.membership_id,
  student_id = excluded.student_id,
  status = excluded.status,
  booked_at = excluded.booked_at,
  cancelled_at = excluded.cancelled_at,
  ghl_appointment_id = excluded.ghl_appointment_id,
  location_id = excluded.location_id,
  updated_at = now();

with seed_context as (
  select '39875f07-0a4b-4429-a201-2249bc1f24df'::uuid as academy_id
)
insert into public.waitlist_entries (
  id,
  tenant_id,
  slot_id,
  membership_id,
  student_id,
  status,
  promoted_at,
  location_id,
  created_at
)
select
  '75000000-0000-4000-8000-000000000001'::uuid,
  c.academy_id,
  '73000000-0000-4000-8000-000000000006'::uuid,
  '6543bff1-4f54-4760-a82f-2c0d210ec27d'::uuid,
  '5c0bf246-1612-4e82-8aca-4fba43e13f6e'::uuid,
  'WAITING',
  null,
  '71000000-0000-4000-8000-000000000001'::uuid,
  now() - interval '1 day'
from seed_context c
on conflict (id) do update set
  tenant_id = excluded.tenant_id,
  slot_id = excluded.slot_id,
  membership_id = excluded.membership_id,
  student_id = excluded.student_id,
  status = excluded.status,
  promoted_at = excluded.promoted_at,
  location_id = excluded.location_id,
  created_at = excluded.created_at,
  updated_at = now();
