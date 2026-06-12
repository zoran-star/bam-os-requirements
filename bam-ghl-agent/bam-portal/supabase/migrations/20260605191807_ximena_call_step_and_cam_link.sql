-- Cam's booking link is now known.
update public.staff set booking_url = 'https://go.byanymeansbusiness.com/widget/bookings/content-acceleration'
  where id = 'b462cefa-fb41-463e-9892-0a7d36274fd9';  -- Cameron Wells (marketing_manager)

alter table public.clients add column if not exists ximena_call_booked_at timestamptz;;
