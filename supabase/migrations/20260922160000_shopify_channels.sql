begin;
-- Configuration survives reconnects so an established location cannot silently move.
create table komisio_private.shopify_sync_settings (
 tenant_id uuid primary key references public.tenants(id),
 shop_domain text not null,
 revision bigint not null,
 settings jsonb not null
);
alter table komisio_private.shopify_sync_settings enable row level security;
revoke all on komisio_private.shopify_sync_settings from public,anon,authenticated;

create function public.shopify_sync_settings(p_tenant uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare s komisio_private.shopify_sync_settings;
begin
 perform komisio_private.require_identity();
 if not (coalesce(public.tenant_role(p_tenant),'') in ('owner','admin','staff','readonly') or coalesce(komisio_private.automation_allowed(p_tenant,'shopify_pull'),false)) then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 select * into s from komisio_private.shopify_sync_settings where tenant_id=p_tenant;
 if s.tenant_id is not null and not exists(select 1 from public.shopify_connections where tenant_id=p_tenant and shop_domain=s.shop_domain) then raise exception 'SHOPIFY_WRONG_SHOP'; end if;
 return jsonb_build_object('settings',s.settings,'revision',coalesce(s.revision,0)::text,'locked',exists(select 1 from public.shopify_product_exports where tenant_id=p_tenant) or exists(select 1 from public.shopify_order_pulls where tenant_id=p_tenant));
end $$;

create function public.save_shopify_sync_settings(p_tenant uuid,p_shop text,p_revision bigint,p_settings jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare s komisio_private.shopify_sync_settings; mode text:=p_settings->>'mode';
begin
 perform komisio_private.require_identity();
 perform 1 from public.tenants where id=p_tenant for update;
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin') then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 if not exists(select 1 from public.shopify_connections where tenant_id=p_tenant and shop_domain=p_shop) then raise exception 'SHOPIFY_WRONG_SHOP'; end if;
 select * into s from komisio_private.shopify_sync_settings where tenant_id=p_tenant;
 if p_revision is distinct from coalesce(s.revision,0) then raise exception 'SHOPIFY_SETTINGS_CHANGED'; end if;
 if exists(select 1 from public.shopify_product_exports where tenant_id=p_tenant) or exists(select 1 from public.shopify_order_pulls where tenant_id=p_tenant) then raise exception 'SHOPIFY_SETTINGS_LOCKED'; end if;
 if p_settings is null or jsonb_typeof(p_settings)<>'object' or not (p_settings ?& array['mode','locationId','locationName','webPublicationId','posPublicationId']) or (p_settings-array['mode','locationId','locationName','webPublicationId','posPublicationId'])<>'{}'::jsonb
 or jsonb_typeof(p_settings->'locationName')<>'string'
 or coalesce(mode,'') not in ('web','pos','both') or coalesce(p_settings->>'locationId','') !~ '^gid://shopify/Location/[0-9]{1,30}$' or coalesce(length(p_settings->>'locationName'),0) not between 1 and 200
 or (mode in ('web','both') and coalesce(p_settings->>'webPublicationId','') !~ '^gid://shopify/Publication/[0-9]{1,30}$')
 or (mode in ('pos','both') and coalesce(p_settings->>'posPublicationId','') !~ '^gid://shopify/Publication/[0-9]{1,30}$')
 or (mode='web' and p_settings->'posPublicationId'<>'null'::jsonb) or (mode='pos' and p_settings->'webPublicationId'<>'null'::jsonb)
 or (mode='both' and p_settings->>'webPublicationId'=p_settings->>'posPublicationId') then raise exception 'INVALID_INPUT'; end if;
 insert into komisio_private.shopify_sync_settings values(p_tenant,p_shop,coalesce(s.revision,0)+1,p_settings)
 on conflict(tenant_id) do update set shop_domain=excluded.shop_domain,revision=excluded.revision,settings=excluded.settings;
 perform komisio_private.record_access(p_tenant,'shopify.settings_saved',p_tenant,p_settings||jsonb_build_object('shop_domain',p_shop,'revision',coalesce(s.revision,0)+1));
 return public.shopify_sync_settings(p_tenant);
end $$;
revoke all on function public.shopify_sync_settings(uuid),public.save_shopify_sync_settings(uuid,text,bigint,jsonb) from public,anon;
grant execute on function public.shopify_sync_settings(uuid),public.save_shopify_sync_settings(uuid,text,bigint,jsonb) to authenticated;

alter table public.shopify_orders add column source_name text, add column retail_location_gid text;

alter table public.shopify_orders drop constraint shopify_orders_hold_reason_check;
alter table public.shopify_orders add constraint shopify_orders_hold_reason_check check(hold_reason is null or hold_reason in ('test','cancelled','financial_status','currency','quantity','unknown_sku','missing_item','ambiguous_item','channel','location'));

create or replace function public.prepare_shopify_product(p_tenant uuid,p_item uuid) returns uuid
language plpgsql security definer set search_path='' as $$
declare uid uuid:=komisio_private.require_identity(); c public.shopify_connections; item public.items; price public.item_prices; prior public.shopify_product_exports;
 cfg jsonb; f jsonb; t jsonb; title text; gid text; result uuid;
begin
 perform 1 from public.tenants where id=p_tenant for update;
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin') then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 select * into c from public.shopify_connections where tenant_id=p_tenant;
 if not found then raise exception 'SHOPIFY_NOT_CONNECTED'; end if;
 cfg:=public.shopify_sync_settings(p_tenant)->'settings';
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
   'price',to_char(price.price_ore/100.0,'FM999999999990.00'),'currency',komisio_private.store_currency(p_tenant),'quantity',1,'syncSettings',cfg),
  gid,uid) returning id into result;
 perform komisio_private.record_access(p_tenant,'shopify.product_prepared',p_item,jsonb_build_object('export_id',result,'price_ore',price.price_ore));
 return result;
