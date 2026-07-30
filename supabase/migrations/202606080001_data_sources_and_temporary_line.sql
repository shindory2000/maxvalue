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
