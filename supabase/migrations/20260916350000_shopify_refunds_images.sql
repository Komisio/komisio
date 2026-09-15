-- Shopify adapter, last two pieces: refunds as returns and the reception
-- photo as product image.
-- Refunds: the order page carries each order's refunds; a refund line whose
-- sku is a Komisio item becomes a return of that sale line through the
-- existing return rule (whole line, once), recorded by the private return
-- core so the scheduled pull can record it too. A refund the rule refuses
-- (partial amount, line already returned, unknown line) is held with the
-- code. Partially refunded and refunded orders count as paid for the sale.
-- Images: after a product is synced, the first reception photo is uploaded
-- once per item (intent row, media id or error recorded); items without a
-- reception photo have no image.
create function komisio_private.record_return_core(p_tenant uuid,p_id uuid,p_sale_line uuid,p_refund_ore bigint,p_reason text,p_occurred_at timestamptz) returns uuid
language plpgsql security definer set search_path='' as $$
declare uid uuid:=komisio_private.require_identity(); prior public.sale_returns; line public.sale_lines; sale public.sales; note text:=trim(coalesce(p_reason,''));
 available bigint; flagged boolean:=false; flag text:='';
begin
 perform 1 from public.tenants where id=p_tenant for update;
 if p_id is null or p_sale_line is null or p_refund_ore is null or p_refund_ore<=0 or length(note) not between 1 and 500
  or p_occurred_at is null or not isfinite(p_occurred_at) or p_occurred_at>now()+interval '1 day' then raise exception 'INVALID_INPUT'; end if;
 select * into prior from public.sale_returns where id=p_id;
 if found then
  if prior.tenant_id is distinct from p_tenant or prior.sale_line_id is distinct from p_sale_line or prior.refund_ore is distinct from p_refund_ore
   or prior.reason is distinct from note or prior.recorded_by is distinct from uid then raise exception 'REQUEST_CONFLICT'; end if;
  return p_id;
 end if;
 select * into line from public.sale_lines where tenant_id=p_tenant and id=p_sale_line;
 if not found then raise exception 'SALE_LINE_NOT_FOUND'; end if;
 select * into sale from public.sales where tenant_id=p_tenant and id=line.sale_id;
 if sale.status<>'completed' then raise exception 'SALE_NOT_COMPLETED'; end if;
 if exists(select 1 from public.sale_returns where tenant_id=p_tenant and sale_line_id=p_sale_line) then raise exception 'LINE_ALREADY_RETURNED'; end if;
 if p_refund_ore<>line.price_ore then raise exception 'PARTIAL_REFUND_UNSUPPORTED'; end if;
 if p_occurred_at<sale.occurred_at then raise exception 'INVALID_INPUT'; end if;
 if line.ownership='consignment' and line.seller_credit_ore>0 then
  available:=komisio_private.available_ore(p_tenant,(select seller_id from public.items where tenant_id=p_tenant and id=line.item_id));
  -- The credit may already be reserved or paid out: the reversal still lands, but a person must look.
  if available<line.seller_credit_ore then flagged:=true; flag:='CREDIT_ALREADY_USED'; end if;
  insert into public.seller_ledger_entries(id,tenant_id,seller_id,kind,amount_ore,reference_kind,reference_id,reason,occurred_at,recorded_by)
  select gen_random_uuid(),p_tenant,i.seller_id,'credit_reversal',-line.seller_credit_ore,'sale_return',p_id,note,p_occurred_at,uid from public.items i where i.tenant_id=p_tenant and i.id=line.item_id;
 end if;
 insert into public.sale_returns(id,tenant_id,sale_line_id,item_id,refund_ore,reason,flagged_for_review,flag_reason,occurred_at,recorded_by)
 values(p_id,p_tenant,p_sale_line,line.item_id,p_refund_ore,note,flagged,flag,p_occurred_at,uid);
 insert into public.item_events(tenant_id,item_id,kind,detail,actor) values(p_tenant,line.item_id,'returned',jsonb_build_object('returnId',p_id,'saleId',line.sale_id,'lineNo',line.line_no,'refundOre',p_refund_ore,'flagged',flagged),uid);
 perform komisio_private.record_access(p_tenant,'sale.returned',p_id,jsonb_build_object('sale_line_id',p_sale_line,'refund_ore',p_refund_ore,'flagged',flagged));
 return p_id;
