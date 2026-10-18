-- #485: current catalogue presentation changes; accepted evidence does not.
create table public.item_category_versions (
 id uuid primary key,
 tenant_id uuid not null references public.tenants(id),
 category_id uuid not null,
 version integer not null check(version>0),
 name text not null check(length(name) between 1 and 120 and name=trim(name)),
 labels jsonb not null check(komisio_private.valid_attribute_labels(labels) and labels<>'{}'),
 active boolean not null,
 created_by uuid not null references auth.users(id),
 created_at timestamptz not null default now(),
 unique(tenant_id,category_id,version),
 foreign key(tenant_id,category_id) references public.item_categories(tenant_id,id) on delete cascade
);
create trigger category_version_immutable before update on public.item_category_versions
 for each row execute function komisio_private.preserve_correction();
create table public.item_category_links (
 id uuid primary key default gen_random_uuid(),
 tenant_id uuid not null references public.tenants(id),
 item_id uuid not null,
 category_id uuid,
 label_key text,
 raw_value text not null,
 created_by uuid references auth.users(id),
 created_at timestamptz not null default now(),
 seq bigint generated always as identity,
 foreign key(tenant_id,item_id) references public.items(tenant_id,id),
 foreign key(tenant_id,category_id) references public.item_categories(tenant_id,id)
);
create index item_category_links_current on public.item_category_links(tenant_id,item_id,seq desc);
create trigger category_link_immutable before update or delete on public.item_category_links
 for each row execute function komisio_private.preserve_correction();
alter table public.item_category_versions enable row level security;
alter table public.item_category_links enable row level security;
revoke all on public.item_category_versions,public.item_category_links from public,anon,authenticated;
grant select on public.item_category_versions,public.item_category_links to authenticated;
create policy read_store on public.item_category_versions for select to authenticated
 using(public.tenant_role(tenant_id) in ('owner','admin','staff','readonly'));
create policy read_store on public.item_category_links for select to authenticated
 using(public.tenant_role(tenant_id) in ('owner','admin','staff','readonly'));

create view komisio_private.current_item_categories as
 select c.id,c.tenant_id,coalesce(v.version,0) version,coalesce(v.name,c.name) name,
 coalesce(v.labels,c.labels) labels,coalesce(v.active,true) active
 from public.item_categories c left join lateral (
  select * from public.item_category_versions v where v.tenant_id=c.tenant_id and v.category_id=c.id order by version desc limit 1
 ) v on true;
revoke all on komisio_private.current_item_categories from public,anon,authenticated;

