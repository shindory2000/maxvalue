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
