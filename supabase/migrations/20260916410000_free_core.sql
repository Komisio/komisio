-- Free core and Butik Plus (owner decision 2026-09-16, replaces the
-- trial-then-read-only model of C1 to C6): a hosted store is free with the
-- core (reception, labels, one print device, seller portal, Zettle, manual
-- payouts, statements, day close and SIE export) up to a monthly intake
-- cap; Butik Plus (the existing subscription, SEK 199 per store and month
-- excluding VAT) lifts the cap and opens Shopify, Fortnox, the assistant,
-- chains and more print devices. A new store gets thirty days of Plus and
-- then drops to the free core instead of read-only; a lapsed subscription
-- drops to free too. Read-only remains for closed stores only. The gate
-- stays in SQL: komisio_private.require_plus and the item cap in the plan
-- gate trigger, so the interface, MCP and extensions cannot differ.
alter table public.tenant_plans drop constraint tenant_plans_state_check;
alter table public.tenant_plans add constraint tenant_plans_state_check check(state in ('free','trial','active','past_due','read_only','closed'));

create function komisio_private.free_item_limit() returns integer language sql immutable set search_path='' as $$ select 100 $$;
create function komisio_private.free_device_limit() returns integer language sql immutable set search_path='' as $$ select 1 $$;
create function komisio_private.plus_device_limit() returns integer language sql immutable set search_path='' as $$ select 5 $$;

-- plus: self-hosted (billing off), stores older than billing, trial, active and grace. free: the free core and lapsed plans.
create function komisio_private.plan_tier(p_tenant uuid) returns text
language plpgsql stable security definer set search_path='' as $$
declare s text;
begin
 if not komisio_private.billing_enabled() then return 'plus'; end if;
 select state into s from public.tenant_plans where tenant_id=p_tenant;
 if s is null or s in ('trial','active','past_due') then return 'plus'; end if;
 return 'free';
end $$;

create function komisio_private.require_plus(p_tenant uuid,p_feature text) returns void
language plpgsql stable security definer set search_path='' as $$
begin
 if komisio_private.plan_tier(p_tenant)='free' then raise exception 'PLAN_PLUS_REQUIRED' using errcode='55000', detail=coalesce(p_feature,''); end if;
end $$;
revoke all on function komisio_private.free_item_limit(),komisio_private.free_device_limit(),komisio_private.plus_device_limit(),komisio_private.plan_tier(uuid),komisio_private.require_plus(uuid,text) from public,anon,authenticated;

-- The gate trigger: read-only stores record nothing; free stores accept at most the monthly cap of items.
create or replace function komisio_private.plan_gate() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 perform komisio_private.require_writable(new.tenant_id);
 if tg_table_name='items' and komisio_private.plan_tier(new.tenant_id)='free'
  and (select count(*) from public.items i where i.tenant_id=new.tenant_id and i.accepted_at>=date_trunc('month',now()))>=komisio_private.free_item_limit() then
  raise exception 'PLAN_LIMIT_ITEMS' using errcode='55000';
 end if;
 return new;
end $$;

