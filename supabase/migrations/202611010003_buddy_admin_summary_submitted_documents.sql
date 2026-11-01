-- Keep draft uploads out of the operations workload. Staff metrics should
-- include only documents attached to a submitted application in an active
-- review state; uploaded files on drafts remain private and untouched.
create or replace function public.buddy_admin_summary()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  admin_role text;
begin
  admin_role := private.require_buddy_admin();
  return pg_catalog.jsonb_build_object(
    'role', admin_role,
    'submitted', (select pg_catalog.count(*) from public.student_loan_applications where status = 'submitted'),
    'under_review', (select pg_catalog.count(*) from public.student_loan_applications where status = 'under_review'),
    'action_required', (select pg_catalog.count(*) from public.student_loan_applications where status = 'action_required'),
    'approved', (select pg_catalog.count(*) from public.student_loan_applications where status = 'approved'),
    'pending_documents', (
      select pg_catalog.count(*)
      from public.student_document_reviews as review
      join public.student_loan_applications as application
        on application.id = review.application_id
      where review.review_status = 'pending'
        and application.status in ('submitted', 'under_review', 'action_required')
    ),
    'updated_at', pg_catalog.now()
  );
end;
$$;
revoke all on function public.buddy_admin_summary() from public, anon;
grant execute on function public.buddy_admin_summary() to authenticated;
