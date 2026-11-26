-- Match current assignments and the same U.S. phone formats accepted by Office.
create index if not exists crm_sms_client_phone_idx on public.clients
 (assigned_agent_id, (right(regexp_replace(coalesce(phone,''), '[^0-9]', '', 'g'),10)));

create or replace function public.crm_sms_phone_candidates(p_agent uuid, p_phones text[])
returns table(id uuid,first_name text,last_name text,phone text) language sql stable security invoker set search_path = '' as $$
 select c.id,c.first_name,c.last_name,c.phone from public.clients c
 where c.assigned_agent_id=p_agent
   and exists(select 1 from unnest(p_phones) p(phone)
     where p.phone ~ '^\+1[0-9]{10}$'
       and right(regexp_replace(coalesce(c.phone,''),'[^0-9]','','g'),10)=right(p.phone,10)
       and regexp_replace(coalesce(c.phone,''),'[^0-9]','','g') in (right(p.phone,10),right(p.phone,11)))
$$;
revoke all on function public.crm_sms_phone_candidates(uuid,text[]) from public,anon,authenticated;
grant execute on function public.crm_sms_phone_candidates(uuid,text[]) to service_role;