-- What members see: the state, the tier and how much of the free core is used.
create or replace function public.plan_status(p_tenant uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare p public.tenant_plans; tier text; used integer; devices integer;
begin
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin','staff','readonly','automation') and not public.is_platform_host() then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 if not komisio_private.billing_enabled() then return jsonb_build_object('billing',false,'state','active','tier','plus','writable',true); end if;
 tier:=komisio_private.plan_tier(p_tenant);
 select count(*) into used from public.items i where i.tenant_id=p_tenant and i.accepted_at>=date_trunc('month',now());
 select count(*) into devices from public.print_devices d where d.tenant_id=p_tenant and d.revoked_at is null;
 select * into p from public.tenant_plans where tenant_id=p_tenant;
 if not found then return jsonb_build_object('billing',true,'state','active','tier','plus','writable',true,'provider','none','itemsThisMonth',used,'itemLimit',null,'devices',devices,'deviceLimit',komisio_private.plus_device_limit()); end if;
 return jsonb_build_object('billing',true,'state',p.state,'tier',tier,'writable',p.state not in ('read_only','closed'),'provider',p.provider,'trialEndsAt',p.trial_ends_at,'graceEndsAt',p.grace_ends_at,'activeUntil',p.active_until,
  'daysLeft',case when p.state='trial' then greatest(0,ceil(extract(epoch from p.trial_ends_at-now())/86400))::int when p.state='past_due' then greatest(0,ceil(extract(epoch from p.grace_ends_at-now())/86400))::int end,
  'itemsThisMonth',used,'itemLimit',case when tier='free' then komisio_private.free_item_limit() end,'devices',devices,'deviceLimit',case when tier='free' then komisio_private.free_device_limit() else komisio_private.plus_device_limit() end);
end $$;


-- Daily: a lapsed trial, grace or manual activation drops to the free core.
create or replace function komisio_private.expire_plans() returns jsonb
language plpgsql security definer set search_path='' as $$
declare p record; n int:=0;
begin
 if not komisio_private.billing_enabled() then return jsonb_build_object('expired',0); end if;
 for p in select * from public.tenant_plans where (state='trial' and trial_ends_at<=now()) or (state='past_due' and grace_ends_at<=now()) or (state='active' and active_until is not null and active_until<=now()) for update loop
  perform 1 from public.tenants where id=p.tenant_id for update;
  perform set_config('komisio.plan_transition','engine',true);
  update public.tenant_plans set state='free',updated_at=now() where tenant_id=p.tenant_id;
  perform set_config('komisio.plan_transition','',true);
  perform komisio_private.plan_event(p.tenant_id,case p.state when 'trial' then 'trial_expired' when 'past_due' then 'grace_expired' else 'activation_expired' end,p.state,'free','{}'::jsonb,p.deadline_set_by);
  n:=n+1;
 end loop;
 return jsonb_build_object('expired',n);
end $$;

-- Stripe: a cancelled or unpaid subscription drops to the free core.
create or replace function public.record_billing_event(p_event_id text,p_type text,p_tenant uuid,p_customer text,p_subscription text,p_outcome text,p_period_end timestamptz,p_detail jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare uid uuid:=komisio_private.require_identity(); p public.tenant_plans; tenant uuid:=p_tenant; prior text; kind text; to_state text;
begin
 if not komisio_private.is_billing_actor() then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 if not komisio_private.billing_enabled() then raise exception 'BILLING_DISABLED'; end if;
 if p_event_id is null or length(p_event_id) not between 1 and 100 or p_type is null or p_outcome not in ('active','past_due','read_only','cancel_at_period_end','none') or p_detail is null or jsonb_typeof(p_detail)<>'object' then raise exception 'INVALID_INPUT'; end if;
 if exists(select 1 from public.billing_events where id=p_event_id) then return jsonb_build_object('replayed',true); end if;
 if tenant is null and coalesce(p_subscription,'')<>'' then select tenant_id into tenant from public.tenant_plans where provider='stripe' and provider_subscription_id=p_subscription; end if;
 if tenant is null and coalesce(p_customer,'')<>'' then select tenant_id into tenant from public.tenant_plans where provider='stripe' and provider_customer_id=p_customer; end if;
 if tenant is null or not exists(select 1 from public.tenants where id=tenant) then
  insert into public.billing_events(id,type,tenant_id,outcome,detail) values(p_event_id,p_type,null,'unmatched',p_detail);
  return jsonb_build_object('replayed',false,'matched',false);
 end if;
 perform 1 from public.tenants where id=tenant for update;
 select * into p from public.tenant_plans where tenant_id=tenant;
 prior:=p.state;
 insert into public.billing_events(id,type,tenant_id,outcome,detail) values(p_event_id,p_type,tenant,p_outcome,p_detail);
 if p_outcome='none' or prior='closed' then return jsonb_build_object('replayed',false,'matched',true,'state',coalesce(prior,'active')); end if;
 to_state:=case p_outcome when 'active' then 'active' when 'cancel_at_period_end' then 'active' when 'past_due' then 'past_due' else 'free' end;
 kind:=case p_outcome when 'active' then 'activated' when 'cancel_at_period_end' then 'cancel_scheduled' when 'past_due' then 'payment_failed' else 'subscription_ended' end;
 perform set_config('komisio.plan_transition','engine',true);
 if p.tenant_id is null then
  insert into public.tenant_plans(tenant_id,state,provider,deadline_set_by,provider_customer_id,provider_subscription_id,grace_ends_at,active_until)
  values(tenant,to_state,'stripe',uid,coalesce(p_customer,''),coalesce(p_subscription,''),case when to_state='past_due' then now()+interval '14 days' end,case when p_outcome='cancel_at_period_end' then p_period_end end);
 else
  update public.tenant_plans set state=to_state,provider='stripe',deadline_set_by=uid,updated_at=now(),
   provider_customer_id=coalesce(nullif(p_customer,''),provider_customer_id),provider_subscription_id=coalesce(nullif(p_subscription,''),provider_subscription_id),
   trial_ends_at=case when to_state='active' then null else trial_ends_at end,
   grace_ends_at=case when to_state='past_due' then coalesce(case when prior='past_due' then grace_ends_at end,now()+interval '14 days') else null end,
   active_until=case when p_outcome='cancel_at_period_end' then p_period_end else null end
  where tenant_id=tenant;
 end if;
 perform set_config('komisio.plan_transition','',true);
 perform komisio_private.plan_event(tenant,kind,prior,to_state,jsonb_build_object('eventId',p_event_id,'type',p_type,'periodEnd',p_period_end),uid);
 return jsonb_build_object('replayed',false,'matched',true,'state',to_state);
end $$;

create or replace function public.store_shopify_connection(p_tenant uuid,p_shop_domain text,p_shop_name text,p_currency text,p_cipher jsonb,p_scope text,p_expires_at timestamptz) returns jsonb
language plpgsql security definer set search_path='' as $$
declare uid uuid:=komisio_private.require_identity(); existing public.shopify_connections; replacing boolean; host text:=lower(trim(coalesce(p_shop_domain,'')));
begin
 perform 1 from public.tenants where id=p_tenant for update;
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin') then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 perform komisio_private.require_plus(p_tenant,'shopify');
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
 perform komisio_private.require_plus(p_tenant,'shopify');
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
 perform komisio_private.require_plus(p_tenant,'shopify');
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
  perform komisio_private.require_plus(p_tenant,'fortnox');
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
  perform komisio_private.require_plus(p_tenant,'fortnox');
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

create or replace function public.reserve_reception_assistance(p_tenant uuid,p_request uuid,p_session uuid,p_revision integer,p_model text,p_prompt text) returns boolean
language plpgsql security definer set search_path='' as $$
declare uid uuid:=komisio_private.require_identity(); prior public.reception_assistance_attempts; latest integer; moment timestamptz;
begin
 perform 1 from public.tenants where id=p_tenant for update;
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin','staff') then raise exception 'FORBIDDEN' using errcode='42501'; end if;
  perform komisio_private.require_plus(p_tenant,'assistant');
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
 perform komisio_private.record_access(p_tenant,'reception.assistance_reserved',p_session,jsonb_build_object('request',p_request,'source_revision',p_revision));
 return true;
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
   perform komisio_private.require_plus(t,'chains');
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
  perform komisio_private.require_plus(p_tenant,'chains');
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
  perform komisio_private.require_plus(p_from,'chains'); perform komisio_private.require_plus(p_to,'chains');
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
 if (select count(*) from public.print_devices d where d.tenant_id=p_tenant and d.revoked_at is null)>=(case komisio_private.plan_tier(p_tenant) when 'plus' then komisio_private.plus_device_limit() else komisio_private.free_device_limit() end) then raise exception 'PLAN_LIMIT_DEVICES' using errcode='55000'; end if;
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
  where g.scope='shopify_pull' and g.accepted_by=auth.uid() and g.disabled_at is null and komisio_private.plan_tier(g.tenant_id)='plus'
  and komisio_private.automation_allowed(g.tenant_id,'shopify_pull')
  and exists(select 1 from public.shopify_connections c where c.tenant_id=g.tenant_id)),'[]'::jsonb);
