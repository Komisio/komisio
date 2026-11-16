-- No activation or alteration of existing bookings. Runtime provisioning selects
-- the service for future claims after the application supports both adapters.
alter table komisio_private.central_shipping_runtime
 add column service_code text not null default '24' check(service_code in ('24','11'));
alter table public.central_parcels
 add column service_code text not null default '24' check(service_code in ('24','11'));
alter table public.central_parcels
 add column estimated_weight_g integer check(estimated_weight_g between 1001 and 3000),
 add constraint home_small_weight_limit check(service_code<>'11' or
  (estimated_weight_g is not null and (weight_g is null or weight_g<=3000)));

create function komisio_private.external_item_selection_weight(p_request uuid) returns integer
language sql stable security invoker set search_path='' as $$
 select coalesce((a.output->>'estimatedWeightG')::integer,2000)
 from public.external_item_requests r left join public.external_photo_ai_results a
  on a.id=r.weight_analysis_id and a.tenant_id=r.tenant_id where r.id=p_request;
$$;
revoke all on function komisio_private.external_item_selection_weight(uuid) from public,anon,authenticated;

create function komisio_private.central_parcel_estimated_weight(p_offers uuid[],p_service text) returns integer
language plpgsql stable security invoker set search_path='' as $$
declare grams bigint;
begin
 if p_service<>'11' then return null; end if;
 select sum(komisio_private.external_item_selection_weight(o.request_id)) into grams
 from public.external_item_offers o where o.id=any(p_offers);
 if grams is null or grams>2000 then raise exception 'PARCEL_WEIGHT_LIMIT'; end if;
 return grams::integer+1000;
end $$;
revoke all on function komisio_private.central_parcel_estimated_weight(uuid[],text) from public,anon,authenticated;

-- Preserve signatures, ownership checks, locks and replay digests. The service
-- comes only from the runtime row and is frozen in the original insert.
do $$ declare definition text; signature text; begin
 foreach signature in array array[
  'public.claim_central_parcel(uuid,uuid,jsonb,integer,integer,integer,integer,text)',
  'public.claim_central_parcel_group(uuid,uuid,uuid[],jsonb,text)'
 ] loop
  definition:=replace(pg_get_functiondef(signature::regprocedure),chr(13),'');
  if position('environment,payload_hash)' in definition)=0
   or position('cfg.environment,digest)' in definition)=0 then
   raise exception 'UNEXPECTED_PARCEL_INSERT';
  end if;
  definition:=replace(definition,'environment,payload_hash)','environment,payload_hash,service_code,estimated_weight_g)');
  definition:=replace(definition,'cfg.environment,digest)','cfg.environment,digest,cfg.service_code,komisio_private.central_parcel_estimated_weight('||
   case when signature like '%_group(%' then 'ids' else 'array[p_offer]' end||',cfg.service_code))');
  execute definition;
 end loop;
 definition:=replace(pg_get_functiondef('public.read_central_parcel(uuid)'::regprocedure),chr(13),'');
 if position('''environment'',p.environment' in definition)=0 then raise exception 'UNEXPECTED_PARCEL_READ'; end if;
 definition:=replace(definition,'''environment'',p.environment','''environment'',p.environment,''serviceCode'',p.service_code,''estimatedWeightG'',p.estimated_weight_g');
 if position('''eligibleItems'',coalesce(' in definition)=0
  or position('''description'',r.description,''handoverId''' in definition)=0 then raise exception 'UNEXPECTED_PARCEL_SELECTION'; end if;
 definition:=replace(definition,'''eligibleItems'',coalesce(',
  '''selectionWeightLimitG'',(select case when c.service_code=''11'' then 2000 end from komisio_private.central_shipping_runtime c where c.tenant_id=o.tenant_id),''eligibleItems'',coalesce(');
 definition:=replace(definition,'''description'',r.description,''handoverId''',
  '''description'',r.description,''selectionWeightG'',komisio_private.external_item_selection_weight(r.id),''handoverId''');
 execute definition;
end $$;
