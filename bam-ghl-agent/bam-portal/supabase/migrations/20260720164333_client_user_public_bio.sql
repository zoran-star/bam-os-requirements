-- Public-facing staff copy for the academy Team page.
-- The Business Blueprint > Staff card is the single home where the owner edits
-- each teammate; these two fields feed the public "Our Team" website page.
--   title = public role/position (e.g. "Head Coach"), distinct from the account
--           role (owner/member) which governs permissions.
--   bio   = free-text blurb the owner writes about the teammate.
-- Both additive + nullable; empty = nothing shown on the Team page.
alter table public.client_users
  add column if not exists title text,
  add column if not exists bio   text;

comment on column public.client_users.title is
  'Public job title/position shown on the academy Team website page (e.g. "Head Coach"). Not the permission role.';
comment on column public.client_users.bio is
  'Public bio/notes the owner writes about this teammate, shown on the academy Team website page.';
