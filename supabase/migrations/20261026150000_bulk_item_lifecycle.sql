-- Direct human batch actions reuse single-item engine rules. Agent proposals
-- retain their existing approval boundary. The audit receipt freezes skips too.
create unique index item_lifecycle_batch_request on public.access_events(tenant_id,target_id) where action='item.lifecycle_batch';

create function komisio_private.validate_lifecycle_batch_operation(p_operation jsonb) returns void
language plpgsql immutable set search_path='' as $$
declare kind text:=p_operation->>'kind'; reason text:=p_operation->>'reason';
begin
 if jsonb_typeof(p_operation) is distinct from 'object' or kind is null or kind not in ('end','extend','setPrice','markdown') then raise exception 'INVALID_INPUT'; end if;
 if kind='markdown' then
  if p_operation<>jsonb_build_object('kind','markdown') then raise exception 'INVALID_INPUT'; end if;
  return;
 end if;
 if jsonb_typeof(p_operation->'reason') is distinct from 'string' or reason<>trim(reason) or length(reason)>500
  or (kind<>'end' and length(reason)=0) then raise exception 'INVALID_INPUT'; end if;
 if kind='end' then
  if p_operation->>'endAction' is null or p_operation->>'endAction' not in ('charity','return','recycle')
   or (p_operation-array['kind','endAction','reason'])<>'{}'::jsonb then raise exception 'INVALID_INPUT'; end if;
 elsif kind='extend' then
  if jsonb_typeof(p_operation->'days') is distinct from 'number' or (p_operation->>'days')!~'^[0-9]+$'
   or (p_operation->>'days')::numeric not between 1 and 365 or (p_operation-array['kind','days','reason'])<>'{}'::jsonb then raise exception 'INVALID_INPUT'; end if;
 else
  if jsonb_typeof(p_operation->'priceOre') is distinct from 'number' or (p_operation->>'priceOre')!~'^[0-9]+$'
   or (p_operation->>'priceOre')::numeric not between 1 and 99999999999 or (p_operation-array['kind','priceOre','reason'])<>'{}'::jsonb then raise exception 'INVALID_INPUT'; end if;
 end if;
end $$;
revoke all on function komisio_private.validate_lifecycle_batch_operation(jsonb) from public,anon,authenticated;

create function komisio_private.lifecycle_batch_item(p_tenant uuid,p_item uuid,p_operation jsonb) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare facts jsonb; reason text; token text; price bigint; ends timestamptz; latest uuid; title text;
begin
 if not exists(select 1 from public.items where tenant_id=p_tenant and id=p_item) then
  return jsonb_build_object('itemId',p_item,'title','','token','','eligible',false,'reason','missing','priceOre',null,'periodEnd',null,'step',null);
 end if;
 facts:=komisio_private.item_lifecycle(p_tenant,p_item);
 title:=coalesce(komisio_private.item_title(p_tenant,p_item)->>'title','');
 select id into latest from public.item_events where tenant_id=p_tenant and item_id=p_item order by occurred_at desc,id desc limit 1;
 -- Token includes action, relevant derived facts and latest evidence. It is an
 -- optimistic comparison, not an authorization credential.
 token:=md5(jsonb_build_object('facts',facts,'event',latest,'operation',p_operation,'title',title,
  'eventCount',(select count(*) from public.item_events where tenant_id=p_tenant and item_id=p_item),
  'priceCount',(select count(*) from public.item_prices where tenant_id=p_tenant and item_id=p_item))::text);
 reason:=case when (facts->>'sold')::boolean then 'sold' when (facts->>'ended')::boolean then 'ended'
  when p_operation->>'kind'='markdown' and facts->>'dueStep' is null then 'markdown_not_due'
  when p_operation->>'endAction'='recycle' and (facts->>'collectionDeadline' is null or (facts->>'collectionDeadline')::timestamptz>now()) then 'collection_not_due' end;
 price:=(facts->>'currentPriceOre')::bigint; ends:=(facts->>'periodEnd')::timestamptz;
 if reason is null then
  case p_operation->>'kind'
   when 'setPrice' then price:=(p_operation->>'priceOre')::bigint;
   when 'markdown' then price:=greatest((facts->>'acceptedPriceOre')::bigint-komisio_private.share_ore((facts->>'acceptedPriceOre')::bigint,round((facts->>'duePercent')::numeric*100)::integer),1);
   when 'extend' then
    if exists(select 1 from public.items where tenant_id=p_tenant and id=p_item and terms ? 'consignmentPeriod')
     or exists(select 1 from public.item_events where tenant_id=p_tenant and item_id=p_item and kind='period_reopened') then
     ends:=((ends at time zone 'Europe/Stockholm')+make_interval(days=>(p_operation->>'days')::integer)) at time zone 'Europe/Stockholm';
    else ends:=ends+make_interval(days=>(p_operation->>'days')::integer); end if;
   else null;
  end case;
 end if;
 return jsonb_build_object('itemId',p_item,'title',title,'token',token,'eligible',reason is null,'reason',reason,'priceOre',price,'periodEnd',ends,'step',facts->'dueStep');
