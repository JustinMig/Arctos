
-- Athena's Medicare: separate records from the existing Medicare Reviews.
-- All content remains restricted to CRM staff with access to the related client.
create table if not exists public.athena_medicare_reviews (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  created_by uuid not null default auth.uid() references auth.users(id),
  full_name text not null check (length(btrim(full_name)) between 2 and 240),
  review_kind text not null check (review_kind in ('new_intake','annual_review')),
  workflow_status text not null default 'draft'
    check (workflow_status in ('draft','follow_up','completed')),
  review_date date,
  next_contact_date date,
  form_data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint athena_form_object check (jsonb_typeof(form_data) = 'object'),
  constraint athena_no_payment_or_id_json check (
    not (form_data ?| array['ssn','medicare_number','medicaid_number',
      'card_number','cvv','bank_account','bank_routing','routing_number','account_number'])
  )
);
create index if not exists athena_reviews_client_idx on public.athena_medicare_reviews(client_id,updated_at desc);
create index if not exists athena_reviews_updated_idx on public.athena_medicare_reviews(updated_at desc);
alter table public.athena_medicare_reviews enable row level security;
create policy athena_reviews_select on public.athena_medicare_reviews
  for select to authenticated
  using (private.mig_can_access_client(client_id));
create policy athena_reviews_insert on public.athena_medicare_reviews
  for insert to authenticated
  with check (created_by = (select auth.uid()) and private.mig_can_access_client(client_id));
create policy athena_reviews_update on public.athena_medicare_reviews
  for update to authenticated
  using (private.mig_can_access_client(client_id))
  with check (private.mig_can_access_client(client_id));
create policy athena_reviews_delete on public.athena_medicare_reviews
  for delete to authenticated
  using (private.mig_can_access_client(client_id));
-- Column-scoped updates keep the original audit owner immutable.
revoke all on public.athena_medicare_reviews from anon, authenticated;
grant select, insert, delete on public.athena_medicare_reviews to authenticated;
grant update (full_name,review_kind,workflow_status,review_date,next_contact_date,form_data,updated_at)
  on public.athena_medicare_reviews to authenticated;
