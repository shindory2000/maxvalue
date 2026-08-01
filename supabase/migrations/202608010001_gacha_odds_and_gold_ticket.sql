update public.gacha_items
set probability = case
  when ticket_type = 'registration_invite' and name = 'コーラ' then 0.39000
  when ticket_type = 'registration_invite' and name = 'SOUMEI' then 0.01000
  when ticket_type = 'registration_invite' and name = 'SOUMEI BLUE' then 0.00000
  when ticket_type = 'interview' and name like '%コーラ%' then 0.79000
  when ticket_type = 'interview' and name like '%SOUMEI BLUE%' then 0.00000
  when ticket_type = 'interview' and name like '%SOUMEI%' then 0.01000
  else probability
end,
description = case
  when name like '%SOUMEI BLUE%' then '現在は排出停止中です'
  when ticket_type = 'interview' and name like '%SOUMEI%' then 'ゴールドチケット限定のプレミアム特典です'
  else description
end
where ticket_type in ('registration_invite', 'interview');
