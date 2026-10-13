-- Optional variant evidence is additive; old receipts retain their exact stored shape.
create function komisio_private.same_shopify_lines(old_lines jsonb,new_lines jsonb) returns boolean
language sql immutable set search_path='' as $$
 select jsonb_array_length(old_lines)=jsonb_array_length(new_lines) and not exists(
 select 1 from jsonb_array_elements(old_lines) with ordinality a(v,n)
 full join jsonb_array_elements(new_lines) with ordinality b(v,n) using(n)
 where a.v is null or b.v is null or (a.v-'itemId'-'variantGid') is distinct from (b.v-'variantGid')
 or (a.v ? 'variantGid' and a.v->'variantGid' is distinct from b.v->'variantGid'))
$$;
revoke all on function komisio_private.same_shopify_lines(jsonb,jsonb) from public,anon,authenticated;

create or replace function komisio_private.record_zettle_page_core(p_tenant uuid,p_id uuid,p_before text,p_after text,p_purchases jsonb) returns uuid
language plpgsql security definer set search_path='' as $$
declare uid uuid:=komisio_private.require_identity();prior public.zettle_sync_runs;latest text;p jsonb;stored public.zettle_imports;line jsonb;matches uuid[];rev integer;
begin
 perform 1 from public.tenants where id=p_tenant for update;
 if not (coalesce(public.tenant_role(p_tenant),'') in ('owner','admin','staff') or coalesce(komisio_private.automation_allowed(p_tenant,'zettle_pull'),false)) then raise exception 'FORBIDDEN' using errcode='42501';end if;
 if p_id is null or length(p_before)>1000 or length(p_after)>1000 or p_before='' or p_after='' or p_purchases is null or jsonb_typeof(p_purchases)<>'array' or jsonb_array_length(p_purchases)>100 then raise exception 'INVALID_INPUT';end if;
 select * into prior from public.zettle_sync_runs where id=p_id;
 if found then
  if prior.tenant_id is distinct from p_tenant or prior.cursor_before is distinct from p_before or prior.cursor_after is distinct from p_after or prior.page is distinct from p_purchases or prior.created_by is distinct from uid then raise exception 'REQUEST_CONFLICT';end if;
  return prior.id;
 end if;
 select cursor_after into latest from public.zettle_sync_runs where tenant_id=p_tenant order by seq desc limit 1;
 if latest is distinct from p_before then raise exception 'ZETTLE_CURSOR_CHANGED';end if;
 if jsonb_array_length(p_purchases)>0 and (p_after is null or p_after is not distinct from p_before) then raise exception 'INVALID_INPUT';end if;
 if jsonb_array_length(p_purchases)=0 and p_after is distinct from p_before then raise exception 'INVALID_INPUT';end if;
 for p in select * from jsonb_array_elements(p_purchases) loop
  if not komisio_private.valid_zettle_purchase(p) then raise exception 'INVALID_INPUT';end if;
  select * into stored from public.zettle_imports where tenant_id=p_tenant and external_id=(p->>'externalId')::uuid;
  if found then
   if stored.occurred_at is distinct from (p->>'occurredAt')::timestamptz or stored.currency is distinct from p->>'currency' or stored.amount_ore is distinct from (p->>'amountOre')::bigint or (stored.blocked_reason is distinct from p->>'blockedReason' and not coalesce((stored.blocked_reason='refund' and p->'blockedReason'='null'::jsonb and stored.amount_ore>0),false)) or stored.lines is distinct from p->'lines' then raise exception 'ZETTLE_PURCHASE_CONFLICT';end if;
   perform komisio_private.classify_zettle_receipt(p_tenant,stored.id,p);
   perform komisio_private.reconcile_zettle_receipt(p_tenant,stored.id);
   continue;
  end if;
  insert into public.zettle_imports(tenant_id,external_id,occurred_at,currency,amount_ore,blocked_reason,lines,created_by)
   values(p_tenant,(p->>'externalId')::uuid,(p->>'occurredAt')::timestamptz,p->>'currency',(p->>'amountOre')::bigint,p->>'blockedReason',p->'lines',uid) returning * into stored;
  rev:=0;
  for line in select * from jsonb_array_elements(stored.lines) loop
   if line->>'productUuid' is not null or line->>'variantUuid' is not null then
    select array_agg(distinct x.item_id) into matches from (
     select e.item_id from public.zettle_product_exports e where e.tenant_id=p_tenant and e.product_id=(line->>'productUuid')::uuid and e.variant_id=(line->>'variantUuid')::uuid
     union select l.item_id from public.pos_product_links l where l.tenant_id=p_tenant and l.provider='paypal'
     and l.account=komisio_private.pos_account(p_tenant,'paypal') and l.product_id=line->>'productUuid' and l.variant_id=line->>'variantUuid'
     and stored.occurred_at>=l.created_at) x;
   else
   select array_agg(i.id order by i.id) into matches from public.items i where i.tenant_id=p_tenant and 'I-'||upper(left(i.id::text,8))=line->>'reference'
    and not exists(select 1 from public.pos_product_links l where l.tenant_id=p_tenant and l.provider='paypal' and l.item_id=i.id);
   end if;
   if cardinality(matches)=1 and not (line->>'labelConflict')::boolean then
    rev:=rev+1;
    insert into public.zettle_line_resolutions(id,tenant_id,import_id,line_no,item_id,revision,source,created_by) values(gen_random_uuid(),p_tenant,stored.id,(line->>'lineNo')::integer,matches[1],rev,'label',uid);
   else
    insert into public.unmatched_sale_lines(tenant_id,import_id,line_no,reason) values(p_tenant,stored.id,(line->>'lineNo')::integer,case when (line->>'labelConflict')::boolean then 'conflicting_labels' when cardinality(matches)>1 then 'ambiguous_label' else 'missing_item' end);
   end if;
  end loop;
  perform komisio_private.classify_zettle_receipt(p_tenant,stored.id,p);
   perform komisio_private.reconcile_zettle_receipt(p_tenant,stored.id);
 end loop;
 insert into public.zettle_sync_runs(id,tenant_id,cursor_before,cursor_after,page,created_by) values(p_id,p_tenant,p_before,p_after,p_purchases,uid);
 perform komisio_private.record_access(p_tenant,'zettle.page_received',p_id,jsonb_build_object('purchases',jsonb_array_length(p_purchases)));
 return p_id;
