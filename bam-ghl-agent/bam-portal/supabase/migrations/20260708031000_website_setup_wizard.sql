-- Website domain wizard state (api/website/domain-setup.js). Applied to prod
-- 2026-07-08. Attaches an academy domain to the bam-client-sites Vercel project
-- and tracks the DNS cutover to their rebuilt portal-native site.
alter table clients add column if not exists website_setup jsonb;
comment on column clients.website_setup is 'Website domain wizard state: { domain, records[], status, created_at }. Driven by api/website/domain-setup.js - attaches the domain to the bam-client-sites Vercel project and tracks DNS cutover.';
