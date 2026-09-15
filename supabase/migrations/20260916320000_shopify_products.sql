-- Shopify adapter, step 2 (docs/SHOPIFY-ADAPTER.md): accepted items out as
-- products, one variant each, sku K-<item id>, one unit at the shop's
-- location. Integration provenance only: an export row is the payload the
-- application will send, an outcome row is what happened (synced with the
-- Shopify ids, failed before the request, or unknown after it). A markdown
-- becomes a new export for the same item at the new price, which updates the
-- existing product. Also token renewal for expiring tokens, bound to the
-- connection revision as for Fortnox. Nothing financial is written here.
create function komisio_private.preserve_shopify() returns trigger language plpgsql set search_path='' as $$
begin raise exception 'IMMUTABLE_SHOPIFY' using errcode='55000';end $$;
revoke all on function komisio_private.preserve_shopify() from public,anon,authenticated;

create function public.refresh_shopify_tokens(p_tenant uuid,p_revision bigint,p_cipher jsonb,p_scope text,p_expires_at timestamptz) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid:=komisio_private.require_identity(); connection public.shopify_connections; detail jsonb; next_revision bigint;
begin
 perform 1 from public.tenants where id=p_tenant for update;
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin') then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 if p_revision is null or p_revision<1 or p_cipher is null or jsonb_typeof(p_cipher)<>'object' or not (p_cipher ?& array['iv','tag','data'])
  or length(coalesce(p_scope,''))>500 or p_expires_at is null or not isfinite(p_expires_at) then raise exception 'INVALID_INPUT'; end if;
 select * into connection from public.shopify_connections where tenant_id=p_tenant;
 if not found then raise exception 'SHOPIFY_NOT_CONNECTED'; end if;
 if connection.revision<>p_revision then
  detail:=jsonb_build_object('reason','SHOPIFY_CONNECTION_CHANGED','expected_revision',p_revision::text,'current_revision',connection.revision::text);
  perform komisio_private.shopify_event(p_tenant,'refused',detail,actor);
  perform komisio_private.record_access(p_tenant,'shopify.refused',p_tenant,detail);
  return jsonb_build_object('error','SHOPIFY_CONNECTION_CHANGED');
 end if;
 next_revision:=nextval('komisio_private.fortnox_connection_revision');
 perform set_config('komisio.shopify_transition','engine',true);
 update public.shopify_connections set cipher=p_cipher,scope=coalesce(p_scope,connection.scope),expires_at=p_expires_at,refreshed_at=now(),revision=next_revision where tenant_id=p_tenant;
 perform set_config('komisio.shopify_transition','',true);
 perform komisio_private.shopify_event(p_tenant,'refreshed',jsonb_build_object('shop_domain',connection.shop_domain,'revision',next_revision::text),actor);
 return jsonb_build_object('status','refreshed','revision',next_revision::text);
end $$;

