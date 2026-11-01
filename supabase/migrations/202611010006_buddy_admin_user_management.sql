-- Privileged user directory and staff-initiated account actions.
-- Only operations_admin and owner_admin can use these functions. No direct
-- table grants are added; every call requires the existing fresh AAL2 session.

alter table public.student_activity_events
  drop constraint if exists student_activity_events_event_type_check;
alter table public.student_activity_events
  add constraint student_activity_events_event_type_check check (event_type in (
    'application_started', 'application_progressed', 'application_status_changed',
    'application_amount_changed', 'document_uploaded', 'document_reviewed',
    'document_removed', 'loan_disbursed', 'staff_reminder'
  ));

create or replace function public.buddy_admin_list_users(
  p_query text default null,
  p_limit integer default 50,
  p_offset integer default 0
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  admin_role text;
  search_text text := pg_catalog.left(pg_catalog.btrim(coalesce(p_query, '')), 100);
  page_limit integer := least(greatest(coalesce(p_limit, 50), 1), 100);
  page_offset integer := least(greatest(coalesce(p_offset, 0), 0), 10000);
begin
  admin_role := private.require_buddy_admin();
  if admin_role not in ('operations_admin', 'owner_admin') then
    raise exception 'Your role cannot access the user directory.' using errcode = '42501';
  end if;
  return pg_catalog.jsonb_build_object(
    'users', (
      select coalesce(pg_catalog.jsonb_agg(pg_catalog.to_jsonb(directory_row)), '[]'::jsonb)
      from (
        select user_record.id as user_id,
          user_record.email,
          user_record.created_at as account_created_at,
          user_record.last_sign_in_at,
          user_record.email_confirmed_at is not null as email_verified,
          profile.first_name,
          profile.last_name,
          profile.phone,
          profile.personal_email,
          profile.profile_consent_at is not null as profile_complete,
          (select pg_catalog.count(*)
            from public.student_loan_applications as application
            where application.user_id = user_record.id and application.status <> 'draft') as application_count,
          (select pg_catalog.jsonb_build_object(
              'id', application.id,
              'status', application.status,
              'requested_amount', application.requested_amount,
              'updated_at', application.updated_at
            )
            from public.student_loan_applications as application
            where application.user_id = user_record.id and application.status <> 'draft'
            order by application.updated_at desc limit 1) as latest_application
        from auth.users as user_record
        left join public.profiles as profile on profile.id = user_record.id
        where not exists (
            select 1 from private.buddy_admin_memberships as staff
            where staff.user_id = user_record.id
          )
          and (
            search_text = ''
            or user_record.email ilike '%' || search_text || '%'
            or profile.first_name ilike '%' || search_text || '%'
            or profile.last_name ilike '%' || search_text || '%'
            or profile.personal_email ilike '%' || search_text || '%'
          )
        order by user_record.created_at desc, user_record.id
        limit page_limit offset page_offset
      ) as directory_row
    ),
    'total', (
      select pg_catalog.count(*)
      from auth.users as user_record
      left join public.profiles as profile on profile.id = user_record.id
      where not exists (
          select 1 from private.buddy_admin_memberships as staff
          where staff.user_id = user_record.id
        )
        and (
          search_text = ''
          or user_record.email ilike '%' || search_text || '%'
          or profile.first_name ilike '%' || search_text || '%'
          or profile.last_name ilike '%' || search_text || '%'
          or profile.personal_email ilike '%' || search_text || '%'
        )
    ),
    'limit', page_limit,
    'offset', page_offset
  );
end;
$$;
revoke all on function public.buddy_admin_list_users(text, integer, integer) from public, anon;
grant execute on function public.buddy_admin_list_users(text, integer, integer) to authenticated;

create or replace function public.buddy_admin_get_user(p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  admin_role text;
  result jsonb;
begin
  admin_role := private.require_buddy_admin();
  if admin_role not in ('operations_admin', 'owner_admin') then
    raise exception 'Your role cannot access user account details.' using errcode = '42501';
  end if;
  select pg_catalog.jsonb_build_object(
    'account', pg_catalog.jsonb_build_object(
      'user_id', user_record.id,
      'email', user_record.email,
      'email_verified', user_record.email_confirmed_at is not null,
      'created_at', user_record.created_at,
      'last_sign_in_at', user_record.last_sign_in_at
    ),
    'profile', case when profile.id is null then null else pg_catalog.to_jsonb(profile) end,
    'applications', (
      select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'id', application.id,
        'requested_amount', application.requested_amount,
        'status', application.status,
        'current_step', application.current_step,
        'bursary_status', application.bursary_status,
        'bursary_name', application.bursary_name,
        'created_at', application.created_at,
        'updated_at', application.updated_at
      ) order by application.updated_at desc), '[]'::jsonb)
      from public.student_loan_applications as application
      where application.user_id = user_record.id and application.status <> 'draft'
    ),
    'loan_history', (
      select pg_catalog.jsonb_build_object(
        'count', pg_catalog.count(*),
        'last_disbursed_at', pg_catalog.max(loan.disbursed_at),
        'total_principal', coalesce(pg_catalog.sum(loan.principal_amount), 0)
      )
      from public.buddy_loan_disbursements as loan
      where loan.user_id = user_record.id
    )
  ) into result
  from auth.users as user_record
  left join public.profiles as profile on profile.id = user_record.id
  where user_record.id = p_user_id;
  if result is null then raise exception 'User account not found.' using errcode = 'P0002'; end if;
  perform private.write_buddy_admin_audit(
    'user_account_viewed', null, null,
    pg_catalog.jsonb_build_object('target_user_id', p_user_id)
  );
  return result;
