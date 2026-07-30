-- MAXVALUE SUPABASE COMPLETE SETUP
-- Supabase SQL Editor: paste and run the whole file.
-- Version: 2026-06-08.5 Bubble import ready
-- Includes enums, tables, indexes, RLS, storage, RPCs, Bubble columns and seeds.

begin;

-- ============================================================================
-- supabase/migrations/202606070001_initial_schema.sql
-- ============================================================================
create extension if not exists pgcrypto;

do $$ begin create type public.user_role as enum ('seeker', 'club_staff', 'admin'); exception when duplicate_object then null; end $$;
do $$ begin create type public.offer_status as enum ('sent', 'interested', 'rejected'); exception when duplicate_object then null; end $$;
do $$ begin create type public.ticket_type as enum ('registration_invite', 'interview'); exception when duplicate_object then null; end $$;
do $$ begin create type public.ticket_source as enum ('registration', 'invite', 'admin_grant', 'interview'); exception when duplicate_object then null; end $$;
do $$ begin create type public.gacha_use_status as enum ('unused', 'requested', 'completed'); exception when duplicate_object then null; end $$;

create table if not exists public.users (
  id uuid primary key default gen_random_uuid(),
  line_user_id text unique not null,
  line_name text not null,
  line_picture_url text,
  role public.user_role not null default 'seeker',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_login_at timestamptz
);

