-- Signed enrollment agreement PDF for a member.
-- Set by the website enrollment funnel checkout (api/website/checkout.js):
-- the parent reads + signs the agreement, we render a PDF, store it in the
-- private `member-files` bucket, and record its path here. Opened from the
-- member popup in the staff portal via a signed URL. NULL until signed.
alter table public.members add column if not exists agreement_pdf_path text;

comment on column public.members.agreement_pdf_path is
  'Storage path (member-files bucket) of the signed enrollment agreement PDF, set by the website enrollment funnel checkout. NULL until the parent signs.';