end $$;

create or replace function komisio_private.reconcile_zettle_refund(p_tenant uuid,p_import uuid) returns void
language plpgsql security definer set search_path='' as $$
declare actor uuid:=komisio_private.require_identity(); receipt public.zettle_imports; classification public.zettle_receipt_classifications;
 sale public.sales; last public.zettle_receipt_outcomes; line jsonb; matches uuid[]; match_id uuid;
 ids uuid[]:=array[]::uuid[]; sale_lines uuid[]:=array[]::uuid[]; failure text; total numeric:=0; position integer:=0;
begin
 perform 1 from public.tenants where id=p_tenant for update;
 select * into receipt from public.zettle_imports where tenant_id=p_tenant and id=p_import;
 select * into classification from public.zettle_receipt_classifications where tenant_id=p_tenant and import_id=p_import and kind='refund';
 if classification.import_id is null then raise exception 'ZETTLE_UNSUPPORTED_PURCHASE';end if;
 select * into last from public.zettle_receipt_outcomes where tenant_id=p_tenant and import_id=p_import order by created_at desc,id desc limit 1;
 if last.return_ids is not null then return;end if;
 begin
  select * into sale from public.sales where tenant_id=p_tenant and provider='zettle' and external_id=classification.original_external_id::text and status='completed';
  if sale.id is null then raise exception 'ZETTLE_ORIGINAL_SALE_REQUIRED';end if;
  if sale.currency is distinct from receipt.currency then raise exception 'CURRENCY_MISMATCH';end if;
  if receipt.amount_ore>=0 or receipt.occurred_at<sale.occurred_at then raise exception 'ZETTLE_REFUND_MISMATCH';end if;
  for line in select * from jsonb_array_elements(receipt.lines) loop
   select array_agg(distinct x.id) into matches from (
    select sl.id from public.zettle_product_exports e
    join public.sale_lines sl on sl.tenant_id=e.tenant_id and sl.item_id=e.item_id and sl.sale_id=sale.id
    where e.tenant_id=p_tenant and e.product_id=(line->>'productUuid')::uuid and e.variant_id=(line->>'variantUuid')::uuid
    union select sl.id from public.zettle_imports original cross join lateral jsonb_array_elements(original.lines) ol
    join public.sale_lines sl on sl.tenant_id=p_tenant and sl.sale_id=sale.id and sl.line_no=(ol->>'lineNo')::integer
    where original.tenant_id=p_tenant and original.id=sale.id and ol->>'productUuid'=line->>'productUuid' and ol->>'variantUuid'=line->>'variantUuid') x;
   if cardinality(matches) is distinct from 1 or (line->>'labelConflict')::boolean then raise exception 'ZETTLE_REFUND_MISMATCH';end if;
   match_id:=matches[1];
   if match_id=any(sale_lines) then raise exception 'ZETTLE_REFUND_MISMATCH';end if;
   if (select price_ore from public.sale_lines where tenant_id=p_tenant and id=match_id) is distinct from (line->>'priceOre')::bigint then raise exception 'PARTIAL_REFUND_UNSUPPORTED';end if;
   sale_lines:=array_append(sale_lines,match_id);
   total:=total+(line->>'priceOre')::numeric;
  end loop;
  if total<>-receipt.amount_ore or total<=0 then raise exception 'ZETTLE_REFUND_MISMATCH';end if;
  for line in select * from jsonb_array_elements(receipt.lines) loop
   position:=position+1;
   ids:=array_append(ids,komisio_private.record_return_core(p_tenant,gen_random_uuid(),sale_lines[position],(line->>'priceOre')::bigint,'PayPal POS refund',receipt.occurred_at));
  end loop;
 exception when others then
  ids:=null;
  failure:=case when sqlerrm in ('ZETTLE_ORIGINAL_SALE_REQUIRED','ZETTLE_REFUND_MISMATCH','CURRENCY_MISMATCH','PARTIAL_REFUND_UNSUPPORTED','LINE_ALREADY_RETURNED','INVALID_INPUT') then sqlerrm else 'ZETTLE_RETURN_FAILED' end;
 end;
 if last.id is not null and last.error_code is not distinct from failure and last.return_ids is not distinct from ids then return;end if;
 insert into public.zettle_receipt_outcomes(tenant_id,import_id,mapping_revision,sale_id,error_code,return_ids,created_by)
 values(p_tenant,p_import,0,null,failure,ids,actor);
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
  if jsonb_typeof(line)<>'object' or not (line ?& array['lineNo','sku','description','quantity','priceOre']) or (line-array['lineNo','sku','description','quantity','priceOre','variantGid'])<>'{}'::jsonb then return false; end if;
  if line ? 'variantGid' and line->'variantGid'<>'null'::jsonb and (jsonb_typeof(line->'variantGid')<>'string' or line->>'variantGid' !~ '^gid://shopify/ProductVariant/[0-9]{1,30}$') then return false;end if;
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
    if jsonb_typeof(line)<>'object' or not (line ?& array['lineNo','sku','quantity','amountOre']) or (line-array['lineNo','sku','quantity','amountOre','variantGid'])<>'{}'::jsonb then return false; end if;
    if line ? 'variantGid' and line->'variantGid'<>'null'::jsonb and (jsonb_typeof(line->'variantGid')<>'string' or line->>'variantGid' !~ '^gid://shopify/ProductVariant/[0-9]{1,30}$') then return false;end if;
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
    or not komisio_private.same_shopify_lines(stored.lines,p->'lines') then
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
   select array_agg(distinct x.item_id) into matches from (
    select l.item_id from public.pos_product_links l where l.tenant_id=p_tenant and l.provider='shopify'
     and l.account=komisio_private.pos_account(p_tenant,'shopify') and l.variant_id=line->>'variantGid' and (p->>'occurredAt')::timestamptz>=l.created_at
    union select i.id from public.items i where i.tenant_id=p_tenant and 'K-'||i.id::text=line->>'sku'
     and not exists(select 1 from public.pos_product_links l where l.tenant_id=p_tenant and l.provider='shopify' and l.item_id=i.id)) x;
   if hold is null then
    hold:=case when (line->>'quantity')::integer<>1 then 'quantity' when line->>'variantGid' is null and (line->'sku'='null'::jsonb or line->>'sku' !~ '^K-') then 'unknown_sku' when cardinality(matches)=0 or matches is null then 'missing_item' when cardinality(matches)>1 then 'ambiguous_item' end;
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

