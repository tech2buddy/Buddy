-- The operations console must never expose a student's draft application or
-- its private documents before the student submits it for review.

create or replace function private.can_preview_buddy_document(p_object_path text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.student_document_reviews as review
    join public.student_loan_applications as application on application.id = review.application_id
    where review.object_path = p_object_path
      and application.status <> 'draft'
      and private.buddy_admin_role() in ('operations_admin','owner_admin')
  ) or exists (
    select 1
    from public.student_document_reviews as review
    join public.student_loan_applications as application on application.id = review.application_id
    where review.object_path = p_object_path
      and application.status <> 'draft'
      and private.buddy_admin_role() = 'application_reviewer'
      and application.assigned_to = (select auth.uid())
  )
$$;
revoke all on function private.can_preview_buddy_document(text) from public, anon, authenticated;
grant execute on function private.can_preview_buddy_document(text) to authenticated;

create or replace function public.buddy_admin_get_application(p_application_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  result jsonb;
  admin_role text;
begin
  admin_role := private.require_buddy_admin();
  select pg_catalog.jsonb_build_object(
    'application', pg_catalog.to_jsonb(application),
    'student', case when admin_role <> 'application_reviewer' or application.assigned_to = (select auth.uid())
      then pg_catalog.jsonb_build_object(
        'first_name', profile.first_name, 'last_name', profile.last_name, 'hometown', profile.hometown,
        'gender', profile.gender, 'home_address', profile.home_address, 'phone', profile.phone,
        'whatsapp_phone', profile.whatsapp_phone, 'personal_email', profile.personal_email,
        'next_of_kin_name', profile.next_of_kin_name, 'next_of_kin_phone', profile.next_of_kin_phone,
        'referral_source', profile.referral_source,
        'university_email', (select user_record.email from auth.users as user_record where user_record.id = profile.id)
      ) else pg_catalog.jsonb_build_object('first_name', profile.first_name, 'last_name', profile.last_name) end,
    'documents', (select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'id', review.id, 'document_type', review.document_type, 'object_path', review.object_path,
      'review_status', review.review_status, 'review_note', review.review_note,
      'reviewed_at', review.reviewed_at, 'created_at', review.created_at
    ) order by review.created_at desc), '[]'::jsonb)
      from public.student_document_reviews as review
      where review.application_id = application.id
        and (admin_role <> 'application_reviewer' or application.assigned_to = (select auth.uid()))
    ),
    'loan_history', pg_catalog.jsonb_build_object(
      'disbursed_this_calendar_year', exists (
        select 1
        from public.buddy_loan_disbursements as loan
        where loan.user_id = application.user_id
          and loan.disbursed_at >= (
            pg_catalog.date_trunc('year', pg_catalog.now() at time zone 'Africa/Johannesburg')
            at time zone 'Africa/Johannesburg'
          )
          and loan.disbursed_at <= pg_catalog.now()
      )
    )
  ) into result
  from public.student_loan_applications as application
  join public.profiles as profile on profile.id = application.user_id
  where application.id = p_application_id
    and application.status <> 'draft'
    and (admin_role <> 'application_reviewer' or application.assigned_to = (select auth.uid()) or application.assigned_to is null);
  if result is null then raise exception 'Application not found.' using errcode = 'P0002'; end if;
  perform private.write_buddy_admin_audit('application_viewed', p_application_id, null, '{}'::jsonb);
  return result;
end;
$$;
revoke all on function public.buddy_admin_get_application(uuid) from public, anon;
grant execute on function public.buddy_admin_get_application(uuid) to authenticated;

create or replace function public.buddy_admin_record_document_access(p_review_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  admin_role text;
  target_application uuid;
begin
  admin_role := private.require_buddy_admin();
  select review.application_id into target_application
  from public.student_document_reviews as review
  join public.student_loan_applications as application on application.id = review.application_id
  where review.id = p_review_id and application.status <> 'draft';
  if not found then raise exception 'Document is not available for operations review.' using errcode = 'P0002'; end if;
  if admin_role = 'application_reviewer' and not exists (
    select 1 from public.student_loan_applications as application
    where application.id = target_application and application.assigned_to = (select auth.uid())
  ) then
    raise exception 'Claim this application before viewing its documents.' using errcode = '42501';
  end if;
  perform private.write_buddy_admin_audit('document_previewed', target_application, p_review_id, '{}'::jsonb);
end;
$$;
revoke all on function public.buddy_admin_record_document_access(uuid) from public, anon;
grant execute on function public.buddy_admin_record_document_access(uuid) to authenticated;

create or replace function public.buddy_admin_review_document(
  p_review_id uuid,
  p_status text,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  admin_role text;
  review_row public.student_document_reviews%rowtype;
  old_review_status text;
begin
  admin_role := private.require_buddy_admin();
  if admin_role not in ('application_reviewer','operations_admin','owner_admin') then
    raise exception 'Your role cannot review documents.' using errcode = '42501';
  end if;
  if p_status not in ('reviewing','accepted','action_required') then
    raise exception 'Choose a valid review outcome.' using errcode = '22023';
  end if;
  if p_status = 'action_required' and nullif(pg_catalog.btrim(p_note), '') is null then
    raise exception 'Add a short reason so the student knows what to update.' using errcode = '23514';
  end if;
  if p_note is not null and pg_catalog.char_length(pg_catalog.btrim(p_note)) > 500 then
    raise exception 'The note is too long.' using errcode = '22023';
  end if;
  select * into review_row from public.student_document_reviews where id = p_review_id for update;
  if not found or review_row.application_id is null then
    raise exception 'Document is not available for operations review.' using errcode = 'P0002';
  end if;
  if not exists (
    select 1 from public.student_loan_applications as application
    where application.id = review_row.application_id
      and application.status in ('submitted','under_review','action_required')
  ) then
    raise exception 'Documents can only be reviewed after the application is submitted.' using errcode = '42501';
  end if;
  if admin_role = 'application_reviewer' and not exists (
    select 1 from public.student_loan_applications as application
    where application.id = review_row.application_id and application.assigned_to = (select auth.uid())
  ) then
    raise exception 'Claim this application before reviewing its documents.' using errcode = '42501';
  end if;
  old_review_status := review_row.review_status;
  update public.student_document_reviews
  set review_status = p_status,
      review_note = case when p_status = 'action_required' then pg_catalog.btrim(p_note) else null end,
      reviewed_by = (select auth.uid()), reviewed_at = pg_catalog.now()
  where id = p_review_id returning * into review_row;
  if p_status = 'action_required' then
    update public.student_loan_applications
    set status = 'action_required'
    where id = review_row.application_id and status in ('submitted','under_review');
  end if;
  perform private.write_buddy_admin_audit('document_status_changed', review_row.application_id, review_row.id,
    pg_catalog.jsonb_build_object('from', old_review_status, 'to', p_status));
  return pg_catalog.jsonb_build_object('id', review_row.id, 'status', review_row.review_status);
end;
$$;
revoke all on function public.buddy_admin_review_document(uuid, text, text) from public, anon;
grant execute on function public.buddy_admin_review_document(uuid, text, text) to authenticated;
