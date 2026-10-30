-- Let a signed-in student submit only their own draft after all four
-- required document types have been uploaded for that application.
create or replace function public.submit_student_application()
returns public.student_loan_applications
language plpgsql
security definer
set search_path = ''
as $$
declare
  student_id uuid := auth.uid();
  application public.student_loan_applications%rowtype;
  missing_types text[];
begin
  if student_id is null then
    raise exception 'Sign in to submit your application.' using errcode = '28000';
  end if;

  select * into application
  from public.student_loan_applications
  where user_id = student_id and status in ('draft', 'action_required')
  order by updated_at desc
  limit 1
  for update;

  if not found then
    raise exception 'There is no draft application ready to submit.' using errcode = 'P0002';
  end if;

  select pg_catalog.array_agg(required.document_type)
  into missing_types
  from (values
    ('south_african_id'),
    ('proof_of_registration'),
    ('proof_of_residence'),
    ('bank_statements')
  ) as required(document_type)
  where not exists (
    select 1
    from (
      select distinct on (review.document_type)
        review.document_type,
        review.review_status
      from public.student_document_reviews as review
      where review.user_id = student_id
        and review.application_id = application.id
      order by review.document_type, review.created_at desc
    ) as latest
    where latest.document_type = required.document_type
      and latest.review_status in ('pending', 'reviewing', 'accepted')
  );

  if pg_catalog.cardinality(missing_types) > 0 then
    raise exception 'Upload all four required document types before submitting.' using errcode = '23514';
  end if;

  update public.student_loan_applications
  set status = 'submitted', current_step = 3
  where id = application.id and user_id = student_id
  returning * into application;

  return application;
end;
$$;

revoke all on function public.submit_student_application() from public, anon, authenticated;
grant execute on function public.submit_student_application() to authenticated;

-- A student may replace requested documents only while a draft is open or
-- Buddy has explicitly requested an update. Submitted files remain locked.
create or replace function public.validate_student_document_application()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.application_id is not null and not exists (
    select 1 from public.student_loan_applications as application
    where application.id = new.application_id
      and application.user_id = new.user_id
      and application.status in ('draft', 'action_required')
  ) then
    raise exception 'Documents can only be added to an application that is being prepared or needs an update';
  end if;
  return new;
end;
$$;
revoke all on function public.validate_student_document_application() from public, anon, authenticated;

drop policy if exists "Students register their own pending documents" on public.student_document_reviews;
create policy "Students register their own pending documents"
on public.student_document_reviews for insert to authenticated
with check (
  user_id = (select auth.uid())
  and review_status = 'pending'
  and review_note is null
  and reviewed_by is null
  and reviewed_at is null
  and split_part(object_path, '/', 1) = (select auth.uid()::text)
  and split_part(split_part(object_path, '/', 2), '-', 1) = document_type
  and split_part(object_path, '/', 2) ~ '^(south_african_id|proof_of_registration|proof_of_residence|bank_statements)-[0-9a-f-]+\.(pdf|jpg|png)$'
  and exists (
    select 1 from storage.objects as stored
    where stored.bucket_id = 'student-documents'
      and stored.name = object_path
  )
  and exists (
    select 1 from public.student_loan_applications as application
    where application.id = student_document_reviews.application_id
      and application.user_id = student_document_reviews.user_id
      and application.status in ('draft', 'action_required')
  )
);

drop policy if exists "Students remove status for their own deleted documents" on public.student_document_reviews;
create policy "Students remove status for their own deleted documents"
on public.student_document_reviews for delete to authenticated
using (
  user_id = (select auth.uid())
  and (application_id is null or exists (
    select 1 from public.student_loan_applications as application
    where application.id = student_document_reviews.application_id
      and application.user_id = student_document_reviews.user_id
      and application.status in ('draft', 'action_required')
  ))
);

drop policy if exists "Students delete only their own documents" on storage.objects;
create policy "Students delete only their own documents"
on storage.objects for delete to authenticated
using (
  bucket_id = 'student-documents'
  and (storage.foldername(name))[1] = (select auth.uid()::text)
  and not exists (
    select 1 from public.student_document_reviews as review
    where review.object_path = name
      and review.user_id = (select auth.uid())
      and review.application_id is not null
      and not exists (
        select 1 from public.student_loan_applications as application
        where application.id = review.application_id
          and application.user_id = review.user_id
          and application.status in ('draft', 'action_required')
      )
  )
);

-- Keep the account activity wording aligned to the shorter, real application flow.
create or replace function public.record_student_application_activity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  stage_label text;
begin
  if tg_op = 'INSERT' then
    insert into public.student_activity_events (user_id, application_id, event_type, title, detail)
    values (new.user_id, new.id, 'application_started', 'Application started',
      'You started an application for R' || new.requested_amount::text || '.');
    return new;
  end if;

  if new.status is distinct from old.status then
    insert into public.student_activity_events (user_id, application_id, event_type, title, detail)
    values (new.user_id, new.id, 'application_status_changed', 'Application status updated',
      'Your application is now ' || replace(new.status, '_', ' ') || '.');
  end if;

  if new.current_step is distinct from old.current_step then
    stage_label := case new.current_step
      when 2 then 'Choose an amount'
      when 3 then 'Upload your documents'
      else 'Application review'
    end;
    insert into public.student_activity_events (user_id, application_id, event_type, title, detail)
    values (new.user_id, new.id, 'application_progressed', 'Application progress saved',
      'Current stage: ' || stage_label || '.');
  end if;

  if new.requested_amount is distinct from old.requested_amount then
    insert into public.student_activity_events (user_id, application_id, event_type, title, detail)
    values (new.user_id, new.id, 'application_amount_changed', 'Requested amount updated',
      'Your requested amount is now R' || new.requested_amount::text || '.');
  end if;
  return new;
end;
$$;

revoke all on function public.record_student_application_activity() from public, anon, authenticated;
