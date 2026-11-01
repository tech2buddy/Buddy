-- Store the student's bursary response and address confirmation with the
-- submitted application, and require both before final submission.
alter table public.student_loan_applications
  add column if not exists bursary_status text
    check (bursary_status in ('using', 'none')),
  add column if not exists bursary_name text,
  add column if not exists residence_confirmed_at timestamptz;

drop function if exists public.submit_student_application();

create or replace function public.submit_student_application(
  p_bursary_status text,
  p_bursary_name text,
  p_residence_confirmed boolean
)
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

  if p_bursary_status is null or p_bursary_status not in ('using', 'none') then
    raise exception 'Choose whether you are using a bursary.' using errcode = '23514';
  end if;

  if p_bursary_status = 'using' and nullif(pg_catalog.btrim(p_bursary_name), '') is null then
    raise exception 'Enter your bursary name.' using errcode = '23514';
  end if;

  if p_bursary_status = 'none' and p_bursary_name is not null then
    raise exception 'Do not enter a bursary name when you are not using one.' using errcode = '23514';
  end if;

  if p_bursary_name is not null and pg_catalog.char_length(pg_catalog.btrim(p_bursary_name)) > 160 then
    raise exception 'Bursary name is too long.' using errcode = '23514';
  end if;

  if p_residence_confirmed is distinct from true then
    raise exception 'Confirm that your home address is current.' using errcode = '23514';
  end if;

  if not exists (
    select 1 from public.profiles as profile
    where profile.id = student_id
      and nullif(pg_catalog.btrim(profile.first_name), '') is not null
      and nullif(pg_catalog.btrim(profile.last_name), '') is not null
      and nullif(pg_catalog.btrim(profile.home_address), '') is not null
  ) then
    raise exception 'Complete your name and home address in your profile.' using errcode = '23514';
  end if;

  select * into application
  from public.student_loan_applications
  where user_id = student_id and status in ('draft', 'action_required')
  order by updated_at desc
  limit 1
  for update;

  if not found then
    raise exception 'There is no application ready to submit.' using errcode = 'P0002';
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
  set status = 'submitted',
      current_step = 3,
      bursary_status = p_bursary_status,
      bursary_name = case when p_bursary_status = 'using' then pg_catalog.btrim(p_bursary_name) else null end,
      residence_confirmed_at = pg_catalog.now()
  where id = application.id and user_id = student_id
  returning * into application;

  return application;
end;
$$;

revoke all on function public.submit_student_application(text, text, boolean) from public, anon, authenticated;
grant execute on function public.submit_student_application(text, text, boolean) to authenticated;
