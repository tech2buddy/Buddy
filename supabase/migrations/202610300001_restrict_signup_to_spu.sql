-- Buddy Loans account sign-up allowlist.
-- Apply from the Supabase SQL Editor as the project owner.
-- Then enable this function in Authentication > Hooks > Before User Created.

create schema if not exists private;
revoke all on schema private from public, anon, authenticated, service_role;

create table if not exists private.allowed_signup_email_domains (
  domain text primary key check (domain = lower(domain) and position('@' in domain) = 0)
);

alter table private.allowed_signup_email_domains enable row level security;
revoke all on table private.allowed_signup_email_domains from public, anon, authenticated, service_role;

insert into private.allowed_signup_email_domains (domain)
values ('spu.ac.za')
on conflict (domain) do nothing;

create or replace function public.buddy_before_user_created(event jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  normalized_email text := lower(btrim(coalesce(event #>> '{user,email}', '')));
  requested_domain text;
begin
  if normalized_email = '' or normalized_email !~ '^[^@[:space:]]+@[^@[:space:]]+$' then
    return jsonb_build_object(
      'error', jsonb_build_object(
        'message', 'A valid SPU-issued email address is required.',
        'http_code', 400
      )
    );
  end if;

  requested_domain := split_part(normalized_email, '@', 2);

  if exists (
    select 1
    from private.allowed_signup_email_domains as approved
    where approved.domain = requested_domain
  ) then
    return '{}'::jsonb;
  end if;

  return jsonb_build_object(
    'error', jsonb_build_object(
      'message', 'Sign-up is currently limited to SPU-issued email addresses.',
      'http_code', 403
    )
  );
end;
$function$;

alter function public.buddy_before_user_created(jsonb) owner to postgres;
revoke all on function public.buddy_before_user_created(jsonb) from public, anon, authenticated, service_role;
grant execute on function public.buddy_before_user_created(jsonb) to supabase_auth_admin;