create or replace function komisio_private.apply_shopify_refunds(p_tenant uuid,p_order uuid,p_refunds jsonb) returns void
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
    select array_agg(distinct sl.id) into matches from public.sale_lines sl
     join lateral jsonb_array_elements(o.lines) ol on (ol->>'itemId')::uuid=sl.item_id
     where sl.tenant_id=p_tenant and sl.sale_id=o.id
     and ((line->>'variantGid' is not null and ol->>'variantGid'=line->>'variantGid')
      or ((line->>'variantGid' is null or ol->>'variantGid' is null) and 'K-'||sl.item_id::text=line->>'sku' and ol->>'sku'=line->>'sku'));
    if (line->>'quantity')::integer<>1 then matches:=null;end if;
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

create or replace function public.zettle_catalog_candidates(p_tenant uuid) returns table(item_id uuid) language plpgsql stable security definer set search_path='' as $$
begin
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin','staff','readonly') then raise exception 'FORBIDDEN' using errcode='42501';end if;
 return query select i.id from public.items i
 join lateral(select p.id from public.item_prices p where p.tenant_id=p_tenant and p.item_id=i.id order by set_at desc,seq desc limit 1) p on true
 left join lateral(select c.id from public.zettle_catalog_configs c where c.tenant_id=p_tenant order by revision desc limit 1)c on true
 where i.tenant_id=p_tenant and not exists(select 1 from public.pos_product_links l where l.tenant_id=p_tenant and l.provider='paypal' and l.item_id=i.id) and not (komisio_private.item_lifecycle(p_tenant,i.id)->>'sold')::boolean and not (komisio_private.item_lifecycle(p_tenant,i.id)->>'ended')::boolean
 and not exists(select 1 from public.zettle_product_exports e join public.zettle_product_outcomes o on o.tenant_id=e.tenant_id and o.export_id=e.id and o.status='synced' where e.tenant_id=p_tenant and e.item_id=i.id and e.price_id=p.id and e.config_id=c.id and e.policy_version is not distinct from (public.current_store_policy(p_tenant)->>'id')::uuid and e.payload->>'name'=komisio_private.zettle_product_name(p_tenant,i.id) and e.id=(select latest.id from public.zettle_product_exports latest where latest.tenant_id=p_tenant and latest.item_id=i.id order by latest.created_at desc,latest.id desc limit 1))
 order by i.accepted_at,i.id limit 20;
