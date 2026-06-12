alter table public.staff drop constraint staff_role_check;

alter table public.staff
  add constraint staff_role_check check (
    role in (
      'admin',
      'systems',
      'marketing',
      'sm',
      'staff',
      'systems_manager',
      'systems_executor',
      'marketing_manager',
      'marketing_executor',
      'scaling_manager'
    )
  );;
