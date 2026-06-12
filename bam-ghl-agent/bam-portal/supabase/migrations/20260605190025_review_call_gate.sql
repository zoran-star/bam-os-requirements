alter table public.clients add column if not exists ready_for_review_at    timestamptz;
alter table public.clients add column if not exists review_call_booked_at  timestamptz;;
