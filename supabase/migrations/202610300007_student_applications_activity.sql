-- Persist a student's in-progress application and expose a truthful activity
-- feed built only from committed application, document and disbursement events.

create table if not exists public.student_loan_applications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  requested_amount integer not null check (
    requested_amount between 100 and 700 and requested_amount % 100 = 0
  ),
  current_step integer not null default 2 check (current_step between 2 and 7),
  status text not null default 'draft' check (status in (
    'draft', 'submitted', 'under_review', 'action_required', 'approved', 'disbursed', 'declined', 'cancelled'
  )),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists student_loan_applications_user_updated_idx
  on public.student_loan_applications (user_id, updated_at desc);

create or replace function public.touch_student_loan_application()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;
revoke all on function public.touch_student_loan_application() from public, anon, authenticated;
drop trigger if exists touch_student_loan_application on public.student_loan_applications;
create trigger touch_student_loan_application
before update on public.student_loan_applications
for each row execute function public.touch_student_loan_application();

alter table public.student_loan_applications enable row level security;
revoke all on table public.student_loan_applications from public, anon, authenticated;
grant select on table public.student_loan_applications to authenticated;
grant insert (user_id, requested_amount, current_step) on table public.student_loan_applications to authenticated;
grant update (requested_amount, current_step) on table public.student_loan_applications to authenticated;

drop policy if exists "Students read their own applications" on public.student_loan_applications;
create policy "Students read their own applications"
on public.student_loan_applications for select to authenticated
using ((select auth.uid()) = user_id);

drop policy if exists "Students create their own draft applications" on public.student_loan_applications;
create policy "Students create their own draft applications"
on public.student_loan_applications for insert to authenticated
with check ((select auth.uid()) = user_id and status = 'draft');

drop policy if exists "Students update their own draft applications" on public.student_loan_applications;
create policy "Students update their own draft applications"
on public.student_loan_applications for update to authenticated
using ((select auth.uid()) = user_id and status = 'draft')
with check ((select auth.uid()) = user_id and status = 'draft');

alter table public.student_document_reviews
  add column if not exists application_id uuid null
  references public.student_loan_applications(id) on delete set null;

create or replace function public.validate_student_document_application()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.application_id is not null and not exists (
    select 1 from public.student_loan_applications as application
    where application.id = new.application_id and application.user_id = new.user_id
  ) then
    raise exception 'Application does not belong to this student';
  end if;
  return new;
end;
$$;
revoke all on function public.validate_student_document_application() from public, anon, authenticated;
drop trigger if exists validate_student_document_application on public.student_document_reviews;
create trigger validate_student_document_application
before insert or update of application_id, user_id on public.student_document_reviews
for each row execute function public.validate_student_document_application();

alter table public.buddy_loan_disbursements
  add column if not exists application_id uuid null
  references public.student_loan_applications(id) on delete set null;

create index if not exists buddy_loan_disbursements_application_idx
  on public.buddy_loan_disbursements (application_id, disbursed_at desc);

create or replace function public.validate_student_disbursement_application()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.application_id is not null and not exists (
    select 1 from public.student_loan_applications as application
    where application.id = new.application_id and application.user_id = new.user_id
  ) then
    raise exception 'Application does not belong to this student';
  end if;
  return new;
end;
$$;
revoke all on function public.validate_student_disbursement_application() from public, anon, authenticated;
drop trigger if exists validate_student_disbursement_application on public.buddy_loan_disbursements;
create trigger validate_student_disbursement_application
before insert or update of application_id, user_id on public.buddy_loan_disbursements
for each row execute function public.validate_student_disbursement_application();

create index if not exists student_document_reviews_application_idx
  on public.student_document_reviews (application_id, created_at desc);

create table if not exists public.student_activity_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  application_id uuid null references public.student_loan_applications(id) on delete set null,
  event_type text not null check (event_type in (
    'application_started', 'application_progressed', 'application_status_changed',
    'application_amount_changed', 'document_uploaded', 'document_reviewed', 'document_removed', 'loan_disbursed'
  )),
  title text not null check (char_length(title) between 1 and 120),
  detail text not null default '' check (char_length(detail) <= 500),
  created_at timestamptz not null default now()
);

create index if not exists student_activity_events_user_date_idx
  on public.student_activity_events (user_id, created_at desc);

alter table public.student_activity_events enable row level security;
revoke all on table public.student_activity_events from public, anon, authenticated;
grant select on table public.student_activity_events to authenticated;

drop policy if exists "Students read their own activity" on public.student_activity_events;
create policy "Students read their own activity"
on public.student_activity_events for select to authenticated
using ((select auth.uid()) = user_id);

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
    and not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'student_activity_events'
    ) then
    alter publication supabase_realtime add table public.student_activity_events;
  end if;
end;
$$;

create or replace function public.record_student_application_activity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
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
    insert into public.student_activity_events (user_id, application_id, event_type, title, detail)
    values (new.user_id, new.id, 'application_progressed', 'Application progress saved',
      'Your application is saved at step ' || new.current_step::text || ' of 7.');
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
drop trigger if exists record_student_application_activity on public.student_loan_applications;
create trigger record_student_application_activity
after insert or update on public.student_loan_applications
for each row execute function public.record_student_application_activity();

