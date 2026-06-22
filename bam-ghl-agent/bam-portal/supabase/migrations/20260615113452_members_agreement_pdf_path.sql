alter table public.members add column if not exists agreement_pdf_path text;
comment on column public.members.agreement_pdf_path is 'Storage path (member-files bucket) of the signed enrollment agreement PDF, set by the website enrollment funnel checkout. NULL until the parent signs.';;
