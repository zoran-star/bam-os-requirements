-- Per-coach Instagram handle for the public Team / About website page.
-- Edited in Business Blueprint > Staff (Public profile), returned by
-- api/website/team.js so the site can link each coach's socials. Additive.
alter table public.client_users
  add column if not exists instagram text;

comment on column public.client_users.instagram is
  'Public Instagram handle for this teammate, shown/linked on the academy Team website page. Handle or URL.';
