-- Extension provenance, not a second inventory or a mutable financial record.
create table public.pos_product_links (
 id uuid primary key default gen_random_uuid(), tenant_id uuid not null references public.tenants(id),
 provider text not null check(provider in ('paypal','shopify')), account text not null,
 product_id text not null, variant_id text not null, item_id uuid not null,
 snapshot jsonb not null, created_by uuid not null references auth.users(id), created_at timestamptz not null default clock_timestamp(),
 foreign key(tenant_id,item_id) references public.items(tenant_id,id),
 unique(tenant_id,provider,account,variant_id), unique(tenant_id,provider,item_id)
);
alter table public.pos_product_links enable row level security;
revoke all on public.pos_product_links from public,anon,authenticated;
grant select on public.pos_product_links to authenticated;
create policy read_store on public.pos_product_links for select to authenticated using(public.tenant_role(tenant_id) in ('owner','admin','staff','readonly'));
create policy store_boundary on public.pos_product_links as restrictive for all to authenticated using(public.tenant_role(tenant_id) in ('owner','admin','staff','readonly')) with check(false);
create trigger immutable before update or delete on public.pos_product_links for each row execute function komisio_private.preserve_shopify();
create unique index pos_import_request on public.access_events(tenant_id,target_id) where action='pos.imported';

create function komisio_private.pos_account(p_tenant uuid,p_provider text) returns text
language sql stable security definer set search_path='' as $$
 select case p_provider when 'paypal' then (select merchant_id::text from public.paypal_credentials where tenant_id=p_tenant)
 when 'shopify' then (select shop_domain from public.shopify_connections where tenant_id=p_tenant) end
$$;

create function komisio_private.pos_item(p_tenant uuid,p_item uuid) returns jsonb
language sql stable security definer set search_path='' as $$
 select jsonb_build_object('id',i.id,'title',coalesce(komisio_private.item_title(p_tenant,i.id)->>'title',''),
 'reference','I-'||upper(left(i.id::text,8)),'ownership',i.ownership,'seller',s.name,'priceOre',p.price_ore)
 from public.items i left join public.sellers s on s.tenant_id=i.tenant_id and s.id=i.seller_id
 join lateral(select price_ore from public.item_prices where tenant_id=i.tenant_id and item_id=i.id order by set_at desc,seq desc limit 1) p on true
 where i.tenant_id=p_tenant and i.id=p_item
$$;

create function public.pos_import_search(p_tenant uuid,p_query text) returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
 perform komisio_private.require_identity();
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin') then raise exception 'FORBIDDEN' using errcode='42501';end if;
 if p_query is null or length(trim(p_query)) not between 1 and 120 then raise exception 'INVALID_INPUT';end if;
 return coalesce((select jsonb_agg(x.item) from (
 select komisio_private.pos_item(p_tenant,i.id) item from public.items i
 where i.tenant_id=p_tenant and komisio_private.item_lifecycle(p_tenant,i.id)->>'stage' in ('on_sale','markdown_due','period_ending')
 and (position(lower(trim(p_query)) in lower(coalesce(komisio_private.item_title(p_tenant,i.id)->>'title','')))>0
 or upper(trim(p_query))='I-'||upper(left(i.id::text,8)) or trim(p_query)=i.id::text)
 order by i.accepted_at desc,i.id limit 20) x),'[]');
end $$;

