-- Path B agency connect: store BAM's GHL agency (Company) OAuth token so the
-- portal can mint a location token per sub-account on demand (/oauth/locationToken).
create table if not exists public.ghl_agency_tokens (
  company_id    text primary key,
  access_token  text not null,
  refresh_token text,
  expires_at    timestamptz,
  updated_at    timestamptz not null default now()
);
alter table public.ghl_agency_tokens enable row level security;
-- No policies: only the service role (server) ever touches this; the service key bypasses RLS.;
