alter table public.users
  add column if not exists bubble_id text,
  add column if not exists is_test boolean not null default false,
  add column if not exists bubble_raw jsonb;

alter table public.seeker_profiles
  add column if not exists bubble_id text,
  add column if not exists is_test boolean not null default false,
  add column if not exists bubble_raw jsonb;

alter table public.clubs
  add column if not exists bubble_id text,
  add column if not exists is_test boolean not null default false,
  add column if not exists bubble_raw jsonb;

alter table public.offers
  add column if not exists bubble_id text,
  add column if not exists is_test boolean not null default false,
  add column if not exists bubble_raw jsonb;

alter table public.offer_responses
  add column if not exists bubble_id text,
  add column if not exists is_test boolean not null default false,
  add column if not exists bubble_raw jsonb;

alter table public.offers
  alter column staff_id drop not null;

alter table public.offers
  alter column seeker_id drop not null;

alter table public.offer_responses
  alter column offer_id drop not null,
  alter column seeker_id drop not null;

create unique index if not exists users_bubble_id_idx
  on public.users(bubble_id);
create unique index if not exists seeker_profiles_bubble_id_idx
  on public.seeker_profiles(bubble_id);
create unique index if not exists clubs_bubble_id_idx
  on public.clubs(bubble_id);
create unique index if not exists offers_bubble_id_idx
  on public.offers(bubble_id);
create unique index if not exists offer_responses_bubble_id_idx
  on public.offer_responses(bubble_id);

comment on column public.users.bubble_id is 'Original Bubble User _id.';
comment on column public.clubs.bubble_id is 'Original Bubble Club _id.';
comment on column public.offers.bubble_id is 'Original Bubble Offer _id.';
comment on column public.offer_responses.bubble_id is 'Original Bubble OfferResponse _id.';
