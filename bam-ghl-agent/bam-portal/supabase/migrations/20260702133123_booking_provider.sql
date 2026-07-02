-- Per-academy trial-BOOKING system-of-record: 'ghl' (default; GHL calendars) or
-- 'portal' (Luka's runtime spine: schedule_slots + trial_bookings). Flip to
-- 'portal' only after the academy has real slots generated. Same pattern as
-- contact_provider / pipeline_provider / messaging_provider / email_provider.
alter table public.clients add column if not exists booking_provider text not null default 'ghl';
alter table public.clients drop constraint if exists clients_booking_provider_check;
alter table public.clients add constraint clients_booking_provider_check check (booking_provider in ('ghl','portal'));
comment on column public.clients.booking_provider is 'Trial booking source of truth: ghl (calendars) | portal (schedule_slots + trial_bookings)';