end $$;

create or replace function komisio_private.valid_shopify_order(p jsonb) returns boolean language plpgsql immutable set search_path='' as $$
declare line jsonb; r jsonb; n integer:=0; m integer; total numeric:=0; keys text[]:=array['orderGid','name','occurredAt','updatedAt','currency','amountOre','financialStatus','test','cancelled','lines'];
begin
 if p is null or jsonb_typeof(p)<>'object' or not (p ?& keys) or (p-keys-'refunds'-'sourceName'-'retailLocationGid')<>'{}'::jsonb then return false; end if;
 if p ? 'sourceName' and p->'sourceName'<>'null'::jsonb and (jsonb_typeof(p->'sourceName')<>'string' or length(p->>'sourceName') not between 1 and 100) then return false; end if;
 if p ? 'retailLocationGid' and p->'retailLocationGid'<>'null'::jsonb and (jsonb_typeof(p->'retailLocationGid')<>'string' or p->>'retailLocationGid' !~ '^gid://shopify/Location/[0-9]{1,30}$') then return false; end if;
 if jsonb_typeof(p->'orderGid')<>'string' or (p->>'orderGid') !~ '^gid://shopify/Order/[0-9]{1,30}$' or jsonb_typeof(p->'name')<>'string' or length(p->>'name') not between 1 and 40 then return false; end if;
 if jsonb_typeof(p->'occurredAt')<>'string' or not isfinite((p->>'occurredAt')::timestamptz) or jsonb_typeof(p->'updatedAt')<>'string' or not isfinite((p->>'updatedAt')::timestamptz) then return false; end if;
 if jsonb_typeof(p->'currency')<>'string' or length(p->>'currency')<>3 or jsonb_typeof(p->'amountOre')<>'number' or (p->>'amountOre') !~ '^-?[0-9]{1,11}$' then return false; end if;
 if jsonb_typeof(p->'financialStatus')<>'string' or length(p->>'financialStatus') not between 1 and 40 or jsonb_typeof(p->'test')<>'boolean' or jsonb_typeof(p->'cancelled')<>'boolean' then return false; end if;
 if jsonb_typeof(p->'lines')<>'array' or jsonb_array_length(p->'lines') not between 1 and 50 then return false; end if;
 for line in select * from jsonb_array_elements(p->'lines') loop
  n:=n+1;
  if jsonb_typeof(line)<>'object' or not (line ?& array['lineNo','sku','description','quantity','priceOre']) or (line-array['lineNo','sku','description','quantity','priceOre'])<>'{}'::jsonb then return false; end if;
  if line->'lineNo'<>to_jsonb(n) or jsonb_typeof(line->'description')<>'string' or length(line->>'description')>120 then return false; end if;
  if line->'sku'<>'null'::jsonb and (jsonb_typeof(line->'sku')<>'string' or length(line->>'sku')>200) then return false; end if;
  if jsonb_typeof(line->'quantity')<>'number' or (line->>'quantity') !~ '^[0-9]{1,6}$' or jsonb_typeof(line->'priceOre')<>'number' or (line->>'priceOre') !~ '^-?[0-9]{1,11}$' then return false; end if;
  total:=total+(line->>'priceOre')::numeric;
 end loop;
 if total<>(p->>'amountOre')::numeric then return false; end if;
 if p ? 'refunds' then
  if jsonb_typeof(p->'refunds')<>'array' or jsonb_array_length(p->'refunds')>20 then return false; end if;
  for r in select * from jsonb_array_elements(p->'refunds') loop
   if jsonb_typeof(r)<>'object' or not (r ?& array['refundGid','occurredAt','amountOre','lines']) or (r-array['refundGid','occurredAt','amountOre','lines'])<>'{}'::jsonb then return false; end if;
   if jsonb_typeof(r->'refundGid')<>'string' or (r->>'refundGid') !~ '^gid://shopify/Refund/[0-9]{1,30}$' or jsonb_typeof(r->'occurredAt')<>'string' or not isfinite((r->>'occurredAt')::timestamptz) then return false; end if;
   if jsonb_typeof(r->'amountOre')<>'number' or (r->>'amountOre') !~ '^-?[0-9]{1,11}$' or jsonb_typeof(r->'lines')<>'array' or jsonb_array_length(r->'lines')>50 then return false; end if;
   m:=0;
   for line in select * from jsonb_array_elements(r->'lines') loop
    m:=m+1;
    if jsonb_typeof(line)<>'object' or not (line ?& array['lineNo','sku','quantity','amountOre']) or (line-array['lineNo','sku','quantity','amountOre'])<>'{}'::jsonb then return false; end if;
    if line->'lineNo'<>to_jsonb(m) or (line->'sku'<>'null'::jsonb and (jsonb_typeof(line->'sku')<>'string' or length(line->>'sku')>200)) then return false; end if;
    if jsonb_typeof(line->'quantity')<>'number' or (line->>'quantity') !~ '^[0-9]{1,6}$' or jsonb_typeof(line->'amountOre')<>'number' or (line->>'amountOre') !~ '^-?[0-9]{1,11}$' then return false; end if;
   end loop;
  end loop;
 end if;
 return true;
