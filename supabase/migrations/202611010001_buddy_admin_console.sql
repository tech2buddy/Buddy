-- Private operations console. No browser secret key and no direct admin-table
-- grants: each operation checks an owner-provisioned role and an AAL2 session.
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create table if not exists private.buddy_admin_memberships (
  user_id uuid primary key references auth.users(id) on delete cascade,
  role text not null check (role in ('application_reviewer', 'operations_admin', 'owner_admin')),
  active boolean not null default true,
  added_by uuid null references auth.users(id),
  created_at timestamptz not null default pg_catalog.now()
);
alter table private.buddy_admin_memberships enable row level security;
revoke all on private.buddy_admin_memberships from public, anon, authenticated;

create table if not exists private.buddy_admin_audit_events (
  id bigint generated always as identity primary key,
  actor_id uuid not null references auth.users(id),
  action text not null check (char_length(action) between 1 and 80),
  application_id uuid null references public.student_loan_applications(id) on delete set null,
  document_review_id uuid null references public.student_document_reviews(id) on delete set null,
  details jsonb not null default '{}'::jsonb check (pg_catalog.octet_length(details::text) <= 4000),
  created_at timestamptz not null default pg_catalog.now()
);
create index if not exists buddy_admin_audit_events_created_idx
  on private.buddy_admin_audit_events (created_at desc);
alter table private.buddy_admin_audit_events enable row level security;
revoke all on private.buddy_admin_audit_events from public, anon, authenticated;

alter table public.student_loan_applications
  add column if not exists assigned_to uuid null references auth.users(id) on delete set null;
create index if not exists student_loan_applications_assigned_idx
  on public.student_loan_applications (assigned_to, updated_at desc)
  where assigned_to is not null;

create or replace function private.buddy_admin_role()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select membership.role
  from private.buddy_admin_memberships as membership
  where membership.user_id = (select auth.uid())
    and membership.active
    and (select auth.jwt() ->> 'aal') = 'aal2'
    and pg_catalog.now() - pg_catalog.to_timestamp(coalesce(nullif((select auth.jwt() ->> 'auth_time'), '')::bigint, 0)) < interval '8 hours'
$$;
revoke all on function private.buddy_admin_role() from public, anon, authenticated;
grant usage on schema private to authenticated;
grant execute on function private.buddy_admin_role() to authenticated;

create or replace function private.can_preview_buddy_document(p_object_path text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.student_document_reviews as review
    join public.student_loan_applications as application on application.id = review.application_id
    where review.object_path = p_object_path
      and private.buddy_admin_role() in ('operations_admin','owner_admin')
  ) or exists (
    select 1 from public.student_document_reviews as review
    join public.student_loan_applications as application on application.id = review.application_id
    where review.object_path = p_object_path
      and private.buddy_admin_role() = 'application_reviewer'
      and application.assigned_to = (select auth.uid())
  )
$$;
revoke all on function private.can_preview_buddy_document(text) from public, anon, authenticated;
grant execute on function private.can_preview_buddy_document(text) to authenticated;

create or replace function private.require_buddy_admin()
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  admin_role text;
begin
  if (select auth.uid()) is null then
    raise exception 'Sign in required.' using errcode = '28000';
  end if;
  if (select auth.jwt() ->> 'aal') is distinct from 'aal2' then
    raise exception 'Complete multi-factor authentication to use the operations console.' using errcode = '42501';
  end if;
  if pg_catalog.now() - pg_catalog.to_timestamp(coalesce(nullif((select auth.jwt() ->> 'auth_time'), '')::bigint, 0)) >= interval '8 hours' then
    raise exception 'Your staff session expired. Sign in again and verify MFA.' using errcode = '42501';
  end if;
  select membership.role into admin_role
  from private.buddy_admin_memberships as membership
  where membership.user_id = (select auth.uid()) and membership.active;
  if admin_role is null then
    raise exception 'This account is not authorized for Buddy operations.' using errcode = '42501';
  end if;
  return admin_role;
end;
$$;
revoke all on function private.require_buddy_admin() from public, anon, authenticated;

