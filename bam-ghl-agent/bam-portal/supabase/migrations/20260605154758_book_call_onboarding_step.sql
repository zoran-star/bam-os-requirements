-- Per-SM booking link + the client's "call booked" timestamp.
alter table public.staff   add column if not exists booking_url   text;
alter table public.clients add column if not exists call_booked_at timestamptz;

-- Seed the two known SM booking links.
update public.staff set booking_url = 'https://calendar.app.google/KboytxQQruDnA7Ut6'
  where id = '29995874-14eb-44ab-bcfc-b42c43864f50';  -- Anthony McManus (Ant)
update public.staff set booking_url = 'https://go.byanymeansbusiness.com/widget/bookings/bam-business/audit'
  where id = '602b9283-84cc-4fc2-84c2-9e57bd3b0ff7';  -- Mike Eluki;
