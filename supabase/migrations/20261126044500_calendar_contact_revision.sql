-- Day cards use these contact fields, and the cross-CRM calendar matches by phone.
alter table private.arctos_calendar_clock
  add column contact_revision bigint not null default 0;

create function private.advance_arctos_calendar_contacts()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  update private.arctos_calendar_clock
     set revision = revision + 1, contact_revision = contact_revision + 1
   where singleton;
  return null;
end;
$$;
revoke all on function private.advance_arctos_calendar_contacts() from public, anon, authenticated;

create trigger arctos_calendar_contact_membership after insert or delete or truncate on public.clients
for each statement execute function private.advance_arctos_calendar_contacts();
create trigger arctos_calendar_contact_fields
after update of id, first_name, last_name, phone, email, assigned_agent_id on public.clients
for each statement execute function private.advance_arctos_calendar_contacts();

create function public.arctos_calendar_state()
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'revision', public.arctos_calendar_revision(),
    'contactRevision', c.contact_revision::text
  ) from private.arctos_calendar_clock c where c.singleton
$$;
revoke all on function public.arctos_calendar_state() from public, anon, authenticated;
grant execute on function public.arctos_calendar_state() to authenticated;
