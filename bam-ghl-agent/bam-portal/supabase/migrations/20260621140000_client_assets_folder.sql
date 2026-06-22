-- Folder organization for the per-academy Assets library: a client can upload a
-- whole folder and its files group under that folder name in the Assets tab.
-- Single-level (the top folder name from the upload). NULL = ungrouped. Additive.
--
-- link_url: large files (> the 50MB project Storage limit) can't be uploaded, so
-- the client adds them as a share link (Drive/Dropbox/etc.) instead. When set, the
-- asset is a LINK (no storage_path / bucket file).
alter table public.client_assets
  add column if not exists folder   text,
  add column if not exists link_url text;

-- Link assets have no bucket file, so storage_path must allow NULL.
alter table public.client_assets
  alter column storage_path drop not null;

comment on column public.client_assets.folder is
  'Optional single-level folder name for grouping in the client portal Assets tab (from a folder upload''s top directory). NULL = ungrouped.';
comment on column public.client_assets.link_url is
  'External share link (Drive/Dropbox/etc.) for assets too large to upload to the bucket. When set, the asset is a link, not a stored file (storage_path is null).';
