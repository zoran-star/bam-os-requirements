-- Content Library: add 'other' as a fifth content_type (Track 2 / P1 follow-up,
-- Zoran 2026-07-20). Widening a CHECK is additive/safe. 'other' carries no
-- conditional person/skill fields - it's the catch-all bucket.
alter table public.client_assets drop constraint if exists client_assets_content_type_check;
alter table public.client_assets
  add constraint client_assets_content_type_check
  check (content_type in ('action','coaching','culture','testimonial','other'));