create function public.pos_import_preview(p_tenant uuid,p_provider text,p_account text,p_products jsonb) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare p jsonb; linked uuid; suggestions jsonb; result jsonb:='[]';
begin
 perform komisio_private.require_identity();
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin') then raise exception 'FORBIDDEN' using errcode='42501';end if;
 if p_provider is null or p_provider not in ('paypal','shopify') or p_account is null or p_account is distinct from komisio_private.pos_account(p_tenant,p_provider) then raise exception 'POS_CONNECTION_CHANGED';end if;
 if jsonb_typeof(p_products) is distinct from 'array' or jsonb_array_length(p_products)>500 then raise exception 'INVALID_INPUT';end if;
 for p in select value from jsonb_array_elements(p_products) loop
  linked:=null;
  select item_id into linked from public.pos_product_links where tenant_id=p_tenant and provider=p_provider and account=p_account and variant_id=p->>'variantId';
  if linked is null and p_provider='paypal' then
   select e.item_id into linked from public.zettle_product_exports e where e.tenant_id=p_tenant and e.product_id::text=p->>'productId' and e.variant_id::text=p->>'variantId' limit 1;
  elsif linked is null and p_provider='shopify' then
   select e.item_id into linked from public.shopify_product_exports e join public.shopify_product_outcomes o on o.tenant_id=e.tenant_id and o.export_id=e.id
   where e.tenant_id=p_tenant and e.shop_domain=p_account and o.product_gid=p->>'productId' and o.variant_gid=p->>'variantId' and o.status='synced' limit 1;
  end if;
  -- Exact references are suggestions only; descriptions never create an automatic link.
  select coalesce(jsonb_agg(x.item),'[]') into suggestions from (
   select komisio_private.pos_item(p_tenant,i.id) item from public.items i where i.tenant_id=p_tenant
   and komisio_private.item_lifecycle(p_tenant,i.id)->>'stage' in ('on_sale','markdown_due','period_ending')
   and ('I-'||upper(left(i.id::text,8))=upper(p->>'barcode') or 'K-'||i.id::text=p->>'sku') order by i.id limit 10) x;
  result:=result||jsonb_build_array(jsonb_build_object('linked',komisio_private.pos_item(p_tenant,linked),'suggestions',suggestions));
 end loop;
 return result;
end $$;