create or replace function private.write_buddy_admin_audit(
  p_action text,
  p_application_id uuid default null,
  p_document_review_id uuid default null,
  p_details jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into private.buddy_admin_audit_events(actor_id, action, application_id, document_review_id, details)
  values ((select auth.uid()), p_action, p_application_id, p_document_review_id,
    coalesce(p_details, '{}'::jsonb));
end;
$$;
revoke all on function private.write_buddy_admin_audit(text, uuid, uuid, jsonb) from public, anon, authenticated;

-- Storage's signed URL endpoint still evaluates SELECT policies. Reviewers can
-- read an object only in a verified AAL2 admin session; students retain their
-- existing own-folder policy.
drop policy if exists "Buddy reviewers read student documents" on storage.objects;
create policy "Buddy reviewers read student documents"
on storage.objects for select to authenticated
using (
  bucket_id = 'student-documents'
  and (select private.can_preview_buddy_document(name))
);

create or replace function public.buddy_admin_summary()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare admin_role text;
begin
  admin_role := private.require_buddy_admin();
  return pg_catalog.jsonb_build_object(
    'role', admin_role,
    'submitted', (select pg_catalog.count(*) from public.student_loan_applications where status = 'submitted'),
    'under_review', (select pg_catalog.count(*) from public.student_loan_applications where status = 'under_review'),
    'action_required', (select pg_catalog.count(*) from public.student_loan_applications where status = 'action_required'),
    'approved', (select pg_catalog.count(*) from public.student_loan_applications where status = 'approved'),
    'pending_documents', (select pg_catalog.count(*) from public.student_document_reviews where review_status = 'pending'),
    'updated_at', pg_catalog.now()
  );
end;
$$;
revoke all on function public.buddy_admin_summary() from public, anon;
grant execute on function public.buddy_admin_summary() to authenticated;

create or replace function public.buddy_admin_list_applications(
  p_status text default null,
  p_query text default null,
  p_limit integer default 50,
  p_offset integer default 0
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare admin_role text;
begin
  admin_role := private.require_buddy_admin();
  if p_status is not null and p_status not in ('submitted','under_review','action_required','approved','declined','disbursed','cancelled') then
    raise exception 'Unsupported queue filter.' using errcode = '22023';
  end if;
  return (
    select coalesce(pg_catalog.jsonb_agg(pg_catalog.to_jsonb(queue_row)), '[]'::jsonb)
    from (
      select application.id, application.user_id, application.assigned_to, application.requested_amount, application.status,
        application.bursary_status, application.bursary_name, application.created_at, application.updated_at,
        profile.first_name, profile.last_name, profile.hometown,
        case when admin_role = 'application_reviewer' and application.assigned_to is null then null
          else (select user_record.email from auth.users as user_record where user_record.id = application.user_id) end as email,
        (select pg_catalog.count(*) from public.student_document_reviews as review
         where review.application_id = application.id and review.review_status in ('pending','reviewing')) as open_documents
      from public.student_loan_applications as application
      join public.profiles as profile on profile.id = application.user_id
      where application.status <> 'draft'
        and (admin_role <> 'application_reviewer' or application.assigned_to is null or application.assigned_to = (select auth.uid()))
        and (p_status is null or application.status = p_status)
        and (nullif(pg_catalog.btrim(p_query), '') is null
          or profile.first_name ilike '%' || pg_catalog.left(pg_catalog.btrim(p_query), 80) || '%'
          or profile.last_name ilike '%' || pg_catalog.left(pg_catalog.btrim(p_query), 80) || '%'
          or exists (select 1 from auth.users as u where u.id = application.user_id and u.email ilike '%' || pg_catalog.left(pg_catalog.btrim(p_query), 120) || '%'))
      order by application.updated_at desc
      limit least(greatest(coalesce(p_limit,50),1),100)
      offset least(greatest(coalesce(p_offset,0),0),10000)
    ) as queue_row
  );
end;
$$;
revoke all on function public.buddy_admin_list_applications(text, text, integer, integer) from public, anon;
grant execute on function public.buddy_admin_list_applications(text, text, integer, integer) to authenticated;

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
      from public.student_document_reviews as review where review.application_id = application.id
        and (admin_role <> 'application_reviewer' or application.assigned_to = (select auth.uid()))
    )
  ) into result
  from public.student_loan_applications as application
  join public.profiles as profile on profile.id = application.user_id
  where application.id = p_application_id
    and (admin_role <> 'application_reviewer' or application.assigned_to = (select auth.uid()) or application.assigned_to is null);
  if result is null then raise exception 'Application not found.' using errcode = 'P0002'; end if;
  perform private.write_buddy_admin_audit('application_viewed', p_application_id, null, '{}'::jsonb);
  return result;
end;
$$;
revoke all on function public.buddy_admin_get_application(uuid) from public, anon;
grant execute on function public.buddy_admin_get_application(uuid) to authenticated;

