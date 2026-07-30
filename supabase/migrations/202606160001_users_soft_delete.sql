alter table public.users
  add column if not exists is_deleted boolean not null default false,
  add column if not exists deleted_at timestamptz;

create index if not exists users_is_deleted_idx
  on public.users (is_deleted);
