-- Test-only preparation through public engine commands, with the caller's role.
-- Financial suites can choose acceptance price/identity separately.
create or replace function pg_temp.prepare_bag_reception(
 p_tenant uuid,p_request uuid,p_bag uuid,p_session uuid,p_expected integer,
 p_description text,p_category text,p_condition text,p_attributes jsonb default '[]'::jsonb
) returns uuid language plpgsql as $$
declare seller uuid; observation uuid:=gen_random_uuid(); price_source uuid:=gen_random_uuid();
 attrs jsonb; agreement uuid; previous uuid; sources jsonb;
begin
 select seller_id into seller from public.bag_receipts where tenant_id=p_tenant and id=p_bag;
 perform public.create_bag_reception(p_tenant,p_session,seller,p_bag);
 sources:=jsonb_build_array(
  jsonb_build_object('id',observation,'kind','observation','reference','Synthetic fixture','observation',p_description),
  jsonb_build_object('id',price_source,'kind','price-evidence','reference','Synthetic appraisal','observation','Test price'));
 perform public.save_reception_sources(p_tenant,p_request,p_session,p_expected,sources);
 if jsonb_array_length(p_attributes)>0 then
  select jsonb_agg(a||jsonb_build_object('sourceIds',jsonb_build_array(observation))) into attrs from jsonb_array_elements(p_attributes) a;
 else
  select jsonb_agg(jsonb_build_object('slug',slug,'definitionVersion',1,'value',value,'sourceIds',jsonb_build_array(observation),'certainty','observed')) into attrs
  from (values ('description',p_description),('category',p_category),('condition',p_condition)) f(slug,value) where nullif(trim(value),'') is not null;
 end if;
 select id into agreement from public.seller_agreement_versions where tenant_id=p_tenant order by version desc limit 1;
 select id into previous from public.reception_reviews where tenant_id=p_tenant and session_id=p_session order by version desc limit 1;
 perform public.publish_reception_review(p_tenant,gen_random_uuid(),p_session,p_expected+1,previous,agreement,
  jsonb_build_object('attributes',attrs,'price',jsonb_build_object('currency',coalesce(public.current_store_policy(p_tenant)->'policy'->>'currency','SEK'),'amount','250.00','rationale','Synthetic appraisal','sourceIds',jsonb_build_array(price_source)),'questions','[]'::jsonb),now()+interval '1 day');
 if not exists(select 1 from public.garment_receipts where tenant_id=p_tenant and session_id=p_session) then
  perform public.receive_garment(p_tenant,gen_random_uuid(),p_session,'Synthetic physical receipt');
 end if;
 return p_request;
end $$;
