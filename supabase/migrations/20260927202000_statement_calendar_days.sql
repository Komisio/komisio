-- Thin calendar adapter: retain the original immutable statement issuer and timestamp API.
create function public.issue_statement_for_days(p_tenant uuid,p_id uuid,p_seller uuid,p_from date,p_to date,p_corrects uuid default null) returns uuid
language plpgsql security invoker set search_path='' as $$
begin
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin','staff') then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 if p_from is null or p_to is null or not isfinite(p_from) or not isfinite(p_to)
   or p_to<p_from or p_to>=(now() at time zone 'Europe/Stockholm')::date then raise exception 'INVALID_INPUT'; end if;
 return public.issue_statement(p_tenant,p_id,p_seller,
   p_from::timestamp at time zone 'Europe/Stockholm',
   (p_to+1)::timestamp at time zone 'Europe/Stockholm',p_corrects);
end $$;
revoke all on function public.issue_statement_for_days(uuid,uuid,uuid,date,date,uuid) from public,anon;
grant execute on function public.issue_statement_for_days(uuid,uuid,uuid,date,date,uuid) to authenticated;
