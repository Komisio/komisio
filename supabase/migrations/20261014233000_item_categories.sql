-- A catalogue of suggested category names. Existing item text remains the
-- stored value: no historic observations or financial records are rewritten.
create table public.item_categories (
 id uuid primary key default gen_random_uuid(),
 tenant_id uuid not null references public.tenants(id),
 name text not null check(length(name) between 1 and 120 and name=trim(name)),
 labels jsonb not null check(komisio_private.valid_attribute_labels(labels) and labels<>'{}'::jsonb),
 created_by uuid references auth.users(id),
 created_at timestamptz not null default now(),
 unique(tenant_id,id)
);
create unique index item_category_name on public.item_categories(tenant_id,lower(name));
alter table public.item_categories enable row level security;
revoke all on public.item_categories from public,anon,authenticated;
grant select on public.item_categories to authenticated;
create policy read_store on public.item_categories for select to authenticated
 using(public.tenant_role(tenant_id) in ('owner','admin','staff','readonly'));
create trigger preserve_category before update or delete on public.item_categories
 for each row execute function komisio_private.preserve_correction();

create function public.create_item_category(p_tenant uuid,p_id uuid,p_name text,p_labels jsonb) returns uuid
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
 if exists(select 1 from public.item_categories where tenant_id=p_tenant and lower(name)=lower(v_name)) then raise exception 'CATEGORY_EXISTS'; end if;
 insert into public.item_categories(id,tenant_id,name,labels,created_by) values(p_id,p_tenant,v_name,p_labels,uid);
 perform komisio_private.record_access(p_tenant,'category.created',p_id,'{}');
 return p_id;
end $$;
revoke all on function public.create_item_category(uuid,uuid,text,jsonb) from public,anon;
grant execute on function public.create_item_category(uuid,uuid,text,jsonb) to authenticated;

create function komisio_private.seed_store_categories() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 insert into public.item_categories(tenant_id,name,labels) values
 (new.id,'Clothing','{"sv":"Kläder","en":"Clothing","no":"Klær","dk":"Tøj","fi":"Vaatteet","de":"Kleidung","es":"Ropa","it":"Abbigliamento"}'),
 (new.id,'Home & décor','{"sv":"Hem och inredning","en":"Home & décor","no":"Hjem og interiør","dk":"Bolig og indretning","fi":"Koti ja sisustus","de":"Wohnen und Einrichtung","es":"Hogar y decoración","it":"Casa e arredamento"}');
 return new;
end $$;
revoke all on function komisio_private.seed_store_categories() from public,anon,authenticated;
create trigger seed_store_categories after insert on public.tenants
 for each row execute function komisio_private.seed_store_categories();
