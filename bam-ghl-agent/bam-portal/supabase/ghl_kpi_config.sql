-- Per-client GHL KPI config (jsonb) for the funnel dashboard.
--
-- Holds the staff-confirmed wiring for an academy's GHL: which forms count as
-- "leads in", which calendar = trial bookings, etc. Starts with the lead forms
-- picker; grows as we wire the rest of the funnel. Nullable — no config yet just
-- means "not set up".
--
-- Shape (evolving):
--   {
--     "ghl_location": "BAM GTA",
--     "lead_form_ids":   ["abc123", "def456"],
--     "lead_form_names": ["Free Trial Booked", "Contact Form"]
--   }
--
-- Run once in the Supabase SQL editor (project ref jnojmfmpnsfmtqmwhopz).

alter table public.clients
  add column if not exists ghl_kpi_config jsonb;

comment on column public.clients.ghl_kpi_config is
  'Staff-confirmed GHL funnel wiring (lead forms, trial calendar, etc.) for the KPI dashboard. NULL = not configured.';
