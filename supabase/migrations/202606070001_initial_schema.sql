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

create or replace function public.upsert_demo_seeker(
  p_line_user_id text, p_line_name text, p_nickname text, p_age integer,
  p_work_experience text, p_desired_region text, p_desired_area text,
  p_desired_shift text, p_start_timing text, p_current_region text default null,
  p_current_area text default null, p_current_club_id uuid default null,
  p_current_hourly_range text default null, p_current_monthly_sales_range text default null
) returns jsonb
language plpgsql security definer set search_path = public
as $$
declare v_user_id uuid; v_profile_id uuid; v_was_new boolean := false;
begin
  if p_line_user_id not like 'demo_%' then raise exception 'Invalid temporary LINE user id'; end if;
  if p_age < 19 or p_age > 35 then raise exception 'Age must be between 19 and 35'; end if;

  insert into public.users(line_user_id, line_name, role, last_login_at)
  values (p_line_user_id, p_line_name, 'seeker', now())
  on conflict (line_user_id) do update set line_name = excluded.line_name, last_login_at = now()
  returning id into v_user_id;

  select id into v_profile_id from public.seeker_profiles where user_id = v_user_id;
  v_was_new := v_profile_id is null;
  insert into public.seeker_profiles (
    user_id, nickname, age, work_experience, desired_region, desired_area,
    desired_shift, start_timing, current_region, current_area, current_club_id,
    current_hourly_range, current_monthly_sales_range, invite_code, setup_completed, updated_at
  ) values (
    v_user_id, p_nickname, p_age, p_work_experience, p_desired_region, p_desired_area,
    p_desired_shift, p_start_timing, p_current_region, p_current_area, p_current_club_id,
    p_current_hourly_range, p_current_monthly_sales_range,
    'MV-' || upper(substr(replace(v_user_id::text, '-', ''), 1, 8)), true, now()
  )
  on conflict (user_id) do update set
    nickname = excluded.nickname, age = excluded.age, work_experience = excluded.work_experience,
    desired_region = excluded.desired_region, desired_area = excluded.desired_area,
    desired_shift = excluded.desired_shift, start_timing = excluded.start_timing,
    current_region = excluded.current_region, current_area = excluded.current_area,
    current_club_id = excluded.current_club_id, current_hourly_range = excluded.current_hourly_range,
    current_monthly_sales_range = excluded.current_monthly_sales_range,
    setup_completed = true, updated_at = now()
  returning id into v_profile_id;

  if v_was_new then
    insert into public.gacha_tickets(user_id, ticket_type, source)
    values (v_user_id, 'registration_invite', 'registration'), (v_user_id, 'registration_invite', 'invite'), (v_user_id, 'interview', 'admin_grant');
    insert into public.offers(seeker_id, club_id, staff_id, hourly_wage, guarantee_period, comment)
    values
      (v_profile_id, '30000000-0000-0000-0000-000000000001', '50000000-0000-0000-0000-000000000001', 20000, '3ヶ月', 'ぜひ一度お話ししたいです'),
      (v_profile_id, '30000000-0000-0000-0000-000000000002', '50000000-0000-0000-0000-000000000002', 18000, '4ヶ月', '経験を活かせる環境です'),
      (v_profile_id, '30000000-0000-0000-0000-000000000003', '50000000-0000-0000-0000-000000000003', 15000, '3ヶ月', '体験入店から歓迎します');
  end if;
  return jsonb_build_object('user_id', v_user_id, 'profile_id', v_profile_id);
end;
$$;

create or replace function public.get_demo_offers(p_line_user_id text)
returns table(id uuid, club text, area text, wage integer, period text, note text, logo text, status text)
language sql security definer set search_path = public
as $$
  select o.id, c.display_name, c.area, o.hourly_wage, o.guarantee_period,
    coalesce(o.comment, ''), left(c.display_name, 1), o.status::text
  from public.offers o
  join public.clubs c on c.id = o.club_id
  join public.seeker_profiles sp on sp.id = o.seeker_id
  join public.users u on u.id = sp.user_id
  where u.line_user_id = p_line_user_id
  order by o.created_at desc;
$$;

create or replace function public.get_demo_gacha_state(p_line_user_id text)
returns jsonb language sql security definer set search_path = public
as $$
  select jsonb_build_object(
    'registration_invite', count(*) filter (where gt.ticket_type = 'registration_invite' and gt.used_at is null),
    'interview', count(*) filter (where gt.ticket_type = 'interview' and gt.used_at is null),
    'results', coalesce((
      select jsonb_agg(jsonb_build_object('name', gi.name, 'rarity', gi.rarity, 'description', gi.description, 'image_url', gi.image_url) order by gr.created_at desc)
      from public.gacha_results gr join public.gacha_items gi on gi.id = gr.gacha_item_id
      where gr.user_id = u.id
    ), '[]'::jsonb)
  )
  from public.users u left join public.gacha_tickets gt on gt.user_id = u.id
  where u.line_user_id = p_line_user_id group by u.id;
$$;

create or replace function public.spin_demo_gacha(p_line_user_id text, p_ticket_type public.ticket_type)
returns jsonb language plpgsql security definer set search_path = public
as $$
declare v_user_id uuid; v_ticket public.gacha_tickets; v_item public.gacha_items; v_roll numeric := random();
begin
  select id into v_user_id from public.users where line_user_id = p_line_user_id;
  if v_user_id is null then raise exception 'Profile not found'; end if;
  select * into v_ticket from public.gacha_tickets
    where user_id = v_user_id and ticket_type = p_ticket_type and used_at is null
    order by created_at limit 1 for update skip locked;
  if v_ticket.id is null then raise exception '利用可能なチケットがありません'; end if;
  select item into v_item from (
    select gi as item, sum(gi.probability) over (order by gi.id) as threshold
    from public.gacha_items gi where gi.is_active
  ) weighted where v_roll <= threshold order by threshold limit 1;
  if v_item.id is null then select * into v_item from public.gacha_items where is_active order by probability desc limit 1; end if;
  update public.gacha_tickets set used_at = now() where id = v_ticket.id;
  insert into public.gacha_results(user_id, gacha_item_id, ticket_id) values (v_user_id, v_item.id, v_ticket.id);
  return jsonb_build_object('name', v_item.name, 'rarity', v_item.rarity, 'description', v_item.description, 'image_url', v_item.image_url);
end;
$$;

revoke all on function public.upsert_demo_seeker(text,text,text,integer,text,text,text,text,text,text,text,uuid,text,text) from public;
revoke all on function public.get_demo_offers(text) from public;
revoke all on function public.get_demo_gacha_state(text) from public;
revoke all on function public.spin_demo_gacha(text,public.ticket_type) from public;
grant execute on function public.upsert_demo_seeker(text,text,text,integer,text,text,text,text,text,text,text,uuid,text,text) to anon, authenticated;
grant execute on function public.get_demo_offers(text) to anon, authenticated;
grant execute on function public.get_demo_gacha_state(text) to anon, authenticated;
grant execute on function public.spin_demo_gacha(text,public.ticket_type) to anon, authenticated;
