create table if not exists public.member_files (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references public.members(id) on delete cascade,
  client_id uuid not null,
  kind text not null default 'document',
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
  using (client_id in (select my_client_ids()) or is_staff());;
