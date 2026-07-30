-- MAXVALUE sales management tables
-- Run in Supabase SQL Editor before using the admin sales screen.

begin;

create extension if not exists pgcrypto;

create table if not exists public.sales_visits (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by text,
  assigned_staff_id uuid references public.users(id),
  assigned_staff_name text,
  companion_staff_name text,
  club_id uuid references public.clubs(id),
  seeker_id uuid references public.seeker_profiles(id),
  bubble_id text unique,
  bubble_raw jsonb,
  visit_purpose text not null default '',
  visit_date date,
  budget integer not null default 0,
  memo text,
  result_saved boolean not null default false
);

create table if not exists public.sales_visit_results (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by text,
  assigned_staff_id uuid references public.users(id),
  club_id uuid references public.clubs(id),
  seeker_id uuid references public.seeker_profiles(id),
  bubble_id text unique,
  bubble_raw jsonb,
  sales_visit_id uuid references public.sales_visits(id) on delete set null,
  expected_hires integer not null default 0,
  actual_cost integer not null default 0,
  is_free_new_sales boolean not null default false,
  follow_up_enabled boolean not null default false,
  receipt_url text
);

create table if not exists public.sales_leads (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by text,
  assigned_staff_id uuid references public.users(id),
  assigned_staff_name text,
  club_id uuid references public.clubs(id),
  seeker_id uuid references public.seeker_profiles(id),
  bubble_id text unique,
  bubble_raw jsonb,
  name text not null default '',
  age integer,
  rank text,
  potential text,
  scout_status text,
  next_action text,
  last_contact_at timestamptz
);

create table if not exists public.sales_result_people (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by text,
  assigned_staff_id uuid references public.users(id),
  club_id uuid references public.clubs(id),
  seeker_id uuid references public.seeker_profiles(id),
  bubble_id text unique,
  bubble_raw jsonb,
  sales_visit_result_id uuid references public.sales_visit_results(id) on delete cascade,
  name text not null default '',
  age integer,
  scout_status text,
  rank text,
  vision text,
  potential text,
  next_action text,
  offer_club_id uuid references public.clubs(id),
  guarantee_period text,
  memo text
);

create table if not exists public.sales_receipts (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by text,
  assigned_staff_id uuid references public.users(id),
  club_id uuid references public.clubs(id),
  seeker_id uuid references public.seeker_profiles(id),
  bubble_id text unique,
  bubble_raw jsonb,
  sales_visit_result_id uuid references public.sales_visit_results(id) on delete cascade,
  file_url text not null,
  amount integer
);

create index if not exists sales_visits_visit_date_idx on public.sales_visits(visit_date desc);
create index if not exists sales_visits_club_idx on public.sales_visits(club_id);
create index if not exists sales_leads_club_idx on public.sales_leads(club_id);
create index if not exists sales_leads_seeker_idx on public.sales_leads(seeker_id);
create index if not exists sales_result_people_result_idx on public.sales_result_people(sales_visit_result_id);

alter table public.sales_visits enable row level security;
alter table public.sales_visit_results enable row level security;
alter table public.sales_leads enable row level security;
alter table public.sales_result_people enable row level security;
alter table public.sales_receipts enable row level security;

drop policy if exists "admin api sales_visits all" on public.sales_visits;
create policy "admin api sales_visits all" on public.sales_visits for all to anon, authenticated using (true) with check (true);
drop policy if exists "admin api sales_visit_results all" on public.sales_visit_results;
create policy "admin api sales_visit_results all" on public.sales_visit_results for all to anon, authenticated using (true) with check (true);
drop policy if exists "admin api sales_leads all" on public.sales_leads;
create policy "admin api sales_leads all" on public.sales_leads for all to anon, authenticated using (true) with check (true);
drop policy if exists "admin api sales_result_people all" on public.sales_result_people;
create policy "admin api sales_result_people all" on public.sales_result_people for all to anon, authenticated using (true) with check (true);
drop policy if exists "admin api sales_receipts all" on public.sales_receipts;
create policy "admin api sales_receipts all" on public.sales_receipts for all to anon, authenticated using (true) with check (true);

commit;
