create table public.assortment_groups (
 id uuid primary key, tenant_id uuid not null references public.tenants(id),
 name text not null check(length(name) between 1 and 80),
 created_by uuid not null references auth.users(id), created_at timestamptz not null default now(),
 unique(tenant_id,id)
);
create unique index assortment_group_name on public.assortment_groups(tenant_id,lower(name));
create table public.item_classification_batches (
 id uuid primary key, tenant_id uuid not null references public.tenants(id),
 selection jsonb not null, item_type text, group_id uuid,
 created_by uuid not null references auth.users(id), created_at timestamptz not null default now(),
 foreign key(tenant_id,group_id) references public.assortment_groups(tenant_id,id),unique(tenant_id,id)
);
create table public.item_classification_versions (
 tenant_id uuid not null, item_id uuid not null, version integer not null check(version>0),
 batch_id uuid not null, item_type text, group_id uuid,
 primary key(tenant_id,item_id,version),
 foreign key(tenant_id,item_id) references public.items(tenant_id,id),
 foreign key(tenant_id,batch_id) references public.item_classification_batches(tenant_id,id),
 foreign key(tenant_id,group_id) references public.assortment_groups(tenant_id,id)
);
alter table public.assortment_groups enable row level security;
alter table public.item_classification_batches enable row level security;
alter table public.item_classification_versions enable row level security;
revoke all on public.assortment_groups,public.item_classification_batches,public.item_classification_versions from public,anon,authenticated;
grant select on public.assortment_groups,public.item_classification_batches,public.item_classification_versions to authenticated;
create policy read_store on public.assortment_groups for select to authenticated using(public.tenant_role(tenant_id) in ('owner','admin','staff','readonly'));
create policy read_store on public.item_classification_batches for select to authenticated using(public.tenant_role(tenant_id) in ('owner','admin','staff','readonly'));
create policy read_store on public.item_classification_versions for select to authenticated using(public.tenant_role(tenant_id) in ('owner','admin','staff','readonly'));
create trigger preserve_group before update or delete on public.assortment_groups for each row execute function komisio_private.preserve_correction();
create trigger preserve_batch before update or delete on public.item_classification_batches for each row execute function komisio_private.preserve_correction();
create trigger preserve_classification before update or delete on public.item_classification_versions for each row execute function komisio_private.preserve_correction();

create function public.create_assortment_group(p_tenant uuid,p_id uuid,p_name text) returns uuid
language plpgsql security definer set search_path='' as $$
declare uid uuid:=komisio_private.require_identity(); old public.assortment_groups; v_name text:=trim(p_name);
begin
 perform 1 from public.tenants where id=p_tenant for update;
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin') then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 if p_id is null or v_name is null or length(v_name) not between 1 and 80 then raise exception 'INVALID_INPUT'; end if;
 select * into old from public.assortment_groups where id=p_id;
 if found then
  if old.tenant_id<>p_tenant or old.name<>v_name or old.created_by<>uid then raise exception 'REQUEST_CONFLICT'; end if;
  return p_id;
 end if;
 if exists(select 1 from public.assortment_groups where tenant_id=p_tenant and lower(name)=lower(v_name)) then raise exception 'GROUP_EXISTS'; end if;
 insert into public.assortment_groups(id,tenant_id,name,created_by) values(p_id,p_tenant,v_name,uid);
 perform komisio_private.record_access(p_tenant,'assortment.created',p_id,'{}');
 return p_id;
end $$;

create function komisio_private.item_classification(p_tenant uuid,p_item uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare v public.item_classification_versions; item public.items; kind text;
begin
 select * into v from public.item_classification_versions where tenant_id=p_tenant and item_id=p_item order by version desc limit 1;
 if found then return jsonb_build_object('id',p_item,'version',v.version,'itemType',v.item_type,'assortment',v.group_id); end if;
 select * into item from public.items where tenant_id=p_tenant and id=p_item;
 if not found then raise exception 'ITEM_NOT_FOUND'; end if;
 if item.origin_kind='reception_review' then
  select suggestions->>'itemType' into kind from public.reception_reviews where tenant_id=p_tenant and session_id=item.origin_id and version=item.origin_revision;
 end if;
 return jsonb_build_object('id',p_item,'version',0,'itemType',kind,'assortment',null);
end $$;
revoke all on function komisio_private.item_classification(uuid,uuid) from public,anon,authenticated;

create function public.item_classifications(p_tenant uuid,p_items uuid[]) returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
 perform komisio_private.require_identity();
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin','staff','readonly') then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 if p_items is null or cardinality(p_items)>200 or array_position(p_items,null) is not null then raise exception 'INVALID_INPUT'; end if;
 return coalesce((select jsonb_agg(komisio_private.item_classification(p_tenant,id)) from unnest(p_items) id),'[]');
end $$;

create function public.classify_items(p_tenant uuid,p_id uuid,p_items jsonb,p_type text,p_group uuid) returns uuid
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
 if p_type is not null and not exists(select 1 from jsonb_array_elements(vocabulary->'types') t where t->>'slug'=p_type and (t->>'active')::boolean) then raise exception 'ITEM_TYPE_UNDEFINED'; end if;
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
revoke all on function public.create_assortment_group(uuid,uuid,text),public.item_classifications(uuid,uuid[]),public.classify_items(uuid,uuid,jsonb,text,uuid) from public,anon;
grant execute on function public.create_assortment_group(uuid,uuid,text),public.item_classifications(uuid,uuid[]),public.classify_items(uuid,uuid,jsonb,text,uuid) to authenticated;
