-- Integration metadata only; no financial rule or direct core writes.
create table public.zettle_stock_intents (
 id uuid primary key, tenant_id uuid not null, item_id uuid not null,
 export_id uuid not null, merchant_id uuid not null,
 product_id uuid not null, variant_id uuid not null, locations jsonb not null,
 created_by uuid not null references auth.users(id), created_at timestamptz not null default now(),
 unique(tenant_id,id), unique(tenant_id,item_id),
 foreign key(tenant_id,item_id) references public.items(tenant_id,id),
 foreign key(tenant_id,export_id) references public.zettle_product_exports(tenant_id,id),
 foreign key(tenant_id,merchant_id) references public.zettle_pull_connections(tenant_id,merchant_id)
);
create table public.zettle_stock_outcomes (
 seq bigint generated always as identity primary key, tenant_id uuid not null,
 intent_id uuid not null, status text not null check(status in ('initialized','depleted','unknown','conflict')),
 error_code text check(error_code in ('ZETTLE_INVENTORY_FAILED','ZETTLE_INVENTORY_CONFLICT','ZETTLE_STOCK_HELD')),
 created_by uuid not null references auth.users(id), created_at timestamptz not null default now(),
 foreign key(tenant_id,intent_id) references public.zettle_stock_intents(tenant_id,id)
);
create index zettle_stock_latest on public.zettle_stock_outcomes(intent_id,seq desc);
do $$ declare t text; begin
 foreach t in array array['zettle_stock_intents','zettle_stock_outcomes'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('revoke all on public.%I from public,anon,authenticated',t);
  execute format('grant select on public.%I to authenticated',t);
  execute format('create policy stock_read on public.%I for select to authenticated using(public.tenant_role(tenant_id) in (''owner'',''admin''))',t);
  execute format('create policy stock_boundary on public.%I as restrictive for all to authenticated using(public.tenant_role(tenant_id) in (''owner'',''admin'')) with check(false)',t);
  execute format('create trigger stock_immutable before update or delete on public.%I for each row execute function komisio_private.preserve_zettle()',t);
 end loop;
end $$;
create function public.claim_zettle_stock(p_tenant uuid,p_id uuid,p_export uuid,p_merchant uuid,p_locations jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare uid uuid:=komisio_private.require_identity(); e public.zettle_product_exports; prior public.zettle_stock_intents; k text; loc uuid[]:=array[]::uuid[];
begin
 perform 1 from public.tenants where id=p_tenant for update;
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin') then raise exception 'FORBIDDEN' using errcode='42501';end if;
 if p_id is null or p_export is null or p_merchant is null or p_locations is null or jsonb_typeof(p_locations)<>'object' or (select count(*) from jsonb_object_keys(p_locations))<>4 then raise exception 'INVALID_INPUT';end if;
 foreach k in array array['STORE','SUPPLIER','SOLD','BIN'] loop
  if p_locations->>k is null then raise exception 'INVALID_INPUT';end if;
  loc:=array_append(loc,(p_locations->>k)::uuid);
 end loop;
 if (select count(distinct x) from unnest(loc) x)<>4 then raise exception 'INVALID_INPUT';end if;
 if not exists(select 1 from public.zettle_pull_connections where tenant_id=p_tenant and merchant_id=p_merchant) then raise exception 'ZETTLE_WRONG_MERCHANT';end if;
 select * into e from public.zettle_product_exports where tenant_id=p_tenant and id=p_export;
 if not found then raise exception 'ITEM_NOT_FOUND';end if;
 if public.prepare_zettle_product(p_tenant,e.item_id) is distinct from p_export then raise exception 'ZETTLE_CONFIG_CHANGED';end if;
 select * into prior from public.zettle_stock_intents where id=p_id;
 if found and (prior.tenant_id is distinct from p_tenant or prior.item_id is distinct from e.item_id or prior.created_by is distinct from uid) then raise exception 'REQUEST_CONFLICT';end if;
 select * into prior from public.zettle_stock_intents where tenant_id=p_tenant and item_id=e.item_id;
 if found then
  if prior.merchant_id is distinct from p_merchant or prior.locations is distinct from p_locations or prior.product_id is distinct from e.product_id or prior.variant_id is distinct from e.variant_id then raise exception 'ZETTLE_INVENTORY_CONFLICT';end if;
  return jsonb_build_object('id',prior.id,'fresh',false);
 end if;
 insert into public.zettle_stock_intents(id,tenant_id,item_id,export_id,merchant_id,product_id,variant_id,locations,created_by)
 values(p_id,p_tenant,e.item_id,e.id,p_merchant,e.product_id,e.variant_id,p_locations,uid);
 return jsonb_build_object('id',p_id,'fresh',true);
end $$;
create function public.finish_zettle_stock(p_tenant uuid,p_intent uuid,p_status text,p_error text) returns void
language plpgsql security definer set search_path='' as $$
declare uid uuid:=komisio_private.require_identity();last public.zettle_stock_outcomes;
begin
 perform 1 from public.tenants where id=p_tenant for update;
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin') then raise exception 'FORBIDDEN' using errcode='42501';end if;
 if p_status is null or p_status not in ('initialized','depleted','unknown','conflict') or (p_error is not null and p_error not in ('ZETTLE_INVENTORY_FAILED','ZETTLE_INVENTORY_CONFLICT','ZETTLE_STOCK_HELD')) then raise exception 'INVALID_INPUT';end if;
 if not exists(select 1 from public.zettle_stock_intents where tenant_id=p_tenant and id=p_intent) then raise exception 'ITEM_NOT_FOUND';end if;
 select * into last from public.zettle_stock_outcomes where tenant_id=p_tenant and intent_id=p_intent order by seq desc limit 1;
 if found and last.status=p_status and last.error_code is not distinct from p_error then return;end if;
 insert into public.zettle_stock_outcomes(tenant_id,intent_id,status,error_code,created_by) values(p_tenant,p_intent,p_status,p_error,uid);
end $$;
create function public.zettle_stock_status(p_tenant uuid) returns table(intent_id uuid,item_id uuid,status text,error_code text,checked_at timestamptz)
language plpgsql security definer set search_path='' as $$
begin
 perform komisio_private.require_identity();
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin') then raise exception 'FORBIDDEN' using errcode='42501';end if;
 return query select i.id,i.item_id,coalesce(o.status,'unknown'),o.error_code,o.created_at from public.zettle_stock_intents i
 left join lateral (select s.status,s.error_code,s.created_at from public.zettle_stock_outcomes s where s.tenant_id=p_tenant and s.intent_id=i.id order by s.seq desc limit 1) o on true
 where i.tenant_id=p_tenant order by (coalesce(o.status,'unknown') in ('unknown','conflict')) desc,i.created_at desc,i.id limit 50;
end $$;
revoke all on function public.claim_zettle_stock(uuid,uuid,uuid,uuid,jsonb),public.finish_zettle_stock(uuid,uuid,text,text),public.zettle_stock_status(uuid) from public,anon;
grant execute on function public.claim_zettle_stock(uuid,uuid,uuid,uuid,jsonb),public.finish_zettle_stock(uuid,uuid,text,text),public.zettle_stock_status(uuid) to authenticated;
