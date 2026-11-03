-- Enable student-side realtime for the records shown on their application page.
-- RLS remains the source of row visibility; publication membership does not
-- grant table access and the browser subscribes only to the signed-in user's ID.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'student_document_reviews'
    ) then
      alter publication supabase_realtime add table public.student_document_reviews;
    end if;
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'buddy_application_offers'
    ) then
      alter publication supabase_realtime add table public.buddy_application_offers;
    end if;
  end if;
end;
$$;
