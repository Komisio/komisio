-- Bounded historical/current matching, with the same RLS and MFA as the evidence.
create function public.zettle_matches(p_tenant uuid,p_import uuid,p_revision integer default null)
returns table(line_no integer,item_id uuid,revision integer)
language plpgsql stable security invoker set search_path='' as $$
begin
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin','staff','readonly') then raise exception 'FORBIDDEN' using errcode='42501';end if;
 if p_import is null or p_revision<0 then raise exception 'INVALID_INPUT';end if;
 return query select distinct on(r.line_no) r.line_no,r.item_id,r.revision from public.zettle_line_resolutions r
 where r.tenant_id=p_tenant and r.import_id=p_import and (p_revision is null or r.revision<=p_revision)
 order by r.line_no,r.revision desc;
end $$;
revoke all on function public.zettle_matches(uuid,uuid,integer) from public,anon;
grant execute on function public.zettle_matches(uuid,uuid,integer) to authenticated;
