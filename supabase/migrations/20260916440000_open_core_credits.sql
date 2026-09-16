-- Open core and AI credits (owner decision 2026-09-16, replaces the free
-- core with item cap and Butik Plus of the same day): Komisio is free and open;
-- no plan, no item cap, no device cap, and Shopify, Fortnox, chains, the
-- assistant and the hosted connector are open to every store. The only
-- metered resource is the AI assistant's model usage when it runs on the
-- host's own key: each store gets an included monthly amount of AI credits
-- (one credit = one krona, held in öre), can buy more, or connect its own
-- provider key, in which case nothing is metered. A platform-wide monthly cap
-- on the host's own model spend is never exceeded. Everything is enforced in
-- SQL: the reservation before a model call and the settlement after it.
-- Plan states remain for hosted subscriptions of the past; nothing is gated by them
-- except the read-only and closed states a host sets by hand.

create or replace function public.store_shopify_connection(p_tenant uuid,p_shop_domain text,p_shop_name text,p_currency text,p_cipher jsonb,p_scope text,p_expires_at timestamptz) returns jsonb
language plpgsql security definer set search_path='' as $$
declare uid uuid:=komisio_private.require_identity(); existing public.shopify_connections; replacing boolean; host text:=lower(trim(coalesce(p_shop_domain,'')));
begin
 perform 1 from public.tenants where id=p_tenant for update;
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin') then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 if host !~ '^[a-z0-9][a-z0-9-]*\.myshopify\.com$' or length(host)>120 or p_shop_name is null or length(trim(p_shop_name)) not between 1 and 200
  or p_currency is null or length(p_currency)<>3
  or p_cipher is null or jsonb_typeof(p_cipher)<>'object' or not (p_cipher ?& array['iv','tag','data']) or (p_expires_at is not null and not isfinite(p_expires_at)) then raise exception 'INVALID_INPUT'; end if;
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

create or replace function public.prepare_shopify_product(p_tenant uuid,p_item uuid) returns uuid
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

create or replace function public.record_shopify_order_page(p_tenant uuid,p_id uuid,p_before text,p_after text,p_orders jsonb,p_accept_test boolean default false) returns uuid
language plpgsql security definer set search_path='' as $$
declare uid uuid:=komisio_private.require_identity(); prior public.shopify_order_pulls; latest text; p jsonb; stored public.shopify_orders; line jsonb; lines jsonb; matches uuid[]; hold text; n integer; cur text:=komisio_private.store_currency(p_tenant);
begin
 perform 1 from public.tenants where id=p_tenant for update;
 if not (coalesce(public.tenant_role(p_tenant),'') in ('owner','admin') or coalesce(komisio_private.automation_allowed(p_tenant,'shopify_pull'),false)) then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 if not exists(select 1 from public.shopify_connections where tenant_id=p_tenant) then raise exception 'SHOPIFY_NOT_CONNECTED'; end if;
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
    or stored.cancelled is distinct from (p->>'cancelled')::boolean
    or (select jsonb_agg(l-'itemId' order by (l->>'lineNo')::integer) from jsonb_array_elements(stored.lines) l) is distinct from p->'lines' then
    if not exists(select 1 from public.shopify_order_outcomes where tenant_id=p_tenant and order_id=stored.id and error_code='SHOPIFY_ORDER_CHANGED') then
     insert into public.shopify_order_outcomes(tenant_id,order_id,sale_id,error_code,created_by) values(p_tenant,stored.id,null,'SHOPIFY_ORDER_CHANGED',uid);
    end if;
   end if;
   perform komisio_private.apply_shopify_refunds(p_tenant,stored.id,p->'refunds');
   continue;
  end if;
  hold:=case when (p->>'test')::boolean and not coalesce(p_accept_test,false) then 'test' when (p->>'cancelled')::boolean then 'cancelled' when p->>'financialStatus' not in ('PAID','PARTIALLY_REFUNDED','REFUNDED') then 'financial_status' when p->>'currency'<>cur then 'currency' end;
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
  insert into public.shopify_orders(tenant_id,order_gid,name,occurred_at,updated_at,currency,amount_ore,financial_status,is_test,cancelled,hold_reason,lines,created_by)
   values(p_tenant,p->>'orderGid',p->>'name',(p->>'occurredAt')::timestamptz,(p->>'updatedAt')::timestamptz,p->>'currency',(p->>'amountOre')::bigint,p->>'financialStatus',(p->>'test')::boolean,(p->>'cancelled')::boolean,hold,lines,uid) returning * into stored;
  if hold is null then perform komisio_private.reconcile_shopify_order(p_tenant,stored.id); end if;
  perform komisio_private.apply_shopify_refunds(p_tenant,stored.id,p->'refunds');
 end loop;
 insert into public.shopify_order_pulls(id,tenant_id,cursor_before,cursor_after,page,order_count,created_by) values(p_id,p_tenant,p_before,p_after,p_orders,n,uid);
 perform komisio_private.record_access(p_tenant,'shopify.orders_received',p_id,jsonb_build_object('orders',n,'cursor_after',p_after));
 return p_id;
end $$;

