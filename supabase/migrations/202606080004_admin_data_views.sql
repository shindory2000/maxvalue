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
