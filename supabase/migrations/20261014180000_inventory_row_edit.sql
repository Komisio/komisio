-- A row is one transaction; source terms and sale evidence remain untouched.
alter table public.item_attribute_corrections drop constraint item_attribute_corrections_value_check;
alter table public.item_attribute_corrections add constraint item_attribute_corrections_value_check
 check(length(value) between 1 and 1000 or (slug='category' and value=''));

create function public.edit_inventory_row(p_tenant uuid,p_id uuid,p_item uuid,p_expected jsonb,p_title text,p_category text,p_type text,p_group uuid) returns uuid
language plpgsql security definer set search_path='' as $$
declare uid uuid:=komisio_private.require_identity(); title_id uuid; category_id uuid; facts jsonb; ver integer;
 title_value text:=trim(p_title); category_value text:=trim(p_category); selection jsonb; replay boolean;
begin
 perform 1 from public.tenants where id=p_tenant for update;
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin','staff') then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 if p_id is null or p_item is null or title_value is null or length(title_value) not between 1 and 1000
  or category_value is null or length(category_value)>1000 or p_expected is null or jsonb_typeof(p_expected)<>'object'
  or not p_expected ?& array['title','category','version'] then raise exception 'INVALID_INPUT'; end if;
 if (select count(*) from jsonb_object_keys(p_expected))<>3
  or jsonb_typeof(p_expected->'title') is distinct from 'string' or jsonb_typeof(p_expected->'category') is distinct from 'string'
  or length(p_expected->>'title')>1000 or length(p_expected->>'category')>1000
  or jsonb_typeof(p_expected->'version') is distinct from 'number' or p_expected->>'version' !~ '^[0-9]+$' then raise exception 'INVALID_INPUT'; end if;
 title_id:=komisio_private.derived_id(p_id::text||':inventory-title');
 category_id:=komisio_private.derived_id(p_id::text||':inventory-category');
 selection:=jsonb_build_array(jsonb_build_object('id',p_item,'version',(p_expected->>'version')::integer));
 replay:=exists(select 1 from public.item_classification_batches where id=p_id);
 if replay then
  if not exists(select 1 from public.item_attribute_corrections where id=title_id and tenant_id=p_tenant and item_id=p_item and slug='description' and value=title_value and corrected_by=uid)
   or not exists(select 1 from public.item_attribute_corrections where id=category_id and tenant_id=p_tenant and item_id=p_item and slug='category' and value=category_value and corrected_by=uid)
   then raise exception 'REQUEST_CONFLICT'; end if;
  perform public.classify_items(p_tenant,p_id,selection,p_type,p_group);
  return p_id;
 end if;
 if exists(select 1 from public.item_attribute_corrections where id in (title_id,category_id)) then raise exception 'REQUEST_CONFLICT'; end if;
 if not exists(select 1 from public.items where tenant_id=p_tenant and id=p_item) then raise exception 'ITEM_NOT_FOUND'; end if;
 facts:=komisio_private.item_title(p_tenant,p_item);
 if coalesce(facts->>'title','') is distinct from p_expected->>'title'
  or coalesce(facts->>'category','') is distinct from p_expected->>'category' then raise exception 'ITEM_CHANGED'; end if;
 -- classify_items checks the expected classification version under this same lock.
 perform public.classify_items(p_tenant,p_id,selection,p_type,p_group);
 perform public.correct_item_attribute(p_tenant,title_id,p_item,'description',title_value,'Inventory row edited');
 if category_value<>'' then
  perform public.correct_item_attribute(p_tenant,category_id,p_item,'category',category_value,'Inventory row edited');
 else
  select max(d.version) into ver from public.attribute_definitions d
   where d.slug='category' and (d.tenant_id is null or d.tenant_id=p_tenant)
    and (d.tenant_id is not null or not exists(select 1 from public.attribute_definitions o where o.slug='category' and o.tenant_id=p_tenant));
  if ver is null then raise exception 'ATTRIBUTE_UNDEFINED'; end if;
  insert into public.item_attribute_corrections(id,tenant_id,item_id,slug,definition_version,value,reason,corrected_by)
   values(category_id,p_tenant,p_item,'category',ver,'','Inventory row edited',uid);
  perform komisio_private.record_access(p_tenant,'item.attribute_corrected',p_item,jsonb_build_object('slug','category','reason','Inventory row edited'));
 end if;
 return p_id;
end $$;
revoke all on function public.edit_inventory_row(uuid,uuid,uuid,jsonb,text,text,text,uuid) from public,anon;
grant execute on function public.edit_inventory_row(uuid,uuid,uuid,jsonb,text,text,text,uuid) to authenticated;