create or replace function public.record_student_document_activity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  label text;
begin
  if tg_op = 'DELETE' then
    label := case old.document_type
      when 'south_african_id' then 'South African ID'
      when 'proof_of_registration' then 'Proof of registration'
      when 'proof_of_residence' then 'Proof of residence'
      when 'bank_statements' then 'Bank statements'
      else 'Document'
    end;
    insert into public.student_activity_events (user_id, application_id, event_type, title, detail)
    values (old.user_id, old.application_id, 'document_removed', 'Document removed', label || ' was removed from your account.');
    return old;
  end if;

  label := case new.document_type
    when 'south_african_id' then 'South African ID'
    when 'proof_of_registration' then 'Proof of registration'
    when 'proof_of_residence' then 'Proof of residence'
    when 'bank_statements' then 'Bank statements'
    else 'Document'
  end;

  if tg_op = 'INSERT' then
    insert into public.student_activity_events (user_id, application_id, event_type, title, detail)
    values (new.user_id, new.application_id, 'document_uploaded', 'Document uploaded', label || ' was added to your account.');
  elsif new.review_status is distinct from old.review_status then
    insert into public.student_activity_events (user_id, application_id, event_type, title, detail)
    values (new.user_id, new.application_id, 'document_reviewed',
      case new.review_status when 'accepted' then 'Document accepted' when 'action_required' then 'Document needs an update' else 'Document review updated' end,
      left(label || ': ' || replace(new.review_status, '_', ' ') || case when new.review_note is not null then ' — ' || new.review_note else '' end, 500));
  end if;
  return new;
end;
$$;

revoke all on function public.record_student_document_activity() from public, anon, authenticated;
drop trigger if exists record_student_document_activity on public.student_document_reviews;
create trigger record_student_document_activity
after insert or update or delete on public.student_document_reviews
for each row execute function public.record_student_document_activity();

create or replace function public.record_student_disbursement_activity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.student_activity_events (user_id, application_id, event_type, title, detail, created_at)
  values (new.user_id, new.application_id, 'loan_disbursed', 'Loan disbursed',
    'R' || new.principal_amount::text || ' was disbursed to your account.', new.disbursed_at);
  if new.application_id is not null then
    update public.student_loan_applications as application
    set status = 'disbursed'
    where application.id = new.application_id and application.user_id = new.user_id;
  end if;
  return new;
end;
$$;

revoke all on function public.record_student_disbursement_activity() from public, anon, authenticated;
drop trigger if exists record_student_disbursement_activity on public.buddy_loan_disbursements;
create trigger record_student_disbursement_activity
after insert on public.buddy_loan_disbursements
for each row execute function public.record_student_disbursement_activity();

update public.student_loan_applications as application
set status = 'disbursed'
from public.buddy_loan_disbursements as loan
where loan.application_id = application.id
  and loan.user_id = application.user_id
  and application.status <> 'disbursed';

-- Backfill truthful activity for uploads and disbursements that already exist.
insert into public.student_activity_events (user_id, application_id, event_type, title, detail, created_at)
select review.user_id, review.application_id, 'document_uploaded', 'Document uploaded',
  case review.document_type
    when 'south_african_id' then 'South African ID was added to your account.'
    when 'proof_of_registration' then 'Proof of registration was added to your account.'
    when 'proof_of_residence' then 'Proof of residence was added to your account.'
    when 'bank_statements' then 'Bank statements were added to your account.'
    else 'A document was added to your account.'
  end,
  review.created_at
from public.student_document_reviews as review
where not exists (
  select 1 from public.student_activity_events as event
  where event.user_id = review.user_id and event.event_type = 'document_uploaded'
    and event.created_at = review.created_at and event.application_id is not distinct from review.application_id
    and event.detail = case review.document_type
      when 'south_african_id' then 'South African ID was added to your account.'
      when 'proof_of_registration' then 'Proof of registration was added to your account.'
      when 'proof_of_residence' then 'Proof of residence was added to your account.'
      when 'bank_statements' then 'Bank statements were added to your account.'
      else 'A document was added to your account.'
    end
);

insert into public.student_activity_events (user_id, application_id, event_type, title, detail, created_at)
select loan.user_id, loan.application_id, 'loan_disbursed', 'Loan disbursed',
  'R' || loan.principal_amount::text || ' was disbursed to your account.', loan.disbursed_at
from public.buddy_loan_disbursements as loan
where not exists (
  select 1 from public.student_activity_events as event
  where event.user_id = loan.user_id and event.event_type = 'loan_disbursed'
    and event.created_at = loan.disbursed_at
    and event.application_id is not distinct from loan.application_id
    and event.detail = 'R' || loan.principal_amount::text || ' was disbursed to your account.'
);

insert into public.student_activity_events (user_id, application_id, event_type, title, detail, created_at)
select review.user_id, review.application_id, 'document_reviewed',
  case review.review_status when 'accepted' then 'Document accepted' when 'action_required' then 'Document needs an update' else 'Document review updated' end,
  left(
    case review.document_type
      when 'south_african_id' then 'South African ID'
      when 'proof_of_registration' then 'Proof of registration'
      when 'proof_of_residence' then 'Proof of residence'
      when 'bank_statements' then 'Bank statements'
      else 'Document'
    end || ': ' || replace(review.review_status, '_', ' ') || case when review.review_note is not null then ' — ' || review.review_note else '' end,
    500
  ),
  coalesce(review.reviewed_at, review.updated_at)
from public.student_document_reviews as review
where review.review_status <> 'pending'
  and not exists (
    select 1 from public.student_activity_events as event
    where event.user_id = review.user_id and event.event_type = 'document_reviewed'
      and event.created_at = coalesce(review.reviewed_at, review.updated_at)
      and event.application_id is not distinct from review.application_id
  );

notify pgrst, 'reload schema';
