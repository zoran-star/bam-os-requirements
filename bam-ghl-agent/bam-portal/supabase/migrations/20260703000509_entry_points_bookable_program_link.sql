-- Offer tie-in step G (Luka-approved shared-table change, 2026-07-02):
-- link sales entry points to the bookable program their bookings land in,
-- so the funnel and the trial APIs share one source of truth. Backfills
-- BAM GTA's booking surfaces (trial calendars + free-trial forms) to the
-- Training program.
alter table public.entry_points
  add column if not exists bookable_program_id uuid references public.bookable_programs(id);

update public.entry_points
   set bookable_program_id = '80000000-0000-4000-8000-000000000001'
 where client_id = '39875f07-0a4b-4429-a201-2249bc1f24df'
   and bookable_program_id is null
   and (type = 'calendar' or key in ('free-trial', '00MuBSi1GxsRcSqklOkF'));
