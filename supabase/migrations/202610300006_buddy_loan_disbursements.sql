-- Private, server-managed record of actual Buddy loan disbursements.
-- An application or approval is not a disbursement and must not create a row.

create table if not exists public.buddy_loan_disbursements (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  principal_amount integer not null check (
    principal_amount between 100 and 700 and principal_amount % 100 = 0
  ),
  disbursed_at timestamptz not null,
  created_at timestamptz not null default now()
);

create index if not exists buddy_loan_disbursements_user_date_idx
  on public.buddy_loan_disbursements (user_id, disbursed_at desc);

alter table public.buddy_loan_disbursements enable row level security;
revoke all on table public.buddy_loan_disbursements from public, anon, authenticated;
grant select on table public.buddy_loan_disbursements to authenticated;
grant all on table public.buddy_loan_disbursements to service_role;

drop policy if exists "Students read their own disbursements" on public.buddy_loan_disbursements;
create policy "Students read their own disbursements"
on public.buddy_loan_disbursements for select to authenticated
using ((select auth.uid()) = user_id);
