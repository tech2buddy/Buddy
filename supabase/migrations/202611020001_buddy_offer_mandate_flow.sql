-- A staff-issued written offer followed by a separately authorised mandate.
-- Bank account details are deliberately not copied from statements into this
-- application table. The payer authorises through the configured provider.

create table if not exists public.buddy_application_offers (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null unique references public.student_loan_applications(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  principal_amount integer not null check (principal_amount between 100 and 700 and principal_amount % 100 = 0),
  interest_amount integer not null check (interest_amount >= 0),
  initiation_fee integer not null check (initiation_fee >= 0),
  service_fee integer not null check (service_fee >= 0),
  total_repayment integer not null check (total_repayment = principal_amount + interest_amount + initiation_fee + service_fee),
  repayment_date date not null,
  offer_status text not null default 'offered' check (offer_status in ('offered','accepted','declined','withdrawn')),
  mandate_provider text not null check (char_length(mandate_provider) between 2 and 100),
  mandate_request_reference text not null check (char_length(mandate_request_reference) between 4 and 120),
  mandate_authorization_url text not null check (mandate_authorization_url like 'https://%' and char_length(mandate_authorization_url) <= 2000),
  mandate_status text not null default 'awaiting_student' check (mandate_status in ('awaiting_student','proof_received','verified','rejected')),
  student_authorization_reference text null check (student_authorization_reference is null or char_length(student_authorization_reference) between 4 and 120),
  payment_reference text null check (payment_reference is null or char_length(payment_reference) between 1 and 120),
  mandate_review_note text null check (mandate_review_note is null or char_length(mandate_review_note) <= 500),
  created_by uuid not null references auth.users(id),
  accepted_at timestamptz null,
  mandate_verified_at timestamptz null,
  created_at timestamptz not null default pg_catalog.now(),
  updated_at timestamptz not null default pg_catalog.now(),
  constraint buddy_offer_acceptance_metadata check (
    (offer_status = 'accepted' and accepted_at is not null)
    or (offer_status <> 'accepted' and accepted_at is null)
  ),
  constraint buddy_offer_mandate_metadata check (
    (mandate_status = 'verified' and mandate_verified_at is not null)
    or (mandate_status <> 'verified' and mandate_verified_at is null)
  ),
  constraint buddy_offer_mandate_reference_check check (
    mandate_status not in ('proof_received','verified','rejected') or student_authorization_reference is not null
  )
);

create index if not exists buddy_application_offers_user_created_idx
  on public.buddy_application_offers(user_id, created_at desc);

alter table public.buddy_application_offers enable row level security;
revoke all on public.buddy_application_offers from public, anon, authenticated;
grant select on public.buddy_application_offers to authenticated;
drop policy if exists "Students read their own offer" on public.buddy_application_offers;
create policy "Students read their own offer"
on public.buddy_application_offers for select to authenticated
using ((select auth.uid()) = user_id);

create or replace function public.buddy_admin_send_offer(
  p_application_id uuid,
  p_principal_amount integer,
  p_repayment_date date,
  p_mandate_provider text,
  p_mandate_request_reference text,
  p_mandate_authorization_url text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  admin_role text;
  app_row public.student_loan_applications%rowtype;
  repeat_loan boolean;
  interest_value integer;
  initiation_value integer;
  service_value integer;
  offer_row public.buddy_application_offers%rowtype;
  year_start timestamptz;
begin
  admin_role := private.require_buddy_admin();
  if admin_role not in ('operations_admin','owner_admin') then
    raise exception 'Your role cannot issue an offer.' using errcode = '42501';
  end if;
  select * into app_row from public.student_loan_applications
    where id = p_application_id for update;
  if not found or app_row.status <> 'approved' then
    raise exception 'Approve the application before preparing an offer.' using errcode = '23514';
  end if;
  if p_principal_amount is null or p_principal_amount < 100 or p_principal_amount > app_row.requested_amount
     or p_principal_amount % 100 <> 0 then
    raise exception 'Choose an approved amount in R100 steps, no higher than requested.' using errcode = '23514';
  end if;
  if p_repayment_date is null or p_repayment_date < (pg_catalog.now() at time zone 'Africa/Johannesburg')::date then
    raise exception 'Choose a valid repayment date.' using errcode = '23514';
  end if;
  if nullif(pg_catalog.btrim(p_mandate_provider), '') is null or pg_catalog.char_length(pg_catalog.btrim(p_mandate_provider)) > 100
     or nullif(pg_catalog.btrim(p_mandate_request_reference), '') is null or pg_catalog.char_length(pg_catalog.btrim(p_mandate_request_reference)) > 120
     or p_mandate_authorization_url is null or p_mandate_authorization_url !~ '^https://[^[:space:]]+$' or pg_catalog.char_length(p_mandate_authorization_url) > 2000 then
    raise exception 'Add the secure authorization link and request details from your approved mandate provider.' using errcode = '23514';
  end if;
  if exists (select 1 from public.buddy_application_offers where application_id = app_row.id) then
    raise exception 'An offer has already been issued for this application.' using errcode = '23514';
  end if;
  if exists (
    select 1 from (values ('south_african_id'),('proof_of_registration'),('proof_of_residence'),('bank_statements')) as required(document_type)
    where not exists (
      select 1 from (
        select distinct on (review.document_type) review.document_type, review.review_status
        from public.student_document_reviews as review
        where review.application_id = app_row.id
        order by review.document_type, review.created_at desc
      ) latest where latest.document_type = required.document_type and latest.review_status = 'accepted'
    )
  ) then raise exception 'Accept all four latest documents before issuing an offer.' using errcode = '23514'; end if;

  year_start := pg_catalog.date_trunc('year', pg_catalog.now() at time zone 'Africa/Johannesburg') at time zone 'Africa/Johannesburg';
  repeat_loan := exists (
    select 1 from public.buddy_loan_disbursements as disbursement
    where disbursement.user_id = app_row.user_id and disbursement.disbursed_at >= year_start
  );
  interest_value := pg_catalog.round(p_principal_amount * case when repeat_loan then 0.03 else 0.05 end)::integer;
  initiation_value := pg_catalog.round(p_principal_amount * 0.15)::integer;
  service_value := least(60, pg_catalog.round(p_principal_amount * case when repeat_loan then 0.22 else 0.20 end)::integer);

  insert into public.buddy_application_offers(
    application_id, user_id, principal_amount, interest_amount, initiation_fee,
    service_fee, total_repayment, repayment_date, mandate_provider,
    mandate_request_reference, mandate_authorization_url, created_by
  ) values (
    app_row.id, app_row.user_id, p_principal_amount, interest_value, initiation_value,
    service_value, p_principal_amount + interest_value + initiation_value + service_value,
    p_repayment_date, pg_catalog.btrim(p_mandate_provider), pg_catalog.btrim(p_mandate_request_reference),
    p_mandate_authorization_url, (select auth.uid())
  ) returning * into offer_row;

  insert into public.student_activity_events(user_id, application_id, event_type, title, detail)
  values (app_row.user_id, app_row.id, 'application_status_changed', 'Your written offer is ready',
    'Review the amount, total repayment and date in Activity. If you accept, complete debit-order authorization with the named provider.');
  perform private.write_buddy_admin_audit('offer_issued', app_row.id, null,
    pg_catalog.jsonb_build_object('offer_id', offer_row.id, 'principal_amount', offer_row.principal_amount,
      'total_repayment', offer_row.total_repayment, 'mandate_provider', offer_row.mandate_provider));
  return pg_catalog.to_jsonb(offer_row);
end;
$$;
revoke all on function public.buddy_admin_send_offer(uuid, integer, date, text, text, text) from public, anon, authenticated;
grant execute on function public.buddy_admin_send_offer(uuid, integer, date, text, text, text) to authenticated;

create or replace function public.student_accept_buddy_offer(p_offer_id uuid, p_accept boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare offer_row public.buddy_application_offers%rowtype;
begin
  if p_accept is null then raise exception 'Choose whether to accept or decline the offer.' using errcode = '23514'; end if;
  if (select auth.uid()) is null then raise exception 'Sign in required.' using errcode = '28000'; end if;
  select * into offer_row from public.buddy_application_offers
    where id = p_offer_id and user_id = (select auth.uid()) for update;
  if not found or offer_row.offer_status <> 'offered' then
    raise exception 'This offer is no longer awaiting your decision.' using errcode = '23514';
  end if;
  update public.buddy_application_offers
    set offer_status = case when p_accept then 'accepted' else 'declined' end,
        accepted_at = case when p_accept then pg_catalog.now() else null end,
        updated_at = pg_catalog.now()
    where id = offer_row.id returning * into offer_row;
  insert into public.student_activity_events(user_id, application_id, event_type, title, detail)
  values (offer_row.user_id, offer_row.application_id, 'application_status_changed',
    case when p_accept then 'Offer accepted' else 'Offer declined' end,
    case when p_accept then 'Now complete debit-order authorization with the provider shown in your offer.' else 'Your application team has been notified.' end);
  return pg_catalog.jsonb_build_object('offer_status', offer_row.offer_status);
end;
$$;
revoke all on function public.student_accept_buddy_offer(uuid, boolean) from public, anon;
grant execute on function public.student_accept_buddy_offer(uuid, boolean) to authenticated;

create or replace function public.student_submit_mandate_reference(p_offer_id uuid, p_reference text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare offer_row public.buddy_application_offers%rowtype;
begin
  if (select auth.uid()) is null then raise exception 'Sign in required.' using errcode = '28000'; end if;
  if nullif(pg_catalog.btrim(p_reference), '') is null or pg_catalog.char_length(pg_catalog.btrim(p_reference)) not between 4 and 120 then
    raise exception 'Enter the confirmation reference supplied by your bank or mandate provider.' using errcode = '23514';
  end if;
  select * into offer_row from public.buddy_application_offers
    where id = p_offer_id and user_id = (select auth.uid()) for update;
  if not found or offer_row.offer_status <> 'accepted' or offer_row.mandate_status not in ('awaiting_student','rejected') then
    raise exception 'Accept the offer before submitting mandate confirmation.' using errcode = '23514';
  end if;
  update public.buddy_application_offers set
    mandate_status = 'proof_received',
    student_authorization_reference = pg_catalog.btrim(p_reference),
    mandate_review_note = null,
    mandate_verified_at = null,
    updated_at = pg_catalog.now()
  where id = offer_row.id returning * into offer_row;
  insert into public.student_activity_events(user_id, application_id, event_type, title, detail)
  values (offer_row.user_id, offer_row.application_id, 'application_status_changed',
    'Mandate confirmation received', 'Buddy will verify your provider confirmation before arranging any disbursement.');
  return pg_catalog.jsonb_build_object('mandate_status', offer_row.mandate_status);
end;
$$;
revoke all on function public.student_submit_mandate_reference(uuid, text) from public, anon;
grant execute on function public.student_submit_mandate_reference(uuid, text) to authenticated;

create or replace function public.buddy_admin_get_application_offer(p_application_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare admin_role text; result jsonb;
begin
  admin_role := private.require_buddy_admin();
  if admin_role not in ('operations_admin','owner_admin') then raise exception 'Your role cannot view offers.' using errcode = '42501'; end if;
  select pg_catalog.to_jsonb(offer) into result
    from public.buddy_application_offers offer where offer.application_id = p_application_id;
  return result;
end;
$$;
revoke all on function public.buddy_admin_get_application_offer(uuid) from public, anon, authenticated;
grant execute on function public.buddy_admin_get_application_offer(uuid) to authenticated;

create or replace function public.buddy_admin_review_mandate(p_offer_id uuid, p_verified boolean, p_note text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare admin_role text; offer_row public.buddy_application_offers%rowtype;
begin
  admin_role := private.require_buddy_admin();
  if admin_role not in ('operations_admin','owner_admin') then raise exception 'Your role cannot verify a mandate.' using errcode = '42501'; end if;
  if p_verified is null then raise exception 'Choose a verification result.' using errcode = '23514'; end if;
  if not p_verified and nullif(pg_catalog.btrim(p_note), '') is null then raise exception 'Add a reason so the student knows what to do next.' using errcode = '23514'; end if;
  if p_note is not null and pg_catalog.char_length(pg_catalog.btrim(p_note)) > 500 then raise exception 'The note is too long.' using errcode = '22023'; end if;
  select * into offer_row from public.buddy_application_offers where id = p_offer_id for update;
  if not found or offer_row.mandate_status <> 'proof_received' then raise exception 'No mandate confirmation is awaiting review.' using errcode = '23514'; end if;
  update public.buddy_application_offers set
    mandate_status = case when p_verified then 'verified' else 'rejected' end,
    mandate_verified_at = case when p_verified then pg_catalog.now() else null end,
    mandate_review_note = case when p_verified then null else pg_catalog.left(pg_catalog.btrim(p_note),500) end,
    updated_at = pg_catalog.now()
  where id = p_offer_id returning * into offer_row;
  insert into public.student_activity_events(user_id, application_id, event_type, title, detail)
  values (offer_row.user_id, offer_row.application_id, 'application_status_changed',
    case when p_verified then 'Mandate verified' else 'Mandate confirmation needs attention' end,
    case when p_verified then 'Your authorization was verified. Buddy will arrange the next step and update you here.' else pg_catalog.left(pg_catalog.btrim(p_note),500) end);
  perform private.write_buddy_admin_audit('mandate_reviewed', offer_row.application_id, null,
    pg_catalog.jsonb_build_object('offer_id', p_offer_id, 'verified', p_verified));
  return pg_catalog.jsonb_build_object('mandate_status', offer_row.mandate_status);
end;
$$;
revoke all on function public.buddy_admin_review_mandate(uuid, boolean, text) from public, anon, authenticated;
grant execute on function public.buddy_admin_review_mandate(uuid, boolean, text) to authenticated;

create or replace function public.buddy_admin_record_disbursement(p_offer_id uuid, p_payment_reference text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare admin_role text; offer_row public.buddy_application_offers%rowtype; app_row public.student_loan_applications%rowtype;
begin
  admin_role := private.require_buddy_admin();
  if admin_role not in ('operations_admin','owner_admin') then raise exception 'Your role cannot record a disbursement.' using errcode = '42501'; end if;
  if nullif(pg_catalog.btrim(p_payment_reference), '') is null or pg_catalog.char_length(pg_catalog.btrim(p_payment_reference)) > 120 then
    raise exception 'Enter the payment confirmation reference.' using errcode = '23514';
  end if;
  select * into offer_row from public.buddy_application_offers where id = p_offer_id for update;
  if not found or offer_row.offer_status <> 'accepted' or offer_row.mandate_status <> 'verified' then
    raise exception 'The student must accept the offer and the mandate must be verified first.' using errcode = '23514';
  end if;
  select * into app_row from public.student_loan_applications where id = offer_row.application_id for update;
  if app_row.status <> 'approved' then raise exception 'This application cannot be disbursed in its current state.' using errcode = '23514'; end if;
  if exists (select 1 from public.buddy_loan_disbursements where application_id = app_row.id) then
    raise exception 'A disbursement is already recorded for this application.' using errcode = '23514';
  end if;
  insert into public.buddy_loan_disbursements(user_id, application_id, principal_amount, disbursed_at)
  values (offer_row.user_id, app_row.id, offer_row.principal_amount, pg_catalog.now());
  update public.buddy_application_offers set payment_reference = pg_catalog.btrim(p_payment_reference), updated_at = pg_catalog.now()
    where id = p_offer_id;
  -- The existing disbursement trigger updates application status and creates
  -- the student activity event. Keep that single source of truth to avoid a
  -- duplicate notification.
  perform private.write_buddy_admin_audit('disbursement_recorded', app_row.id, null,
    pg_catalog.jsonb_build_object('offer_id', p_offer_id, 'principal_amount', offer_row.principal_amount,
      'payment_reference_recorded', true));
  return pg_catalog.jsonb_build_object('application_status', 'disbursed');
end;
$$;
revoke all on function public.buddy_admin_record_disbursement(uuid, text) from public, anon, authenticated;
grant execute on function public.buddy_admin_record_disbursement(uuid, text) to authenticated;
