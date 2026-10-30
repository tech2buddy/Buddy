-- Private review state for each uploaded student document.
-- Students may read their own status and create only a pending row for a file
-- that exists in their own private storage folder. They cannot set decisions.

create table if not exists public.student_document_reviews (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  object_path text not null unique,
  document_type text not null check (document_type in (
    'south_african_id', 'proof_of_registration', 'proof_of_residence', 'bank_statements'
  )),
  review_status text not null default 'pending' check (review_status in (
    'pending', 'reviewing', 'accepted', 'action_required'
  )),
  review_note text null check (review_note is null or char_length(review_note) <= 500),
  reviewed_by uuid null references auth.users(id),
  reviewed_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint student_document_reviews_status_metadata check (
    (review_status = 'pending' and review_note is null and reviewed_by is null and reviewed_at is null)
    or (review_status <> 'pending' and reviewed_by is not null and reviewed_at is not null)
  ),
  constraint student_document_reviews_action_note check (
    review_status <> 'action_required' or review_note is not null
  ),
  constraint student_document_reviews_path_matches_type check (
    split_part(split_part(object_path, '/', 2), '-', 1) = document_type
  )
);

create index if not exists student_document_reviews_user_created_idx
  on public.student_document_reviews (user_id, created_at desc);

alter table public.student_document_reviews enable row level security;
revoke all on table public.student_document_reviews from anon, authenticated;
grant select, insert, delete on table public.student_document_reviews to authenticated;

drop policy if exists "Students read their own document review statuses" on public.student_document_reviews;
drop policy if exists "Students register their own pending documents" on public.student_document_reviews;
drop policy if exists "Students remove status for their own deleted documents" on public.student_document_reviews;

create policy "Students read their own document review statuses"
on public.student_document_reviews for select to authenticated
using ((select auth.uid()) = user_id);

create policy "Students register their own pending documents"
on public.student_document_reviews for insert to authenticated
with check (
  user_id = (select auth.uid())
  and review_status = 'pending'
  and review_note is null
  and reviewed_by is null
  and reviewed_at is null
  and split_part(object_path, '/', 1) = (select auth.uid()::text)
  and split_part(split_part(object_path, '/', 2), '-', 1) = document_type
  and split_part(object_path, '/', 2) ~ '^(south_african_id|proof_of_registration|proof_of_residence|bank_statements)-[0-9a-f-]+\.(pdf|jpg|png)$'
  and exists (
    select 1 from storage.objects as stored
    where stored.bucket_id = 'student-documents'
      and stored.name = object_path
  )
);

create policy "Students remove status for their own deleted documents"
on public.student_document_reviews for delete to authenticated
using ((select auth.uid()) = user_id);

create or replace function public.set_student_document_review_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;
revoke all on function public.set_student_document_review_updated_at() from public, anon, authenticated;
drop trigger if exists set_student_document_review_updated_at on public.student_document_reviews;
create trigger set_student_document_review_updated_at
before update on public.student_document_reviews
for each row execute function public.set_student_document_review_updated_at();

-- Give files already in the bucket an initial truthful status without changing
-- Storage metadata or the underlying objects.
insert into public.student_document_reviews (user_id, object_path, document_type)
select
  case
    when split_part(stored.name, '/', 1) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      then split_part(stored.name, '/', 1)::uuid
  end,
  stored.name,
  split_part(split_part(stored.name, '/', 2), '-', 1)
from storage.objects as stored
where stored.bucket_id = 'student-documents'
  and split_part(stored.name, '/', 1) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  and split_part(stored.name, '/', 2) ~ '^(south_african_id|proof_of_registration|proof_of_residence|bank_statements)-[0-9a-f-]+\.(pdf|jpg|png)$'
on conflict (object_path) do nothing;
