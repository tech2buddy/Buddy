-- Owner-only staff management. Staff users must already exist in Auth and
-- complete MFA before they can use any Buddy operations RPC.

create or replace function public.buddy_admin_staff_list()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  admin_role text;
begin
  admin_role := private.require_buddy_admin();
  if admin_role <> 'owner_admin' then
    raise exception 'Only an owner admin can manage staff access.' using errcode = '42501';
  end if;
  return (
    select coalesce(pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object(
        'user_id', membership.user_id,
        'email', user_record.email,
        'role', membership.role,
        'active', membership.active,
        'created_at', membership.created_at
      ) order by membership.created_at asc
    ), '[]'::jsonb)
    from private.buddy_admin_memberships as membership
    join auth.users as user_record on user_record.id = membership.user_id
  );
end;
$$;
revoke all on function public.buddy_admin_staff_list() from public, anon;
grant execute on function public.buddy_admin_staff_list() to authenticated;

create or replace function public.buddy_admin_set_staff_role(
  p_email text,
  p_role text,
  p_active boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  admin_role text;
  target_user_id uuid;
  old_role text;
  old_active boolean;
  normalized_email text;
begin
  admin_role := private.require_buddy_admin();
  if admin_role <> 'owner_admin' then
    raise exception 'Only an owner admin can manage staff access.' using errcode = '42501';
  end if;
  normalized_email := pg_catalog.lower(pg_catalog.btrim(coalesce(p_email, '')));
  if normalized_email = '' or pg_catalog.char_length(normalized_email) > 254 then
    raise exception 'Enter a valid staff email address.' using errcode = '22023';
  end if;
  if p_role not in ('application_reviewer','operations_admin','owner_admin') then
    raise exception 'Choose a valid staff role.' using errcode = '22023';
  end if;
  select user_record.id into target_user_id
  from auth.users as user_record
  where pg_catalog.lower(user_record.email) = normalized_email
    and user_record.email_confirmed_at is not null
  for update;
  if target_user_id is null then
    raise exception 'Create and verify this staff account in Authentication first.' using errcode = 'P0002';
  end if;

  select membership.role, membership.active into old_role, old_active
  from private.buddy_admin_memberships as membership
  where membership.user_id = target_user_id
  for update;

  if old_role = 'owner_admin' and old_active and (p_role <> 'owner_admin' or not coalesce(p_active, false))
    and not exists (
      select 1 from private.buddy_admin_memberships as other_owner
      where other_owner.role = 'owner_admin' and other_owner.active
        and other_owner.user_id <> target_user_id
    ) then
    raise exception 'Buddy must always have at least one active owner admin.' using errcode = '23514';
  end if;

  insert into private.buddy_admin_memberships(user_id, role, active, added_by)
  values (target_user_id, p_role, coalesce(p_active, true), (select auth.uid()))
  on conflict (user_id) do update
    set role = excluded.role, active = excluded.active;

  perform private.write_buddy_admin_audit(
    case when coalesce(p_active, true) then 'staff_access_changed' else 'staff_access_revoked' end,
    null, null,
    pg_catalog.jsonb_build_object(
      'target_user_id', target_user_id,
      'email', normalized_email,
      'from_role', old_role,
      'from_active', old_active,
      'to_role', p_role,
      'to_active', coalesce(p_active, true)
    )
  );
  return pg_catalog.jsonb_build_object(
    'user_id', target_user_id,
    'email', normalized_email,
    'role', p_role,
    'active', coalesce(p_active, true)
  );
end;
$$;
revoke all on function public.buddy_admin_set_staff_role(text, text, boolean) from public, anon;
grant execute on function public.buddy_admin_set_staff_role(text, text, boolean) to authenticated;
