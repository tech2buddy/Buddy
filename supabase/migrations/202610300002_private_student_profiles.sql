-- Private student onboarding profile. Run in the Supabase SQL Editor as project owner.
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  first_name text not null check (char_length(btrim(first_name)) between 1 and 80),
  last_name text not null check (char_length(btrim(last_name)) between 1 and 80),
  hometown text not null check (char_length(btrim(hometown)) between 1 and 100),
  gender text not null default '' check (gender in ('', 'Female', 'Male', 'Non-binary', 'Self-describe')),
  home_address text not null check (char_length(btrim(home_address)) between 1 and 300),
  phone text not null check (char_length(btrim(phone)) between 3 and 32),
  whatsapp_phone text not null check (char_length(btrim(whatsapp_phone)) between 3 and 32),
  personal_email text not null check (char_length(btrim(personal_email)) between 3 and 254),
  next_of_kin_name text not null check (char_length(btrim(next_of_kin_name)) between 1 and 160),
  next_of_kin_phone text not null check (char_length(btrim(next_of_kin_phone)) between 3 and 32),
  referral_source text not null check (referral_source in ('Friend or family', 'Campus / university', 'Social media', 'Online search', 'Student organisation', 'Other')),
  referral_other text not null default '' check (char_length(referral_other) <= 120),
  profile_consent_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.profiles enable row level security;
revoke all on table public.profiles from public, anon;
grant select, insert, update on table public.profiles to authenticated;

drop policy if exists "Students can read their own profile" on public.profiles;
create policy "Students can read their own profile"
  on public.profiles for select to authenticated
  using ((select auth.uid()) = id);

drop policy if exists "Students can create their own profile" on public.profiles;
create policy "Students can create their own profile"
  on public.profiles for insert to authenticated
  with check ((select auth.uid()) = id);

drop policy if exists "Students can update their own profile" on public.profiles;
create policy "Students can update their own profile"
  on public.profiles for update to authenticated
  using ((select auth.uid()) = id)
  with check ((select auth.uid()) = id);

comment on table public.profiles is 'Private student account contact profile. Each authenticated user can access only their own row.';
