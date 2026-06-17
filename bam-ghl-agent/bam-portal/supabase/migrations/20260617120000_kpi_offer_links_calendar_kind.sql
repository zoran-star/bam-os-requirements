-- Allow tying GHL calendars to offers (for the KPIs "Bookings" metric).
alter table public.kpi_offer_links drop constraint if exists kpi_offer_links_kind_check;
alter table public.kpi_offer_links add constraint kpi_offer_links_kind_check
  check (kind in ('stripe_product','ghl_pipeline','ghl_calendar'));
