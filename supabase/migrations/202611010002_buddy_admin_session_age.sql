-- Keep staff access limited to a recent, MFA-verified Supabase session.
-- Supabase's access token does not guarantee an auth_time claim, so validate
-- the signed session_id against the server-owned auth.sessions record.

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
    and exists (
      select 1
      from auth.sessions as auth_session
      where auth_session.id = nullif((select auth.jwt() ->> 'session_id'), '')::uuid
        and auth_session.user_id = (select auth.uid())
        and auth_session.aal::text = 'aal2'
        and auth_session.created_at > pg_catalog.now() - interval '8 hours'
        and (auth_session.not_after is null or auth_session.not_after > pg_catalog.now())
    )
$$;
revoke all on function private.buddy_admin_role() from public, anon, authenticated;
grant usage on schema private to authenticated;
grant execute on function private.buddy_admin_role() to authenticated;

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
  if not exists (
    select 1
    from auth.sessions as auth_session
    where auth_session.id = nullif((select auth.jwt() ->> 'session_id'), '')::uuid
      and auth_session.user_id = (select auth.uid())
      and auth_session.aal::text = 'aal2'
      and auth_session.created_at > pg_catalog.now() - interval '8 hours'
      and (auth_session.not_after is null or auth_session.not_after > pg_catalog.now())
  ) then
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