end;
$$;
revoke all on function public.buddy_admin_get_user(uuid) from public, anon;
grant execute on function public.buddy_admin_get_user(uuid) to authenticated;

create or replace function public.buddy_admin_send_user_reminder(
  p_user_id uuid,
  p_title text,
  p_message text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  admin_role text;
  reminder_title text := pg_catalog.btrim(coalesce(p_title, ''));
  reminder_message text := pg_catalog.btrim(coalesce(p_message, ''));
  reminder_id uuid;
begin
  admin_role := private.require_buddy_admin();
  if admin_role not in ('operations_admin', 'owner_admin') then
    raise exception 'Your role cannot send account reminders.' using errcode = '42501';
  end if;
  if not exists (select 1 from auth.users where id = p_user_id) then
    raise exception 'User account not found.' using errcode = 'P0002';
  end if;
  if pg_catalog.char_length(reminder_title) not between 1 and 120
    or pg_catalog.char_length(reminder_message) not between 1 and 500 then
    raise exception 'Add a title and a message of up to 500 characters.' using errcode = '22023';
  end if;
  insert into public.student_activity_events(user_id, event_type, title, detail)
  values (p_user_id, 'staff_reminder', reminder_title, reminder_message)
  returning id into reminder_id;
  perform private.write_buddy_admin_audit(
    'user_reminder_added', null, null,
    pg_catalog.jsonb_build_object('target_user_id', p_user_id, 'reminder_id', reminder_id)
  );
  return pg_catalog.jsonb_build_object('id', reminder_id, 'created_at', pg_catalog.now());
end;
$$;
revoke all on function public.buddy_admin_send_user_reminder(uuid, text, text) from public, anon;
grant execute on function public.buddy_admin_send_user_reminder(uuid, text, text) to authenticated;

create or replace function public.buddy_admin_record_user_contact(p_user_id uuid, p_channel text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare admin_role text;
begin
  admin_role := private.require_buddy_admin();
  if admin_role not in ('operations_admin', 'owner_admin') then
    raise exception 'Your role cannot contact users.' using errcode = '42501';
  end if;
  if p_channel is null or p_channel not in ('email', 'call', 'whatsapp') then
    raise exception 'Choose a valid contact channel.' using errcode = '22023';
  end if;
  if not exists (select 1 from auth.users where id = p_user_id) then
    raise exception 'User account not found.' using errcode = 'P0002';
  end if;
  perform private.write_buddy_admin_audit(
    'user_contact_link_opened', null, null,
    pg_catalog.jsonb_build_object('target_user_id', p_user_id, 'channel', p_channel)
  );
end;
$$;
revoke all on function public.buddy_admin_record_user_contact(uuid, text) from public, anon;
grant execute on function public.buddy_admin_record_user_contact(uuid, text) to authenticated;

drop function if exists public.buddy_admin_recent_audit(integer);
create function public.buddy_admin_recent_audit(p_limit integer default 100, p_offset integer default 0)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare admin_role text;
begin
  admin_role := private.require_buddy_admin();
  if admin_role not in ('operations_admin', 'owner_admin') then
    raise exception 'Your role cannot access the staff activity log.' using errcode = '42501';
  end if;
  return (
    select coalesce(pg_catalog.jsonb_agg(pg_catalog.to_jsonb(events)), '[]'::jsonb)
    from (
      select audit.id, audit.actor_id, actor.email as actor_email,
        audit.action, audit.application_id, audit.document_review_id, audit.details,
        target.email as target_user_email, audit.created_at
      from private.buddy_admin_audit_events as audit
      join auth.users as actor on actor.id = audit.actor_id
      left join public.student_document_reviews as review on review.id = audit.document_review_id
      left join public.student_loan_applications as application on application.id = audit.application_id
      left join auth.users as target on target.id = coalesce(
        case
          when audit.details->>'target_user_id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
            then (audit.details->>'target_user_id')::uuid
          else null
        end,
        review.user_id,
        application.user_id
      )
      order by audit.created_at desc
      limit least(greatest(coalesce(p_limit, 100), 1), 100)
      offset least(greatest(coalesce(p_offset, 0), 0), 100000)
    ) as events
  );
end;
$$;
revoke all on function public.buddy_admin_recent_audit(integer, integer) from public, anon;
grant execute on function public.buddy_admin_recent_audit(integer, integer) to authenticated;

-- Keep staff accounts in their separate privileged directory, not the student
-- support directory. They remain visible in the owner-only Staff access page.
