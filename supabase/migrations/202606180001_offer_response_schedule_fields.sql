alter table public.offer_responses
  add column if not exists response_status text,
  add column if not exists next_action text,
  add column if not exists selected_date date,
  add column if not exists offered_hourly_wage integer,
  add column if not exists response_source text;

create index if not exists offer_responses_offer_id_idx
  on public.offer_responses (offer_id);

create index if not exists offer_responses_seeker_id_idx
  on public.offer_responses (seeker_id);

create index if not exists offer_responses_response_status_idx
  on public.offer_responses (response_status);
