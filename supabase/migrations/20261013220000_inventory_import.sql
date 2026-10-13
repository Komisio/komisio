-- Existing append-only audit events retain file provenance and deduplication keys.
create unique index inventory_import_reference on public.access_events(tenant_id,target_id)
 where action='inventory.item_imported';
create unique index inventory_import_request on public.access_events(tenant_id,target_id)
 where action='inventory.imported';

create function public.inventory_import_context(p_tenant uuid,p_sellers uuid[]) returns text
language plpgsql stable security definer set search_path='' as $$
declare uid uuid:=komisio_private.require_identity(); terms jsonb; agreement uuid;
begin
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin') then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 if p_sellers is null or cardinality(p_sellers)>200 or array_position(p_sellers,null) is not null then raise exception 'INVALID_INPUT'; end if;
 select jsonb_agg(jsonb_build_object('seller',s,'terms',public.effective_seller_terms(p_tenant,s)) order by s)
 into terms from (select distinct unnest(p_sellers) s) sellers;
 select id into agreement from public.seller_agreement_versions where tenant_id=p_tenant order by version desc limit 1;
 return md5(jsonb_build_object('policy',public.current_store_policy(p_tenant),'currency',komisio_private.store_currency(p_tenant),'agreement',agreement,'sellers',terms)::text);
end $$;

create function public.import_inventory(p_tenant uuid,p_request uuid,p_source text,p_rows jsonb,p_context text,p_received boolean) returns jsonb
language plpgsql security definer set search_path='' as $$
declare uid uuid:=komisio_private.require_identity(); prior public.access_events; row_data jsonb;
 snapshot jsonb; sellers uuid[]:='{}'; seller uuid; matched jsonb; key uuid; session uuid;
 result jsonb; results jsonb:='[]'; created integer:=0; skipped integer:=0;
begin
 perform 1 from public.tenants where id=p_tenant for update;
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin') then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 if p_received is distinct from true then raise exception 'CUSTODY_REQUIRED'; end if;
 if p_request is null or p_source is null or length(trim(p_source)) not between 1 and 200
  or p_rows is null or jsonb_typeof(p_rows)<>'array' or p_context is null then raise exception 'INVALID_INPUT'; end if;
 if jsonb_array_length(p_rows) not between 1 and 200 then raise exception 'INVALID_INPUT'; end if;
 snapshot:=jsonb_build_object('source',p_source,'rows',p_rows,'context',p_context,'received',p_received);
 select * into prior from public.access_events where tenant_id=p_tenant and target_id=p_request and action='inventory.imported';
 if found then
  if prior.actor_id<>uid or prior.detail->'input' is distinct from snapshot then raise exception 'REQUEST_CONFLICT'; end if;
  return prior.detail->'result';
 end if;
 -- Validate the whole snapshot before creating any reception.
 for row_data in select value from jsonb_array_elements(p_rows) loop
  if jsonb_typeof(row_data)<>'object' or not (row_data ?& array['reference','sellerId','email','description','priceOre','currency'])
   or row_data-array['reference','sellerId','email','description','priceOre','currency']<>'{}'::jsonb then raise exception 'INVALID_INPUT'; end if;
  if exists(select 1 from jsonb_each(row_data) e where e.key<>'priceOre' and jsonb_typeof(e.value)<>'string')
   or jsonb_typeof(row_data->'priceOre')<>'number' then raise exception 'INVALID_INPUT'; end if;
  if length(trim(row_data->>'reference')) not between 1 and 120 or row_data->>'reference'<>trim(row_data->>'reference')
   or length(trim(row_data->>'description')) not between 1 and 1000
   or length(row_data->>'email')>254
   or row_data->>'sellerId' !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
   or row_data->>'priceOre' !~ '^[0-9]{1,8}$' or (row_data->>'priceOre')::bigint not between 1 and 99999999 then raise exception 'INVALID_INPUT'; end if;
  if row_data->>'currency' is distinct from komisio_private.store_currency(p_tenant) then raise exception 'CURRENCY_MISMATCH'; end if;
  seller:=(row_data->>'sellerId')::uuid;
  matched:=public.inventory_import_sellers(p_tenant,jsonb_build_array(jsonb_build_object('sellerId',seller,'email',row_data->>'email')))->0;
  if matched->>'status'<>'matched' then raise exception 'IMPORT_SELLER_CHANGED'; end if;
  sellers:=array_append(sellers,seller);
 end loop;
 if (select count(distinct value->>'reference') from jsonb_array_elements(p_rows))<>jsonb_array_length(p_rows) then raise exception 'INVALID_INPUT'; end if;
 if public.inventory_import_context(p_tenant,sellers) is distinct from p_context then raise exception 'IMPORT_CHANGED'; end if;
 for row_data in select value from jsonb_array_elements(p_rows) loop
  key:=komisio_private.derived_uuid(p_tenant::text||':inventory-reference:'||(row_data->>'reference'));
  select * into prior from public.access_events where tenant_id=p_tenant and target_id=key and action='inventory.item_imported';
  if found then
   -- Email is a lookup hint, not the stable seller identity. Never change an imported item.
   if ((prior.detail->'row')-'email') is distinct from (row_data-'email') then raise exception 'IMPORT_REFERENCE_CONFLICT'; end if;
   result:=prior.detail->'result'; skipped:=skipped+1;
  else
   session:=public.create_reception_session(p_tenant,komisio_private.derived_uuid(key::text||':session'),(row_data->>'sellerId')::uuid);
   result:=public.quick_receive(p_tenant,key,session,(row_data->>'sellerId')::uuid,0,jsonb_build_object('description',row_data->>'description'),(row_data->>'priceOre')::bigint);
   perform komisio_private.record_access(p_tenant,'inventory.item_imported',key,jsonb_build_object('source',p_source,'request',p_request,'row',row_data,'result',result));
   created:=created+1;
  end if;
  results:=results||jsonb_build_array(jsonb_build_object('sourceReference',row_data->>'reference','itemId',result->'itemId','reference',result->'reference'));
 end loop;
 result:=jsonb_build_object('requestId',p_request,'created',created,'skipped',skipped,'items',results);
 perform komisio_private.record_access(p_tenant,'inventory.imported',p_request,jsonb_build_object('input',snapshot,'result',result));
 return result;
end $$;
revoke all on function public.inventory_import_context(uuid,uuid[]),public.import_inventory(uuid,uuid,text,jsonb,text,boolean) from public,anon;
grant execute on function public.inventory_import_context(uuid,uuid[]),public.import_inventory(uuid,uuid,text,jsonb,text,boolean) to authenticated;