create or replace function public.store_fortnox_connection(p_tenant uuid,p_database_number text,p_company_name text,p_organisation_number text,p_cipher jsonb,p_scope text,p_expires_at timestamptz) returns jsonb
language plpgsql security definer set search_path='' as $$
declare uid uuid:=komisio_private.require_identity(); existing public.fortnox_connections; replacing boolean;
begin
 perform 1 from public.tenants where id=p_tenant for update;
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin') then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 if p_database_number is null or length(trim(p_database_number)) not between 1 and 40 or p_company_name is null or length(trim(p_company_name)) not between 1 and 200
  or p_cipher is null or jsonb_typeof(p_cipher)<>'object' or not (p_cipher ?& array['iv','tag','data']) or p_expires_at is null or not isfinite(p_expires_at) then raise exception 'INVALID_INPUT'; end if;
 select * into existing from public.fortnox_connections where tenant_id=p_tenant;
 replacing:=found;
 if replacing and existing.database_number<>trim(p_database_number) then raise exception 'FORTNOX_WRONG_COMPANY'; end if;
 perform set_config('komisio.fortnox_transition','engine',true);
 if replacing then
  update public.fortnox_connections set company_name=trim(p_company_name),organisation_number=coalesce(trim(p_organisation_number),''),cipher=p_cipher,scope=coalesce(p_scope,''),expires_at=p_expires_at,refreshed_at=now() where tenant_id=p_tenant;
 else
  insert into public.fortnox_connections(tenant_id,database_number,company_name,organisation_number,cipher,scope,expires_at,connected_by)
  values(p_tenant,trim(p_database_number),trim(p_company_name),coalesce(trim(p_organisation_number),''),p_cipher,coalesce(p_scope,''),p_expires_at,uid);
 end if;
 perform set_config('komisio.fortnox_transition','',true);
 perform komisio_private.fortnox_event(p_tenant,case when replacing then 'refreshed' else 'connected' end,jsonb_build_object('database_number',trim(p_database_number),'company_name',trim(p_company_name)),uid);
 perform komisio_private.record_access(p_tenant,'fortnox.'||case when replacing then 'refreshed' else 'connected' end,p_tenant,jsonb_build_object('database_number',trim(p_database_number)));
 return jsonb_build_object('databaseNumber',trim(p_database_number),'companyName',trim(p_company_name),'replaced',replacing);
end $$;

