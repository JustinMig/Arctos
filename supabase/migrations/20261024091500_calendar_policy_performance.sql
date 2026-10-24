-- Equivalent authorization predicates; evaluate the session identity once.
alter policy calendar_event_client_links_write on public.calendar_event_client_links
with check (updated_by = (select auth.uid()) and private.mig_can_access_client(client_id));
alter policy calendar_event_details_select on public.calendar_event_details
using ((select auth.uid()) is not null);
alter policy calendar_event_details_insert on public.calendar_event_details
with check (updated_by = (select auth.uid()));
alter policy calendar_event_details_update on public.calendar_event_details
using ((select auth.uid()) is not null) with check (updated_by = (select auth.uid()));
alter policy calendar_event_details_delete on public.calendar_event_details
using ((select auth.uid()) is not null);
alter policy completed_appointments_insert on public.client_completed_appointments
with check (private.mig_can_access_client(client_id) and completed_by = (select auth.uid()));
create index if not exists athena_reviews_created_by_idx on public.athena_medicare_reviews(created_by);
create index if not exists calendar_client_links_updated_by_idx on public.calendar_event_client_links(updated_by);
create index if not exists client_review_manual_updated_by_idx on public.client_review_manual(updated_by);
create index if not exists medicare_intakes_created_by_idx on public.medicare_intakes(created_by);
-- Remove a duplicate SELECT only when ALL already grants identical access.
do $$ begin
 if exists(select 1 from pg_policies s join pg_policies w
 on s.schemaname=w.schemaname and s.tablename=w.tablename
 and s.roles=w.roles and s.qual=w.qual and s.permissive=w.permissive
 where s.schemaname='public' and s.tablename='calendar_event_client_links'
 and s.policyname='calendar_event_client_links_select' and s.cmd='SELECT'
 and w.policyname='calendar_event_client_links_write' and w.cmd='ALL') then
  drop policy calendar_event_client_links_select on public.calendar_event_client_links;
 end if;
end $$;
