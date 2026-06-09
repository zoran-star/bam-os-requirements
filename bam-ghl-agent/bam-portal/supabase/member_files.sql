-- Per-member documents (signed waivers, media releases, medical forms, intake).
--
-- Mirrors offer_files, but the bucket is PRIVATE (waivers hold health + minor
-- PII) — read via signed URLs only. Storage path: <client_id>/<member_id>/<kind>/<stamp>-<name>
-- so the first path segment is the client_id (RLS scopes on it, like the offers bucket).
--
-- Run once in the Supabase SQL editor (project ref jnojmfmpnsfmtqmwhopz) — or
-- use the /apply-sql skill. Idempotent.

create table if not exists public.member_files (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references public.members(id) on delete cascade,
  client_id uuid not null,
  kind text not null default 'document',   -- waiver | media | medical | intake | other
  filename text not null,
  storage_path text not null,
  mime_type text,
  size_bytes bigint,
  signed_at timestamptz,
  uploaded_by uuid,
  metadata jsonb,
  created_at timestamptz not null default now()
);
create index if not exists idx_member_files_member on public.member_files(member_id);
create index if not exists idx_member_files_client on public.member_files(client_id);

alter table public.member_files enable row level security;

drop policy if exists member_files_client_read on public.member_files;
create policy member_files_client_read on public.member_files for select
  using (client_id in (select my_client_ids()) or is_staff());
drop policy if exists member_files_client_insert on public.member_files;
create policy member_files_client_insert on public.member_files for insert
  with check (client_id in (select my_client_ids()) or is_staff());
drop policy if exists member_files_client_update on public.member_files;
create policy member_files_client_update on public.member_files for update
  using (client_id in (select my_client_ids()) or is_staff())
  with check (client_id in (select my_client_ids()) or is_staff());
drop policy if exists member_files_client_delete on public.member_files;
create policy member_files_client_delete on public.member_files for delete
  using (client_id in (select my_client_ids()) or is_staff());

-- Private bucket + storage policies (scoped on the client_id path prefix).
insert into storage.buckets (id, name, public)
values ('member-files', 'member-files', false)
on conflict (id) do nothing;

drop policy if exists member_files_storage_read on storage.objects;
create policy member_files_storage_read on storage.objects for select
  using (bucket_id='member-files' and ((split_part(name,'/',1))::uuid in (select my_client_ids()) or is_staff()));
drop policy if exists member_files_storage_insert on storage.objects;
create policy member_files_storage_insert on storage.objects for insert
  with check (bucket_id='member-files' and ((split_part(name,'/',1))::uuid in (select my_client_ids()) or is_staff()));
drop policy if exists member_files_storage_update on storage.objects;
create policy member_files_storage_update on storage.objects for update
  using (bucket_id='member-files' and ((split_part(name,'/',1))::uuid in (select my_client_ids()) or is_staff()))
  with check (bucket_id='member-files' and ((split_part(name,'/',1))::uuid in (select my_client_ids()) or is_staff()));
drop policy if exists member_files_storage_delete on storage.objects;
create policy member_files_storage_delete on storage.objects for delete
  using (bucket_id='member-files' and ((split_part(name,'/',1))::uuid in (select my_client_ids()) or is_staff()));