exception when others then return false;
end $$;

create or replace function public.record_shopify_order_page(p_tenant uuid,p_id uuid,p_before text,p_after text,p_orders jsonb,p_accept_test boolean default false) returns uuid
language plpgsql security definer set search_path='' as $$
declare uid uuid:=komisio_private.require_identity(); prior public.shopify_order_pulls; latest text; cfg jsonb; p jsonb; stored public.shopify_orders; line jsonb; lines jsonb; matches uuid[]; hold text; n integer; cur text:=komisio_private.store_currency(p_tenant);
begin
 perform 1 from public.tenants where id=p_tenant for update;
 if not (coalesce(public.tenant_role(p_tenant),'') in ('owner','admin') or coalesce(komisio_private.automation_allowed(p_tenant,'shopify_pull'),false)) then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 if not exists(select 1 from public.shopify_connections where tenant_id=p_tenant) then raise exception 'SHOPIFY_NOT_CONNECTED'; end if;
 cfg:=public.shopify_sync_settings(p_tenant)->'settings';
 if p_id is null or p_orders is null or jsonb_typeof(p_orders)<>'array' or jsonb_array_length(p_orders)>50 or length(p_before)>100 or length(p_after)>100 or p_before='' or p_after='' then raise exception 'INVALID_INPUT'; end if;
 select * into prior from public.shopify_order_pulls where id=p_id;
 if found then
  if prior.tenant_id is distinct from p_tenant or prior.cursor_before is distinct from p_before or prior.cursor_after is distinct from p_after or prior.page is distinct from p_orders or prior.created_by is distinct from uid then raise exception 'REQUEST_CONFLICT'; end if;
  return p_id;
 end if;
 latest:=komisio_private.shopify_watermark(p_tenant);
 if latest is distinct from p_before then raise exception 'SHOPIFY_CURSOR_CHANGED'; end if;
 n:=jsonb_array_length(p_orders);
 if (n>0 and p_after is null) or (n=0 and p_after is distinct from p_before) then raise exception 'INVALID_INPUT'; end if;
 for p in select * from jsonb_array_elements(p_orders) loop
  if not komisio_private.valid_shopify_order(p) then raise exception 'INVALID_INPUT'; end if;
  select * into stored from public.shopify_orders where tenant_id=p_tenant and order_gid=p->>'orderGid';
  if found then
   -- The same order again (a later page, or a replay): no new evidence. A changed order is held for a person.
   if stored.occurred_at is distinct from (p->>'occurredAt')::timestamptz or stored.amount_ore is distinct from (p->>'amountOre')::bigint or stored.currency is distinct from p->>'currency'
    or (stored.source_name is not null and (stored.source_name is distinct from p->>'sourceName' or stored.retail_location_gid is distinct from p->>'retailLocationGid'))
    or stored.cancelled is distinct from (p->>'cancelled')::boolean
    or (select jsonb_agg(l-'itemId' order by (l->>'lineNo')::integer) from jsonb_array_elements(stored.lines) l) is distinct from p->'lines' then
    if not exists(select 1 from public.shopify_order_outcomes where tenant_id=p_tenant and order_id=stored.id and error_code='SHOPIFY_ORDER_CHANGED') then
     insert into public.shopify_order_outcomes(tenant_id,order_id,sale_id,error_code,created_by) values(p_tenant,stored.id,null,'SHOPIFY_ORDER_CHANGED',uid);
    end if;
   end if;
   perform komisio_private.apply_shopify_refunds(p_tenant,stored.id,p->'refunds');
   continue;
  end if;
  hold:=case when cfg<>'null'::jsonb and not coalesce((p->>'sourceName'='web' and cfg->>'mode' in ('web','both')) or (p->>'sourceName'='pos' and cfg->>'mode' in ('pos','both')),false) then 'channel'
   when cfg<>'null'::jsonb and p->>'sourceName'='pos' and p->>'retailLocationGid' is distinct from cfg->>'locationId' then 'location'
   when (p->>'test')::boolean and not coalesce(p_accept_test,false) then 'test' when (p->>'cancelled')::boolean then 'cancelled' when p->>'financialStatus' not in ('PAID','PARTIALLY_REFUNDED','REFUNDED') then 'financial_status' when p->>'currency'<>cur then 'currency' end;
  lines:='[]'::jsonb;
  for line in select * from jsonb_array_elements(p->'lines') loop
   matches:=null;
   if line->>'sku' ~ '^K-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    select array_agg(i.id) into matches from public.items i where i.tenant_id=p_tenant and i.id=substr(line->>'sku',3)::uuid;
   end if;
   if hold is null then
    hold:=case when (line->>'quantity')::integer<>1 then 'quantity' when line->'sku'='null'::jsonb or line->>'sku' !~ '^K-' then 'unknown_sku' when cardinality(matches)=0 or matches is null then 'missing_item' when cardinality(matches)>1 then 'ambiguous_item' end;
   end if;
   lines:=lines||(line||jsonb_build_object('itemId',case when cardinality(matches)=1 then matches[1] end));
  end loop;
  insert into public.shopify_orders(tenant_id,order_gid,name,occurred_at,updated_at,currency,amount_ore,financial_status,is_test,cancelled,hold_reason,lines,created_by,source_name,retail_location_gid)
   values(p_tenant,p->>'orderGid',p->>'name',(p->>'occurredAt')::timestamptz,(p->>'updatedAt')::timestamptz,p->>'currency',(p->>'amountOre')::bigint,p->>'financialStatus',(p->>'test')::boolean,(p->>'cancelled')::boolean,hold,lines,uid,p->>'sourceName',p->>'retailLocationGid') returning * into stored;
  if hold is null then perform komisio_private.reconcile_shopify_order(p_tenant,stored.id); end if;
  perform komisio_private.apply_shopify_refunds(p_tenant,stored.id,p->'refunds');
 end loop;
 insert into public.shopify_order_pulls(id,tenant_id,cursor_before,cursor_after,page,order_count,created_by) values(p_id,p_tenant,p_before,p_after,p_orders,n,uid);
 perform komisio_private.record_access(p_tenant,'shopify.orders_received',p_id,jsonb_build_object('orders',n,'cursor_after',p_after));
 return p_id;