create table public.shopify_product_exports (
 id uuid primary key default gen_random_uuid(),
 tenant_id uuid not null references public.tenants(id),
 item_id uuid not null,
 price_id uuid not null references public.item_prices(id),
 shop_domain text not null,
 sku text not null,
 payload jsonb not null check(jsonb_typeof(payload)='object'),
 product_gid text,
 created_by uuid not null references auth.users(id),
 created_at timestamptz not null default now(),
 seq bigint generated always as identity,
 unique(tenant_id,id),
 unique(tenant_id,item_id,price_id),
 foreign key(tenant_id,item_id) references public.items(tenant_id,id)
);
create table public.shopify_product_outcomes (
 id uuid primary key default gen_random_uuid(),
 tenant_id uuid not null references public.tenants(id),
 export_id uuid not null,
 status text not null check(status in ('synced','failed','unknown')),
 error_code text check(error_code is null or error_code ~ '^SHOPIFY_[A-Z_]{1,80}$'),
 product_gid text,
 variant_gid text,
 inventory_item_gid text,
 created_by uuid not null references auth.users(id),
 created_at timestamptz not null default now(),
 seq bigint generated always as identity,
 foreign key(tenant_id,export_id) references public.shopify_product_exports(tenant_id,id),
 check((status='synced')=(product_gid is not null and variant_gid is not null)),
 check((status='synced')=(error_code is null))
);
-- Rows written in one transaction share created_at; seq orders them.
create index shopify_product_item on public.shopify_product_exports(tenant_id,item_id,seq desc);
create index shopify_product_result on public.shopify_product_outcomes(tenant_id,export_id,seq desc);
do $$ declare t text; begin
 foreach t in array array['shopify_product_exports','shopify_product_outcomes'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('revoke all on public.%I from public,anon,authenticated',t);
  execute format('grant select on public.%I to authenticated',t);
  execute format('create policy read_store on public.%I for select to authenticated using(public.tenant_role(tenant_id) in (''owner'',''admin'',''staff'',''readonly''))',t);
  execute format('create policy store_boundary on public.%I as restrictive for all to authenticated using(public.tenant_role(tenant_id) in (''owner'',''admin'',''staff'',''readonly'')) with check(false)',t);
  execute format('create trigger immutable before update or delete on public.%I for each row execute function komisio_private.preserve_shopify()',t);
 end loop;
end $$;

-- The payload the application sends, recorded before any request. Replay per item and price.
create function public.prepare_shopify_product(p_tenant uuid,p_item uuid) returns uuid
language plpgsql security definer set search_path='' as $$
declare uid uuid:=komisio_private.require_identity(); c public.shopify_connections; item public.items; price public.item_prices; prior public.shopify_product_exports;
 f jsonb; t jsonb; title text; gid text; result uuid;
begin
 perform 1 from public.tenants where id=p_tenant for update;
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin') then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 select * into c from public.shopify_connections where tenant_id=p_tenant;
 if not found then raise exception 'SHOPIFY_NOT_CONNECTED'; end if;
 select * into item from public.items where tenant_id=p_tenant and id=p_item;
 if not found then raise exception 'ITEM_NOT_FOUND'; end if;
 f:=komisio_private.item_lifecycle(p_tenant,p_item);
 if (f->>'sold')::boolean then raise exception 'ITEM_NOT_ON_SALE'; end if;
 if (f->>'ended')::boolean then raise exception 'ITEM_ENDED'; end if;
 select * into price from public.item_prices where tenant_id=p_tenant and item_id=p_item order by set_at desc,seq desc limit 1;
 if not found then raise exception 'ITEM_NOT_FOUND'; end if;
 select * into prior from public.shopify_product_exports where tenant_id=p_tenant and item_id=p_item and price_id=price.id;
 if found then return prior.id; end if;
 t:=komisio_private.item_title(p_tenant,p_item);
 title:=left(coalesce(nullif(trim(t->>'title'),''),'Item I-'||upper(left(p_item::text,8))),255);
 select o.product_gid into gid from public.shopify_product_outcomes o join public.shopify_product_exports e on e.tenant_id=o.tenant_id and e.id=o.export_id
  where o.tenant_id=p_tenant and e.item_id=p_item and o.status='synced' order by o.seq desc limit 1;
 insert into public.shopify_product_exports(tenant_id,item_id,price_id,shop_domain,sku,payload,product_gid,created_by)
 values(p_tenant,p_item,price.id,c.shop_domain,'K-'||p_item::text,
  jsonb_build_object('title',title,'category',nullif(trim(coalesce(t->>'category','')),''),'sku','K-'||p_item::text,'reference','I-'||upper(left(p_item::text,8)),
   'price',to_char(price.price_ore/100.0,'FM999999999990.00'),'currency',komisio_private.store_currency(p_tenant),'quantity',1),
  gid,uid) returning id into result;
 perform komisio_private.record_access(p_tenant,'shopify.product_prepared',p_item,jsonb_build_object('export_id',result,'price_ore',price.price_ore));
 return result;
end $$;

-- What happened; synced carries the Shopify ids, failed stopped before the request, unknown lost the answer.
create function public.finish_shopify_product(p_tenant uuid,p_export uuid,p_status text,p_error text,p_product_gid text,p_variant_gid text,p_inventory_item_gid text) returns uuid
language plpgsql security definer set search_path='' as $$
declare uid uuid:=komisio_private.require_identity(); job public.shopify_product_exports; last public.shopify_product_outcomes; result uuid;
begin
 perform 1 from public.tenants where id=p_tenant for update;
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin') then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 if p_status is null or p_status not in ('synced','failed','unknown')
  or (p_status='synced' and (p_error is not null or p_product_gid is null or p_variant_gid is null or length(p_product_gid)>200 or length(p_variant_gid)>200))
  or (p_status<>'synced' and (p_error is null or p_error !~ '^SHOPIFY_[A-Z_]{1,80}$')) then raise exception 'INVALID_INPUT'; end if;
 select * into job from public.shopify_product_exports where tenant_id=p_tenant and id=p_export;
 if not found then raise exception 'SHOPIFY_EXPORT_NOT_FOUND'; end if;
 select * into last from public.shopify_product_outcomes where tenant_id=p_tenant and export_id=p_export order by seq desc limit 1;
 if last.status=p_status and last.error_code is not distinct from p_error and last.product_gid is not distinct from p_product_gid then return last.id; end if;
 insert into public.shopify_product_outcomes(tenant_id,export_id,status,error_code,product_gid,variant_gid,inventory_item_gid,created_by)
 values(p_tenant,p_export,p_status,p_error,p_product_gid,p_variant_gid,left(p_inventory_item_gid,200),uid) returning id into result;
 perform komisio_private.record_access(p_tenant,'shopify.product_'||p_status,job.item_id,jsonb_build_object('export_id',p_export,'error_code',p_error,'product_gid',p_product_gid));
 return result;
end $$;

-- Items on sale whose current price has no synced export yet: new items and markdowns alike.
create function public.shopify_product_candidates(p_tenant uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin','staff','readonly') then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 return coalesce((select jsonb_agg(jsonb_build_object('itemId',x.id,'reference','I-'||upper(left(x.id::text,8)),'title',x.t->>'title','priceOre',x.price_ore,
   'exportedBefore',exists(select 1 from public.shopify_product_outcomes o join public.shopify_product_exports e on e.tenant_id=o.tenant_id and e.id=o.export_id where o.tenant_id=p_tenant and e.item_id=x.id and o.status='synced')) order by x.accepted_at,x.id)
  from (
   select i.id,i.accepted_at,komisio_private.item_title(p_tenant,i.id) as t,p.price_ore
   from public.items i
   join lateral(select pr.id,pr.price_ore from public.item_prices pr where pr.tenant_id=p_tenant and pr.item_id=i.id order by pr.set_at desc,pr.seq desc limit 1) p on true
   where i.tenant_id=p_tenant
    and not (komisio_private.item_lifecycle(p_tenant,i.id)->>'sold')::boolean and not (komisio_private.item_lifecycle(p_tenant,i.id)->>'ended')::boolean
    and not exists(select 1 from public.shopify_product_exports e join public.shopify_product_outcomes o on o.tenant_id=e.tenant_id and o.export_id=e.id and o.status='synced'
     where e.tenant_id=p_tenant and e.item_id=i.id and e.price_id=p.id)
   order by i.accepted_at,i.id limit 20) x),'[]'::jsonb);
