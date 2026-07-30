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