create table if not exists public.clubs (
  id uuid primary key default gen_random_uuid(),
  display_name text not null,
  search_name text not null,
  kana_name text,
  store_code text unique,
  business_type text not null,
  region text not null,
  area text not null,
  appeal_text text,
  logo_url text,
  instagram_url text,
  interior_photo_urls text[] not null default '{}',
  invite_token uuid unique not null default gen_random_uuid(),
  is_active boolean not null default true,
  profile jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.seeker_profiles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid unique not null references public.users(id) on delete cascade,
  nickname text not null,
  age integer not null check (age >= 18),
  work_experience text not null,
  desired_region text not null,
  desired_area text not null,
  desired_shift text not null,
  start_timing text not null,
  current_region text,
  current_area text,
  current_club_id uuid references public.clubs(id),
  blocked_club_ids uuid[] not null default '{}',
  current_hourly_range text,
  current_monthly_sales_range text,
  photo_1_url text,
  photo_2_url text,
  full_body_photo_url text,
  invite_code text unique not null,
  invited_by_user_id uuid references public.users(id),
  setup_completed boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.club_staffs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid unique not null references public.users(id) on delete cascade,
  club_id uuid not null references public.clubs(id) on delete cascade,
  staff_name text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.offers (
  id uuid primary key default gen_random_uuid(),
  seeker_id uuid not null references public.seeker_profiles(id) on delete cascade,
  club_id uuid not null references public.clubs(id),
  staff_id uuid not null references public.club_staffs(id),
  hourly_wage integer not null check (hourly_wage > 0),
  guarantee_period text not null,
  comment varchar(30),
  status public.offer_status not null default 'sent',
  created_at timestamptz not null default now()
);
create index if not exists offers_seeker_created_idx on public.offers(seeker_id, created_at desc);

create table if not exists public.offer_responses (
  id uuid primary key default gen_random_uuid(),
  offer_id uuid not null references public.offers(id) on delete cascade,
  seeker_id uuid not null references public.seeker_profiles(id) on delete cascade,
  response public.offer_status not null check (response <> 'sent'),
  created_at timestamptz not null default now(),
  line_payload jsonb
);

create table if not exists public.gacha_items (
  id uuid primary key default gen_random_uuid(),
  name text unique not null,
  rarity text not null,
  image_url text,
  probability numeric(6,5) not null check (probability >= 0 and probability <= 1),
  description text,
  is_active boolean not null default true
);

create table if not exists public.gacha_tickets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  ticket_type public.ticket_type not null,
  source public.ticket_source not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.gacha_results (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  gacha_item_id uuid not null references public.gacha_items(id),
  ticket_id uuid unique not null references public.gacha_tickets(id),
  created_at timestamptz not null default now(),
  used_requested_at timestamptz,
  used_status public.gacha_use_status not null default 'unused'
);

alter table public.users enable row level security;
alter table public.seeker_profiles enable row level security;
alter table public.clubs enable row level security;
alter table public.club_staffs enable row level security;
alter table public.offers enable row level security;
alter table public.offer_responses enable row level security;
alter table public.gacha_items enable row level security;
alter table public.gacha_tickets enable row level security;
alter table public.gacha_results enable row level security;

drop policy if exists "public active clubs" on public.clubs;
create policy "public active clubs" on public.clubs for select to anon, authenticated using (is_active);
drop policy if exists "public active gacha items" on public.gacha_items;
create policy "public active gacha items" on public.gacha_items for select to anon, authenticated using (is_active);

-- ============================================================================
-- supabase/migrations/202606070002_storage_buckets.sql
-- ============================================================================
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('user-images', 'user-images', true, 10485760, array['image/jpeg', 'image/png', 'image/webp']),
  ('club-images', 'club-images', true, 10485760, array['image/jpeg', 'image/png', 'image/webp']),
  ('gacha-images', 'gacha-images', true, 10485760, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "public image reads" on storage.objects;
create policy "public image reads"
on storage.objects for select
to anon, authenticated
using (bucket_id in ('user-images', 'club-images', 'gacha-images'));

drop policy if exists "authenticated user image uploads" on storage.objects;
create policy "authenticated user image uploads"
on storage.objects for insert
to authenticated
with check (
  bucket_id = 'user-images'
  and (storage.foldername(name))[1] = auth.uid()::text
);

drop policy if exists "authenticated user image updates" on storage.objects;
create policy "authenticated user image updates"
on storage.objects for update
to authenticated
using (
  bucket_id = 'user-images'
  and (storage.foldername(name))[1] = auth.uid()::text
)
with check (
  bucket_id = 'user-images'
  and (storage.foldername(name))[1] = auth.uid()::text
);

-- Club and gacha asset writes stay server-side. Add service-role upload routes
-- when club authentication and the operations console are introduced.

-- ============================================================================
-- supabase/migrations/202606070003_line_login_prep.sql
-- ============================================================================
create table if not exists public.line_auth_states (
  id uuid primary key default gen_random_uuid(),
  state_hash text unique not null,
  return_to text not null default '/?screen=offers',
  role public.user_role not null default 'seeker',
  expires_at timestamptz not null default now() + interval '10 minutes',
  consumed_at timestamptz,
  created_at timestamptz not null default now()
);

alter table public.line_auth_states enable row level security;

alter table public.users
  add column if not exists auth_user_id uuid unique references auth.users(id) on delete set null;

create index if not exists users_auth_user_id_idx on public.users(auth_user_id);
create index if not exists line_auth_states_expiry_idx on public.line_auth_states(expires_at);

comment on table public.line_auth_states is
  'Short-lived OAuth state records for the future LINE Login callback.';
comment on column public.users.auth_user_id is
  'Optional Supabase Auth identity linked after LINE token verification.';

revoke all on public.line_auth_states from anon, authenticated;

-- ============================================================================
-- supabase/migrations/202606080001_data_sources_and_temporary_line.sql
-- ============================================================================
create table if not exists public.location_areas (
  id uuid primary key default gen_random_uuid(),
  region text not null,
  area text not null,
  sort_order integer not null default 0,
  is_active boolean not null default true,
  unique (region, area)
);

alter table public.location_areas enable row level security;

drop policy if exists "public active location areas" on public.location_areas;
create policy "public active location areas"
on public.location_areas for select
to anon, authenticated
using (is_active);

alter table public.gacha_items
  add column if not exists ticket_type public.ticket_type;

update public.gacha_items
set ticket_type = 'registration_invite'
where ticket_type is null;

alter table public.gacha_items
  alter column ticket_type set not null;

alter table public.gacha_items
  drop constraint if exists gacha_items_name_key;

create unique index if not exists gacha_items_ticket_name_idx
  on public.gacha_items(ticket_type, name);

create index if not exists clubs_location_idx
  on public.clubs(region, area, display_name)
  where is_active;

create index if not exists gacha_items_pool_idx
  on public.gacha_items(ticket_type, is_active);

drop view if exists public.seeker_directory;

create view public.seeker_directory
with (security_invoker = false)
as
select
  sp.id,
  sp.nickname,
  sp.age,
  sp.desired_region as region,
  sp.desired_area as area,
  sp.work_experience as experience,
  sp.desired_shift,
  sp.start_timing,
  sp.photo_1_url,
  sp.photo_2_url,
  sp.full_body_photo_url,
  sp.created_at
from public.seeker_profiles sp
where sp.setup_completed;

revoke all on public.seeker_directory from public;
grant select on public.seeker_directory to anon, authenticated;

drop function if exists public.upsert_demo_seeker(
  text,text,text,integer,text,text,text,text,text,text,text,uuid,text,text
);
drop function if exists public.get_demo_offers(text);
drop function if exists public.get_demo_gacha_state(text);
drop function if exists public.spin_demo_gacha(text,public.ticket_type);

create or replace function public.bootstrap_temporary_user(
  p_line_user_id text,
  p_line_name text default '仮LINEユーザー'
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid;
begin
  if p_line_user_id not like 'temp_%' then
    raise exception 'Invalid temporary LINE user id';
  end if;

  insert into public.users(line_user_id, line_name, role, last_login_at)
  values (p_line_user_id, p_line_name, 'seeker', now())
  on conflict (line_user_id) do update
    set last_login_at = now()
  returning id into v_user_id;

  if not exists (
    select 1 from public.gacha_tickets where user_id = v_user_id
  ) then
    insert into public.gacha_tickets(user_id, ticket_type, source)
    values
      (v_user_id, 'registration_invite', 'admin_grant'),
      (v_user_id, 'registration_invite', 'admin_grant'),
      (v_user_id, 'interview', 'admin_grant');
  end if;

  return jsonb_build_object(
    'user_id', v_user_id,
    'line_user_id', p_line_user_id,
    'temporary', true
  );
end;
$$;

create or replace function public.upsert_temporary_seeker(
  p_line_user_id text,
  p_line_name text,
  p_nickname text,
  p_age integer,
  p_work_experience text,
  p_desired_region text,
  p_desired_area text,
  p_desired_shift text,
  p_start_timing text,
  p_current_region text default null,
  p_current_area text default null,
  p_current_club_id uuid default null,
  p_blocked_club_ids uuid[] default '{}',
  p_current_hourly_range text default null,
  p_current_monthly_sales_range text default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid;
  v_profile_id uuid;
begin
  if p_line_user_id not like 'temp_%' then
    raise exception 'Invalid temporary LINE user id';
  end if;
  if p_age < 19 or p_age > 35 then
    raise exception 'Age must be between 19 and 35';
  end if;
  if p_desired_region not in ('大阪', '東京') then
    raise exception 'Invalid desired region';
  end if;

  perform public.bootstrap_temporary_user(p_line_user_id, p_line_name);

  update public.users
  set line_name = p_line_name, last_login_at = now()
  where line_user_id = p_line_user_id
  returning id into v_user_id;

  insert into public.seeker_profiles (
    user_id, nickname, age, work_experience, desired_region, desired_area,
    desired_shift, start_timing, current_region, current_area, current_club_id,
    blocked_club_ids, current_hourly_range, current_monthly_sales_range,
    invite_code, setup_completed, updated_at
  ) values (
    v_user_id, p_nickname, p_age, p_work_experience, p_desired_region, p_desired_area,
    p_desired_shift, p_start_timing, p_current_region, p_current_area, p_current_club_id,
    coalesce(p_blocked_club_ids, '{}'), p_current_hourly_range,
    p_current_monthly_sales_range,
    'MV-' || upper(substr(replace(v_user_id::text, '-', ''), 1, 8)),
    true, now()
  )
  on conflict (user_id) do update set
    nickname = excluded.nickname,
    age = excluded.age,
    work_experience = excluded.work_experience,
    desired_region = excluded.desired_region,
    desired_area = excluded.desired_area,
    desired_shift = excluded.desired_shift,
    start_timing = excluded.start_timing,
    current_region = excluded.current_region,
    current_area = excluded.current_area,
    current_club_id = excluded.current_club_id,
    blocked_club_ids = excluded.blocked_club_ids,
    current_hourly_range = excluded.current_hourly_range,
    current_monthly_sales_range = excluded.current_monthly_sales_range,
    setup_completed = true,
    updated_at = now()
  returning id into v_profile_id;

  return jsonb_build_object('user_id', v_user_id, 'profile_id', v_profile_id);
end;
$$;

create or replace function public.get_temporary_profile(p_line_user_id text)
returns jsonb
language sql
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'nickname', sp.nickname,
    'age', sp.age,
    'work_experience', sp.work_experience,
    'desired_region', sp.desired_region,
    'desired_area', sp.desired_area,
    'desired_shift', sp.desired_shift,
    'start_timing', sp.start_timing,
    'current_region', sp.current_region,
    'current_area', sp.current_area,
    'current_club', c.display_name,
    'blocked_clubs', coalesce((
      select jsonb_agg(blocked.display_name order by blocked.display_name)
      from public.clubs blocked
      where blocked.id = any(sp.blocked_club_ids)
    ), '[]'::jsonb),
    'current_hourly_range', sp.current_hourly_range,
    'current_monthly_sales_range', sp.current_monthly_sales_range,
    'photo_1_url', sp.photo_1_url,
    'photo_2_url', sp.photo_2_url,
    'full_body_photo_url', sp.full_body_photo_url,
    'invite_code', sp.invite_code
  )
  from public.seeker_profiles sp
  join public.users u on u.id = sp.user_id
  left join public.clubs c on c.id = sp.current_club_id
  where u.line_user_id = p_line_user_id
  limit 1;
$$;

create or replace function public.get_temporary_offers(p_line_user_id text)
returns table(
  id uuid,
  club text,
  area text,
  wage integer,
  period text,
  note text,
  logo text,
  status text
)
language sql
security definer
set search_path = public
as $$
  select
    o.id,
    c.display_name,
    c.area,
    o.hourly_wage,
    o.guarantee_period,
    coalesce(o.comment, ''),
    coalesce(c.logo_url, left(c.display_name, 1)),
    o.status::text
  from public.offers o
  join public.clubs c on c.id = o.club_id
  join public.seeker_profiles sp on sp.id = o.seeker_id
  join public.users u on u.id = sp.user_id
  where u.line_user_id = p_line_user_id
  order by o.created_at desc;
$$;

create or replace function public.get_temporary_gacha_state(p_line_user_id text)
returns jsonb
language sql
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'registration_invite',
      count(*) filter (
        where gt.ticket_type = 'registration_invite' and gt.used_at is null
      ),
    'interview',
      count(*) filter (
        where gt.ticket_type = 'interview' and gt.used_at is null
      ),
    'results',
      coalesce((
        select jsonb_agg(
          jsonb_build_object(
            'name', gi.name,
            'rarity', gi.rarity,
            'description', gi.description,
            'image_url', gi.image_url
          )
          order by gr.created_at desc
        )
        from public.gacha_results gr
        join public.gacha_items gi on gi.id = gr.gacha_item_id
        where gr.user_id = u.id
      ), '[]'::jsonb)
  )
  from public.users u
  left join public.gacha_tickets gt on gt.user_id = u.id
  where u.line_user_id = p_line_user_id
  group by u.id;
$$;

create or replace function public.spin_temporary_gacha(
  p_line_user_id text,
  p_ticket_type public.ticket_type
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid;
  v_ticket public.gacha_tickets;
  v_item public.gacha_items;
  v_roll numeric := random();
  v_threshold numeric := 0;
begin
  if p_line_user_id not like 'temp_%' then
    raise exception 'Invalid temporary LINE user id';
  end if;

  select id into v_user_id
  from public.users
  where line_user_id = p_line_user_id;

  if v_user_id is null then
    raise exception 'Temporary profile not found';
  end if;

  select * into v_ticket
  from public.gacha_tickets
  where user_id = v_user_id
    and ticket_type = p_ticket_type
    and used_at is null
  order by created_at
  limit 1
  for update skip locked;

  if v_ticket.id is null then
    raise exception '利用可能なチケットがありません';
  end if;

  for v_item in
    select *
    from public.gacha_items
    where is_active
      and ticket_type = p_ticket_type
    order by id
  loop
    v_threshold := v_threshold + v_item.probability;
    exit when v_roll <= v_threshold;
  end loop;

  if v_item.id is null then
    select * into v_item
    from public.gacha_items
    where is_active and ticket_type = p_ticket_type
    order by probability desc
    limit 1;
  end if;

  if v_item.id is null then
    raise exception 'ガチャ景品が設定されていません';
  end if;

  update public.gacha_tickets
  set used_at = now()
  where id = v_ticket.id;

  insert into public.gacha_results(user_id, gacha_item_id, ticket_id)
  values (v_user_id, v_item.id, v_ticket.id);

  return jsonb_build_object(
    'name', v_item.name,
    'rarity', v_item.rarity,
    'description', v_item.description,
    'image_url', v_item.image_url
  );
end;
$$;

revoke all on function public.bootstrap_temporary_user(text,text) from public;
revoke all on function public.upsert_temporary_seeker(
  text,text,text,integer,text,text,text,text,text,text,text,uuid,uuid[],text,text
) from public;
revoke all on function public.get_temporary_profile(text) from public;
revoke all on function public.get_temporary_offers(text) from public;
revoke all on function public.get_temporary_gacha_state(text) from public;
revoke all on function public.spin_temporary_gacha(text,public.ticket_type) from public;

grant execute on function public.bootstrap_temporary_user(text,text)
  to anon, authenticated;
grant execute on function public.upsert_temporary_seeker(
  text,text,text,integer,text,text,text,text,text,text,text,uuid,uuid[],text,text
) to anon, authenticated;
grant execute on function public.get_temporary_profile(text)
  to anon, authenticated;
grant execute on function public.get_temporary_offers(text)
  to anon, authenticated;
grant execute on function public.get_temporary_gacha_state(text)
  to anon, authenticated;
grant execute on function public.spin_temporary_gacha(text,public.ticket_type)
  to anon, authenticated;

-- ============================================================================
-- supabase/migrations/202606080002_bubble_import.sql
-- ============================================================================
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

-- ============================================================================
-- supabase/migrations/202606080003_bubble_gacha_import.sql
-- ============================================================================
alter table public.gacha_items
  add column if not exists bubble_id text,
  add column if not exists is_test boolean not null default false,
  add column if not exists bubble_raw jsonb;

alter table public.gacha_tickets
  add column if not exists bubble_id text,
  add column if not exists is_test boolean not null default false,
  add column if not exists bubble_raw jsonb;

alter table public.gacha_results
  add column if not exists bubble_id text,
  add column if not exists is_test boolean not null default false,
  add column if not exists bubble_raw jsonb;

create unique index if not exists gacha_items_bubble_id_idx
  on public.gacha_items(bubble_id);
create unique index if not exists gacha_tickets_bubble_id_idx
  on public.gacha_tickets(bubble_id);
create unique index if not exists gacha_results_bubble_id_idx
  on public.gacha_results(bubble_id);

comment on column public.gacha_items.bubble_id is 'Original Bubble gacha item _id.';
comment on column public.gacha_results.bubble_id is 'Original Bubble gacha result _id.';

-- ============================================================================
-- supabase/migrations/202606080004_admin_data_views.sql
-- ============================================================================
create or replace function public.get_admin_offers()
returns table (
  id uuid,
  bubble_id text,
  club_name text,
  seeker_name text,
  area text,
  hourly_wage integer,
  guarantee_period text,
  comment text,
  status public.offer_status,
  is_test boolean,
  created_at timestamptz
)
language sql
security definer
set search_path = public
as $$
  select
    o.id,
    o.bubble_id,
    c.display_name as club_name,
    sp.nickname as seeker_name,
    c.area,
    o.hourly_wage,
    o.guarantee_period,
    o.comment,
    o.status,
    coalesce(o.is_test, false) as is_test,
    o.created_at
  from public.offers o
  left join public.clubs c on c.id = o.club_id
  left join public.seeker_profiles sp on sp.id = o.seeker_id
  order by o.created_at desc;
$$;

create or replace function public.get_admin_gacha_results()
returns table (
  id uuid,
  bubble_id text,
  user_name text,
  item_name text,
  rarity text,
  used_status public.gacha_use_status,
  is_test boolean,
  created_at timestamptz
)
language sql
security definer
set search_path = public
as $$
  select
    gr.id,
    gr.bubble_id,
    u.line_name as user_name,
    gi.name as item_name,
    gi.rarity,
    gr.used_status,
    coalesce(gr.is_test, false) as is_test,
    gr.created_at
  from public.gacha_results gr
  join public.users u on u.id = gr.user_id
  join public.gacha_items gi on gi.id = gr.gacha_item_id
  order by gr.created_at desc;
$$;

revoke all on function public.get_admin_offers() from public;
revoke all on function public.get_admin_gacha_results() from public;
grant execute on function public.get_admin_offers() to anon, authenticated;
grant execute on function public.get_admin_gacha_results() to anon, authenticated;

-- ============================================================================
-- supabase/seed.sql
-- ============================================================================
insert into public.location_areas(region, area, sort_order)
values
  ('大阪', '北新地', 10),
  ('大阪', 'ミナミ', 20),
  ('東京', '六本木', 30),
  ('東京', '銀座', 40),
  ('東京', '歌舞伎町', 50)
on conflict (region, area) do update set
  sort_order = excluded.sort_order,
  is_active = true;

insert into public.clubs (
  id, display_name, search_name, store_code, business_type,
  region, area, appeal_text
)
select
  ('30000000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid,
  display_name,
  lower(display_name),
  'seedclub' || lpad(n::text, 3, '0'),
  business_type,
  region,
  area,
  appeal_text
from (values
  (1, 'CLUB A', 'キャバクラ', '大阪', '北新地', '北新地で長く愛される上質な空間'),
  (2, 'JUNGLE 北新地', 'キャバクラ', '大阪', '北新地', '経験を活かせる高待遇店'),
  (3, 'MADISON ROUNGE', 'ラウンジ', '大阪', '北新地', '落ち着いた会員制ラウンジ'),
  (4, 'ラピス', 'キャバクラ', '大阪', '北新地', null),
  (5, 'バニラ', 'キャバクラ', '大阪', '北新地', null),
  (6, 'アモン', 'キャバクラ', '大阪', '北新地', null),
  (7, 'アルス', 'キャバクラ', '大阪', '北新地', null),
  (8, 'イリス 北新地', 'キャバクラ', '大阪', '北新地', null),
  (9, 'エルドラド', 'キャバクラ', '大阪', '北新地', null),
  (10, 'アテナ', 'キャバクラ', '大阪', '北新地', null),
  (11, 'ホルス 北新地', 'キャバクラ', '大阪', '北新地', null),
  (12, 'バルゴ 北新地', 'キャバクラ', '大阪', '北新地', null),
  (13, 'タワー', 'キャバクラ', '大阪', '北新地', null),
  (14, 'バベル 北新地', 'キャバクラ', '大阪', '北新地', null),
  (15, 'ビゼ 北新地', 'キャバクラ', '大阪', '北新地', null),
  (16, 'バロンレックス', 'キャバクラ', '大阪', '北新地', null),
  (17, 'バロン 北新地', 'キャバクラ', '大阪', '北新地', null),
  (18, 'アンジュール 北新地', 'キャバクラ', '大阪', '北新地', null),
  (19, 'ランス', 'キャバクラ', '大阪', '北新地', null),
  (20, 'リリス 北新地', 'キャバクラ', '大阪', '北新地', null),
  (21, 'ニルス', 'キャバクラ', '大阪', '北新地', null),
  (22, 'スパロー', 'キャバクラ', '大阪', '北新地', null),
  (23, 'アーチ', 'キャバクラ', '大阪', '北新地', null),
  (24, 'ミュゼルバ ミナミ', 'キャバクラ', '大阪', 'ミナミ', null),
  (25, '美人茶屋 ミナミ', 'キャバクラ', '大阪', 'ミナミ', null),
  (26, 'サーカス', 'キャバクラ', '大阪', 'ミナミ', null),
  (27, 'バルモノ ミナミ', 'キャバクラ', '大阪', 'ミナミ', null),
  (28, 'ネプチューン', 'キャバクラ', '大阪', 'ミナミ', null),
  (29, 'パール ミナミ', 'キャバクラ', '大阪', 'ミナミ', null),
  (30, 'イリス ミナミ', 'キャバクラ', '大阪', 'ミナミ', null),
  (31, 'リリス ミナミ', 'キャバクラ', '大阪', 'ミナミ', null),
  (32, 'アンジュール ミナミ', 'キャバクラ', '大阪', 'ミナミ', null),
  (33, 'アロー', 'キャバクラ', '大阪', 'ミナミ', null),
  (34, 'ファブリック セブン', 'キャバクラ', '東京', '六本木', null),
  (35, 'ファブリック', 'キャバクラ', '東京', '六本木', null),
  (36, 'ミュゼルバ 六本木', 'キャバクラ', '東京', '六本木', null),
  (37, '美人茶屋 六本木', 'キャバクラ', '東京', '六本木', null),
  (38, 'ララァ', 'キャバクラ', '東京', '六本木', null),
  (39, 'ベネ 東京', 'キャバクラ', '東京', '六本木', null),
  (40, 'プリマ 東京', 'キャバクラ', '東京', '六本木', null),
  (41, 'リリック 六本木', 'キャバクラ', '東京', '六本木', null),
  (42, 'ポセイドン 六本木', 'キャバクラ', '東京', '六本木', null),
  (43, 'バロン 東京', 'キャバクラ', '東京', '六本木', null),
  (44, 'アンジュール 東京', 'キャバクラ', '東京', '六本木', null),
  (45, 'リオ 六本木', 'キャバクラ', '東京', '六本木', null),
  (46, 'ジャングル 東京', 'キャバクラ', '東京', '六本木', null)
) as seed(n, display_name, business_type, region, area, appeal_text)
on conflict (id) do update set
  display_name = excluded.display_name,
  search_name = excluded.search_name,
  business_type = excluded.business_type,
  region = excluded.region,
  area = excluded.area,
  appeal_text = excluded.appeal_text,
  is_active = true;

insert into public.users(id, line_user_id, line_name, role)
values
  ('20000000-0000-0000-0000-000000000001', 'seed_club_a', 'CLUB A担当', 'club_staff'),
  ('20000000-0000-0000-0000-000000000002', 'seed_jungle', 'JUNGLE担当', 'club_staff'),
  ('20000000-0000-0000-0000-000000000003', 'seed_madison', 'MADISON担当', 'club_staff')
on conflict (line_user_id) do update set line_name = excluded.line_name;

insert into public.club_staffs(id, user_id, club_id, staff_name)
values
  ('50000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', '山下'),
  ('50000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000002', '30000000-0000-0000-0000-000000000002', '田中'),
  ('50000000-0000-0000-0000-000000000003', '20000000-0000-0000-0000-000000000003', '30000000-0000-0000-0000-000000000003', '佐藤')
on conflict (id) do update set
  club_id = excluded.club_id,
  staff_name = excluded.staff_name;

insert into public.users(id, line_user_id, line_name, role)
select
  ('10000000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid,
  'seed_' || lower(name),
  name,
  'seeker'::public.user_role
from (values
  (1, 'Aimi'), (2, 'Yuka'), (3, 'Hikaru'),
  (4, 'Mio'), (5, 'Rena'), (6, 'Noa')
) as seed(n, name)
on conflict (line_user_id) do update set line_name = excluded.line_name;

insert into public.seeker_profiles(
  id, user_id, nickname, age, work_experience, desired_region, desired_area,
  desired_shift, start_timing, invite_code, setup_completed
)
select
  ('40000000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid,
  ('10000000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid,
  name, age, experience, region, area, shift, '良いお店があれば',
  'MV-SEED-' || n, true
from (values
  (1, 'Aimi', 23, '未経験', '大阪', '北新地', '週3〜4'),
  (2, 'Yuka', 27, '2年以上', '大阪', '北新地', '週4〜5'),
  (3, 'Hikaru', 30, '2年以上', '東京', '六本木', '週5以上'),
  (4, 'Mio', 22, '1年〜2年', '大阪', 'ミナミ', '週3〜4'),
  (5, 'Rena', 25, '半年〜1年', '東京', '銀座', '週4〜5'),
  (6, 'Noa', 24, '2年以上', '東京', '歌舞伎町', '検討中')
) as seed(n, name, age, experience, region, area, shift)
on conflict (id) do update set
  nickname = excluded.nickname,
  age = excluded.age,
  work_experience = excluded.work_experience,
  desired_region = excluded.desired_region,
  desired_area = excluded.desired_area,
  desired_shift = excluded.desired_shift,
  setup_completed = true;

insert into public.gacha_items(
  id, ticket_type, name, rarity, probability, description
)
values
  ('70000000-0000-0000-0000-000000000001', 'registration_invite', 'セットサロン無料券', 'SR', 0.51000, 'ALIS 北新地店で利用できます'),
  ('70000000-0000-0000-0000-000000000002', 'registration_invite', 'ピラティス体験券', 'SR', 0.09000, '提携スタジオの体験チケット'),
  ('70000000-0000-0000-0000-000000000003', 'registration_invite', 'コーラ', 'R', 0.37000, '担当者と日程調整のうえ受け取れます'),
  ('70000000-0000-0000-0000-000000000004', 'registration_invite', 'SOUMEI', 'SSR', 0.02500, '担当者と日程調整のうえ利用できます'),
  ('70000000-0000-0000-0000-000000000005', 'registration_invite', 'SOUMEI BLUE', 'UR', 0.00500, '特別な日に楽しめるプレミアムシャンパン'),
  ('70000000-0000-0000-0000-000000000101', 'interview', '面接後 コーラ', 'R', 0.70000, '面接後に担当者から受け取れます'),
  ('70000000-0000-0000-0000-000000000102', 'interview', '面接後 セットサロン無料券', 'SR', 0.20000, 'ALIS 北新地店で利用できます'),
  ('70000000-0000-0000-0000-000000000103', 'interview', '面接後 SOUMEI', 'SSR', 0.09000, '面接後限定のプレミアム特典です'),
  ('70000000-0000-0000-0000-000000000104', 'interview', '面接後 SOUMEI BLUE', 'UR', 0.01000, '面接後限定の最高レア特典です')
on conflict (ticket_type, name) do update set
  rarity = excluded.rarity,
  probability = excluded.probability,
  description = excluded.description,
  is_active = true;

insert into public.offers(
  id, seeker_id, club_id, staff_id, hourly_wage,
  guarantee_period, comment, status
)
values
  ('60000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', '50000000-0000-0000-0000-000000000001', 20000, '3ヶ月', 'ぜひ一度お話ししたいです', 'sent'),
  ('60000000-0000-0000-0000-000000000002', '40000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000002', '50000000-0000-0000-0000-000000000002', 18000, '4ヶ月', '経験を活かせる環境です', 'interested'),
  ('60000000-0000-0000-0000-000000000003', '40000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000003', '50000000-0000-0000-0000-000000000003', 15000, '3ヶ月', '体験入店から歓迎します', 'rejected')
on conflict (id) do update set
  hourly_wage = excluded.hourly_wage,
  guarantee_period = excluded.guarantee_period,
  comment = excluded.comment,
  status = excluded.status;

commit;

select 'clubs' as object_name, count(*)::bigint as row_count from public.clubs
union all select 'users', count(*)::bigint from public.users
union all select 'offers', count(*)::bigint from public.offers
union all select 'offer_responses', count(*)::bigint from public.offer_responses
union all select 'gacha_items', count(*)::bigint from public.gacha_items
union all select 'location_areas', count(*)::bigint from public.location_areas
order by object_name;
