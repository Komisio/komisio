-- Preserve prior normalized sale contracts while admitting strictly bounded refund evidence.

create or replace function komisio_private.valid_zettle_purchase(p jsonb) returns boolean language plpgsql immutable set search_path='' as $$
declare line jsonb;n integer:=0;total numeric:=0;
begin
 if p is null or jsonb_typeof(p)<>'object' or not(p ?& array['externalId','occurredAt','currency','amountOre','blockedReason','lines']) or (p-array['externalId','occurredAt','currency','amountOre','blockedReason','lines','refundOf'])<>'{}'::jsonb then return false;end if;
 if jsonb_typeof(p->'externalId')<>'string' or (p->>'externalId') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' or jsonb_typeof(p->'occurredAt')<>'string' or not isfinite((p->>'occurredAt')::timestamptz) then return false;end if;
 if jsonb_typeof(p->'currency')<>'string' or length(p->>'currency') not between 1 and 10 or (p->>'amountOre') !~ '^-?[0-9]{1,11}$' or jsonb_typeof(p->'amountOre')<>'number' then return false;end if;
 if p->'blockedReason'<>'null'::jsonb and p->>'blockedReason' not in ('source','refund','currency','discount','service_charge','quantity','product_type','amount') then return false;end if;
 if jsonb_typeof(p->'lines')<>'array' or jsonb_array_length(p->'lines') not between 1 and 50 then return false;end if;
 for line in select * from jsonb_array_elements(p->'lines') loop
  n:=n+1;
  if jsonb_typeof(line)<>'object' or not(line ?& array['lineNo','reference','labelConflict','description','priceOre']) or (line-array['lineNo','reference','labelConflict','description','priceOre','productUuid','variantUuid'])<>'{}'::jsonb then return false;end if;
  if line->'lineNo'<>to_jsonb(n) or jsonb_typeof(line->'labelConflict')<>'boolean' or jsonb_typeof(line->'description')<>'string' or length(line->>'description')>120 then return false;end if;
  if line->'reference'<>'null'::jsonb and (jsonb_typeof(line->'reference')<>'string' or (line->>'reference') !~ '^I-[0-9A-F]{8}$') then return false;end if;
  if jsonb_typeof(line->'priceOre')<>'number' or (line->>'priceOre') !~ '^-?[0-9]{1,11}$' then return false;end if;
  if (line ? 'productUuid' and line->'productUuid'<>'null'::jsonb and (jsonb_typeof(line->'productUuid')<>'string' or (line->>'productUuid')!~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')) or (line ? 'variantUuid' and line->'variantUuid'<>'null'::jsonb and (jsonb_typeof(line->'variantUuid')<>'string' or (line->>'variantUuid')!~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')) then return false;end if;
  total:=total+(line->>'priceOre')::numeric;
  if p->'blockedReason'='null'::jsonb and (line->>'priceOre')::numeric<=0 then return false;end if;
 end loop;
 if p->'blockedReason'='null'::jsonb and (p->>'currency' not in ('SEK','NOK','DKK','EUR') or total<>(p->>'amountOre')::numeric or total<=0) then return false;end if;
 if p ? 'refundOf' then
  if jsonb_typeof(p->'refundOf')<>'string' or p->>'refundOf' !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
   or p->>'refundOf'=p->>'externalId' or p->>'blockedReason' is distinct from 'refund'
   or total<=0 or total<>-(p->>'amountOre')::numeric or p->>'currency' not in ('SEK','NOK','DKK','EUR') then return false;end if;
  for line in select * from jsonb_array_elements(p->'lines') loop
   if line->>'productUuid' is null or line->>'variantUuid' is null or (line->>'labelConflict')::boolean or (line->>'priceOre')::numeric<=0 then return false;end if;
  end loop;
 end if;
 return true;
exception when others then return false;
end $$;

create function komisio_private.classify_zettle_receipt(p_tenant uuid,p_import uuid,p jsonb) returns void
language plpgsql security definer set search_path='' as $$
declare prior public.zettle_receipt_classifications; r public.zettle_imports; kind text;
begin
 select * into prior from public.zettle_receipt_classifications where tenant_id=p_tenant and import_id=p_import;
 if prior.import_id is not null then
  if (prior.kind='refund' and prior.original_external_id is distinct from (p->>'refundOf')::uuid)
   or (prior.kind='sale' and p->>'blockedReason' is not null) then raise exception 'ZETTLE_PURCHASE_CONFLICT';end if;
  return;
 end if;
 select * into r from public.zettle_imports where tenant_id=p_tenant and id=p_import;
 if p ? 'refundOf' then kind:='refund';
 elsif r.blocked_reason='refund' and r.amount_ore>0 and p->>'blockedReason' is null then kind:='sale';
 else return;end if;
 insert into public.zettle_receipt_classifications(import_id,tenant_id,kind,original_external_id,created_by)
 values(p_import,p_tenant,kind,(p->>'refundOf')::uuid,komisio_private.require_identity());
