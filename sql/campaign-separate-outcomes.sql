alter table public.campaign_members drop constraint campaign_members_contact_status_check;
alter table public.campaign_members add constraint campaign_members_contact_status_check check(contact_status in ('not_contacted','busy','no_answer','voicemail','declined','appointment','follow_up','face_to_face','completed'));
alter table public.campaign_contact_log drop constraint campaign_contact_log_outcome_check;
alter table public.campaign_contact_log add constraint campaign_contact_log_outcome_check check(outcome in ('busy','no_answer','voicemail','declined','appointment','follow_up','face_to_face','completed','return_step1','note'));
CREATE OR REPLACE FUNCTION public.campaign_record_contact(p_member_id uuid, p_operation_id uuid, p_expected_version integer, p_outcome text, p_note text DEFAULT ''::text, p_next_action text DEFAULT ''::text, p_event_date date DEFAULT NULL::date, p_start_time time without time zone DEFAULT NULL::time without time zone, p_duration_minutes integer DEFAULT 30, p_agent_id uuid DEFAULT NULL::uuid, p_replace_event boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare m public.campaign_members%rowtype;c public.campaigns%rowtype;person public.clients%rowtype;prior public.campaign_contact_log%rowtype;event_id uuid;target_agent uuid;finish timestamp;
begin
 if auth.uid() is null or not private.is_active_crm_user() then raise exception 'Sign in with an active CRM account.' using errcode='42501'; end if;
 select * into m from public.campaign_members where id=p_member_id for update;
 if not found then raise exception 'Campaign client not found or access denied.' using errcode='42501'; end if;
 select * into c from public.campaigns where id=m.campaign_id;
 if not found or c.status<>'active' then raise exception 'Reopen this campaign before recording contact.'; end if;
 if not (private.is_crm_admin() or c.assigned_agent_id=auth.uid()) or (private.mig_can_access_client(m.client_id) IS DISTINCT FROM TRUE) then
   raise exception 'You do not have permission to update this campaign client.' using errcode='42501';
 end if;
 select * into prior from public.campaign_contact_log where id=p_operation_id;
 if found then
  if prior.member_id<>m.id then raise exception 'This update identifier was already used.'; end if;
  return jsonb_build_object('saved',true,'already_saved',true,'event_id',prior.appointment_id,'member_id',m.id);
 end if;
 if p_operation_id is null then raise exception 'An update identifier is required.'; end if;
 select * into c from public.campaigns where id=m.campaign_id;
 if c.status<>'active' then raise exception 'Reopen this campaign before recording contact.'; end if;
 select * into person from public.clients where id=m.client_id;
 if not found or person.status='deceased' then raise exception 'Contact is disabled for a deceased or unavailable client.'; end if;
 if p_expected_version is null or m.version<>p_expected_version then raise exception 'This campaign client was updated in another session. Refresh the campaign and try again.' using errcode='40001'; end if;
 if p_outcome is null or p_outcome not in('busy','no_answer','voicemail','declined','appointment','follow_up','face_to_face','completed') then raise exception 'Choose a valid contact result.'; end if;
 if length(coalesce(p_note,''))>4000 or length(coalesce(p_next_action,''))>500 then raise exception 'The notes or next action are too long.'; end if;
 if p_outcome in('appointment','follow_up') then
  if p_event_date is null or p_start_time is null then raise exception 'Choose a valid date and appointment time.'; end if;
  if p_event_date<(now() at time zone 'America/Chicago')::date then raise exception 'Choose today or a future date.'; end if;
  if p_duration_minutes is null or p_duration_minutes not in(15,30,45,60,90,120) then raise exception 'Choose a valid duration.'; end if;
  finish:=p_event_date+p_start_time+make_interval(mins=>p_duration_minutes);
  if finish::date<>p_event_date then raise exception 'The appointment must end on the selected day.'; end if;
  target_agent:=coalesce(p_agent_id,c.assigned_agent_id);
  if target_agent<>c.assigned_agent_id and target_agent<>auth.uid() and not private.is_crm_admin() then raise exception 'You cannot book another agent calendar.' using errcode='42501'; end if;
  if not exists(select 1 from public.profiles where id=target_agent and active) then raise exception 'Choose an active agent.'; end if;
  if p_replace_event and m.next_event_id is not null then update public.appointments set status='cancelled' where id=m.next_event_id and client_id=m.client_id and status='scheduled'; end if;
  insert into public.appointments(client_id,assigned_agent_id,title,event_type,event_date,start_time,end_time,status,notes) values(m.client_id,target_agent,(case when p_outcome='follow_up' then 'Follow Up: ' else 'Appointment: ' end)||btrim(concat_ws(' ',person.first_name,person.last_name)),case when p_outcome='follow_up' then 'follow_up' else 'appointment' end,p_event_date,p_start_time,finish::time,'scheduled',concat_ws(E'\n','Campaign: '||c.name,nullif(btrim(p_next_action),''),nullif(btrim(p_note),''))) returning id into event_id;
 end if;
 insert into public.campaign_contact_log(id,member_id,actor_id,outcome,note,next_action,appointment_id) values(p_operation_id,m.id,auth.uid(),p_outcome,coalesce(btrim(p_note),''),coalesce(btrim(p_next_action),''),event_id);
 update public.campaign_members set contact_status=p_outcome,attempt_count=attempt_count+1,last_contacted_at=now(),last_note=case when length(btrim(coalesce(p_note,'')))>0 then btrim(p_note) else m.last_note end,next_action=case when event_id is not null then coalesce(btrim(p_next_action),'') else next_action end,next_event_id=coalesce(event_id,next_event_id),version=version+1 where id=m.id;
 return jsonb_build_object('saved',true,'already_saved',false,'event_id',event_id,'member_id',m.id);
end $function$
;

