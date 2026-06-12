-- Receipt column for failed GHL syncs (ghl_contact_id / ghl_synced_at already exist)
alter table public.website_leads add column if not exists ghl_error text;

-- Per-client allowed website domains (bare domains, no protocol).
-- The leads API builds its CORS allow-list from this — adding a client
-- site is a row update, not a code change.
alter table public.clients add column if not exists allowed_domains text[];

update public.clients set allowed_domains = array['byanymeansbball.com','by-any-means-lac.vercel.app']
  where id = 'aad50450-c993-4f20-91bb-2209cfe82602';

update public.clients set allowed_domains = array['bam-gta.vercel.app']
  where id = '39875f07-0a4b-4429-a201-2249bc1f24df';;