create or replace function public.begin_fortnox_send(p_tenant uuid,p_id uuid,p_export uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare uid uuid:=komisio_private.require_identity(); c public.fortnox_connections; e public.accounting_exports; close public.day_closes; prior public.fortnox_voucher_sends; open_row public.fortnox_voucher_sends;
begin
 perform 1 from public.tenants where id=p_tenant for update;
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin') and not komisio_private.automation_allowed(p_tenant,'fortnox_send') then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 if p_id is null or p_export is null then raise exception 'INVALID_INPUT'; end if;
 select * into prior from public.fortnox_voucher_sends where id=p_id;
 if found then
  if prior.tenant_id<>p_tenant or prior.export_id<>p_export or prior.actor<>uid then raise exception 'REQUEST_CONFLICT'; end if;
  return komisio_private.fortnox_send_state(prior)||jsonb_build_object('dispatchAllowed',false);
 end if;
 select * into c from public.fortnox_connections where tenant_id=p_tenant;
 if not found then raise exception 'FORTNOX_NOT_CONNECTED'; end if;
 if komisio_private.store_currency(p_tenant)<>'SEK' then raise exception 'FORTNOX_CURRENCY_UNSUPPORTED'; end if;
 select * into e from public.accounting_exports where tenant_id=p_tenant and id=p_export;
 if not found then raise exception 'EXPORT_NOT_FOUND'; end if;
 select * into open_row from public.fortnox_voucher_sends where tenant_id=p_tenant and export_id=p_export and status in ('pending','sent');
 if found then
  if open_row.status='sent' then raise exception 'FORTNOX_ALREADY_SENT'; end if;
  raise exception 'FORTNOX_SEND_IN_PROGRESS';
 end if;
 if exists(select 1 from public.fortnox_voucher_sends where tenant_id=p_tenant and export_id=p_export and status='failed' and error_code not in ('FORTNOX_PREFLIGHT_FAILED','FORTNOX_WRONG_COMPANY')) then raise exception 'FORTNOX_OUTCOME_UNKNOWN'; end if;
 insert into public.fortnox_voucher_sends(id,tenant_id,export_id,database_number,status,actor) values(p_id,p_tenant,p_export,c.database_number,'pending',uid);
 select * into prior from public.fortnox_voucher_sends where id=p_id;
 return komisio_private.fortnox_send_state(prior)||jsonb_build_object('dispatchAllowed',true);
end $$;

create or replace function public.create_chain(p_id uuid,p_name text,p_tenants uuid[]) returns uuid
language plpgsql security definer set search_path='' as $$
declare uid uuid:=komisio_private.require_identity(); existing public.chains; t uuid; n text:=trim(coalesce(p_name,''));
begin
 if p_id is null or length(n) not between 1 and 100 or p_tenants is null or cardinality(p_tenants)<1 or cardinality(p_tenants)>50
  or (select count(distinct x) from unnest(p_tenants) x)<>cardinality(p_tenants) then raise exception 'INVALID_INPUT'; end if;
 select * into existing from public.chains where id=p_id;
 if found then
  if existing.created_by<>uid then raise exception 'REQUEST_CONFLICT'; end if;
  return existing.id;
 end if;
 foreach t in array p_tenants loop
  perform 1 from public.tenants where id=t for update;
  if coalesce(public.tenant_role(t),'')<>'owner' then raise exception 'FORBIDDEN' using errcode='42501'; end if;
  if exists(select 1 from public.tenants where id=t and chain_id is not null) then raise exception 'CHAIN_CONFLICT'; end if;
 end loop;
 insert into public.chains(id,name,created_by) values(p_id,n,uid);
 foreach t in array p_tenants loop
  perform komisio_private.set_chain(t,p_id,'chain.joined');
 end loop;
 return p_id;
end $$;

create or replace function public.join_chain(p_chain uuid,p_tenant uuid) returns void
language plpgsql security definer set search_path='' as $$
begin
 perform komisio_private.require_identity();
 if p_chain is null or p_tenant is null then raise exception 'INVALID_INPUT'; end if;
 perform 1 from public.tenants where id=p_tenant for update;
 if coalesce(public.tenant_role(p_tenant),'')<>'owner' then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 if not exists(select 1 from public.chains where id=p_chain) then raise exception 'CHAIN_NOT_FOUND'; end if;
 if not exists(select 1 from public.tenants t where t.chain_id=p_chain and coalesce(public.tenant_role(t.id),'')='owner') then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 if exists(select 1 from public.tenants where id=p_tenant and chain_id is not null) then raise exception 'CHAIN_CONFLICT'; end if;
 perform komisio_private.set_chain(p_tenant,p_chain,'chain.joined');
end $$;

create or replace function public.transfer_item(p_from uuid,p_item uuid,p_to uuid,p_id uuid,p_note text default '') returns jsonb
language plpgsql security definer set search_path='' as $$
declare uid uuid:=komisio_private.require_identity(); note text:=trim(coalesce(p_note,'')); item public.items; src public.sellers; dst uuid;
 chain_from uuid; chain_to uuid; from_name text; facts jsonb; prior public.item_events; bag uuid; draft uuid; title text; category text;
 detail jsonb; first uuid; second uuid;
begin
 if p_from is null or p_to is null or p_item is null or p_id is null or p_from=p_to or length(note)>500 then raise exception 'INVALID_INPUT'; end if;
 -- Lock both stores in a fixed order so two opposite transfers cannot deadlock.
 if p_from<p_to then first:=p_from; second:=p_to; else first:=p_to; second:=p_from; end if;
 perform 1 from public.tenants where id=first for update;
 perform 1 from public.tenants where id=second for update;
 if coalesce(public.tenant_role(p_from),'') not in ('owner','admin') or coalesce(public.tenant_role(p_to),'') not in ('owner','admin') then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 select chain_id,name into chain_from,from_name from public.tenants where id=p_from;
 select chain_id into chain_to from public.tenants where id=p_to;
 if chain_from is null or chain_to is distinct from chain_from then raise exception 'NOT_SAME_CHAIN'; end if;
 select * into prior from public.item_events where id=p_id;
 if found then
  if prior.tenant_id<>p_from or prior.item_id<>p_item or prior.kind<>'period_ended' or prior.actor<>uid or prior.detail->>'action' is distinct from 'transfer' then raise exception 'REQUEST_CONFLICT'; end if;
  return jsonb_build_object('transferred',true,'replayed',true,'toTenant',prior.detail->>'toTenant','sellerId',prior.detail->>'sellerId','bagId',prior.detail->>'bagId','draftId',prior.detail->>'draftId');
 end if;
 select * into item from public.items where tenant_id=p_from and id=p_item;
 if not found then raise exception 'ITEM_NOT_FOUND'; end if;
 if item.ownership<>'consignment' or item.seller_id is null then raise exception 'TRANSFER_UNSUPPORTED'; end if;
 facts:=komisio_private.item_lifecycle(p_from,p_item);
 if (facts->>'sold')::boolean then raise exception 'ITEM_NOT_ON_SALE'; end if;
 if (facts->>'ended')::boolean then raise exception 'ITEM_ENDED'; end if;
 select * into src from public.sellers where tenant_id=p_from and id=item.seller_id;
 -- The same person in the target store: matched by e-mail, else by phone; otherwise copied.
 if src.email<>'' then select id into dst from public.sellers where tenant_id=p_to and lower(email)=lower(src.email) order by created_at limit 1; end if;
 if dst is null and src.phone<>'' then select id into dst from public.sellers where tenant_id=p_to and phone=src.phone order by created_at limit 1; end if;
 if dst is null then
  dst:=gen_random_uuid();
  insert into public.sellers(id,tenant_id,name,email,phone,created_by) values(dst,p_to,src.name,src.email,src.phone,uid);
  perform komisio_private.record_access(p_to,'seller.registered',dst,jsonb_build_object('via','transfer','from_tenant',p_from));
 end if;
 title:=coalesce(komisio_private.item_title(p_from,p_item)->>'title','Transferred item');
 category:=coalesce(komisio_private.item_title(p_from,p_item)->>'category','');
 bag:=gen_random_uuid(); draft:=gen_random_uuid();
 insert into public.bag_receipts(id,tenant_id,seller_id,note,created_by)
 values(bag,p_to,dst,left('Transfer from '||from_name||' (item '||p_item::text||')'||case when note<>'' then ': '||note else '' end,500),uid);
 insert into public.inspection_draft_revisions(id,tenant_id,bag_id,draft_id,revision,description,category,condition,created_by)
 values(gen_random_uuid(),p_to,bag,draft,1,left(title,1000),left(category,120),'',uid);
 detail:=jsonb_build_object('action','transfer','note',note,'toTenant',p_to,'sellerId',dst,'bagId',bag,'draftId',draft);
 insert into public.item_events(id,tenant_id,item_id,kind,detail,actor) values(p_id,p_from,p_item,'period_ended',detail,uid);
 perform komisio_private.record_access(p_from,'item.transferred_out',p_item,jsonb_build_object('to_tenant',p_to,'bag_id',bag));
 perform komisio_private.record_access(p_to,'item.transferred_in',bag,jsonb_build_object('from_tenant',p_from,'item_id',p_item,'draft_id',draft));
 return jsonb_build_object('transferred',true,'replayed',false,'toTenant',p_to,'sellerId',dst,'bagId',bag,'draftId',draft);
end $$;

create or replace function public.create_print_pairing_code(p_tenant uuid,p_printer uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare uid uuid:=komisio_private.require_identity(); code text; expires timestamptz:=now()+interval '15 minutes';
begin
 perform 1 from public.tenants where id=p_tenant for update;
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin') then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 if not exists(select 1 from public.printers where tenant_id=p_tenant and id=p_printer and transport='tcp') then raise exception 'PRINTER_NOT_FOUND'; end if;
 code:=upper(left(replace(gen_random_uuid()::text,'-',''),10));
 insert into public.print_pairing_codes(tenant_id,printer_id,code_hash,created_by,expires_at) values(p_tenant,p_printer,encode(sha256(convert_to(code,'UTF8')),'hex'),uid,expires);
 perform komisio_private.record_access(p_tenant,'print.pairing_code_created',p_printer,jsonb_build_object('expires_at',expires));
 return jsonb_build_object('code',left(code,5)||'-'||right(code,5),'expiresAt',expires);
end $$;

create or replace function public.shopify_automation_tenants() returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
 perform komisio_private.require_identity();
 return coalesce((select jsonb_agg(jsonb_build_object('tenantId',g.tenant_id)) from public.automation_grants g
  where g.scope='shopify_pull' and g.accepted_by=auth.uid() and g.disabled_at is null
  and komisio_private.automation_allowed(g.tenant_id,'shopify_pull')
  and exists(select 1 from public.shopify_connections c where c.tenant_id=g.tenant_id)),'[]'::jsonb);
end $$;

create or replace function public.fortnox_automation_tenants() returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
 perform komisio_private.require_identity();
 return (select coalesce(jsonb_agg(jsonb_build_object('tenantId',g.tenant_id) order by g.tenant_id),'[]') from public.automation_grants g
 where g.scope='fortnox_send' and g.disabled_at is null and g.accepted_by=auth.uid() and komisio_private.automation_allowed(g.tenant_id,'fortnox_send'));
end $$;

create or replace function public.authorize_connector(p_id uuid,p_tenant uuid,p_client uuid,p_redirect_uri text,p_scopes text[],p_code_challenge text,p_code_hash text,p_aal text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare uid uuid:=komisio_private.require_identity(); c public.connector_clients; g public.connector_grants;
begin
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin','staff','readonly') then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 select * into c from public.connector_clients where id=p_client;
 if not found or p_redirect_uri is null or not (p_redirect_uri=any(c.redirect_uris)) then raise exception 'INVALID_INPUT'; end if;
 if p_id is null or p_scopes is null or cardinality(p_scopes) not between 1 and 20 or (select count(distinct s) from unnest(p_scopes) s)<>cardinality(p_scopes)
  or exists(select 1 from unnest(p_scopes) s where not (s=any(komisio_private.connector_scopes())))
  or p_code_challenge !~ '^[A-Za-z0-9_-]{43,128}$' or p_code_hash !~ '^[0-9a-f]{64}$' or p_aal not in ('aal1','aal2') then raise exception 'INVALID_INPUT'; end if;
 if exists(select 1 from public.connector_grants where id=p_id) then raise exception 'REQUEST_CONFLICT'; end if;
 insert into public.connector_grants(id,tenant_id,user_id,client_id,scopes,aal) values(p_id,p_tenant,uid,p_client,p_scopes,p_aal) returning * into g;
 insert into public.connector_codes(code_hash,grant_id,redirect_uri,code_challenge,expires_at) values(p_code_hash,p_id,p_redirect_uri,p_code_challenge,now()+interval '10 minutes');
 perform komisio_private.record_access(p_tenant,'connector.authorized',p_id,jsonb_build_object('client',c.name,'scopes',to_jsonb(p_scopes)));
 return komisio_private.connector_grant_state(g);
end $$;

create or replace function komisio_private.connector_grant_for(p_access_hash text) returns public.connector_grants
language plpgsql stable set search_path='' as $$
declare t public.connector_tokens; g public.connector_grants;
begin
 if p_access_hash !~ '^[0-9a-f]{64}$' then raise exception 'CONNECTOR_TOKEN_INVALID' using errcode='42501'; end if;
 select * into t from public.connector_tokens where token_hash=p_access_hash and kind='access';
 if not found or t.expires_at<=now() then raise exception 'CONNECTOR_TOKEN_INVALID' using errcode='42501'; end if;
 select * into g from public.connector_grants where id=t.grant_id;
 if g.revoked_at is not null then raise exception 'CONNECTOR_REVOKED' using errcode='42501'; end if;
 return g;
end $$;

-- The gate trigger keeps only the hand-set read-only and closed states.
create or replace function komisio_private.plan_gate() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 perform komisio_private.require_writable(new.tenant_id);
 return new;
end $$;
-- What members see: the state and its dates; no tier, no caps.
create or replace function public.plan_status(p_tenant uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare p public.tenant_plans;
begin
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin','staff','readonly','automation') and not public.is_platform_host() then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 if not komisio_private.billing_enabled() then return jsonb_build_object('billing',false,'state','active','writable',true); end if;
 select * into p from public.tenant_plans where tenant_id=p_tenant;
 if not found then return jsonb_build_object('billing',true,'state','active','writable',true,'provider','none'); end if;
 return jsonb_build_object('billing',true,'state',p.state,'writable',p.state not in ('read_only','closed'),'provider',p.provider,'trialEndsAt',p.trial_ends_at,'graceEndsAt',p.grace_ends_at,'activeUntil',p.active_until,
  'daysLeft',case when p.state='trial' then greatest(0,ceil(extract(epoch from p.trial_ends_at-now())/86400))::int when p.state='past_due' then greatest(0,ceil(extract(epoch from p.grace_ends_at-now())/86400))::int end);
end $$;
drop function komisio_private.require_plus(uuid,text);
drop function komisio_private.plan_tier(uuid);
drop function komisio_private.free_item_limit();
drop function komisio_private.free_device_limit();
drop function komisio_private.plus_device_limit();

-- 2. AI credits. Platform-wide settings (one row, host-managed).
alter table public.platform_settings
 add column ai_credits_enabled boolean not null default false,
 add column ai_monthly_cap_ore bigint not null default 200000 check(ai_monthly_cap_ore>=0),
 add column ai_included_ore integer not null default 10000 check(ai_included_ore>=0),
 add column ai_pack_ore integer not null default 10000 check(ai_pack_ore>0),
 add column ai_reserve_ore integer not null default 50 check(ai_reserve_ore>0),
 add column ai_reserve_batch_ore integer not null default 200 check(ai_reserve_batch_ore>0),
 add column ai_input_ore_per_million numeric(12,2) not null default 420 check(ai_input_ore_per_million>=0),
 add column ai_output_ore_per_million numeric(12,2) not null default 1700 check(ai_output_ore_per_million>=0);
-- Every movement of credits is a row: included grants per month, purchases,
-- reservations before a model call and settlements after it. Never edited.
create table public.ai_credit_events(
 id uuid primary key default gen_random_uuid(),
 tenant_id uuid not null references public.tenants(id),
 kind text not null check(kind in ('included','purchased','reserved','settled','adjustment')),
 amount_ore bigint not null,
 funded_by text not null default 'included' check(funded_by in ('included','purchased','own')),
 period text not null check(period ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
 reference text,
 model text,
 input_tokens integer,
 output_tokens integer,
 detail jsonb not null default '{}',
 recorded_by uuid references auth.users(id),
 created_at timestamptz not null default clock_timestamp()
);
create index ai_credit_events_tenant on public.ai_credit_events(tenant_id,created_at desc);
create index ai_credit_events_period on public.ai_credit_events(period,kind) where funded_by='included';
create unique index ai_credit_events_included on public.ai_credit_events(tenant_id,period) where kind='included';
create unique index ai_credit_events_reference on public.ai_credit_events(kind,reference) where reference is not null;
alter table public.ai_credit_events enable row level security;
revoke all on public.ai_credit_events from public,anon,authenticated;
grant select on public.ai_credit_events to authenticated;
create policy ai_credit_events_read on public.ai_credit_events for select to authenticated using(public.tenant_role(tenant_id) in ('owner','admin','staff','readonly'));
create policy ai_credit_events_boundary on public.ai_credit_events as restrictive for all to authenticated using(public.tenant_role(tenant_id) in ('owner','admin','staff','readonly')) with check(false);
create trigger ai_credit_events_immutable before update or delete on public.ai_credit_events for each row execute function komisio_private.preserve_usage_event();
-- A store's own provider key: sealed by the application, never readable in clear from SQL.
create table public.ai_connections(
 tenant_id uuid primary key references public.tenants(id),
 provider text not null check(provider in ('openai')),
 model text not null check(model ~ '^[a-zA-Z0-9._:-]{1,100}$'),
 cipher jsonb not null check(jsonb_typeof(cipher)='object' and cipher ?& array['iv','tag','data']),
 connected_by uuid not null references auth.users(id),
 connected_at timestamptz not null default now()
);
alter table public.ai_connections enable row level security;
revoke all on public.ai_connections from public,anon,authenticated;
-- Stores the host may show, anonymously, on the public pricing page.
create table public.store_showcase(
 tenant_id uuid primary key references public.tenants(id),
 label text not null check(length(label) between 1 and 120),
 added_by uuid not null references auth.users(id),
 added_at timestamptz not null default now()
);
alter table public.store_showcase enable row level security;
revoke all on public.store_showcase from public,anon,authenticated;

create function komisio_private.ai_settings() returns public.platform_settings
language sql stable security definer set search_path='' as $$ select s from public.platform_settings s; $$;
revoke all on function komisio_private.ai_settings() from public,anon,authenticated;
-- The included grant of the current month, written once when first needed.
create function komisio_private.ai_grant_included(p_tenant uuid) returns void
language plpgsql security definer set search_path='' as $$
declare s public.platform_settings:=komisio_private.ai_settings(); p text:=komisio_private.usage_period(clock_timestamp());
begin
 if s.ai_included_ore>0 and not exists(select 1 from public.ai_credit_events e where e.tenant_id=p_tenant and e.kind='included' and e.period=p) then
  insert into public.ai_credit_events(tenant_id,kind,amount_ore,funded_by,period,reference) values(p_tenant,'included',s.ai_included_ore,'included',p,'included:'||p_tenant||':'||p);
 end if;
end $$;
revoke all on function komisio_private.ai_grant_included(uuid) from public,anon,authenticated;
-- Balances: included credits expire with the month; purchased credits do not.
create function komisio_private.ai_balances(p_tenant uuid,p_period text) returns table(included_left bigint,purchased_left bigint)
language sql stable security definer set search_path='' as $$
 select
  greatest(0,coalesce((select sum(amount_ore) from public.ai_credit_events e where e.tenant_id=p_tenant and e.period=p_period and e.funded_by='included'),0)),
  greatest(0,coalesce((select sum(amount_ore) from public.ai_credit_events e where e.tenant_id=p_tenant and e.funded_by='purchased'),0));
$$;
revoke all on function komisio_private.ai_balances(uuid,text) from public,anon,authenticated;
create function komisio_private.ai_cap_used(p_period text) returns bigint
language sql stable security definer set search_path='' as $$
 select coalesce(-sum(amount_ore),0) from public.ai_credit_events e where e.period=p_period and e.funded_by='included' and e.kind in ('reserved','settled');
$$;
revoke all on function komisio_private.ai_cap_used(text) from public,anon,authenticated;
create function komisio_private.ai_cost_ore(p_input integer,p_output integer) returns bigint
language sql stable security definer set search_path='' as $$
 select ceil(coalesce(p_input,0)*s.ai_input_ore_per_million/1000000.0+coalesce(p_output,0)*s.ai_output_ore_per_million/1000000.0)::bigint from public.platform_settings s;
$$;
revoke all on function komisio_private.ai_cost_ore(integer,integer) from public,anon,authenticated;

-- Reservation: the assistant is free with the store's own key; on the host's
-- key it needs credits and room under the platform cap. The reservation is
-- the estimate; the settlement corrects it to the actual token cost.

create or replace function public.reserve_reception_assistance(p_tenant uuid,p_request uuid,p_session uuid,p_revision integer,p_model text,p_prompt text) returns boolean
language plpgsql security definer set search_path='' as $$
declare uid uuid:=komisio_private.require_identity(); prior public.reception_assistance_attempts; latest integer; moment timestamptz; s public.platform_settings; est bigint; p text; inc bigint; pur bigint; fund text;
begin
 perform 1 from public.tenants where id=p_tenant for update;
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin','staff') then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 if p_request is null or p_session is null or p_revision is null or p_revision<1
  or p_model is null or p_model !~ '^[a-zA-Z0-9._:-]{1,100}$' or (p_prompt is null or p_prompt not in ('reception-v1','reception-batch-v1')) then raise exception 'INVALID_INPUT'; end if;
 select * into prior from public.reception_assistance_attempts where id=p_request;
 if found then
  if prior.tenant_id is distinct from p_tenant or prior.session_id is distinct from p_session or prior.source_revision is distinct from p_revision
   or prior.created_by is distinct from uid or prior.model is distinct from p_model or prior.prompt_version is distinct from p_prompt then raise exception 'REQUEST_CONFLICT'; end if;
  return false;
 end if;
 select revision into latest from public.reception_source_revisions where tenant_id=p_tenant and session_id=p_session order by revision desc limit 1;
 if latest is distinct from p_revision then raise exception 'RECEPTION_CHANGED'; end if;
 moment:=clock_timestamp();
 if exists(select 1 from public.reception_assistance_attempts where tenant_id=p_tenant and created_at>moment-interval '20 seconds')
  or (select count(*) from public.reception_assistance_attempts where tenant_id=p_tenant and created_at>moment-interval '24 hours')>=10 then raise exception 'ASSISTANCE_LIMIT'; end if;
 insert into public.reception_assistance_attempts(id,tenant_id,session_id,source_revision,created_by,model,prompt_version,created_at)
 values(p_request,p_tenant,p_session,p_revision,uid,p_model,p_prompt,moment);
 s:=komisio_private.ai_settings();
 if s.ai_credits_enabled and not exists(select 1 from public.ai_connections c where c.tenant_id=p_tenant) then
  p:=komisio_private.usage_period(moment);
  est:=case when p_prompt='reception-batch-v1' then s.ai_reserve_batch_ore else s.ai_reserve_ore end;
  perform komisio_private.ai_grant_included(p_tenant);
  select included_left,purchased_left into inc,pur from komisio_private.ai_balances(p_tenant,p);
  if inc>=est then fund:='included'; elsif pur>=est then fund:='purchased'; else raise exception 'AI_CREDITS_EXHAUSTED' using errcode='55000'; end if;
  if fund='included' and komisio_private.ai_cap_used(p)+est>s.ai_monthly_cap_ore then
   if pur>=est then fund:='purchased'; else raise exception 'AI_CAP_REACHED' using errcode='55000'; end if;
  end if;
  insert into public.ai_credit_events(tenant_id,kind,amount_ore,funded_by,period,reference,model,recorded_by) values(p_tenant,'reserved',-est,fund,p,'attempt:'||p_request,p_model,uid);
 end if;
 perform komisio_private.record_access(p_tenant,'reception.assistance_reserved',p_session,jsonb_build_object('request',p_request,'source_revision',p_revision));
 return true;
end $$;

-- Settlement after the model answered (or failed: zero tokens releases the reservation).
create function public.settle_reception_assistance(p_tenant uuid,p_request uuid,p_input_tokens integer,p_output_tokens integer) returns jsonb
language plpgsql security definer set search_path='' as $$
declare uid uuid:=komisio_private.require_identity(); r public.ai_credit_events; actual bigint;
begin
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin','staff') then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 if p_input_tokens is null or p_output_tokens is null or p_input_tokens<0 or p_output_tokens<0 or p_input_tokens>10000000 or p_output_tokens>10000000 then raise exception 'INVALID_INPUT'; end if;
 select * into r from public.ai_credit_events where kind='reserved' and reference='attempt:'||p_request and tenant_id=p_tenant;
 if not found then return jsonb_build_object('metered',false); end if;
 if exists(select 1 from public.ai_credit_events where kind='settled' and reference='attempt:'||p_request) then return jsonb_build_object('metered',true,'replayed',true); end if;
 actual:=komisio_private.ai_cost_ore(p_input_tokens,p_output_tokens);
 insert into public.ai_credit_events(tenant_id,kind,amount_ore,funded_by,period,reference,model,input_tokens,output_tokens,recorded_by)
  values(p_tenant,'settled',-r.amount_ore-actual,r.funded_by,r.period,'attempt:'||p_request,r.model,p_input_tokens,p_output_tokens,uid);
 return jsonb_build_object('metered',true,'costOre',actual,'fundedBy',r.funded_by);
end $$;

-- A purchase recorded by the billing actor from the Stripe webhook, once per event.
create function public.record_ai_credit_purchase(p_event_id text,p_tenant uuid,p_amount_ore bigint,p_detail jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
begin
 perform komisio_private.require_identity();
 if not komisio_private.is_billing_actor() then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 if p_event_id is null or length(p_event_id) not between 1 and 200 or p_tenant is null or p_amount_ore is null or p_amount_ore<=0 or p_amount_ore>10000000 then raise exception 'INVALID_INPUT'; end if;
 if exists(select 1 from public.ai_credit_events where kind='purchased' and reference='stripe:'||p_event_id) then return jsonb_build_object('replayed',true); end if;
 if not exists(select 1 from public.tenants where id=p_tenant) then return jsonb_build_object('replayed',false,'matched',false); end if;
 insert into public.ai_credit_events(tenant_id,kind,amount_ore,funded_by,period,reference,detail) values(p_tenant,'purchased',p_amount_ore,'purchased',komisio_private.usage_period(clock_timestamp()),'stripe:'||p_event_id,coalesce(p_detail,'{}'));
 perform komisio_private.record_access(p_tenant,'ai.credits_purchased',null,jsonb_build_object('amountOre',p_amount_ore));
 return jsonb_build_object('replayed',false,'matched',true);
end $$;

-- What members see under Settings: balances, this month's usage, the pack price and whether an own key is connected.
create function public.ai_credits(p_tenant uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare s public.platform_settings:=komisio_private.ai_settings(); p text:=komisio_private.usage_period(clock_timestamp()); inc bigint; pur bigint; used bigint; attempts bigint; avg_ore numeric;
begin
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin','staff','readonly') then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 select included_left,purchased_left into inc,pur from komisio_private.ai_balances(p_tenant,p);
 select coalesce(-sum(amount_ore),0) into used from public.ai_credit_events e where e.tenant_id=p_tenant and e.period=p and e.kind in ('reserved','settled');
 select count(*),coalesce(avg(-amount_ore),0) into attempts,avg_ore from public.ai_credit_events e where e.kind='settled' and e.created_at>now()-interval '90 days';
 return jsonb_build_object('enabled',s.ai_credits_enabled,'period',p,
  'includedOre',s.ai_included_ore,'includedLeftOre',case when exists(select 1 from public.ai_credit_events e where e.tenant_id=p_tenant and e.kind='included' and e.period=p) then inc else s.ai_included_ore end,
  'purchasedLeftOre',pur,'usedThisPeriodOre',used,'packOre',s.ai_pack_ore,
  'ownKey',exists(select 1 from public.ai_connections c where c.tenant_id=p_tenant),
  'ownModel',(select c.model from public.ai_connections c where c.tenant_id=p_tenant),
  'capReached',komisio_private.ai_cap_used(p)>=s.ai_monthly_cap_ore,
  'estimatedItemsPerMonth',case when attempts>=20 and avg_ore>0 then floor(s.ai_included_ore/avg_ore)::int else floor(s.ai_included_ore/s.ai_reserve_ore*2.5)::int end);
end $$;
-- Own key: owner or admin connects; the run reads the sealed box through its own function.
create function public.store_ai_connection(p_tenant uuid,p_provider text,p_model text,p_cipher jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare uid uuid:=komisio_private.require_identity();
begin
 perform 1 from public.tenants where id=p_tenant for update;
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin') then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 if p_provider is distinct from 'openai' or p_model is null or p_model !~ '^[a-zA-Z0-9._:-]{1,100}$' or p_cipher is null or jsonb_typeof(p_cipher)<>'object' or not (p_cipher ?& array['iv','tag','data']) then raise exception 'INVALID_INPUT'; end if;
 insert into public.ai_connections(tenant_id,provider,model,cipher,connected_by) values(p_tenant,p_provider,p_model,p_cipher,uid)
  on conflict(tenant_id) do update set provider=excluded.provider,model=excluded.model,cipher=excluded.cipher,connected_by=uid,connected_at=now();
 perform komisio_private.record_access(p_tenant,'ai.own_key_connected',null,jsonb_build_object('provider',p_provider,'model',p_model));
 return jsonb_build_object('provider',p_provider,'model',p_model);
end $$;
create function public.remove_ai_connection(p_tenant uuid) returns void
language plpgsql security definer set search_path='' as $$
begin
 perform komisio_private.require_identity();
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin') then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 delete from public.ai_connections where tenant_id=p_tenant;
 perform komisio_private.record_access(p_tenant,'ai.own_key_removed',null,'{}'::jsonb);
end $$;
create function public.ai_connection_cipher(p_tenant uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
 perform komisio_private.require_identity();
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin','staff') then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 return (select jsonb_build_object('provider',c.provider,'model',c.model,'cipher',c.cipher) from public.ai_connections c where c.tenant_id=p_tenant);
end $$;

-- Host: the platform-wide AI settings and the showcase list.
create function public.ai_platform_settings() returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare s public.platform_settings:=komisio_private.ai_settings(); p text:=komisio_private.usage_period(clock_timestamp());
begin
 perform komisio_private.require_identity();
 if not public.is_platform_host() then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 return jsonb_build_object('enabled',s.ai_credits_enabled,'monthlyCapOre',s.ai_monthly_cap_ore,'includedOre',s.ai_included_ore,'packOre',s.ai_pack_ore,
  'reserveOre',s.ai_reserve_ore,'reserveBatchOre',s.ai_reserve_batch_ore,'inputOrePerMillion',s.ai_input_ore_per_million,'outputOrePerMillion',s.ai_output_ore_per_million,
  'period',p,'capUsedOre',komisio_private.ai_cap_used(p),
  'showcase',coalesce((select jsonb_agg(jsonb_build_object('tenantId',x.tenant_id,'label',x.label) order by x.added_at) from public.store_showcase x),'[]'::jsonb));
end $$;
create function public.set_ai_platform_settings(p jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
begin
 perform komisio_private.require_identity();
 if not public.is_platform_host() then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 if p is null or jsonb_typeof(p)<>'object' then raise exception 'INVALID_INPUT'; end if;
 update public.platform_settings set
  ai_credits_enabled=coalesce((p->>'enabled')::boolean,ai_credits_enabled),
  ai_monthly_cap_ore=coalesce((p->>'monthlyCapOre')::bigint,ai_monthly_cap_ore),
  ai_included_ore=coalesce((p->>'includedOre')::integer,ai_included_ore),
  ai_pack_ore=coalesce((p->>'packOre')::integer,ai_pack_ore),
  ai_reserve_ore=coalesce((p->>'reserveOre')::integer,ai_reserve_ore),
  ai_reserve_batch_ore=coalesce((p->>'reserveBatchOre')::integer,ai_reserve_batch_ore),
  ai_input_ore_per_million=coalesce((p->>'inputOrePerMillion')::numeric,ai_input_ore_per_million),
  ai_output_ore_per_million=coalesce((p->>'outputOrePerMillion')::numeric,ai_output_ore_per_million),
  updated_at=now();
 return public.ai_platform_settings();
end $$;
create function public.set_store_showcase(p_tenant uuid,p_label text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare uid uuid:=komisio_private.require_identity();
begin
 if not public.is_platform_host() then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 if p_tenant is null or not exists(select 1 from public.tenants where id=p_tenant) then raise exception 'INVALID_INPUT'; end if;
 if p_label is null or length(trim(p_label))=0 then delete from public.store_showcase where tenant_id=p_tenant;
 elsif length(trim(p_label))>120 then raise exception 'INVALID_INPUT';
 else insert into public.store_showcase(tenant_id,label,added_by) values(p_tenant,trim(p_label),uid) on conflict(tenant_id) do update set label=excluded.label,added_by=uid,added_at=now();
 end if;
 return public.ai_platform_settings();
end $$;
-- Public: the offer and real, anonymous figures for the stores the host listed.
create function public.public_pricing() returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare s public.platform_settings:=komisio_private.ai_settings(); p text:=komisio_private.usage_period(clock_timestamp()); attempts bigint; avg_ore numeric;
begin
 select count(*),coalesce(avg(-amount_ore),0) into attempts,avg_ore from public.ai_credit_events e where e.kind='settled' and e.created_at>now()-interval '90 days';
 return jsonb_build_object('includedOre',s.ai_included_ore,'packOre',s.ai_pack_ore,
  'estimatedItemsPerMonth',case when attempts>=20 and avg_ore>0 then floor(s.ai_included_ore/avg_ore)::int else floor(s.ai_included_ore/s.ai_reserve_ore*2.5)::int end,
  'measured',attempts>=20,
  'stores',coalesce((select jsonb_agg(jsonb_build_object(
    'label',x.label,
    'itemsPerMonth',(select count(*) from public.items i where i.tenant_id=x.tenant_id and i.accepted_at>now()-interval '30 days'),
    'costOre',(select coalesce(sum(e.amount_ore),0) from public.ai_credit_events e where e.tenant_id=x.tenant_id and e.kind='purchased' and e.created_at>now()-interval '30 days')
   ) order by x.added_at) from public.store_showcase x),'[]'::jsonb));
end $$;
revoke all on function public.settle_reception_assistance(uuid,uuid,integer,integer),public.record_ai_credit_purchase(text,uuid,bigint,jsonb),public.ai_credits(uuid),
 public.store_ai_connection(uuid,text,text,jsonb),public.remove_ai_connection(uuid),public.ai_connection_cipher(uuid),public.ai_platform_settings(),public.set_ai_platform_settings(jsonb),
 public.set_store_showcase(uuid,text),public.public_pricing() from public,anon,authenticated;
grant execute on function public.settle_reception_assistance(uuid,uuid,integer,integer),public.record_ai_credit_purchase(text,uuid,bigint,jsonb),public.ai_credits(uuid),
 public.store_ai_connection(uuid,text,text,jsonb),public.remove_ai_connection(uuid),public.ai_connection_cipher(uuid),public.ai_platform_settings(),public.set_ai_platform_settings(jsonb),
 public.set_store_showcase(uuid,text) to authenticated;
grant execute on function public.public_pricing() to anon,authenticated;