create or replace function public.buddy_admin_claim_application(
  p_application_id uuid,
  p_release boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  admin_role text;
  current_assignee uuid;
begin
  admin_role := private.require_buddy_admin();
  select assigned_to into current_assignee
    from public.student_loan_applications where id = p_application_id
      and status in ('submitted','under_review','action_required') for update;
  if not found then raise exception 'Application not found.' using errcode = 'P0002'; end if;
  if p_release then
    if current_assignee is distinct from (select auth.uid()) then
      raise exception 'Only the assigned reviewer can release this application.' using errcode = '42501';
    end if;
    update public.student_loan_applications set assigned_to = null where id = p_application_id;
  else
    if current_assignee is not null and current_assignee is distinct from (select auth.uid()) then
      raise exception 'This application is already assigned to another reviewer.' using errcode = '23514';
    end if;
    update public.student_loan_applications set assigned_to = (select auth.uid()) where id = p_application_id;
  end if;
  perform private.write_buddy_admin_audit(case when p_release then 'application_released' else 'application_claimed' end,
    p_application_id, null, '{}'::jsonb);
  return pg_catalog.jsonb_build_object('assigned_to', case when p_release then null else (select auth.uid()) end);
end;
$$;
revoke all on function public.buddy_admin_claim_application(uuid, boolean) from public, anon;
grant execute on function public.buddy_admin_claim_application(uuid, boolean) to authenticated;

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
  select application_id into target_application from public.student_document_reviews where id = p_review_id;
  if not found then raise exception 'Document record not found.' using errcode = 'P0002'; end if;
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
  if not found then raise exception 'Document record not found.' using errcode = 'P0002'; end if;
  if admin_role = 'application_reviewer' and not exists (
    select 1 from public.student_loan_applications as application
    where application.id = review_row.application_id and application.assigned_to = (select auth.uid())
  ) then
    raise exception 'Claim this application before reviewing its documents.' using errcode = '42501';
  end if;
  old_review_status := review_row.review_status;
  update public.student_document_reviews
  set review_status = p_status, review_note = case when p_status = 'action_required' then pg_catalog.btrim(p_note) else null end,
      reviewed_by = (select auth.uid()), reviewed_at = pg_catalog.now()
  where id = p_review_id returning * into review_row;
  if p_status = 'action_required' and review_row.application_id is not null then
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

create or replace function public.buddy_admin_update_application_status(
  p_application_id uuid,
  p_status text,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  admin_role text;
  app_row public.student_loan_applications%rowtype;
  old_status text;
begin
  admin_role := private.require_buddy_admin();
  if admin_role not in ('operations_admin','owner_admin') then
    raise exception 'Your role cannot make application decisions.' using errcode = '42501';
  end if;
  if p_status not in ('under_review','action_required','approved','declined') then
    raise exception 'Choose a valid application decision.' using errcode = '22023';
  end if;
  if p_status in ('action_required','declined') and nullif(pg_catalog.btrim(p_reason), '') is null then
    raise exception 'Add a clear reason for this outcome.' using errcode = '23514';
  end if;
  if p_reason is not null and pg_catalog.char_length(pg_catalog.btrim(p_reason)) > 500 then
    raise exception 'The note is too long.' using errcode = '22023';
  end if;
  select * into app_row from public.student_loan_applications where id = p_application_id for update;
  if not found then raise exception 'Application not found.' using errcode = 'P0002'; end if;
  if app_row.status not in ('submitted','under_review','action_required') then
    raise exception 'This application is not open for review.' using errcode = '23514';
  end if;
  if p_status = 'approved' and exists (
    select 1 from (values
      ('south_african_id'),('proof_of_registration'),('proof_of_residence'),('bank_statements')
    ) as required(document_type)
    where not exists (
      select 1 from (
        select distinct on (review.document_type) review.document_type, review.review_status
        from public.student_document_reviews as review
        where review.application_id = app_row.id
        order by review.document_type, review.created_at desc
      ) as latest
      where latest.document_type = required.document_type and latest.review_status = 'accepted'
    )
  ) then
    raise exception 'All four latest documents must be accepted before approval.' using errcode = '23514';
  end if;
  old_status := app_row.status;
  update public.student_loan_applications set status = p_status where id = p_application_id returning * into app_row;
  if p_reason is not null then
    insert into public.student_activity_events(user_id, application_id, event_type, title, detail)
    values (app_row.user_id, app_row.id, 'application_status_changed', 'Application review update',
      pg_catalog.left(pg_catalog.btrim(p_reason), 500));
  end if;
  perform private.write_buddy_admin_audit('application_status_changed', app_row.id, null,
    pg_catalog.jsonb_build_object('from', old_status, 'to', p_status, 'reason_recorded', p_reason is not null));
  return pg_catalog.jsonb_build_object('id', app_row.id, 'status', app_row.status);
end;
$$;
revoke all on function public.buddy_admin_update_application_status(uuid, text, text) from public, anon;
grant execute on function public.buddy_admin_update_application_status(uuid, text, text) to authenticated;

create or replace function public.buddy_admin_recent_audit(p_limit integer default 50)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.require_buddy_admin();
  return (select coalesce(pg_catalog.jsonb_agg(pg_catalog.to_jsonb(events)), '[]'::jsonb)
    from (select id, actor_id, action, application_id, document_review_id, details, created_at
      from private.buddy_admin_audit_events order by created_at desc
      limit least(greatest(coalesce(p_limit,50),1),100)) as events);
end;
$$;
revoke all on function public.buddy_admin_recent_audit(integer) from public, anon;
grant execute on function public.buddy_admin_recent_audit(integer) to authenticated;

comment on table private.buddy_admin_memberships is 'Privileged Buddy operations roles. Provision and revoke only using the Supabase SQL editor as project owner.';
comment on table private.buddy_admin_audit_events is 'Append-only application-level audit trail for privileged Buddy operations.';

-- Provision the first operations admin manually after verifying their Auth user
-- UUID and confirming TOTP MFA is enrolled; never expose role assignment in UI.
-- insert into private.buddy_admin_memberships(user_id, role, added_by)
-- values ('AUTH_USER_UUID', 'owner_admin', null);
