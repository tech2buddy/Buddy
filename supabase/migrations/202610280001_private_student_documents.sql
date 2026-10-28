-- Buddy Loans private document storage foundation.
-- Apply only to the intended Supabase project after confirming retention,
-- consent wording, file limits and production access procedures.

-- Keep documents private. No client-facing service-role key is required.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'student-documents',
  'student-documents',
  false,
  10485760,
  array['application/pdf', 'image/jpeg', 'image/png']
)
on conflict (id) do update set
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- Object path: <authenticated user UUID>/<application UUID>/<document UUID>.<ext>
-- No public access, cross-user reads, overwrite or user-driven object moves.
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