end $$;
revoke all on function komisio_private.lifecycle_batch_item(uuid,uuid,jsonb) from public,anon,authenticated;

create function public.preview_item_lifecycle_batch(p_tenant uuid,p_items uuid[],p_operation jsonb) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare result jsonb:='[]'; item uuid;
begin
 perform komisio_private.require_identity();
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin','staff') then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 perform komisio_private.validate_lifecycle_batch_operation(p_operation);
 if coalesce(cardinality(p_items),0) not between 1 and 50 or array_ndims(p_items)<>1
  or exists(select 1 from unnest(p_items) v where v is null)
  or (select count(distinct v) from unnest(p_items) v)<>cardinality(p_items) then raise exception 'INVALID_INPUT'; end if;
 foreach item in array p_items loop result:=result||jsonb_build_array(komisio_private.lifecycle_batch_item(p_tenant,item,p_operation)); end loop;
 return result;
end $$;

create function public.apply_item_lifecycle_batch(p_tenant uuid,p_id uuid,p_operation jsonb,p_preview jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid:=komisio_private.require_identity(); prior public.access_events; input jsonb; result jsonb:='[]'; expected jsonb; current jsonb; event uuid; item uuid; reason text;
begin
 perform 1 from public.tenants where id=p_tenant for update;
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin','staff') then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 if p_id is null then raise exception 'INVALID_INPUT'; end if;
 input:=jsonb_build_object('operation',p_operation,'preview',p_preview);
 select * into prior from public.access_events where tenant_id=p_tenant and target_id=p_id and action='item.lifecycle_batch';
 if found then
  if prior.actor_id is distinct from actor or prior.detail->'input' is distinct from input then raise exception 'REQUEST_CONFLICT'; end if;
  return prior.detail->'result';
 end if;
 perform komisio_private.validate_lifecycle_batch_operation(p_operation);
 if jsonb_typeof(p_preview) is distinct from 'array' then raise exception 'INVALID_INPUT'; end if;
 if jsonb_array_length(p_preview) not between 1 and 50 or (select count(distinct v->>'itemId') from jsonb_array_elements(p_preview) v)<>jsonb_array_length(p_preview) then raise exception 'INVALID_INPUT'; end if;
 for expected in select * from jsonb_array_elements(p_preview) loop
  if jsonb_typeof(expected) is distinct from 'object' or jsonb_typeof(expected->'eligible') is distinct from 'boolean'
   or jsonb_typeof(expected->'token') is distinct from 'string' then raise exception 'INVALID_INPUT'; end if;
  item:=(expected->>'itemId')::uuid;
  if item is null then raise exception 'INVALID_INPUT'; end if;
  current:=komisio_private.lifecycle_batch_item(p_tenant,item,p_operation);
  reason:=case when not (expected->>'eligible')::boolean then
    case when expected->>'reason' in ('missing','sold','ended','markdown_not_due','collection_not_due') then expected->>'reason' else 'changed' end
   when not(current->>'eligible')::boolean then current->>'reason'
   when expected->>'token' is distinct from current->>'token' then 'changed' end;
  event:=null;
  if reason is null then
   event:=gen_random_uuid();
   case p_operation->>'kind'
    when 'end' then perform public.end_sale_period(p_tenant,event,item,p_operation->>'endAction',p_operation->>'reason');
    when 'extend' then perform public.extend_sale_period(p_tenant,event,item,(p_operation->>'days')::integer,p_operation->>'reason');
    when 'setPrice' then perform public.set_item_price(p_tenant,event,item,(p_operation->>'priceOre')::bigint,p_operation->>'reason');
    when 'markdown' then perform public.apply_markdown(p_tenant,event,item,(current->>'step')::integer);
   end case;
  end if;
  result:=result||jsonb_build_array(jsonb_build_object('itemId',item,'status',case when reason is null then 'applied' else 'skipped' end,'reason',reason,'eventId',event));
 end loop;
 result:=jsonb_build_object('id',p_id,'items',result);
 perform komisio_private.record_access(p_tenant,'item.lifecycle_batch',p_id,jsonb_build_object('input',input,'result',result));
 return result;
end $$;
revoke all on function public.preview_item_lifecycle_batch(uuid,uuid[],jsonb),public.apply_item_lifecycle_batch(uuid,uuid,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.preview_item_lifecycle_batch(uuid,uuid[],jsonb),public.apply_item_lifecycle_batch(uuid,uuid,jsonb,jsonb) to authenticated;
