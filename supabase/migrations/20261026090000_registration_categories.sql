-- #632: stable category identity without rewriting accepted descriptive evidence.
alter table public.item_types add column suggested_category_id uuid;
alter table public.item_types add constraint item_type_category_fk
 foreign key(tenant_id,suggested_category_id) references public.item_categories(tenant_id,id);
update public.item_types t set suggested_category_id=m.category_id
 from public.item_types source cross join lateral komisio_private.category_match(source.tenant_id,source.suggested_category) m
 where t.tenant_id=source.tenant_id and t.slug=source.slug;

-- Append only for uniquely matching, previously unlinked text. Explicit clears remain empty.
insert into public.item_category_links(tenant_id,item_id,category_id,label_key,raw_value)
 select i.tenant_id,i.id,m.category_id,m.label_key,a->>'value'
 from public.items i
 cross join lateral jsonb_array_elements(komisio_private.item_attributes_before_categories(i.tenant_id,i.id)) a
 cross join lateral komisio_private.category_match(i.tenant_id,a->>'value') m
 left join lateral (select l.* from public.item_category_links l where l.tenant_id=i.tenant_id and l.item_id=i.id order by seq desc limit 1) prior on true
 where a->>'slug'='category' and prior.category_id is null and nullif(trim(a->>'value'),'') is not null
  and (prior.id is null or prior.raw_value=a->>'value');

-- Extend the existing authorized vocabulary, preserving legacy suggested text.
do $migration$
declare source text:=pg_get_functiondef('public.attribute_vocabulary(uuid)'::regprocedure); changed text;
begin
 changed:=replace(source,'y.labels, y.suggested_category, y.active','y.labels, y.suggested_category, y.suggested_category_id, y.active');
 if changed=source then raise exception 'Missing vocabulary projection'; end if;
 execute changed;
end $migration$;

