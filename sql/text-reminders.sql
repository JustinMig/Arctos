create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;

create table public.arctos_reminder_phone (
 user_id uuid primary key references auth.users(id) on delete cascade,
 phone text not null check (phone ~ '^\+1[0-9]{10}$'),
 generation uuid not null default gen_random_uuid(),
 link_code text, requested_at timestamptz not null default now(),
 verified_at timestamptz, checked_at timestamptz
);
create table public.arctos_reminder_receipts (sid text primary key);
create table public.arctos_reminder_ticks (token uuid primary key, expires_at timestamptz not null);
alter table public.arctos_reminder_phone enable row level security;
alter table public.arctos_reminder_receipts enable row level security;
alter table public.arctos_reminder_ticks enable row level security;
revoke all on public.arctos_reminder_phone, public.arctos_reminder_receipts, public.arctos_reminder_ticks from public, anon, authenticated;
grant select, insert, update, delete on public.arctos_reminder_phone, public.arctos_reminder_receipts, public.arctos_reminder_ticks to service_role;
alter table public.dashboard_todos drop constraint dashboard_todos_description_check,
 add constraint dashboard_todos_description_check check(char_length(description) between 1 and 1600);

create function public.arctos_take_reminder_tick(p_token uuid) returns boolean
language sql set search_path='' as $$
 with consumed as (delete from public.arctos_reminder_ticks where token=p_token and expires_at>now() returning token)
 select exists(select 1 from consumed)
$$;

create function public.arctos_apply_reminder_messages(p_generation uuid,p_items jsonb,p_checked_at timestamptz) returns void
language plpgsql set search_path='' as $$
declare settings public.arctos_reminder_phone; item jsonb; sent timestamptz;
begin
 select s.* into settings from public.arctos_reminder_phone s
 join public.profiles p on p.id=s.user_id and p.active
 where s.generation=p_generation for update of s;
 if not found then return; end if;
 for item in select value from jsonb_array_elements(p_items) order by (value->>'sent')::timestamptz, (value->>'kind'='link') desc loop
  sent:=(item->>'sent')::timestamptz;
  if sent < date_trunc('second',settings.requested_at) then continue; end if;
  if item->>'kind'='link' and settings.verified_at is null and sent <= settings.requested_at+interval '15 minutes' and item->>'code'=settings.link_code then
   settings.verified_at:=sent;
   update public.arctos_reminder_phone set verified_at=sent,link_code=null where generation=p_generation;
  elsif item->>'kind'='note' and settings.verified_at is not null and sent>=settings.verified_at then
   insert into public.arctos_reminder_receipts(sid) values(item->>'sid') on conflict do nothing;
   if found then insert into public.dashboard_todos(user_id,description,created_at) values(settings.user_id,item->>'description',sent); end if;
  end if;
 end loop;
 update public.arctos_reminder_phone set checked_at=greatest(checked_at,p_checked_at) where generation=p_generation;
end $$;
revoke all on function public.arctos_take_reminder_tick(uuid), public.arctos_apply_reminder_messages(uuid,jsonb,timestamptz) from public, anon, authenticated;
grant execute on function public.arctos_take_reminder_tick(uuid), public.arctos_apply_reminder_messages(uuid,jsonb,timestamptz) to service_role;

select cron.schedule('arctos-text-reminders','* * * * *',$job$
 delete from public.arctos_reminder_ticks where expires_at<now();
 with ticket as (
  insert into public.arctos_reminder_ticks(token,expires_at)
  select gen_random_uuid(),now()+interval '90 seconds' where exists(
   select 1 from public.arctos_reminder_phone s join public.profiles p on p.id=s.user_id and p.active
   where s.verified_at is not null or s.requested_at>now()-interval '17 minutes')
  returning token
 )
 select net.http_post(url:='https://mh.mayerig.com/api/text-reminders',headers:=jsonb_build_object('Content-Type','application/json','X-Reminder-Tick',token),body:='{}'::jsonb,timeout_milliseconds:=45000) from ticket;
$job$);