end $$;

-- Newest export per item with its latest outcome, for the page.
create function public.shopify_product_status(p_tenant uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin','staff','readonly') then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 return coalesce((select jsonb_agg(jsonb_build_object('itemId',e.item_id,'reference',e.payload->>'reference','title',e.payload->>'title','price',e.payload->>'price','exportId',e.id,'createdAt',e.created_at,
   'status',coalesce(o.status,'pending'),'errorCode',o.error_code,'productGid',coalesce(o.product_gid,e.product_gid),'decidedAt',o.created_at) order by e.seq desc)
  from (select distinct on (item_id) * from public.shopify_product_exports where tenant_id=p_tenant order by item_id,seq desc) e
  left join lateral (select * from public.shopify_product_outcomes o where o.tenant_id=p_tenant and o.export_id=e.id order by o.seq desc limit 1) o on true
  limit 50),'[]'::jsonb);
end $$;
revoke all on function public.refresh_shopify_tokens(uuid,bigint,jsonb,text,timestamptz),public.prepare_shopify_product(uuid,uuid),public.finish_shopify_product(uuid,uuid,text,text,text,text,text),public.shopify_product_candidates(uuid),public.shopify_product_status(uuid) from public,anon;
grant execute on function public.refresh_shopify_tokens(uuid,bigint,jsonb,text,timestamptz),public.prepare_shopify_product(uuid,uuid),public.finish_shopify_product(uuid,uuid,text,text,text,text,text),public.shopify_product_candidates(uuid),public.shopify_product_status(uuid) to authenticated;