alter function public.set_item_type(uuid,text,jsonb) rename to set_item_type_before_category_id;
alter function public.set_item_type_before_category_id(uuid,text,jsonb) set schema komisio_private;
revoke all on function komisio_private.set_item_type_before_category_id(uuid,text,jsonb) from public,anon,authenticated;
create function public.set_item_type(p_tenant uuid,p_slug text,p_payload jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare category uuid; name text; result jsonb; payload jsonb:=p_payload;
begin
 perform komisio_private.require_identity();
 perform 1 from public.tenants where id=p_tenant for update;
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin') then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 if payload ? 'suggestedCategoryId' then
  begin category:=(payload->>'suggestedCategoryId')::uuid; exception when invalid_text_representation then raise exception 'INVALID_INPUT'; end;
  if category is not null then
   select c.name into name from komisio_private.current_item_categories c where c.tenant_id=p_tenant and c.id=category and c.active;
   -- An unchanged archived default may survive an unrelated type edit.
   if not found then
    select c.name into name from komisio_private.current_item_categories c join public.item_types t on t.tenant_id=c.tenant_id and t.suggested_category_id=c.id
     where c.tenant_id=p_tenant and c.id=category and t.slug=p_slug;
    if not found then raise exception 'CATEGORY_NOT_FOUND'; end if;
   end if;
  end if;
  payload:=(payload-'suggestedCategoryId')||jsonb_build_object('suggestedCategory',coalesce(name,''));
 else
  select m.category_id into category from komisio_private.category_match(p_tenant,payload->>'suggestedCategory') m;
 end if;
 result:=komisio_private.set_item_type_before_category_id(p_tenant,p_slug,payload);
 update public.item_types set suggested_category_id=category where tenant_id=p_tenant and slug=p_slug;
 return result;
end $$;
revoke all on function public.set_item_type(uuid,text,jsonb) from public,anon;
grant execute on function public.set_item_type(uuid,text,jsonb) to authenticated;

-- Preserve optimistic concurrency and replay with the extended profile.
create or replace function public.update_item_type(p_tenant uuid,p_slug text,p_expected jsonb,p_payload jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare cur jsonb; desired jsonb; category uuid; category_name text;
begin
 perform komisio_private.require_identity();
 perform 1 from public.tenants where id=p_tenant for update;
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin') then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 select t into cur from jsonb_array_elements(public.attribute_vocabulary(p_tenant)->'types') t where t->>'slug'=p_slug;
 if cur is null then raise exception 'ITEM_TYPE_UNDEFINED'; end if;
 if p_payload ? 'suggestedCategoryId' then
  begin category:=(p_payload->>'suggestedCategoryId')::uuid; exception when invalid_text_representation then raise exception 'INVALID_INPUT'; end;
  select name into category_name from komisio_private.current_item_categories where tenant_id=p_tenant and id=category;
 else
  select m.category_id into category from komisio_private.category_match(p_tenant,p_payload->>'suggestedCategory') m;
  category_name:=p_payload->>'suggestedCategory';
 end if;
 desired:=jsonb_build_object('labels',p_payload->'labels','suggested_category',coalesce(category_name,''),'suggested_category_id',category,'active',p_payload->'active','attributes',p_payload->'attributes');
 if cur is distinct from (jsonb_build_object('suggested_category_id',null)||p_expected) then
  if (cur-array['slug','own'])=desired then return cur; end if;
  raise exception 'CATALOGUE_CHANGED';
 end if;
 if p_payload is null or jsonb_typeof(p_payload)<>'object' or p_payload->'labels'='{}' or jsonb_typeof(p_payload->'active') is distinct from 'boolean' then raise exception 'INVALID_INPUT'; end if;
 if exists(select 1 from jsonb_array_elements(public.attribute_vocabulary(p_tenant)->'types') t
  cross join lateral jsonb_each_text(t->'labels') l cross join lateral jsonb_each_text(p_payload->'labels') n
  where t->>'slug'<>p_slug and lower(trim(l.value))=lower(trim(n.value))) then raise exception 'ITEM_TYPE_NAME_EXISTS'; end if;
 perform public.set_item_type(p_tenant,p_slug,p_payload);
 return (select t from jsonb_array_elements(public.attribute_vocabulary(p_tenant)->'types') t where t->>'slug'=p_slug);
end $$;

-- Explicit identity participates in the same transaction and retry contract as acceptance.
create function public.quick_receive_categorized(p_tenant uuid,p_request uuid,p_session uuid,p_seller uuid,p_expected integer,p_facts jsonb,p_price_ore bigint,p_bag uuid,p_item_type text,p_group uuid,p_category uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare uid uuid:=komisio_private.require_identity(); receipt uuid:=komisio_private.derived_uuid(p_request::text||':category');
 prior public.item_category_links; category_name text; result jsonb; facts jsonb:=p_facts;
begin
 perform 1 from public.tenants where id=p_tenant for update;
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin','staff') then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 if p_request is null or facts is null or jsonb_typeof(facts)<>'object' or facts ? 'category' then raise exception 'INVALID_INPUT'; end if;
 select * into prior from public.item_category_links where id=receipt;
 if found then
  if prior.tenant_id<>p_tenant or prior.created_by<>uid or prior.category_id is distinct from p_category then raise exception 'REQUEST_CONFLICT'; end if;
  category_name:=prior.raw_value;
 else
  if exists(select 1 from public.items where id=komisio_private.derived_uuid(p_request::text||':item')) then raise exception 'REQUEST_CONFLICT'; end if;
  if p_category is not null then
   select name into category_name from komisio_private.current_item_categories where tenant_id=p_tenant and id=p_category and active;
   if not found then raise exception 'CATEGORY_NOT_FOUND'; end if;
  end if;
 end if;
 if p_category is not null then facts:=facts||jsonb_build_object('category',category_name); end if;
 result:=public.quick_receive_classified(p_tenant,p_request,p_session,p_seller,p_expected,facts,p_price_ore,p_bag,p_item_type,p_group);
 if prior.id is null then
  insert into public.item_category_links(id,tenant_id,item_id,category_id,raw_value,created_by)
   values(receipt,p_tenant,(result->>'itemId')::uuid,p_category,coalesce(category_name,''),uid);
 elsif prior.item_id is distinct from (result->>'itemId')::uuid then raise exception 'REQUEST_CONFLICT'; end if;
 return result;
end $$;
revoke all on function public.quick_receive_categorized(uuid,uuid,uuid,uuid,integer,jsonb,bigint,uuid,text,uuid,uuid) from public,anon;
grant execute on function public.quick_receive_categorized(uuid,uuid,uuid,uuid,integer,jsonb,bigint,uuid,text,uuid,uuid) to authenticated;

-- Protect linked defaults from deletion even after a category rename.
alter function komisio_private.catalogue_usage(uuid,text,text) rename to catalogue_usage_before_category_defaults;
create function komisio_private.catalogue_usage(p_tenant uuid,p_kind text,p_key text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare result jsonb:=komisio_private.catalogue_usage_before_category_defaults(p_tenant,p_kind,p_key); linked bigint;
begin
 if p_kind='category' then
  select count(*) into linked from public.item_types where tenant_id=p_tenant and suggested_category_id::text=p_key;
  if linked>0 then result:=jsonb_set(result,'{settings}',to_jsonb(coalesce((result->>'settings')::bigint,0)+linked)); end if;
 end if;
 return result;
end $$;
revoke all on function komisio_private.catalogue_usage(uuid,text,text) from public,anon,authenticated;

-- Exact ID filtering is additive: older text-filter clients retain their contract.
do $migration$
declare source text:=pg_get_functiondef('public.items_search_page(uuid,jsonb,text,text,integer,integer)'::regprocedure); changed text;
begin
 changed:=replace(source,$old$'seller','category','itemType'$old$,$new$'seller','category','categoryId','itemType'$new$);
 if changed=source then raise exception 'Missing filter whitelist'; end if; source:=changed;
 changed:=replace(source,$old$if f ? 'bag' then$old$,$new$if f ? 'categoryId' and f->>'categoryId'<>'none' then
  begin perform (f->>'categoryId')::uuid; exception when invalid_text_representation then raise exception 'INVALID_INPUT'; end;
 end if;
 if f ? 'bag' then$new$);
 if changed=source then raise exception 'Missing filter validation'; end if; source:=changed;
 changed:=replace(source,$old$and (not f ? 'ownership' or i.ownership=f->>'ownership')$old$,$new$and (not f ? 'categoryId' or coalesce((select l.category_id::text from public.item_category_links l where l.tenant_id=p_tenant and l.item_id=i.id order by l.seq desc limit 1),'none')=f->>'categoryId')
   and (not f ? 'ownership' or i.ownership=f->>'ownership')$new$);
 if changed=source then raise exception 'Missing filter predicate'; end if;
 execute changed;
end $migration$;

-- New read contract preserves legacy reports and all stock/financial formulas.
do $migration$
declare source text:=pg_get_functiondef('public.stock_report_by_ownership(uuid,date,date,text)'::regprocedure); changed text;
begin
 source:=replace(source,'public.stock_report_by_ownership(', 'public.stock_report_by_category(');
 changed:=replace(source,$old$coalesce(komisio_private.item_title(p_tenant,i.id)->>'category','') as category,$old$,$new$coalesce(category.name,'') as category, category.id as category_id,$new$);
 if changed=source then raise exception 'Missing report category'; end if; source:=changed;
 changed:=replace(source,$old$from public.items i$old$,$new$from public.items i
  left join lateral (select l.category_id from public.item_category_links l where l.tenant_id=p_tenant and l.item_id=i.id order by l.seq desc limit 1) link on true
  left join komisio_private.current_item_categories category on category.tenant_id=p_tenant and category.id=link.category_id$new$);
 if changed=source then raise exception 'Missing report items'; end if; source:=changed;
 source:=replace(source,'select category,','select category_id,category,');
 source:=replace(source,'group by category','group by category_id,category');
 source:=replace(source,$old$'category',c.category,$old$,$new$'categoryId',c.category_id,'category',c.category,$new$);
 execute source;
end $migration$;
revoke all on function public.stock_report_by_category(uuid,date,date,text) from public,anon;
grant execute on function public.stock_report_by_category(uuid,date,date,text) to authenticated;
