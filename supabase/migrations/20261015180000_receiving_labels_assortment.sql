-- Descriptive label facts never change accepted terms or accounting evidence.
create or replace function public.item_label_facts(p_tenant uuid,p_item uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare title jsonb; facts jsonb; attrs jsonb; profile jsonb;
begin
 perform komisio_private.require_identity();
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin','staff','readonly') then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 if not exists(select 1 from public.items where tenant_id=p_tenant and id=p_item) then return null; end if;
 title:=komisio_private.item_title(p_tenant,p_item);
 facts:=komisio_private.item_lifecycle(p_tenant,p_item);
 select t into profile from jsonb_array_elements(public.attribute_vocabulary(p_tenant)->'types') t
 where t->>'slug'=komisio_private.item_classification(p_tenant,p_item)->>'itemType';
 select coalesce(jsonb_agg(entry order by ordering,slug),'[]') into attrs from (
  select a->>'slug' slug,
   coalesce((select (q->>'sort')::int from jsonb_array_elements(profile->'attributes') q where q->>'slug'=a->>'slug'),2147483647) ordering,
   jsonb_build_object('slug',a->>'slug','value',a->>'value','labels',coalesce(d.labels,'{}'),
    'dataType',coalesce(d.data_type,'text'),'unit',coalesce(d.unit,''),'choices',coalesce(d.choices,'[]')) entry
  from jsonb_array_elements(komisio_private.item_attributes(p_tenant,p_item)) a
  left join lateral (
   select x.labels,x.data_type,x.unit,x.choices from public.attribute_definitions x
   where x.slug=a->>'slug' and x.version=(a->>'definitionVersion')::int and (x.tenant_id=p_tenant or x.tenant_id is null)
   order by (x.tenant_id is not null) desc limit 1
  ) d on true
  where a->>'slug' not in ('description','category') and nullif(trim(a->>'value'),'') is not null
  order by ordering,slug limit 4
 ) selected;
 return jsonb_build_object('id',p_item,'reference','I-'||upper(left(p_item::text,8)),
  'title',title->>'title','priceOre',facts->>'currentPriceOre','currency',komisio_private.store_currency(p_tenant),'attributes',attrs);
end $$;

-- One transaction and one immutable classification batch, including the ungrouped choice.
-- Existing quick reception and classification commands retain their own rules.
create function public.quick_receive_classified(p_tenant uuid,p_request uuid,p_session uuid,p_seller uuid,p_expected integer,p_facts jsonb,p_price_ore bigint,p_bag uuid,p_item_type text,p_group uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare result jsonb; item_id uuid; batch_id uuid; existing public.items;
begin
 perform komisio_private.require_identity();
 perform 1 from public.tenants where id=p_tenant for update;
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin','staff') then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 if p_request is null then raise exception 'INVALID_INPUT'; end if;
 item_id:=komisio_private.derived_uuid(p_request::text||':item');
 batch_id:=komisio_private.derived_uuid(p_request::text||':classification');
 select * into existing from public.items where tenant_id=p_tenant and origin_kind='reception_review' and origin_id=p_session;
 if found and (existing.id<>item_id or not exists(select 1 from public.item_classification_batches where tenant_id=p_tenant and id=batch_id)) then
  raise exception 'REQUEST_CONFLICT';
 end if;
 if p_bag is null then
  result:=public.quick_receive(p_tenant,p_request,p_session,p_seller,p_expected,p_facts,p_price_ore,p_item_type);
 else
  result:=public.quick_receive_from_bag(p_tenant,p_request,p_session,p_seller,p_expected,p_facts,p_price_ore,p_bag,p_item_type);
 end if;
 if result->>'itemId' is distinct from item_id::text then raise exception 'REQUEST_CONFLICT'; end if;
 perform public.classify_items(p_tenant,batch_id,jsonb_build_array(jsonb_build_object('id',item_id,'version',0)),p_item_type,p_group);
 return result;
end $$;
revoke all on function public.quick_receive_classified(uuid,uuid,uuid,uuid,integer,jsonb,bigint,uuid,text,uuid) from public,anon;
grant execute on function public.quick_receive_classified(uuid,uuid,uuid,uuid,integer,jsonb,bigint,uuid,text,uuid) to authenticated;

-- Identical current-stock eligibility to stock_report_by_ownership; current classification.
create function public.stock_assortment_report(p_tenant uuid,p_ownership text default null) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare rows jsonb;
begin
 perform komisio_private.require_identity();
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin','staff','readonly') then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 if p_ownership is not null and p_ownership not in ('consignment','store') then raise exception 'INVALID_INPUT'; end if;
 with stock as (
  select i.id,(komisio_private.item_classification(p_tenant,i.id)->>'assortment')::uuid group_id,
   (select p.price_ore from public.item_prices p where p.tenant_id=p_tenant and p.item_id=i.id order by p.set_at desc,p.seq desc limit 1) price,
   greatest(0,floor(extract(epoch from (now()-i.accepted_at))/86400))::int age
  from public.items i where i.tenant_id=p_tenant and (p_ownership is null or i.ownership=p_ownership)
   and not exists(select 1 from public.item_events e where e.tenant_id=p_tenant and e.item_id=i.id and e.kind='period_ended')
   and not exists(select 1 from public.sale_lines l join public.sales s on s.tenant_id=l.tenant_id and s.id=l.sale_id
     where l.tenant_id=p_tenant and l.item_id=i.id and s.status='completed'
     and not exists(select 1 from public.sale_returns r where r.tenant_id=p_tenant and r.sale_line_id=l.id))
 ), groups as (
  select id,name from public.assortment_groups where tenant_id=p_tenant
  union all select null::uuid,null::text
 ), counts as (
  select g.id,g.name,count(s.id) in_stock,coalesce(sum(s.price),0) value,round(avg(s.age))::int age
  from groups g left join stock s on s.group_id is not distinct from g.id group by g.id,g.name
 ) select coalesce(jsonb_agg(jsonb_build_object('id',id,'name',name,'inStock',in_stock,'stockValueOre',value::text,'averageAgeDays',age)
   order by in_stock desc,name nulls last),'[]') into rows from counts;
 return jsonb_build_object('currency',komisio_private.store_currency(p_tenant),'groups',rows);
end $$;
revoke all on function public.stock_assortment_report(uuid,text) from public,anon;
grant execute on function public.stock_assortment_report(uuid,text) to authenticated;
