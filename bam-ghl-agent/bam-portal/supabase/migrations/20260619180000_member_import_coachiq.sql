-- Member import + CoachIQ linkage.
-- Per-academy CoachIQ toggle (gates the CoachIQ cleanup step), and staging columns
-- so the importer can carry each member's CoachIQ user id (auto-harvested from the
-- Stripe sub's metadata.userId, or pasted) through promote into members.coachiq_member_id.
alter table clients         add column if not exists coachiq_enabled boolean not null default false;
alter table members_staging add column if not exists coachiq_member_id text;
alter table members_staging add column if not exists coachiq_not_applicable boolean not null default false;
