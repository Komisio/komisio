CREATE OR REPLACE FUNCTION public.import_inventory(p_tenant uuid, p_request uuid, p_source text, p_rows jsonb, p_context text, p_received boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
   or length(trim(row_data->>'description')) not between 0 and 1000
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
end $function$
;
alter table public.purchase_receipts add column registration_attributes jsonb not null default '[]'::jsonb check(komisio_private.valid_item_attributes(registration_attributes));
alter table public.purchase_receipts add column item_type text;
CREATE OR REPLACE FUNCTION public.register_purchase_described(p_tenant uuid, p_id uuid, p_note text, p_price_ore bigint, p_evidence text, p_margin_eligible boolean,p_facts jsonb,p_item_type text,p_internal_note text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare uid uuid:=komisio_private.require_identity(); previous public.purchase_receipts; n text:=trim(coalesce(p_note,'')); e text:=trim(coalesce(p_evidence,'')); attrs jsonb:='[]'; fact record; def public.attribute_definitions;
begin
 perform 1 from public.tenants where id=p_tenant for update;
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin','staff') then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 if p_id is null or p_price_ore is null or p_price_ore<0 or p_price_ore>99999999999 or length(n)>500
  or length(e) not between 1 and 500 or p_margin_eligible is null then raise exception 'INVALID_INPUT'; end if;
 if p_facts is null or jsonb_typeof(p_facts)<>'object' or p_facts ?| array['description','category'] then raise exception 'INVALID_INPUT'; end if;
 select * into previous from public.purchase_receipts where id=p_id;
 if found then
  if previous.tenant_id is distinct from p_tenant or previous.created_by is distinct from uid or previous.supplier_note is distinct from n
   or previous.purchase_price_ore is distinct from p_price_ore or previous.evidence_reference is distinct from e
   or previous.margin_eligible is distinct from p_margin_eligible then raise exception 'REQUEST_CONFLICT'; end if;
  if previous.item_type is distinct from p_item_type or (select coalesce(jsonb_object_agg(a->>'slug',a->>'value'),'{}') from jsonb_array_elements(previous.registration_attributes) a) is distinct from p_facts then raise exception 'REQUEST_CONFLICT'; end if;
  perform public.save_item_internal_note(p_tenant,komisio_private.derived_uuid(p_id::text||':internal-note'),'purchase',p_id,null,p_internal_note);
  return p_id;
 end if;
 if (komisio_private.registration_settings(p_tenant)->'settings'->>'descriptionRequired')::boolean and n='' then raise exception 'DESCRIPTION_REQUIRED'; end if;
 if p_item_type is not null and not exists(select 1 from public.item_types where slug=p_item_type and (tenant_id=p_tenant or tenant_id is null) and active) then raise exception 'ITEM_TYPE_UNDEFINED'; end if;
 for fact in select * from jsonb_each(p_facts) loop
  if jsonb_typeof(fact.value)<>'string' or length(trim(fact.value#>>'{}')) not between 1 and 1000 then raise exception 'INVALID_INPUT'; end if;
  select * into def from public.attribute_definitions where slug=fact.key and (tenant_id=p_tenant or tenant_id is null) order by (tenant_id is not null) desc,version desc limit 1;
  if not found or not def.active then raise exception 'ATTRIBUTE_UNDEFINED'; end if;
  attrs:=attrs||jsonb_build_array(jsonb_build_object('slug',fact.key,'definitionVersion',def.version,'value',fact.value#>>'{}','sourceIds','[]'::jsonb,'certainty','observed'));
 end loop;
 insert into public.purchase_receipts(id,tenant_id,supplier_note,purchase_price_ore,currency,evidence_reference,margin_eligible,created_by,registration_attributes,item_type)
 values(p_id,p_tenant,n,p_price_ore,komisio_private.store_currency(p_tenant),e,p_margin_eligible,uid,attrs,p_item_type);
 perform public.save_item_internal_note(p_tenant,komisio_private.derived_uuid(p_id::text||':internal-note'),'purchase',p_id,null,p_internal_note);
 perform komisio_private.record_access(p_tenant,'purchase.registered',p_id,jsonb_build_object('price_ore',p_price_ore,'margin_eligible',p_margin_eligible));
 return p_id;
end $function$
;
CREATE OR REPLACE FUNCTION komisio_private.item_attributes_before_categories(p_tenant uuid, p_item uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare item public.items; out jsonb:='[]'::jsonb; note text; merged jsonb:='[]'::jsonb; a jsonb; c record; seen text[]:='{}';
begin
 select * into item from public.items where tenant_id=p_tenant and id=p_item;
 if not found then return '[]'::jsonb; end if;
 if item.origin_kind='reception_review' then
  select komisio_private.stored_review_attributes(suggestions) into out
   from public.reception_reviews where tenant_id=p_tenant and session_id=item.origin_id and version=item.origin_revision;
 elsif item.origin_kind='inspection_draft' then
  -- The owner explicitly retired this source; later corrections still apply.
  out:='[]'::jsonb;
 else
  select registration_attributes into out from public.purchase_receipts where tenant_id=p_tenant and id=item.origin_id;
  select supplier_note into note from public.purchase_receipts where tenant_id=p_tenant and id=item.origin_id;
  if nullif(trim(coalesce(note,'')),'') is not null then
   out:=out||jsonb_build_array(jsonb_build_object('slug','description','definitionVersion',1,'value',note,'sourceIds','[]'::jsonb,'certainty','observed'));
  end if;
 end if;
 out:=coalesce(out,'[]'::jsonb);
 for a in select * from jsonb_array_elements(out) loop
  select * into c from public.item_attribute_corrections k
   where k.tenant_id=p_tenant and k.item_id=p_item and k.slug=a->>'slug'
   order by k.seq desc limit 1;
  if found then
   merged:=merged||jsonb_build_array(a||jsonb_build_object('value',c.value,'definitionVersion',c.definition_version,'source','corrected',
    'accepted',jsonb_build_object('value',a->>'value','at',item.accepted_at),
    'correctedBy',c.corrected_by,'correctedAt',c.corrected_at,'reason',c.reason));
  else
   merged:=merged||jsonb_build_array(a||jsonb_build_object('source','accepted'));
  end if;
  seen:=seen||(a->>'slug');
 end loop;
 -- A correction may also add something the reception never recorded, such as a
 -- socket nobody noted at the counter.
 for c in select distinct on (k.slug) k.* from public.item_attribute_corrections k
   where k.tenant_id=p_tenant and k.item_id=p_item and not(k.slug=any(seen))
   order by k.slug, k.seq desc loop
  merged:=merged||jsonb_build_array(jsonb_build_object('slug',c.slug,'definitionVersion',c.definition_version,'value',c.value,
   'sourceIds','[]'::jsonb,'certainty','observed','source','corrected','accepted',null,
   'correctedBy',c.corrected_by,'correctedAt',c.corrected_at,'reason',c.reason));
 end loop;
 return merged;
end $function$
;CREATE OR REPLACE FUNCTION komisio_private.item_classification(p_tenant uuid, p_item uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v public.item_classification_versions; item public.items; kind text;
begin
 select * into v from public.item_classification_versions where tenant_id=p_tenant and item_id=p_item order by version desc limit 1;
 if found then return jsonb_build_object('id',p_item,'version',v.version,'itemType',v.item_type,'assortment',v.group_id); end if;
 select * into item from public.items where tenant_id=p_tenant and id=p_item;
 if not found then raise exception 'ITEM_NOT_FOUND'; end if;
 if item.origin_kind='purchase' then select item_type into kind from public.purchase_receipts where tenant_id=p_tenant and id=item.origin_id; end if;
 if item.origin_kind='reception_review' then
  select suggestions->>'itemType' into kind from public.reception_reviews where tenant_id=p_tenant and session_id=item.origin_id and version=item.origin_revision;
 end if;
 return jsonb_build_object('id',p_item,'version',0,'itemType',kind,'assortment',null);
end $function$
;
revoke all on function public.register_purchase_described(uuid,uuid,text,bigint,text,boolean,jsonb,text,text) from public,anon;
grant execute on function public.register_purchase_described(uuid,uuid,text,bigint,text,boolean,jsonb,text,text) to authenticated;
notify pgrst,'reload schema';