create function public.commit_pos_import(p_tenant uuid,p_request uuid,p_provider text,p_account text,p_product jsonb,p_mode text,p_item uuid,p_seller uuid,p_context text,p_received boolean) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid:=komisio_private.require_identity(); prior public.access_events; input jsonb; existing public.pos_product_links; item uuid:=p_item; result jsonb; received jsonb; session uuid; created boolean:=false;
begin
 perform 1 from public.tenants where id=p_tenant for update;
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin') then raise exception 'FORBIDDEN' using errcode='42501';end if;
 if p_request is null or p_provider is null or p_provider not in ('paypal','shopify') or p_mode is null or p_mode not in ('create','link') then raise exception 'INVALID_INPUT';end if;
 input:=jsonb_build_object('provider',p_provider,'account',p_account,'product',p_product,'mode',p_mode,'item',p_item,'seller',p_seller,'context',p_context,'received',p_received);
 select * into prior from public.access_events where tenant_id=p_tenant and target_id=p_request and action='pos.imported';
 if found then
  if prior.actor_id<>actor or prior.detail->'input' is distinct from input then raise exception 'REQUEST_CONFLICT';end if;
  return prior.detail->'result';
 end if;
 if p_account is null or p_account is distinct from komisio_private.pos_account(p_tenant,p_provider) then raise exception 'POS_CONNECTION_CHANGED';end if;
 if jsonb_typeof(p_product) is distinct from 'object' or not(p_product ?& array['productId','variantId','title','sku','barcode','priceOre','currency','quantity','active'])
 or (p_product-array['productId','variantId','title','sku','barcode','priceOre','currency','quantity','active'])<>'{}'::jsonb then raise exception 'INVALID_INPUT';end if;
 if exists(select 1 from jsonb_each(p_product) x where x.key in ('productId','variantId','title') and jsonb_typeof(x.value)<>'string')
 or length(trim(p_product->>'title')) not between 1 and 1000 or length(p_product->>'productId') not between 1 and 200 or length(p_product->>'variantId') not between 1 and 200
 or exists(select 1 from jsonb_each(p_product) x where x.key in ('sku','barcode') and x.value<>'null'::jsonb and (jsonb_typeof(x.value)<>'string' or length(x.value#>>'{}')>200)) then raise exception 'INVALID_INPUT';end if;
 if (p_provider='paypal' and (p_product->>'productId' !~ '^[0-9a-f-]{36}$' or p_product->>'variantId' !~ '^[0-9a-f-]{36}$'))
 or (p_provider='shopify' and (p_product->>'productId' !~ '^gid://shopify/Product/[0-9]{1,30}$' or p_product->>'variantId' !~ '^gid://shopify/ProductVariant/[0-9]{1,30}$')) then raise exception 'INVALID_INPUT';end if;
 select * into existing from public.pos_product_links where tenant_id=p_tenant and provider=p_provider and account=p_account and variant_id=p_product->>'variantId';
 if found then
  if existing.product_id<>p_product->>'productId' or (p_mode='link' and existing.item_id is distinct from p_item)
   or (p_mode='create' and (select seller_id from public.items where tenant_id=p_tenant and id=existing.item_id) is distinct from p_seller) then raise exception 'POS_ALREADY_LINKED';end if;
  item:=existing.item_id;
 else
  if p_product->'active' is distinct from 'true'::jsonb or p_product->'quantity' not in ('null'::jsonb,'1'::jsonb) then raise exception 'POS_ITEM_UNSUPPORTED';end if;
  if p_product->>'currency' is distinct from komisio_private.store_currency(p_tenant) then raise exception 'CURRENCY_MISMATCH';end if;
  if jsonb_typeof(p_product->'priceOre')<>'number' or p_product->>'priceOre' !~ '^[0-9]{1,8}$' or (p_product->>'priceOre')::bigint<1 then raise exception 'POS_ITEM_UNSUPPORTED';end if;
  if (public.pos_import_preview(p_tenant,p_provider,p_account,jsonb_build_array(p_product))->0->'linked')<>'null'::jsonb then raise exception 'POS_ALREADY_LINKED';end if;
  if p_mode='create' then
   if p_item is not null or p_seller is null then raise exception 'INVALID_INPUT';end if;
   if p_received is distinct from true then raise exception 'CUSTODY_REQUIRED';end if;
   if p_context is distinct from public.inventory_import_context(p_tenant,array[p_seller]) then raise exception 'IMPORT_CHANGED';end if;
   session:=public.create_reception_session(p_tenant,komisio_private.derived_uuid(p_request::text||':session'),p_seller);
   received:=public.quick_receive(p_tenant,p_request,session,p_seller,0,jsonb_build_object('description',p_product->>'title'),(p_product->>'priceOre')::bigint);
   item:=(received->>'itemId')::uuid;created:=true;
  else
   if p_item is null or p_seller is not null then raise exception 'INVALID_INPUT';end if;
   if not exists(select 1 from public.items where tenant_id=p_tenant and id=p_item) then raise exception 'ITEM_NOT_FOUND';end if;
   if komisio_private.item_lifecycle(p_tenant,p_item)->>'stage' not in ('on_sale','markdown_due','period_ending') then raise exception 'ITEM_NOT_ON_SALE';end if;
   if (select price_ore from public.item_prices where tenant_id=p_tenant and item_id=p_item order by set_at desc,seq desc limit 1)<>(p_product->>'priceOre')::bigint then raise exception 'POS_PRICE_MISMATCH';end if;
  end if;
  if exists(select 1 from public.pos_product_links where tenant_id=p_tenant and provider=p_provider and item_id=item)
   or (p_provider='paypal' and exists(select 1 from public.zettle_product_exports where tenant_id=p_tenant and item_id=item))
   or (p_provider='shopify' and exists(select 1 from public.shopify_product_exports where tenant_id=p_tenant and item_id=item)) then raise exception 'POS_ALREADY_LINKED';end if;
  insert into public.pos_product_links(tenant_id,provider,account,product_id,variant_id,item_id,snapshot,created_by)
  values(p_tenant,p_provider,p_account,p_product->>'productId',p_product->>'variantId',item,p_product,actor);
 end if;
 result:=jsonb_build_object('requestId',p_request,'item',komisio_private.pos_item(p_tenant,item),'created',created);
 perform komisio_private.record_access(p_tenant,'pos.imported',p_request,jsonb_build_object('input',input,'result',result));
 return result;
end $$;

revoke all on function komisio_private.pos_account(uuid,text),komisio_private.pos_item(uuid,uuid) from public,anon,authenticated;
revoke all on function public.pos_import_search(uuid,text),public.pos_import_preview(uuid,text,text,jsonb),public.commit_pos_import(uuid,uuid,text,text,jsonb,text,uuid,uuid,text,boolean) from public,anon;
grant execute on function public.pos_import_search(uuid,text),public.pos_import_preview(uuid,text,text,jsonb),public.commit_pos_import(uuid,uuid,text,text,jsonb,text,uuid,uuid,text,boolean) to authenticated;

-- These catalogs remain managed at their source. No accidental second product,
-- stock initialization or full-product PUT over a merchant's existing metadata.
alter function public.prepare_shopify_product(uuid,uuid) rename to prepare_shopify_product_before_pos_import;
alter function public.prepare_zettle_product(uuid,uuid) rename to prepare_zettle_product_before_pos_import;
revoke all on function public.prepare_shopify_product_before_pos_import(uuid,uuid),public.prepare_zettle_product_before_pos_import(uuid,uuid) from public,anon,authenticated;
create function public.prepare_shopify_product(p_tenant uuid,p_item uuid) returns uuid language plpgsql security definer set search_path='' as $$
begin
 perform komisio_private.require_identity();
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin') then raise exception 'FORBIDDEN' using errcode='42501';end if;
 perform 1 from public.tenants where id=p_tenant for update;
 if exists(select 1 from public.pos_product_links where tenant_id=p_tenant and provider='shopify' and item_id=p_item) then raise exception 'POS_SOURCE_MANAGED';end if;
 return public.prepare_shopify_product_before_pos_import(p_tenant,p_item);
end $$;
create function public.prepare_zettle_product(p_tenant uuid,p_item uuid) returns uuid language plpgsql security definer set search_path='' as $$
begin
 perform komisio_private.require_identity();
 if not (coalesce(public.tenant_role(p_tenant),'') in ('owner','admin','staff') or coalesce(komisio_private.automation_allowed(p_tenant,'catalog_export'),false)) then raise exception 'FORBIDDEN' using errcode='42501';end if;
 perform 1 from public.tenants where id=p_tenant for update;
 if exists(select 1 from public.pos_product_links where tenant_id=p_tenant and provider='paypal' and item_id=p_item) then raise exception 'POS_SOURCE_MANAGED';end if;
 return public.prepare_zettle_product_before_pos_import(p_tenant,p_item);
end $$;
revoke all on function public.prepare_shopify_product(uuid,uuid),public.prepare_zettle_product(uuid,uuid) from public,anon;
grant execute on function public.prepare_shopify_product(uuid,uuid),public.prepare_zettle_product(uuid,uuid) to authenticated;

create function public.pos_import_result(p_tenant uuid,p_request uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare actor uuid:=komisio_private.require_identity(); prior public.access_events;
begin
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin') then raise exception 'FORBIDDEN' using errcode='42501';end if;
 select * into prior from public.access_events where tenant_id=p_tenant and target_id=p_request and action='pos.imported';
 if not found then return null;end if;
 if prior.actor_id<>actor then raise exception 'REQUEST_CONFLICT';end if;
 return prior.detail;
end $$;
revoke all on function public.pos_import_result(uuid,uuid) from public,anon;
grant execute on function public.pos_import_result(uuid,uuid) to authenticated;

alter function komisio_private.item_sync_snapshot(uuid,uuid) rename to item_sync_snapshot_before_pos_import;
create function komisio_private.item_sync_snapshot(p_tenant uuid,p_item uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare result jsonb:='[]'; c jsonb; l public.pos_product_links;
begin
 for c in select value from jsonb_array_elements(komisio_private.item_sync_snapshot_before_pos_import(p_tenant,p_item)) loop
  if not exists(select 1 from public.pos_product_links where tenant_id=p_tenant and item_id=p_item and provider=c->>'provider') then result:=result||jsonb_build_array(c);end if;
 end loop;
 for l in select * from public.pos_product_links where tenant_id=p_tenant and item_id=p_item loop
  result:=result||jsonb_build_array(jsonb_build_object('provider',l.provider,'connectionId',l.provider,'itemId',p_item,'status','linked',
   'productStatus',null,'productAt',l.created_at,'stockStatus',null,'stockAt',null,'imageStatus',null,'errorCode',null,
   'canExport',false,'connected',coalesce(l.account=komisio_private.pos_account(p_tenant,l.provider),false)));
 end loop;
 return result;
end $$;
revoke all on function komisio_private.item_sync_snapshot(uuid,uuid),komisio_private.item_sync_snapshot_before_pos_import(uuid,uuid) from public,anon,authenticated;