end $$;
create or replace function public.record_return(p_tenant uuid,p_id uuid,p_sale_line uuid,p_refund_ore bigint,p_reason text,p_occurred_at timestamptz default now()) returns uuid
language plpgsql security definer set search_path='' as $$
begin
 perform komisio_private.require_identity();
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin','staff') then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 return komisio_private.record_return_core(p_tenant,p_id,p_sale_line,p_refund_ore,p_reason,p_occurred_at);
end $$;
revoke all on function komisio_private.record_return_core(uuid,uuid,uuid,bigint,text,timestamptz) from public,anon,authenticated;

create table public.shopify_refunds (
 id uuid primary key default gen_random_uuid(),
 seq bigint generated always as identity,
 tenant_id uuid not null references public.tenants(id),
 order_id uuid not null,
 refund_gid text not null check(refund_gid ~ '^gid://shopify/Refund/[0-9]{1,30}$'),
 occurred_at timestamptz not null,
 amount_ore bigint not null,
 lines jsonb not null check(jsonb_typeof(lines)='array'),
 created_by uuid not null references auth.users(id),
 created_at timestamptz not null default now(),
 unique(tenant_id,refund_gid),
 unique(tenant_id,id),
 foreign key(tenant_id,order_id) references public.shopify_orders(tenant_id,id)
);
create table public.shopify_refund_outcomes (
 id uuid primary key default gen_random_uuid(),
 seq bigint generated always as identity,
 tenant_id uuid not null references public.tenants(id),
 refund_id uuid not null,
 line_no integer not null,
 return_id uuid,
 error_code text check(error_code is null or error_code ~ '^[A-Z_]{1,100}$'),
 created_by uuid not null references auth.users(id),
 created_at timestamptz not null default now(),
 foreign key(tenant_id,refund_id) references public.shopify_refunds(tenant_id,id),
 check((return_id is null)<>(error_code is null))
);
create table public.shopify_product_images (
 id uuid primary key,
 seq bigint generated always as identity,
 tenant_id uuid not null references public.tenants(id),
 item_id uuid not null,
 product_gid text not null check(length(product_gid)<=200),
 source_reference text not null check(length(source_reference)<=300),
 media_gid text check(media_gid is null or length(media_gid)<=200),
 error_code text check(error_code is null or error_code ~ '^[A-Z_]{1,100}$'),
 updated_at timestamptz not null default now(),
 created_by uuid not null references auth.users(id),
 created_at timestamptz not null default now(),
 unique(tenant_id,item_id),
 foreign key(tenant_id,item_id) references public.items(tenant_id,id)
);
create index shopify_refund_order on public.shopify_refunds(tenant_id,order_id,seq desc);
create index shopify_refund_outcome_latest on public.shopify_refund_outcomes(tenant_id,refund_id,line_no,seq desc);
do $$ declare t text; begin
 foreach t in array array['shopify_refunds','shopify_refund_outcomes','shopify_product_images'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('revoke all on public.%I from public,anon,authenticated',t);
  execute format('grant select on public.%I to authenticated',t);
  execute format('create policy read_store on public.%I for select to authenticated using(public.tenant_role(tenant_id) in (''owner'',''admin'',''staff'',''readonly''))',t);
  execute format('create policy store_boundary on public.%I as restrictive for all to authenticated using(public.tenant_role(tenant_id) in (''owner'',''admin'',''staff'',''readonly'')) with check(false)',t);
 end loop;
 foreach t in array array['shopify_refunds','shopify_refund_outcomes'] loop
  execute format('create trigger immutable before update or delete on public.%I for each row execute function komisio_private.preserve_shopify()',t);
 end loop;
end $$;

-- The order evidence may now carry refunds: id, time, amount and lines with sku and refunded amount.
create or replace function komisio_private.valid_shopify_order(p jsonb) returns boolean language plpgsql immutable set search_path='' as $$
declare line jsonb; r jsonb; n integer:=0; m integer; total numeric:=0; keys text[]:=array['orderGid','name','occurredAt','updatedAt','currency','amountOre','financialStatus','test','cancelled','lines'];
begin
 if p is null or jsonb_typeof(p)<>'object' or not (p ?& keys) or (p-keys-'refunds')<>'{}'::jsonb then return false; end if;
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

-- Each refund once; each refund line a return of the matching sale line, or a held outcome with the rule's code.
create function komisio_private.apply_shopify_refunds(p_tenant uuid,p_order uuid,p_refunds jsonb) returns void
language plpgsql security definer set search_path='' as $$
declare uid uuid:=komisio_private.require_identity(); o public.shopify_orders; r jsonb; line jsonb; ref public.shopify_refunds; matches uuid[]; result uuid; failure text; rid uuid;
begin
 if p_refunds is null or jsonb_typeof(p_refunds)<>'array' then return; end if;
 select * into o from public.shopify_orders where tenant_id=p_tenant and id=p_order;
 if not found then raise exception 'SHOPIFY_ORDER_NOT_FOUND'; end if;
 for r in select * from jsonb_array_elements(p_refunds) loop
  if exists(select 1 from public.shopify_refunds where tenant_id=p_tenant and refund_gid=r->>'refundGid') then continue; end if;
  insert into public.shopify_refunds(tenant_id,order_id,refund_gid,occurred_at,amount_ore,lines,created_by)
   values(p_tenant,o.id,r->>'refundGid',(r->>'occurredAt')::timestamptz,(r->>'amountOre')::bigint,r->'lines',uid) returning * into ref;
  for line in select * from jsonb_array_elements(ref.lines) loop
   result:=null; failure:=null; matches:=null;
   if not exists(select 1 from public.sales where tenant_id=p_tenant and id=o.id) then
    failure:='SHOPIFY_SALE_MISSING';
   else
    if line->>'sku' ~ '^K-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
     select array_agg(l.id) into matches from public.sale_lines l where l.tenant_id=p_tenant and l.sale_id=o.id and l.item_id=substr(line->>'sku',3)::uuid;
    end if;
    if matches is null or cardinality(matches)<>1 then
     failure:='SHOPIFY_REFUND_LINE_UNKNOWN';
    else
     rid:=md5('shopify-refund:'||ref.refund_gid||':'||(line->>'lineNo'))::uuid;
     begin
      result:=komisio_private.record_return_core(p_tenant,rid,matches[1],(line->>'amountOre')::bigint,'Shopify refund '||ref.refund_gid||' on order '||o.name,greatest(ref.occurred_at,o.occurred_at));
     exception when others then
      failure:=case when sqlerrm ~ '^[A-Z_]{1,100}$' then sqlerrm else 'SHOPIFY_RETURN_FAILED' end;
     end;
    end if;
   end if;
   insert into public.shopify_refund_outcomes(tenant_id,refund_id,line_no,return_id,error_code,created_by) values(p_tenant,ref.id,(line->>'lineNo')::integer,result,failure,uid);
   perform komisio_private.record_access(p_tenant,case when result is null then 'shopify.refund_held' else 'shopify.return_recorded' end,ref.id,jsonb_build_object('order_gid',o.order_gid,'line',(line->>'lineNo')::integer,'error_code',failure,'return_id',result));
  end loop;
 end loop;
end $$;
revoke all on function komisio_private.apply_shopify_refunds(uuid,uuid,jsonb) from public,anon,authenticated;

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

create or replace function public.shopify_order_status(p_tenant uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin','staff','readonly') then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 return jsonb_build_object(
  'lastPullAt',(select created_at from public.shopify_order_pulls where tenant_id=p_tenant order by seq desc limit 1),
  'cursor',(select cursor_after from public.shopify_order_pulls where tenant_id=p_tenant order by seq desc limit 1),
  'pulls',(select count(*) from public.shopify_order_pulls where tenant_id=p_tenant),
  'held',(select count(*) from public.shopify_orders o where o.tenant_id=p_tenant and (o.hold_reason is not null or exists(select 1 from public.shopify_order_outcomes x where x.tenant_id=p_tenant and x.order_id=o.id and x.error_code is not null and x.seq=(select max(seq) from public.shopify_order_outcomes y where y.tenant_id=p_tenant and y.order_id=o.id))))
   +(select count(*) from public.shopify_refund_outcomes f where f.tenant_id=p_tenant and f.error_code is not null),
  'orders',coalesce((select jsonb_agg(jsonb_build_object('id',o.id,'name',o.name,'occurredAt',o.occurred_at,'currency',o.currency,'amountOre',o.amount_ore,'holdReason',o.hold_reason,'lines',jsonb_array_length(o.lines),
    'saleId',x.sale_id,'errorCode',x.error_code,
    'returned',(select count(*) from public.shopify_refund_outcomes f join public.shopify_refunds rf on rf.tenant_id=f.tenant_id and rf.id=f.refund_id where f.tenant_id=p_tenant and rf.order_id=o.id and f.return_id is not null),
    'refundsHeld',(select count(*) from public.shopify_refund_outcomes f join public.shopify_refunds rf on rf.tenant_id=f.tenant_id and rf.id=f.refund_id where f.tenant_id=p_tenant and rf.order_id=o.id and f.error_code is not null),
    'refundError',(select f.error_code from public.shopify_refund_outcomes f join public.shopify_refunds rf on rf.tenant_id=f.tenant_id and rf.id=f.refund_id where f.tenant_id=p_tenant and rf.order_id=o.id and f.error_code is not null order by f.seq desc limit 1)) order by o.seq desc)
   from (select * from public.shopify_orders where tenant_id=p_tenant order by seq desc limit 30) o
   left join lateral (select * from public.shopify_order_outcomes x where x.tenant_id=p_tenant and x.order_id=o.id order by x.seq desc limit 1) x on true),'[]'::jsonb));
end $$;

-- The first reception photo of an item with a synced product; one intent per item.
create function public.prepare_shopify_image(p_tenant uuid,p_id uuid,p_item uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid:=komisio_private.require_identity(); item_row public.items; prior public.shopify_product_images; selected_photo jsonb; gid text; fresh boolean:=false;
begin
 perform 1 from public.tenants where id=p_tenant for update;
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin') then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 if p_id is null or p_item is null then raise exception 'INVALID_INPUT'; end if;
 select * into item_row from public.items where tenant_id=p_tenant and id=p_item;
 if not found then raise exception 'ITEM_NOT_FOUND'; end if;
 if item_row.origin_kind<>'reception_review' then return null; end if;
 select source.value into selected_photo
 from public.reception_reviews review_row
 join public.reception_source_revisions source_row on source_row.tenant_id=review_row.tenant_id and source_row.session_id=review_row.session_id and source_row.revision=review_row.source_revision
 cross join lateral jsonb_array_elements(source_row.sources) with ordinality source(value,position)
 where review_row.tenant_id=p_tenant and review_row.session_id=item_row.origin_id and review_row.version=item_row.origin_revision and source.value->>'kind'='photo'
 order by source.position limit 1;
 if selected_photo is null then return null; end if;
 if selected_photo->>'reference' not in (p_tenant::text||'/'||item_row.origin_id::text||'/'||(selected_photo->>'id')||'.jpg',p_tenant::text||'/'||item_row.origin_id::text||'/'||(selected_photo->>'id')||'.png') then raise exception 'INVALID_INPUT'; end if;
 select o.product_gid into gid from public.shopify_product_outcomes o join public.shopify_product_exports e on e.tenant_id=o.tenant_id and e.id=o.export_id
  where o.tenant_id=p_tenant and e.item_id=p_item and o.status='synced' order by o.seq desc limit 1;
 if gid is null then raise exception 'SHOPIFY_IMAGE_PRODUCT_REQUIRED'; end if;
 select * into prior from public.shopify_product_images where tenant_id=p_tenant and item_id=p_item;
 if not found then
  insert into public.shopify_product_images(id,tenant_id,item_id,product_gid,source_reference,created_by) values(p_id,p_tenant,p_item,gid,selected_photo->>'reference',actor) returning * into prior;
  fresh:=true;
 elsif prior.product_gid<>gid then
  raise exception 'SHOPIFY_IMAGE_PRODUCT_CHANGED';
 end if;
 return jsonb_build_object('id',prior.id,'fresh',fresh,'reference',prior.source_reference,'productGid',prior.product_gid,'mediaGid',prior.media_gid);
end $$;

-- The media id once Shopify holds the image, or the code of the failed attempt; a media id is never replaced.
create function public.record_shopify_image_result(p_tenant uuid,p_intent uuid,p_media_gid text,p_error text) returns void
language plpgsql security definer set search_path='' as $$
declare uid uuid:=komisio_private.require_identity(); prior public.shopify_product_images;
begin
 perform 1 from public.tenants where id=p_tenant for update;
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin') then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 if (p_media_gid is null)=(p_error is null) or (p_media_gid is not null and (length(p_media_gid)>200 or p_media_gid !~ '^gid://shopify/')) or (p_error is not null and p_error !~ '^[A-Z_]{1,100}$') then raise exception 'INVALID_INPUT'; end if;
 select * into prior from public.shopify_product_images where tenant_id=p_tenant and id=p_intent;
 if not found then raise exception 'ITEM_NOT_FOUND'; end if;
 if prior.media_gid is not null then
  if p_media_gid is distinct from prior.media_gid then raise exception 'REQUEST_CONFLICT'; end if;
  return;
 end if;
 update public.shopify_product_images set media_gid=p_media_gid,error_code=p_error,updated_at=now() where tenant_id=p_tenant and id=p_intent;
 perform komisio_private.record_access(p_tenant,case when p_media_gid is null then 'shopify.image_failed' else 'shopify.image_synced' end,prior.item_id,jsonb_build_object('intent',p_intent,'media_gid',p_media_gid,'error_code',p_error));
end $$;

create or replace function public.shopify_product_status(p_tenant uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin','staff','readonly') then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 return coalesce((select jsonb_agg(jsonb_build_object('itemId',e.item_id,'reference',e.payload->>'reference','title',e.payload->>'title','price',e.payload->>'price','exportId',e.id,'createdAt',e.created_at,
   'status',coalesce(o.status,'pending'),'errorCode',o.error_code,'productGid',coalesce(o.product_gid,e.product_gid),'decidedAt',o.created_at,
   'imageStatus',case when img.media_gid is not null then 'synced' when img.error_code is not null then 'failed' when img.id is not null then 'pending' end) order by e.seq desc)
  from (select distinct on (item_id) * from public.shopify_product_exports where tenant_id=p_tenant order by item_id,seq desc) e
  left join lateral (select * from public.shopify_product_outcomes o where o.tenant_id=p_tenant and o.export_id=e.id order by o.seq desc limit 1) o on true
  left join public.shopify_product_images img on img.tenant_id=p_tenant and img.item_id=e.item_id
  limit 50),'[]'::jsonb);
end $$;
revoke all on function public.prepare_shopify_image(uuid,uuid,uuid),public.record_shopify_image_result(uuid,uuid,text,text) from public,anon;
grant execute on function public.prepare_shopify_image(uuid,uuid,uuid),public.record_shopify_image_result(uuid,uuid,text,text) to authenticated;