end $$;

create or replace function public.fortnox_automation_tenants() returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
 perform komisio_private.require_identity();
 return (select coalesce(jsonb_agg(jsonb_build_object('tenantId',g.tenant_id) order by g.tenant_id),'[]') from public.automation_grants g
 where g.scope='fortnox_send' and g.disabled_at is null and komisio_private.plan_tier(g.tenant_id)='plus' and g.accepted_by=auth.uid() and komisio_private.automation_allowed(g.tenant_id,'fortnox_send'));
end $$;

-- The ended-trial notice: the store continues on the free core (legacy read_only rows keep their notice).
create or replace function public.due_plan_notices() returns table(tenant_id uuid,store_name text,kind text,deadline timestamptz,locale text,emails text[])
language plpgsql stable security definer set search_path='' as $$
begin
 perform komisio_private.require_identity();
 if not komisio_private.is_billing_actor() then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 if not komisio_private.billing_enabled() then return; end if;
 return query
 with due as (
  select p.tenant_id,'trial_week'::text as kind,p.trial_ends_at as deadline from public.tenant_plans p where p.state='trial' and p.trial_ends_at<=now()+interval '7 days'
  union all
  select p.tenant_id,'trial_tomorrow',p.trial_ends_at from public.tenant_plans p where p.state='trial' and p.trial_ends_at<=now()+interval '1 day'
  union all
  select p.tenant_id,'trial_ended',p.trial_ends_at from public.tenant_plans p where p.state in ('free','read_only') and p.provider='none' and p.trial_ends_at is not null and p.trial_ends_at>now()-interval '3 days'
  union all
  select p.tenant_id,'grace_week',p.grace_ends_at from public.tenant_plans p where p.state='past_due' and p.grace_ends_at<=now()+interval '7 days'
 )
 select d.tenant_id,t.name,d.kind,d.deadline,
  coalesce((select nullif(pr.locale,'') from public.user_profiles pr join public.tenant_members m on m.user_id=pr.user_id where m.tenant_id=d.tenant_id and m.role='owner' order by m.created_at limit 1),'sv'),
  coalesce((select array_agg(lower(u.email) order by m.created_at) from public.tenant_members m join auth.users u on u.id=m.user_id where m.tenant_id=d.tenant_id and m.role='owner' and u.email is not null),'{}'::text[])
 from due d join public.tenants t on t.id=d.tenant_id
 where not exists(select 1 from public.plan_notices n where n.tenant_id=d.tenant_id and n.kind=d.kind)
 order by d.deadline,d.tenant_id limit 200;
end $$;