end $$;

create or replace function public.shopify_order_status(p_tenant uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin','staff','readonly') then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 return jsonb_build_object(
  'lastPullAt',(select created_at from public.shopify_order_pulls where tenant_id=p_tenant order by seq desc limit 1),
  'cursor',(select cursor_after from public.shopify_order_pulls where tenant_id=p_tenant order by seq desc limit 1),
  'pulls',(select count(*) from public.shopify_order_pulls where tenant_id=p_tenant),
  'held',(select count(*) from public.shopify_orders o where o.tenant_id=p_tenant and (o.hold_reason is not null or exists(select 1 from public.shopify_order_outcomes x where x.tenant_id=p_tenant and x.order_id=o.id and x.error_code is not null and x.seq=(select max(seq) from public.shopify_order_outcomes y where y.tenant_id=p_tenant and y.order_id=o.id))))
   +(select count(*) from public.shopify_refund_outcomes f where f.tenant_id=p_tenant and f.error_code is not null),
  'orders',coalesce((select jsonb_agg(jsonb_build_object('id',o.id,'name',o.name,'occurredAt',o.occurred_at,'currency',o.currency,'amountOre',o.amount_ore,'holdReason',o.hold_reason,'sourceName',o.source_name,'retailLocationGid',o.retail_location_gid,'lines',jsonb_array_length(o.lines),
    'saleId',x.sale_id,'errorCode',x.error_code,
    'returned',(select count(*) from public.shopify_refund_outcomes f join public.shopify_refunds rf on rf.tenant_id=f.tenant_id and rf.id=f.refund_id where f.tenant_id=p_tenant and rf.order_id=o.id and f.return_id is not null),
    'refundsHeld',(select count(*) from public.shopify_refund_outcomes f join public.shopify_refunds rf on rf.tenant_id=f.tenant_id and rf.id=f.refund_id where f.tenant_id=p_tenant and rf.order_id=o.id and f.error_code is not null),
    'refundError',(select f.error_code from public.shopify_refund_outcomes f join public.shopify_refunds rf on rf.tenant_id=f.tenant_id and rf.id=f.refund_id where f.tenant_id=p_tenant and rf.order_id=o.id and f.error_code is not null order by f.seq desc limit 1)) order by o.seq desc)
   from (select * from public.shopify_orders where tenant_id=p_tenant order by seq desc limit 30) o
   left join lateral (select * from public.shopify_order_outcomes x where x.tenant_id=p_tenant and x.order_id=o.id order by x.seq desc limit 1) x on true),'[]'::jsonb));