end $$;
revoke all on function komisio_private.classify_zettle_receipt(uuid,uuid,jsonb) from public,anon,authenticated;

create or replace function komisio_private.ready_zettle_purchase(p_tenant uuid,p_import uuid,p_revision integer) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare receipt public.zettle_imports;latest integer;line jsonb;matched uuid;lines jsonb:='[]'::jsonb;total numeric:=0;
begin
 select * into receipt from public.zettle_imports where tenant_id=p_tenant and id=p_import;
 if not found then raise exception 'ZETTLE_IMPORT_NOT_FOUND';end if;
 if receipt.blocked_reason is not null and not exists(select 1 from public.zettle_receipt_classifications where tenant_id=p_tenant and import_id=p_import and kind='sale') then raise exception 'ZETTLE_UNSUPPORTED_PURCHASE';end if;
 select coalesce(max(revision),0) into latest from public.zettle_line_resolutions where import_id=p_import;
 if latest is distinct from p_revision then raise exception 'ZETTLE_MATCH_CHANGED';end if;
 for line in select * from jsonb_array_elements(receipt.lines) loop
  select item_id into matched from public.zettle_line_resolutions where import_id=p_import and line_no=(line->>'lineNo')::integer order by revision desc limit 1;
  if matched is null then raise exception 'ZETTLE_UNMATCHED_LINES';end if;
  lines:=lines||jsonb_build_array(jsonb_build_object('itemId',matched,'priceOre',(line->>'priceOre')::bigint));
  total:=total+(line->>'priceOre')::numeric;
 end loop;
 if not komisio_private.valid_sale_lines(lines) or total<>receipt.amount_ore then raise exception 'INVALID_INPUT';end if;
 if receipt.currency<>komisio_private.store_currency(p_tenant) then raise exception 'CURRENCY_MISMATCH';end if;
 return jsonb_build_object('externalId',receipt.external_id,'occurredAt',receipt.occurred_at,'lines',lines,'amountOre',receipt.amount_ore,'currency',receipt.currency);
end $$;

create or replace function komisio_private.reconcile_zettle_receipt(p_tenant uuid,p_import uuid) returns uuid language plpgsql security definer set search_path='' as $$
declare uid uuid:=komisio_private.require_identity();rev integer;receipt jsonb;result uuid;failure text;last public.zettle_receipt_outcomes; refund record; original_id uuid;
begin
 if exists(select 1 from public.zettle_receipt_classifications where tenant_id=p_tenant and import_id=p_import and kind='refund') then
  perform komisio_private.reconcile_zettle_refund(p_tenant,p_import);
  return case when exists(select 1 from public.zettle_receipt_outcomes where tenant_id=p_tenant and import_id=p_import and return_ids is not null) then p_import end;
 end if;
 select coalesce(max(revision),0) into rev from public.zettle_line_resolutions where tenant_id=p_tenant and import_id=p_import;
 begin
  receipt:=komisio_private.ready_zettle_purchase(p_tenant,p_import,rev);
  select id into result from public.sales where tenant_id=p_tenant and id=p_import and provider='zettle' and external_id=receipt->>'externalId';
  if result is null then result:=komisio_private.record_sale_core(p_tenant,p_import,'zettle',receipt->>'externalId',(receipt->>'occurredAt')::timestamptz,receipt->>'currency',receipt->'lines',jsonb_build_object('zettleImportId',p_import));end if;
 exception when others then
  failure:=case when sqlerrm ~ '^[A-Z_]{1,100}$' then sqlerrm else 'ZETTLE_RECORD_FAILED' end;
 end;
 if result is not null then
  select external_id into original_id from public.zettle_imports where tenant_id=p_tenant and id=p_import;
  for refund in select c.import_id from public.zettle_receipt_classifications c
   where c.tenant_id=p_tenant and c.kind='refund' and c.original_external_id=original_id
   and not exists(select 1 from public.zettle_receipt_outcomes o where o.tenant_id=p_tenant and o.import_id=c.import_id and o.return_ids is not null)
   order by c.created_at,c.import_id limit 50 loop
   perform komisio_private.reconcile_zettle_refund(p_tenant,refund.import_id);
  end loop;
 end if;
 select * into last from public.zettle_receipt_outcomes where tenant_id=p_tenant and import_id=p_import order by created_at desc limit 1;
 if last.mapping_revision=rev and last.sale_id is not distinct from result and last.error_code is not distinct from failure then return result;end if;
 insert into public.zettle_receipt_outcomes(tenant_id,import_id,mapping_revision,sale_id,error_code,created_by) values(p_tenant,p_import,rev,result,failure,uid);
 return result;
end $$;

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
    select array_agg(distinct e.item_id) into matches from public.zettle_product_exports e where e.tenant_id=p_tenant and e.product_id=(line->>'productUuid')::uuid and e.variant_id=(line->>'variantUuid')::uuid;
   else
   select array_agg(i.id order by i.id) into matches from public.items i where i.tenant_id=p_tenant and 'I-'||upper(left(i.id::text,8))=line->>'reference';
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
