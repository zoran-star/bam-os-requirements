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
  using (bucket_id='member-files' and ((split_part(name,'/',1))::uuid in (select my_client_ids()) or is_staff()));;
