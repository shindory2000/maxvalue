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
