-- A bounded read, not an import operation or a financial approval.
create function public.inventory_import_sellers(p_tenant uuid,p_rows jsonb) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare entry jsonb; result jsonb:='[]'; matched public.sellers; n integer; sid uuid; lookup_email text;
begin
 perform komisio_private.require_identity();
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin') then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 if p_rows is null or jsonb_typeof(p_rows)<>'array' then raise exception 'INVALID_INPUT'; end if;
 if jsonb_array_length(p_rows)>200 then raise exception 'INVALID_INPUT'; end if;
 for entry in select value from jsonb_array_elements(p_rows) loop
  if jsonb_typeof(entry)<>'object' or not(entry ?& array['sellerId','email']) or (entry-array['sellerId','email'])<>'{}'
   or jsonb_typeof(entry->'sellerId')<>'string' or jsonb_typeof(entry->'email')<>'string'
   or length(entry->>'email')>254 or length(entry->>'sellerId')>36 then raise exception 'INVALID_INPUT'; end if;
  if entry->>'sellerId'<>'' and entry->>'sellerId' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then raise exception 'INVALID_INPUT'; end if;
  sid:=nullif(entry->>'sellerId','')::uuid; lookup_email:=lower(trim(entry->>'email'));
  if sid is not null then
   select * into matched from public.sellers where tenant_id=p_tenant and id=sid;
   if not found then result:=result||jsonb_build_array(jsonb_build_object('status','missing')); continue; end if;
   if lookup_email<>'' and lower(trim(matched.email))<>lookup_email then result:=result||jsonb_build_array(jsonb_build_object('status','conflict')); continue; end if;
  else
   select count(*) into n from (select id from public.sellers where tenant_id=p_tenant and lookup_email<>'' and lower(trim(sellers.email))=lookup_email limit 2) bounded;
   if n<>1 then result:=result||jsonb_build_array(jsonb_build_object('status',case when n=0 then 'missing' else 'ambiguous' end)); continue; end if;
   select * into matched from public.sellers where tenant_id=p_tenant and lower(trim(sellers.email))=lookup_email;
  end if;
  result:=result||jsonb_build_array(jsonb_build_object('status','matched','id',matched.id,'name',matched.name));
 end loop;
 return result;
end $$;
revoke all on function public.inventory_import_sellers(uuid,jsonb) from public,anon;
grant execute on function public.inventory_import_sellers(uuid,jsonb) to authenticated;
