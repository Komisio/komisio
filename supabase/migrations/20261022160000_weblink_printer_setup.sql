-- Preparation only: no activation, pairing secret or transport is provisioned.
create function public.register_weblink_printer(p_tenant uuid,p_id uuid,p_name text,p_model text,p_dpi integer) returns uuid
language plpgsql security definer set search_path='' as $$
declare uid uuid:=komisio_private.require_identity(); prior public.printers;
 n text:=trim(coalesce(p_name,'')); m text:=trim(coalesce(p_model,''));
begin
 perform 1 from public.tenants where id=p_tenant for update;
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin') then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 if p_id is null or length(n) not between 1 and 80 or length(m)>80 or p_dpi is null or p_dpi not in (203,300,600) then raise exception 'INVALID_INPUT'; end if;
 select * into prior from public.printers where id=p_id;
 if found then
  if row(prior.tenant_id,prior.transport,prior.name,prior.model,prior.dpi) is distinct from row(p_tenant,'weblink'::text,n,m,p_dpi) then raise exception 'REQUEST_CONFLICT'; end if;
  return p_id;
 end if;
 insert into public.printers(id,tenant_id,name,transport,address,model,dpi,active,created_by)
 values(p_id,p_tenant,n,'weblink','',m,p_dpi,false,uid);
 perform komisio_private.record_access(p_tenant,'printer.registered',p_id,jsonb_build_object('name',n,'transport','weblink','active',false));
 return p_id;
end $$;
revoke all on function public.register_weblink_printer(uuid,uuid,text,text,integer) from public,anon;
grant execute on function public.register_weblink_printer(uuid,uuid,text,text,integer) to authenticated;
