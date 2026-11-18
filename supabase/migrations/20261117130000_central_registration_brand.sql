-- Central registration confirms description and price, not the submitted brand.
-- Keep that proposal on its immutable request instead of publishing an
-- unverified attribute or relabelling it as a staff observation.
do $$
declare definition text; brand_block text := $brand$
 if length(request.brand)>0 then
  select max(d.version) into version from public.attribute_definitions d where d.slug='brand' and (d.tenant_id is null or d.tenant_id=p_tenant)
   and (d.tenant_id is not null or not exists(select 1 from public.attribute_definitions o where o.slug=d.slug and o.tenant_id=p_tenant));
  if version is not null then attrs:=attrs||jsonb_build_array(jsonb_build_object('slug','brand','definitionVersion',version,'value',request.brand,'sourceIds',jsonb_build_array(request.photos[1]),'certainty','tentative')); end if;
 end if;
$brand$;
begin
 definition:=replace(pg_get_functiondef('public.register_external_item(uuid,uuid,uuid,text,bigint)'::regprocedure),E'\r','');
 if position(brand_block in definition)=0 then raise exception 'UNEXPECTED_CENTRAL_REGISTRATION'; end if;
 execute replace(definition,brand_block,E'\n -- Submitted brand remains on the request until separately verified.\n');
end $$;