create function public.item_category_catalogue(p_tenant uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin','staff','readonly') then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 return (select coalesce(jsonb_agg(to_jsonb(c)-'tenant_id' order by name,id),'[]') from komisio_private.current_item_categories c where tenant_id=p_tenant);
end $$;
revoke all on function public.item_category_catalogue(uuid) from public,anon;
grant execute on function public.item_category_catalogue(uuid) to authenticated;

create function public.update_item_category(p_tenant uuid,p_id uuid,p_category uuid,p_expected integer,p_name text,p_labels jsonb,p_active boolean) returns uuid
language plpgsql security definer set search_path='' as $$
declare uid uuid:=komisio_private.require_identity(); old public.item_category_versions; cur record; v_name text:=trim(p_name);
begin
 perform 1 from public.tenants where id=p_tenant for update;
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin') then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 if p_id is null or p_category is null or p_expected is null or p_expected<0 or p_active is null
  or v_name is null or length(v_name) not between 1 and 120 or p_labels is null
  or not komisio_private.valid_attribute_labels(p_labels) or p_labels='{}' then raise exception 'INVALID_INPUT'; end if;
 select * into old from public.item_category_versions where id=p_id;
 if found then
  if old.tenant_id<>p_tenant or old.category_id<>p_category or old.version<>p_expected+1 or old.name<>v_name
   or old.labels<>p_labels or old.active<>p_active or old.created_by<>uid then raise exception 'REQUEST_CONFLICT'; end if;
  return p_id;
 end if;
 select * into cur from komisio_private.current_item_categories where tenant_id=p_tenant and id=p_category;
 if not found then raise exception 'CATEGORY_NOT_FOUND'; end if;
 if cur.version<>p_expected then raise exception 'CATALOGUE_CHANGED'; end if;
 if exists(select 1 from komisio_private.current_item_categories where tenant_id=p_tenant and id<>p_category and lower(name)=lower(v_name)) then raise exception 'CATEGORY_EXISTS'; end if;
 insert into public.item_category_versions(id,tenant_id,category_id,version,name,labels,active,created_by)
 values(p_id,p_tenant,p_category,p_expected+1,v_name,p_labels,p_active,uid);
 perform komisio_private.record_access(p_tenant,'category.updated',p_category,jsonb_build_object('version',p_expected+1));
 return p_id;
end $$;
revoke all on function public.update_item_category(uuid,uuid,uuid,integer,text,jsonb,boolean) from public,anon;
grant execute on function public.update_item_category(uuid,uuid,uuid,integer,text,jsonb,boolean) to authenticated;

-- Keep the source read separate from the current catalogue overlay.
alter function komisio_private.item_attributes(uuid,uuid) rename to item_attributes_before_categories;
create function komisio_private.category_match(p_tenant uuid,p_value text)
 returns table(category_id uuid,label_key text)
language sql stable security definer set search_path='' as $$
 with candidates as (
  select c.id,case when lower(trim(c.name))=lower(trim(p_value)) then null
   else (select key from jsonb_each_text(c.labels) where lower(trim(value))=lower(trim(p_value)) order by key limit 1) end label_key
  from komisio_private.current_item_categories c where c.tenant_id=p_tenant and c.active and nullif(trim(p_value),'') is not null
   and (lower(trim(c.name))=lower(trim(p_value)) or exists(select 1 from jsonb_each_text(c.labels) where lower(trim(value))=lower(trim(p_value))))
 ) select id,label_key from candidates where (select count(*) from candidates)=1
$$;
revoke all on function komisio_private.category_match(uuid,text) from public,anon,authenticated;

insert into public.item_category_links(tenant_id,item_id,category_id,label_key,raw_value)
 select i.tenant_id,i.id,m.category_id,m.label_key,a->>'value' from public.items i
 cross join lateral jsonb_array_elements(komisio_private.item_attributes_before_categories(i.tenant_id,i.id)) a
 cross join lateral komisio_private.category_match(i.tenant_id,a->>'value') m where a->>'slug'='category';

create function komisio_private.item_attributes(p_tenant uuid,p_item uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare facts jsonb:=komisio_private.item_attributes_before_categories(p_tenant,p_item); link public.item_category_links; cat record; display text;
begin
 select * into link from public.item_category_links where tenant_id=p_tenant and item_id=p_item order by seq desc limit 1;
 if link.category_id is null then return facts; end if;
 select * into cat from komisio_private.current_item_categories where tenant_id=p_tenant and id=link.category_id;
 if not found then return facts; end if;
 display:=coalesce(cat.labels->>link.label_key,cat.name);
 return (select coalesce(jsonb_agg(case when a->>'slug'='category' then a||jsonb_build_object('value',display,'categoryId',cat.id,'categoryVersion',cat.version) else a end order by n),'[]') from jsonb_array_elements(facts) with ordinality e(a,n));
end $$;
revoke all on function komisio_private.item_attributes(uuid,uuid) from public,anon,authenticated;

create function komisio_private.link_item_category() returns trigger
language plpgsql security definer set search_path='' as $$
declare item uuid; val text; match record; prior record;
begin
 if tg_table_name='item_attribute_corrections' then
  if new.slug<>'category' then return new; end if;
  item:=new.item_id; val:=new.value;
 else
  item:=new.id;
  select a->>'value' into val from jsonb_array_elements(komisio_private.item_attributes_before_categories(new.tenant_id,item)) a where a->>'slug'='category';
 end if;
 perform 1 from public.tenants where id=new.tenant_id for update;
 -- An ordinary title/type edit also writes category text. Retain its existing
 -- link when that text is unchanged, including an archived category.
 select l.category_id,l.label_key,coalesce(c.labels->>l.label_key,c.name) display into prior
  from public.item_category_links l left join komisio_private.current_item_categories c on c.tenant_id=l.tenant_id and c.id=l.category_id
  where l.tenant_id=new.tenant_id and l.item_id=item order by l.seq desc limit 1;
 if prior.category_id is not null and val=prior.display then
  insert into public.item_category_links(tenant_id,item_id,category_id,label_key,raw_value,created_by)
   values(new.tenant_id,item,prior.category_id,prior.label_key,coalesce(val,''),auth.uid());
 else
  select * into match from komisio_private.category_match(new.tenant_id,val);
  insert into public.item_category_links(tenant_id,item_id,category_id,label_key,raw_value,created_by)
   values(new.tenant_id,item,match.category_id,match.label_key,coalesce(val,''),auth.uid());
 end if;
 return new;
end $$;
revoke all on function komisio_private.link_item_category() from public,anon,authenticated;
create trigger item_category_link after insert on public.items for each row execute function komisio_private.link_item_category();
create trigger item_category_link after insert on public.item_attribute_corrections for each row execute function komisio_private.link_item_category();

create function public.edit_inventory_row_with_category(p_tenant uuid,p_id uuid,p_item uuid,p_expected jsonb,p_title text,p_category text,p_type text,p_group uuid,p_category_id uuid) returns uuid
language plpgsql security definer set search_path='' as $$
declare uid uuid:=komisio_private.require_identity(); receipt uuid:=komisio_private.derived_id(p_id::text||':category-link'); prior public.item_category_links; cat record; locale text;
begin
 perform 1 from public.tenants where id=p_tenant for update;
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin','staff') then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 select * into prior from public.item_category_links where id=receipt;
 if found then
  if prior.tenant_id<>p_tenant or prior.item_id<>p_item or prior.category_id is distinct from p_category_id or prior.raw_value<>trim(p_category) or prior.created_by<>uid then raise exception 'REQUEST_CONFLICT'; end if;
  perform public.edit_inventory_row(p_tenant,p_id,p_item,p_expected,p_title,p_category,p_type,p_group);
  return p_id;
 end if;
 if p_category_id is not null then
  if exists(select 1 from public.item_classification_batches where id=p_id) then raise exception 'REQUEST_CONFLICT'; end if;
  select * into cat from komisio_private.current_item_categories where tenant_id=p_tenant and id=p_category_id and active;
  if not found then raise exception 'CATEGORY_NOT_FOUND'; end if;
  if cat.name<>trim(p_category) and not exists(select 1 from jsonb_each_text(cat.labels) where value=trim(p_category)) then raise exception 'CATALOGUE_CHANGED'; end if;
  if cat.name<>trim(p_category) then select key into locale from jsonb_each_text(cat.labels) where value=trim(p_category) order by key limit 1; end if;
 end if;
 perform public.edit_inventory_row(p_tenant,p_id,p_item,p_expected,p_title,p_category,p_type,p_group);
 if p_category_id is not null then
  insert into public.item_category_links(id,tenant_id,item_id,category_id,label_key,raw_value,created_by)
   values(receipt,p_tenant,p_item,p_category_id,locale,trim(p_category),uid);
 elsif exists(select 1 from public.item_category_links where id=receipt) then raise exception 'REQUEST_CONFLICT';
 end if;
 return p_id;
end $$;
revoke all on function public.edit_inventory_row_with_category(uuid,uuid,uuid,jsonb,text,text,text,uuid,uuid) from public,anon;
grant execute on function public.edit_inventory_row_with_category(uuid,uuid,uuid,jsonb,text,text,text,uuid,uuid) to authenticated;

create function public.update_item_type(p_tenant uuid,p_slug text,p_expected jsonb,p_payload jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare cur jsonb; desired jsonb;
begin
 perform komisio_private.require_identity();
 perform 1 from public.tenants where id=p_tenant for update;
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin') then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 select t into cur from jsonb_array_elements(public.attribute_vocabulary(p_tenant)->'types') t where t->>'slug'=p_slug;
 if cur is null then raise exception 'ITEM_TYPE_UNDEFINED'; end if;
 desired:=jsonb_build_object('labels',p_payload->'labels','suggested_category',p_payload->'suggestedCategory','active',p_payload->'active','attributes',p_payload->'attributes');
 if cur is distinct from p_expected then
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
revoke all on function public.update_item_type(uuid,text,jsonb,jsonb) from public,anon;
grant execute on function public.update_item_type(uuid,text,jsonb,jsonb) to authenticated;

create or replace function komisio_private.catalogue_usage(p_tenant uuid,p_kind text,p_key text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare names text[]:='{}'; profiles bigint:=0; items bigint:=0; history bigint:=0; receptions bigint:=0;
 proposals bigint:=0; settings bigint:=0; refs jsonb; target record; n bigint;
begin
 if p_kind='category' then
  select array_agg(distinct lower(trim(v))) into names from (
   select c.name,c.labels from public.item_categories c where c.tenant_id=p_tenant and c.id::text=p_key
   union all select c.name,c.labels from public.item_category_versions c where c.tenant_id=p_tenant and c.category_id::text=p_key
  ) c cross join lateral (select c.name v union select value from jsonb_each_text(c.labels)) l;
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
 if p_kind='category' then
  select history+count(*) into history from public.item_category_links where tenant_id=p_tenant and category_id::text=p_key;
 end if;
 refs:=jsonb_build_object('items',items,'profiles',profiles,'history',history,'receptions',receptions,'proposals',proposals,'settings',settings);
 return (select coalesce(jsonb_object_agg(k,v),'{}'::jsonb) from jsonb_each(refs) e(k,v) where v<>'0'::jsonb);
end $$;
revoke all on function komisio_private.catalogue_usage(uuid,text,text) from public,anon,authenticated;


create or replace function public.classify_items(p_tenant uuid,p_id uuid,p_items jsonb,p_type text,p_group uuid) returns uuid
language plpgsql security definer set search_path='' as $$
declare uid uuid:=komisio_private.require_identity(); old public.item_classification_batches; row jsonb; current_version integer; vocabulary jsonb;
begin
 perform 1 from public.tenants where id=p_tenant for update;
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin','staff') then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 if p_id is null or p_items is null or jsonb_typeof(p_items)<>'array' or jsonb_array_length(p_items) not between 1 and 200 then raise exception 'INVALID_INPUT'; end if;
 select * into old from public.item_classification_batches where id=p_id;
 if found then
  if old.tenant_id<>p_tenant or old.created_by<>uid or old.selection<>p_items or old.item_type is distinct from p_type or old.group_id is distinct from p_group then raise exception 'REQUEST_CONFLICT'; end if;
  return p_id;
 end if;
 if (select count(distinct e->>'id') from jsonb_array_elements(p_items) e)<>jsonb_array_length(p_items) then raise exception 'INVALID_INPUT'; end if;
 if p_group is not null and not exists(select 1 from public.assortment_groups where tenant_id=p_tenant and id=p_group) then raise exception 'GROUP_NOT_FOUND'; end if;
 vocabulary:=public.attribute_vocabulary(p_tenant);
 if p_type is not null and not exists(select 1 from jsonb_array_elements(vocabulary->'types') t where t->>'slug'=p_type and ((t->>'active')::boolean or not exists(select 1 from jsonb_array_elements(p_items) i where komisio_private.item_classification(p_tenant,(i->>'id')::uuid)->>'itemType' is distinct from p_type))) then raise exception 'ITEM_TYPE_UNDEFINED'; end if;
 insert into public.item_classification_batches(id,tenant_id,selection,item_type,group_id,created_by) values(p_id,p_tenant,p_items,p_type,p_group,uid);
 for row in select * from jsonb_array_elements(p_items) loop
  if jsonb_typeof(row)<>'object' or not row ?& array['id','version'] or jsonb_typeof(row->'id') is distinct from 'string'
   or jsonb_typeof(row->'version') is distinct from 'number' or row->>'version' !~ '^[0-9]+$'
   or (select count(*) from jsonb_object_keys(row))<>2 then raise exception 'INVALID_INPUT'; end if;
  current_version:=(komisio_private.item_classification(p_tenant,(row->>'id')::uuid)->>'version')::integer;
  if current_version<>(row->>'version')::integer then raise exception 'ITEM_CHANGED'; end if;
  insert into public.item_classification_versions(tenant_id,item_id,version,batch_id,item_type,group_id) values(p_tenant,(row->>'id')::uuid,current_version+1,p_id,p_type,p_group);
 end loop;
 perform komisio_private.record_access(p_tenant,'items.classified',p_id,jsonb_build_object('count',jsonb_array_length(p_items)));
 return p_id;
end $$;

create or replace function public.create_item_category(p_tenant uuid,p_id uuid,p_name text,p_labels jsonb) returns uuid
language plpgsql security definer set search_path='' as $$
declare uid uuid:=komisio_private.require_identity(); prior public.item_categories; v_name text:=trim(p_name);
begin
 perform 1 from public.tenants where id=p_tenant for update;
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin') then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 if p_id is null or v_name is null or length(v_name) not between 1 and 120
  or p_labels is null or not komisio_private.valid_attribute_labels(p_labels) or p_labels='{}'::jsonb then raise exception 'INVALID_INPUT'; end if;
 select * into prior from public.item_categories where id=p_id;
 if found then
  if prior.tenant_id<>p_tenant or prior.name<>v_name or prior.labels<>p_labels or prior.created_by is distinct from uid then raise exception 'REQUEST_CONFLICT'; end if;
  return p_id;
 end if;
 if exists(select 1 from komisio_private.current_item_categories where tenant_id=p_tenant and lower(name)=lower(v_name)) or exists(select 1 from public.item_categories where tenant_id=p_tenant and lower(name)=lower(v_name)) then raise exception 'CATEGORY_EXISTS'; end if;
 insert into public.item_categories(id,tenant_id,name,labels,created_by) values(p_id,p_tenant,v_name,p_labels,uid);
 perform komisio_private.record_access(p_tenant,'category.created',p_id,'{}');
 return p_id;
end $$;
revoke all on function public.create_item_category(uuid,uuid,text,jsonb) from public,anon;
grant execute on function public.create_item_category(uuid,uuid,text,jsonb) to authenticated;
