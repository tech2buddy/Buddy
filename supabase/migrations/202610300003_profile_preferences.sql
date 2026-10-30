-- Persist student contact and product-update preferences.
alter table public.profiles
  add column if not exists preferred_contact_method text not null default 'WhatsApp'
    check (preferred_contact_method in ('WhatsApp', 'Call', 'Email')),
  add column if not exists product_updates boolean not null default false;

comment on column public.profiles.preferred_contact_method is 'Student-selected preferred contact channel.';
comment on column public.profiles.product_updates is 'Student opt-in for non-essential Buddy product updates.';

notify pgrst, 'reload schema';
