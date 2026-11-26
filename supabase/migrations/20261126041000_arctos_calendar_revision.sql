-- A committed change to any part of an appointment invalidates the calendar.
create schema if not exists private;
create table private.arctos_calendar_clock (
  singleton boolean primary key check (singleton),
  revision bigint not null
);
alter table private.arctos_calendar_clock enable row level security;
revoke all on private.arctos_calendar_clock from public, anon, authenticated;
insert into private.arctos_calendar_clock values (true, 0);

create function private.advance_arctos_calendar_clock()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  update private.arctos_calendar_clock set revision = revision + 1 where singleton;
  return null;
end;
$$;
revoke all on function private.advance_arctos_calendar_clock() from public, anon, authenticated;

create trigger arctos_calendar_changed after insert or update or delete or truncate on public.appointments
for each statement execute function private.advance_arctos_calendar_clock();
create trigger arctos_calendar_changed after insert or update or delete or truncate on public.calendar_event_details
for each statement execute function private.advance_arctos_calendar_clock();
create trigger arctos_calendar_changed after insert or update or delete or truncate on public.calendar_event_client_links
for each statement execute function private.advance_arctos_calendar_clock();

create function public.arctos_calendar_revision()
returns text language plpgsql stable security definer set search_path = '' as $$
begin
  if not exists (
    select 1 from public.profiles where id = (select auth.uid()) and active and role in ('owner','admin')
  ) then
    raise exception 'Active calendar administrator required' using errcode = '42501';
  end if;
  return (select revision::text from private.arctos_calendar_clock where singleton);
end;
$$;
revoke all on function public.arctos_calendar_revision() from public, anon, authenticated;
grant execute on function public.arctos_calendar_revision() to authenticated;
