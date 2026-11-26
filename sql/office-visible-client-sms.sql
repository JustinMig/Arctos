create view public.office_visible_client_sms with (security_invoker=true) as
select * from public.client_sms_messages where right(regexp_replace(coalesce(from_number,''),'[^0-9]','','g'),10) <> '6627504626' and right(regexp_replace(coalesce(to_number,''),'[^0-9]','','g'),10) <> '6627504626';
revoke all on public.office_visible_client_sms from public, anon, authenticated;
grant select on public.office_visible_client_sms to service_role;
notify pgrst,'reload schema';