end $$;

create or replace function public.store_shopify_connection(p_tenant uuid,p_shop_domain text,p_shop_name text,p_currency text,p_cipher jsonb,p_scope text,p_expires_at timestamptz) returns jsonb
language plpgsql security definer set search_path='' as $$
declare uid uuid:=komisio_private.require_identity(); existing public.shopify_connections; replacing boolean; host text:=lower(trim(coalesce(p_shop_domain,'')));
begin
 perform 1 from public.tenants where id=p_tenant for update;
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin') then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 if host !~ '^[a-z0-9][a-z0-9-]*\.myshopify\.com$' or length(host)>120 or p_shop_name is null or length(trim(p_shop_name)) not between 1 and 200
  or p_currency is null or length(p_currency)<>3
  or p_cipher is null or jsonb_typeof(p_cipher)<>'object' or not (p_cipher ?& array['iv','tag','data']) or (p_expires_at is not null and not isfinite(p_expires_at)) then raise exception 'INVALID_INPUT'; end if;
 if exists(select 1 from komisio_private.shopify_sync_settings where tenant_id=p_tenant and shop_domain<>host) then raise exception 'SHOPIFY_WRONG_SHOP'; end if;
 select * into existing from public.shopify_connections where tenant_id=p_tenant;
 replacing:=found;
 if replacing and existing.shop_domain<>host then raise exception 'SHOPIFY_WRONG_SHOP'; end if;
 perform set_config('komisio.shopify_transition','engine',true);
 if replacing then
  update public.shopify_connections set shop_name=trim(p_shop_name),currency=upper(p_currency),cipher=p_cipher,scope=coalesce(p_scope,''),expires_at=p_expires_at,refreshed_at=now(),revision=nextval('komisio_private.fortnox_connection_revision') where tenant_id=p_tenant;
 else
  insert into public.shopify_connections(tenant_id,shop_domain,shop_name,currency,cipher,scope,expires_at,connected_by)
  values(p_tenant,host,trim(p_shop_name),upper(p_currency),p_cipher,coalesce(p_scope,''),p_expires_at,uid);
 end if;
 perform set_config('komisio.shopify_transition','',true);
 perform komisio_private.shopify_event(p_tenant,case when replacing then 'refreshed' else 'connected' end,jsonb_build_object('shop_domain',host,'shop_name',trim(p_shop_name)),uid);
 perform komisio_private.record_access(p_tenant,'shopify.'||case when replacing then 'refreshed' else 'connected' end,p_tenant,jsonb_build_object('shop_domain',host));
 return jsonb_build_object('shopDomain',host,'shopName',trim(p_shop_name),'replaced',replacing);
end $$;

commit;
