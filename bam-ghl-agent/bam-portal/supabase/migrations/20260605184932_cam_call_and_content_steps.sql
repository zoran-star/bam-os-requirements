alter table public.clients add column if not exists cam_call_booked_at   timestamptz;
alter table public.clients add column if not exists content_submitted_at timestamptz;;
