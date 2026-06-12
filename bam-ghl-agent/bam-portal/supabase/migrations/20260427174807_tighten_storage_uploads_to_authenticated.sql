drop policy if exists "Anyone can upload ticket files" on storage.objects;
create policy "Authenticated can upload ticket files"
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'ticket-files');;
