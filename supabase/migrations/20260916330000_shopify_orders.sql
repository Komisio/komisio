-- Shopify adapter, step 3 (docs/SHOPIFY-ADAPTER.md): paid orders in. The
-- application pulls paid orders updated since a stored watermark and hands
-- each page here as minimized evidence (order id, name, time, currency,
-- amount, status flags, lines with sku and line total). A page is recorded
-- once per request id and only on top of the latest watermark. Each new
-- order is matched by sku K-<item id>; an order whose lines all match, in
-- the store's currency, one unit per line, paid, not cancelled, not a test
-- order, becomes a sale through record_sale (provider shopify, the order
-- id as external id). Anything else is held for a person with a reason.
-- Evidence and outcomes are immutable; record_sale is the only financial writer.
create table public.shopify_order_pulls (
 id uuid primary key,
 seq bigint generated always as identity,
 tenant_id uuid not null references public.tenants(id),
 cursor_before text,
 cursor_after text,
 page jsonb not null check(jsonb_typeof(page)='array'),
 order_count integer not null check(order_count between 0 and 50),
 created_by uuid not null references auth.users(id),
 created_at timestamptz not null default now()
);
create table public.shopify_orders (
 id uuid primary key default gen_random_uuid(),
 seq bigint generated always as identity,
 tenant_id uuid not null references public.tenants(id),
 order_gid text not null check(order_gid ~ '^gid://shopify/Order/[0-9]{1,30}$'),
 name text not null check(length(name) between 1 and 40),
 occurred_at timestamptz not null,
 updated_at timestamptz not null,
 currency text not null check(length(currency)=3),
 amount_ore bigint not null,
 financial_status text not null check(length(financial_status) between 1 and 40),
 is_test boolean not null,
 cancelled boolean not null,
 hold_reason text check(hold_reason is null or hold_reason in ('test','cancelled','financial_status','currency','quantity','unknown_sku','missing_item','ambiguous_item')),
 lines jsonb not null check(jsonb_typeof(lines)='array'),
 created_by uuid not null references auth.users(id),
 created_at timestamptz not null default now(),
 unique(tenant_id,order_gid),
 unique(tenant_id,id)
);
create table public.shopify_order_outcomes (
 id uuid primary key default gen_random_uuid(),
 seq bigint generated always as identity,
 tenant_id uuid not null references public.tenants(id),
 order_id uuid not null,
 sale_id uuid,
 error_code text check(error_code is null or error_code ~ '^[A-Z_]{1,100}$'),
 created_by uuid not null references auth.users(id),
 created_at timestamptz not null default now(),
 foreign key(tenant_id,order_id) references public.shopify_orders(tenant_id,id),
 check((sale_id is null)<>(error_code is null))
);
create index shopify_order_pull_latest on public.shopify_order_pulls(tenant_id,seq desc);
create index shopify_order_list on public.shopify_orders(tenant_id,seq desc);
create index shopify_order_outcome_latest on public.shopify_order_outcomes(tenant_id,order_id,seq desc);
do $$ declare t text; begin
 foreach t in array array['shopify_order_pulls','shopify_orders','shopify_order_outcomes'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('revoke all on public.%I from public,anon,authenticated',t);
  execute format('grant select on public.%I to authenticated',t);
  execute format('create policy read_store on public.%I for select to authenticated using(public.tenant_role(tenant_id) in (''owner'',''admin'',''staff'',''readonly''))',t);
  execute format('create policy store_boundary on public.%I as restrictive for all to authenticated using(public.tenant_role(tenant_id) in (''owner'',''admin'',''staff'',''readonly'')) with check(false)',t);
  execute format('create trigger immutable before update or delete on public.%I for each row execute function komisio_private.preserve_shopify()',t);
 end loop;
end $$;

create function komisio_private.valid_shopify_order(p jsonb) returns boolean language plpgsql immutable set search_path='' as $$
declare line jsonb; n integer:=0; total numeric:=0; keys text[]:=array['orderGid','name','occurredAt','updatedAt','currency','amountOre','financialStatus','test','cancelled','lines'];
begin
 if p is null or jsonb_typeof(p)<>'object' or not (p ?& keys) or (p-keys)<>'{}'::jsonb then return false; end if;
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
 return true;
exception when others then return false;
end $$;
revoke all on function komisio_private.valid_shopify_order(jsonb) from public,anon,authenticated;

-- The watermark the next pull continues from: the last page's cursor, else when the shop was connected.
create function komisio_private.shopify_watermark(p_tenant uuid) returns text language sql stable set search_path='' as $$
 select coalesce((select cursor_after from public.shopify_order_pulls where tenant_id=p_tenant order by seq desc limit 1),
  (select to_char(connected_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"') from public.shopify_connections where tenant_id=p_tenant));
$$;
revoke all on function komisio_private.shopify_watermark(uuid) from public,anon,authenticated;

-- Record the sale for one held-nowhere order, or the reason it could not be recorded. Idempotent per state.
create function komisio_private.reconcile_shopify_order(p_tenant uuid,p_order uuid) returns uuid language plpgsql security definer set search_path='' as $$
declare uid uuid:=komisio_private.require_identity(); o public.shopify_orders; lines jsonb; result uuid; failure text; last public.shopify_order_outcomes;
begin
 select * into o from public.shopify_orders where tenant_id=p_tenant and id=p_order;
 if not found then raise exception 'SHOPIFY_ORDER_NOT_FOUND'; end if;
 if o.hold_reason is not null then raise exception 'SHOPIFY_ORDER_HELD'; end if;
 select jsonb_agg(jsonb_build_object('itemId',(l->>'itemId')::uuid,'priceOre',(l->>'priceOre')::bigint) order by (l->>'lineNo')::integer) into lines from jsonb_array_elements(o.lines) l;
 begin
  result:=public.record_sale(p_tenant,o.id,'shopify',o.order_gid,o.occurred_at,o.currency,lines,jsonb_build_object('shopifyOrderName',o.name,'shopifyOrderId',o.id));
 exception when others then
  failure:=case when sqlerrm ~ '^[A-Z_]{1,100}$' then sqlerrm else 'SHOPIFY_RECORD_FAILED' end;
 end;
 select * into last from public.shopify_order_outcomes where tenant_id=p_tenant and order_id=p_order order by seq desc limit 1;
 if last.sale_id is not distinct from result and last.error_code is not distinct from failure then return result; end if;
 insert into public.shopify_order_outcomes(tenant_id,order_id,sale_id,error_code,created_by) values(p_tenant,p_order,result,failure,uid);
 perform komisio_private.record_access(p_tenant,case when result is null then 'shopify.order_failed' else 'shopify.order_recorded' end,p_order,jsonb_build_object('sale_id',result,'error_code',failure,'order_gid',o.order_gid));
 return result;
end $$;
revoke all on function komisio_private.reconcile_shopify_order(uuid,uuid) from public,anon,authenticated;

-- p_accept_test: a pilot store on a development shop only sees test orders; the deployment says whether they count.
create function public.record_shopify_order_page(p_tenant uuid,p_id uuid,p_before text,p_after text,p_orders jsonb,p_accept_test boolean default false) returns uuid
language plpgsql security definer set search_path='' as $$
declare uid uuid:=komisio_private.require_identity(); prior public.shopify_order_pulls; latest text; p jsonb; stored public.shopify_orders; line jsonb; lines jsonb; matches uuid[]; hold text; n integer; cur text:=komisio_private.store_currency(p_tenant);
begin
 perform 1 from public.tenants where id=p_tenant for update;
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin') then raise exception 'FORBIDDEN' using errcode='42501'; end if;
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
    or stored.cancelled is distinct from (p->>'cancelled')::boolean or stored.financial_status is distinct from p->>'financialStatus'
    or (select jsonb_agg(l-'itemId' order by (l->>'lineNo')::integer) from jsonb_array_elements(stored.lines) l) is distinct from p->'lines' then
    if not exists(select 1 from public.shopify_order_outcomes where tenant_id=p_tenant and order_id=stored.id and error_code='SHOPIFY_ORDER_CHANGED') then
     insert into public.shopify_order_outcomes(tenant_id,order_id,sale_id,error_code,created_by) values(p_tenant,stored.id,null,'SHOPIFY_ORDER_CHANGED',uid);
    end if;
   end if;
   continue;
  end if;
  hold:=case when (p->>'test')::boolean and not coalesce(p_accept_test,false) then 'test' when (p->>'cancelled')::boolean then 'cancelled' when p->>'financialStatus'<>'PAID' then 'financial_status' when p->>'currency'<>cur then 'currency' end;
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
 end loop;
 insert into public.shopify_order_pulls(id,tenant_id,cursor_before,cursor_after,page,order_count,created_by) values(p_id,p_tenant,p_before,p_after,p_orders,n,uid);
 perform komisio_private.record_access(p_tenant,'shopify.orders_received',p_id,jsonb_build_object('orders',n,'cursor_after',p_after));
 return p_id;
end $$;

-- Retry the sale for an order whose recording failed (for example after the item's state was corrected).
create function public.reconcile_shopify_order(p_tenant uuid,p_order uuid) returns uuid language plpgsql security definer set search_path='' as $$
begin
 perform komisio_private.require_identity(); perform 1 from public.tenants where id=p_tenant for update;
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin') then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 return komisio_private.reconcile_shopify_order(p_tenant,p_order);
end $$;

create function public.shopify_order_cursor(p_tenant uuid) returns text language plpgsql stable security definer set search_path='' as $$
begin
 perform komisio_private.require_identity();
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin') then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 return komisio_private.shopify_watermark(p_tenant);
end $$;

create function public.shopify_order_status(p_tenant uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin','staff','readonly') then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 return jsonb_build_object(
  'lastPullAt',(select created_at from public.shopify_order_pulls where tenant_id=p_tenant order by seq desc limit 1),
  'cursor',(select cursor_after from public.shopify_order_pulls where tenant_id=p_tenant order by seq desc limit 1),
  'pulls',(select count(*) from public.shopify_order_pulls where tenant_id=p_tenant),
  'held',(select count(*) from public.shopify_orders o where o.tenant_id=p_tenant and (o.hold_reason is not null or exists(select 1 from public.shopify_order_outcomes x where x.tenant_id=p_tenant and x.order_id=o.id and x.error_code is not null and x.seq=(select max(seq) from public.shopify_order_outcomes y where y.tenant_id=p_tenant and y.order_id=o.id)))),
  'orders',coalesce((select jsonb_agg(jsonb_build_object('id',o.id,'name',o.name,'occurredAt',o.occurred_at,'currency',o.currency,'amountOre',o.amount_ore,'holdReason',o.hold_reason,'lines',jsonb_array_length(o.lines),
    'saleId',x.sale_id,'errorCode',x.error_code) order by o.seq desc)
   from (select * from public.shopify_orders where tenant_id=p_tenant order by seq desc limit 30) o
   left join lateral (select * from public.shopify_order_outcomes x where x.tenant_id=p_tenant and x.order_id=o.id order by x.seq desc limit 1) x on true),'[]'::jsonb));
end $$;
revoke all on function public.record_shopify_order_page(uuid,uuid,text,text,jsonb,boolean),public.reconcile_shopify_order(uuid,uuid),public.shopify_order_cursor(uuid),public.shopify_order_status(uuid) from public,anon;
grant execute on function public.record_shopify_order_page(uuid,uuid,text,text,jsonb,boolean),public.reconcile_shopify_order(uuid,uuid),public.shopify_order_cursor(uuid),public.shopify_order_status(uuid) to authenticated;
