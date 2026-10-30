-- Ensure secure, per-student storage is ready for authenticated uploads.
-- The bucket remains private; students may create/list/download/remove only their own files.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('student-documents', 'student-documents', false, 10485760,
        array['application/pdf', 'image/jpeg', 'image/png'])
on conflict (id) do update set
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Students upload documents to their own folder" on storage.objects;
drop policy if exists "Students read only their own documents" on storage.objects;
drop policy if exists "Students delete only their own documents" on storage.objects;
drop policy if exists "Students update only their own documents" on storage.objects;

create policy "Students upload documents to their own folder"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'student-documents'
  and (storage.foldername(name))[1] = (select auth.uid()::text)
);

create policy "Students read only their own documents"
on storage.objects for select to authenticated
using (
  bucket_id = 'student-documents'
  and (storage.foldername(name))[1] = (select auth.uid()::text)
);

create policy "Students delete only their own documents"
on storage.objects for delete to authenticated
using (
  bucket_id = 'student-documents'
  and (storage.foldername(name))[1] = (select auth.uid()::text)
);

-- Intentionally no UPDATE policy: existing uploads cannot be overwritten or moved.