end $$;

create or replace function public.shopify_product_candidates(p_tenant uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin','staff','readonly') then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 return coalesce((select jsonb_agg(jsonb_build_object('itemId',x.id,'reference','I-'||upper(left(x.id::text,8)),'title',x.t->>'title','priceOre',x.price_ore,
   'exportedBefore',exists(select 1 from public.shopify_product_outcomes o join public.shopify_product_exports e on e.tenant_id=o.tenant_id and e.id=o.export_id where o.tenant_id=p_tenant and e.item_id=x.id and o.status='synced')) order by x.accepted_at,x.id)
  from (
   select i.id,i.accepted_at,komisio_private.item_title(p_tenant,i.id) as t,p.price_ore
   from public.items i
   join lateral(select pr.id,pr.price_ore from public.item_prices pr where pr.tenant_id=p_tenant and pr.item_id=i.id order by pr.set_at desc,pr.seq desc limit 1) p on true
   where i.tenant_id=p_tenant and not exists(select 1 from public.pos_product_links l where l.tenant_id=p_tenant and l.provider='shopify' and l.item_id=i.id)
    and not (komisio_private.item_lifecycle(p_tenant,i.id)->>'sold')::boolean and not (komisio_private.item_lifecycle(p_tenant,i.id)->>'ended')::boolean
    and not exists(select 1 from public.shopify_product_exports e join public.shopify_product_outcomes o on o.tenant_id=e.tenant_id and o.export_id=e.id and o.status='synced'
     where e.tenant_id=p_tenant and e.item_id=i.id and e.price_id=p.id)
   order by i.accepted_at,i.id limit 20) x),'[]'::jsonb);
end $$;
