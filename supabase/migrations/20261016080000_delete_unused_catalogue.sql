-- Owner #460: remove only unused store vocabulary. Historical evidence stays.
-- Category references are text, not foreign keys: match every translated label.
create function komisio_private.catalogue_json_reference(doc jsonb, kind text, key text, names text[]) returns boolean
language plpgsql immutable set search_path='' as $$
declare k text; v jsonb;
begin
 if jsonb_typeof(doc)='array' then
  for v in select value from jsonb_array_elements(doc) loop
   if komisio_private.catalogue_json_reference(v,kind,key,names) then return true; end if;
  end loop;
 elsif jsonb_typeof(doc)='object' then
  if kind='attribute' and doc->>'slug'=key and (doc ? 'value' or doc ? 'definitionVersion') then return true; end if;
  if kind='category' and doc->>'slug'='category' and lower(trim(doc->>'value'))=any(names) then return true; end if;
  for k,v in select * from jsonb_each(doc) loop
   if kind='type' and k in ('itemType','item_type','typeSlug','type_slug') and v=to_jsonb(key) then return true; end if;
   if kind='group' and k in ('assortment','groupId','group_id','assortmentGroupId') and v=to_jsonb(key) then return true; end if;
   if kind='category' and k in ('category','suggestedCategory','suggested_category') and lower(trim(v#>>'{}'))=any(names) then return true; end if;
   if kind='attribute' and k=key then return true; end if;
   if komisio_private.catalogue_json_reference(v,kind,key,names) then return true; end if;
  end loop;
 end if;
 return false;
end $$;
revoke all on function komisio_private.catalogue_json_reference(jsonb,text,text,text[]) from public,anon,authenticated;

create function komisio_private.catalogue_usage(p_tenant uuid,p_kind text,p_key text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare names text[]:='{}'; profiles bigint:=0; items bigint:=0; history bigint:=0; receptions bigint:=0;
 proposals bigint:=0; settings bigint:=0; refs jsonb; target record; n bigint;
begin
 if p_kind='category' then
  select array_agg(distinct lower(trim(v))) into names from public.item_categories c
  cross join lateral (select c.name v union select value from jsonb_each_text(c.labels)) l
  where c.tenant_id=p_tenant and c.id::text=p_key;
  select count(*) into profiles from public.item_types t where (tenant_id=p_tenant or
   (tenant_id is null and not exists(select 1 from public.item_types own where own.tenant_id=p_tenant and own.slug=t.slug))) and lower(trim(suggested_category))=any(names);
 elsif p_kind='attribute' then
  select count(*) into profiles from public.item_type_attributes a where (tenant_id=p_tenant or
   (tenant_id is null and not exists(select 1 from public.item_types own where own.tenant_id=p_tenant and own.slug=a.type_slug))) and attribute_slug=p_key;
 end if;
 -- All stages, all corrections and classification versions, including superseded ones.
 select count(*) into items from public.items i where i.tenant_id=p_tenant and (
  komisio_private.catalogue_json_reference(komisio_private.item_attributes(p_tenant,i.id),p_kind,p_key,names)
  or exists(select 1 from public.item_attribute_corrections a where a.tenant_id=p_tenant and a.item_id=i.id
    and ((p_kind='attribute' and a.slug=p_key) or (p_kind='category' and a.slug='category' and lower(trim(a.value))=any(names))))
  or exists(select 1 from public.item_classification_versions c where c.tenant_id=p_tenant and c.item_id=i.id
    and ((p_kind='type' and c.item_type=p_key) or (p_kind='group' and c.group_id::text=p_key)))
  or exists(select 1 from public.reception_reviews r where r.tenant_id=p_tenant and r.session_id=i.origin_id
    and komisio_private.catalogue_json_reference(r.suggestions,p_kind,p_key,names)));
 select count(*) into history from public.item_classification_batches where tenant_id=p_tenant
  and ((p_kind='type' and item_type=p_key) or (p_kind='group' and group_id::text=p_key));
 select count(*) into receptions from public.reception_reviews where tenant_id=p_tenant
  and komisio_private.catalogue_json_reference(suggestions,p_kind,p_key,names);
 select receptions+count(*) into receptions from public.reception_source_revisions where tenant_id=p_tenant
  and komisio_private.catalogue_json_reference(sources,p_kind,p_key,names);
 select count(*) into proposals from public.pending_operations where tenant_id=p_tenant
  and komisio_private.catalogue_json_reference(payload,p_kind,p_key,names);
 -- Configurations are extensible JSON. Inspect structured references in store
 -- settings as well as ordinary item relations; never inspect free-text notes.
 for target in
  select c.table_name,c.column_name from information_schema.columns c
  where c.table_schema='public' and c.data_type='jsonb'
   and c.column_name in ('policy','settings','config','configuration','mapping','mappings','vat_map',
    'snapshot','context','output','assistance_output','payload','previous_payload','answers','terms')
   and c.table_name<>'pending_operations'
   and exists(select 1 from information_schema.columns t where t.table_schema=c.table_schema and t.table_name=c.table_name and t.column_name='tenant_id')
 loop
  execute format('select count(*) from public.%I where tenant_id=$1 and komisio_private.catalogue_json_reference(%I,$2,$3,$4)',target.table_name,target.column_name)
   into n using p_tenant,p_kind,p_key,names;
  settings:=settings+n;
 end loop;
 refs:=jsonb_build_object('items',items,'profiles',profiles,'history',history,'receptions',receptions,'proposals',proposals,'settings',settings);
 return (select coalesce(jsonb_object_agg(k,v),'{}'::jsonb) from jsonb_each(refs) e(k,v) where v<>'0'::jsonb);
end $$;
revoke all on function komisio_private.catalogue_usage(uuid,text,text) from public,anon,authenticated;

create function komisio_private.guard_catalogue_delete() returns trigger
language plpgsql security definer set search_path='' as $$
declare key text; kind text:=tg_argv[0]; usage jsonb;
begin
 perform komisio_private.require_identity();
 perform 1 from public.tenants where id=old.tenant_id for update;
 if old.tenant_id is null or coalesce(public.tenant_role(old.tenant_id),'') not in ('owner','admin') then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 key:=case when kind in ('type','attribute') then to_jsonb(old)->>'slug' else to_jsonb(old)->>'id' end;
 usage:=komisio_private.catalogue_usage(old.tenant_id,kind,key);
 if usage<>'{}'::jsonb then raise exception 'CATALOGUE_IN_USE' using detail=usage::text; end if;
 return old;
end $$;
revoke all on function komisio_private.guard_catalogue_delete() from public,anon,authenticated;

-- A profile saved after a concurrent deletion must not recreate a dangling
-- attribute reference. The same tenant lock orders both transactions.
create function komisio_private.guard_catalogue_profile() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if new.tenant_id is not null then
  perform 1 from public.tenants where id=new.tenant_id for update;
  if not exists(select 1 from public.attribute_definitions where slug=new.attribute_slug and (tenant_id=new.tenant_id or tenant_id is null)) then
   raise exception 'ATTRIBUTE_UNDEFINED';
  end if;
 end if;
 return new;
end $$;
revoke all on function komisio_private.guard_catalogue_profile() from public,anon,authenticated;
create trigger catalogue_profile before insert or update on public.item_type_attributes for each row execute function komisio_private.guard_catalogue_profile();

-- Preserve the existing update rules; only unused deletion is now allowed.
drop trigger preserve_category on public.item_categories;
create trigger preserve_category before update on public.item_categories for each row execute function komisio_private.preserve_correction();
drop trigger preserve_group on public.assortment_groups;
create trigger preserve_group before update on public.assortment_groups for each row execute function komisio_private.preserve_correction();
drop trigger definition_meaning on public.attribute_definitions;
create trigger definition_meaning before update on public.attribute_definitions for each row execute function komisio_private.preserve_definition_meaning();
create trigger catalogue_delete before delete on public.item_categories for each row execute function komisio_private.guard_catalogue_delete('category');
create trigger catalogue_delete before delete on public.assortment_groups for each row execute function komisio_private.guard_catalogue_delete('group');
create trigger catalogue_delete before delete on public.item_types for each row execute function komisio_private.guard_catalogue_delete('type');
create trigger catalogue_delete before delete on public.attribute_definitions for each row execute function komisio_private.guard_catalogue_delete('attribute');

create function public.delete_catalogue_record(p_tenant uuid,p_kind text,p_key text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare uid uuid:=komisio_private.require_identity(); usage jsonb; existed boolean;
begin
 perform 1 from public.tenants where id=p_tenant for update;
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin') then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 if p_kind is null or p_kind not in ('category','group','type','attribute') or p_key is null or length(p_key)>40 then raise exception 'INVALID_INPUT'; end if;
 if (p_kind in ('type','attribute') and p_key !~ '^[a-z][a-z0-9_]{0,39}$')
  or (p_kind in ('category','group') and p_key !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$') then raise exception 'INVALID_INPUT'; end if;
 if p_kind='type' then
  select exists(select 1 from public.item_types where tenant_id=p_tenant and slug=p_key) into existed;
  if not existed and exists(select 1 from public.item_types where tenant_id is null and slug=p_key) then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 elsif p_kind='attribute' then
  select exists(select 1 from public.attribute_definitions where tenant_id=p_tenant and slug=p_key) into existed;
  if not existed and exists(select 1 from public.attribute_definitions where tenant_id is null and slug=p_key) then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 elsif p_kind='category' then
  select exists(select 1 from public.item_categories where tenant_id=p_tenant and id::text=p_key) into existed;
 else
  select exists(select 1 from public.assortment_groups where tenant_id=p_tenant and id::text=p_key) into existed;
 end if;
 if not existed then return jsonb_build_object('ok',true,'kind',p_kind,'key',p_key); end if;
 usage:=komisio_private.catalogue_usage(p_tenant,p_kind,p_key);
 if usage<>'{}'::jsonb then return jsonb_build_object('ok',false,'usage',usage); end if;
 if p_kind='category' then delete from public.item_categories where tenant_id=p_tenant and id::text=p_key;
 elsif p_kind='group' then delete from public.assortment_groups where tenant_id=p_tenant and id::text=p_key;
 elsif p_kind='attribute' then delete from public.attribute_definitions where tenant_id=p_tenant and slug=p_key;
 else
  delete from public.item_types where tenant_id=p_tenant and slug=p_key;
  delete from public.item_type_attributes where tenant_id=p_tenant and type_slug=p_key;
 end if;
 perform komisio_private.record_access(p_tenant,'catalogue.deleted',null,jsonb_build_object('kind',p_kind,'key',p_key));
 return jsonb_build_object('ok',true,'kind',p_kind,'key',p_key);
end $$;
revoke all on function public.delete_catalogue_record(uuid,text,text) from public,anon;
grant execute on function public.delete_catalogue_record(uuid,text,text) to authenticated;
