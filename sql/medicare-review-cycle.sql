-- September starts the new annual review season. Keep historical rows intact;
-- the new season naturally starts unchecked, even when nobody has the CRM open.
create or replace function public.medicare_review_cycle_year(p_at timestamptz default now())
returns integer language sql stable security invoker set search_path = '' as $$
  select extract(year from (p_at at time zone 'America/Chicago'))::integer
    - case when extract(month from (p_at at time zone 'America/Chicago')) < 9 then 1 else 0 end
$$;

create or replace function public.client_medicare_reviews_current_cycle()
returns table(id uuid, first_name text, last_name text, phone text,
  assigned_agent_id uuid, status text, review_year integer, completed_at timestamptz)
language sql stable security invoker set search_path = '' as $$
  select c.id, c.first_name, c.last_name, c.phone, c.assigned_agent_id,
    c.status, r.review_year, r.completed_at
  from public.clients c
  join public.client_review_manual r on r.client_id = c.id
  where private.is_active_crm_user() is true
    and (private.is_crm_admin() is true or c.assigned_agent_id = auth.uid())
    and c.status is distinct from 'deceased'
    and r.completed is true
    and r.review_year = public.medicare_review_cycle_year()
  order by lower(c.last_name), lower(c.first_name), c.id
$$;

create or replace function public.client_medicare_review_status(p_client_id uuid)
returns jsonb language plpgsql stable security invoker set search_path = '' as $$
declare v_year integer := public.medicare_review_cycle_year(); v_completed boolean;
begin
  if not exists (
    select 1 from public.clients c where c.id = p_client_id
      and private.is_active_crm_user() is true
      and (private.is_crm_admin() is true or c.assigned_agent_id = auth.uid())
  ) then
    raise exception 'Client is not available to this account.' using errcode = '42501';
  end if;
  select r.completed into v_completed from public.client_review_manual r
    where r.client_id = p_client_id and r.review_year = v_year;
  return jsonb_build_object('review_year', v_year, 'completed', coalesce(v_completed, false));
end
$$;

create or replace function public.set_client_medicare_review_completed(
  p_client_id uuid, p_review_year integer, p_completed boolean)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare v_year integer := public.medicare_review_cycle_year();
begin
  if p_review_year is distinct from v_year then
    raise exception 'The September review season changed. Reopen the client record and try again.';
  end if;
  if p_completed is null then raise exception 'A completion value is required.'; end if;
  if auth.uid() is null or not exists (
    select 1 from public.clients c where c.id = p_client_id
      and private.is_active_crm_user() is true
      and (private.is_crm_admin() is true or c.assigned_agent_id = auth.uid())
  ) then
    raise exception 'Client is not available to this account.' using errcode = '42501';
  end if;
  insert into public.client_review_manual(client_id, review_year, completed, completed_at, updated_by)
    values(p_client_id, v_year, p_completed, case when p_completed then now() else null end, auth.uid())
  on conflict(client_id, review_year) do update
    set completed = excluded.completed, completed_at = excluded.completed_at, updated_by = excluded.updated_by;
  return jsonb_build_object('review_year', v_year, 'completed', p_completed);
end
$$;

revoke all on function public.medicare_review_cycle_year(timestamptz) from public, anon;
revoke all on function public.client_medicare_reviews_current_cycle() from public, anon;
revoke all on function public.client_medicare_review_status(uuid) from public, anon;
revoke all on function public.set_client_medicare_review_completed(uuid, integer, boolean) from public, anon;
grant execute on function public.medicare_review_cycle_year(timestamptz) to authenticated;
grant execute on function public.client_medicare_reviews_current_cycle() to authenticated;
grant execute on function public.client_medicare_review_status(uuid) to authenticated;
grant execute on function public.set_client_medicare_review_completed(uuid, integer, boolean) to authenticated;
