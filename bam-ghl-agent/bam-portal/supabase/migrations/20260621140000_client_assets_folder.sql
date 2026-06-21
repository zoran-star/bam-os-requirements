-- Folder organization for the per-academy Assets library: a client can upload a
-- whole folder and its files group under that folder name in the Assets tab.
-- Single-level (the top folder name from the upload). NULL = ungrouped. Additive.
alter table public.client_assets
  add column if not exists folder text;

comment on column public.client_assets.folder is
  'Optional single-level folder name for grouping in the client portal Assets tab (from a folder upload''s top directory). NULL = ungrouped.';
