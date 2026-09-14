create function komisio_private.current_store_policy_core(p_tenant uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare current_version public.store_policy_versions;
begin
 select * into current_version from public.store_policy_versions where tenant_id=p_tenant order by version desc limit 1;
 return jsonb_build_object('id',current_version.id,'version',coalesce(current_version.version,0),'policy',coalesce(current_version.policy,
 '{"commissionBasis":"inclusive","commissionRatePercent":60,"agreementRequiredFor":["review_publication","acceptance"],"custodySources":["staff_receipt"],"sellerReviewMode":"delegated","salePeriodDays":42,"markdownSteps":[{"afterDays":14,"percent":10},{"afterDays":28,"percent":25},{"afterDays":42,"percent":50}],"endOfPeriodAction":"charity","unsoldNotifyAfterDays":60,"minPayoutThreshold":100}'::jsonb));
end $$;


create function public.zettle_automation_tenants() returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
 perform komisio_private.require_identity();
 return coalesce((select jsonb_agg(jsonb_build_object('tenantId',g.tenant_id)) from public.automation_grants g
 where g.scope='zettle_pull' and g.accepted_by=auth.uid() and g.disabled_at is null
 and komisio_private.automation_allowed(g.tenant_id,'zettle_pull')),'[]'::jsonb);
end $$;

create function public.prepare_zettle_automatic_pull(p_tenant uuid,p_merchant uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid:=komisio_private.require_identity(); run_id uuid; window_id uuid; window_row public.zettle_pull_windows; before_cursor text;
begin
 perform 1 from public.tenants where id=p_tenant for update;
 if not coalesce(komisio_private.automation_allowed(p_tenant,'zettle_pull'),false) then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 if not exists(select 1 from public.zettle_pull_connections where tenant_id=p_tenant and merchant_id=p_merchant) then raise exception 'ZETTLE_NOT_CONNECTED'; end if;
 run_id:=md5('zettle-cron:'||p_tenant::text||':'||floor(extract(epoch from clock_timestamp())/600)::text)::uuid;
 if exists(select 1 from public.access_events where tenant_id=p_tenant and action='zettle.automatic_started' and target_id=run_id) then return null; end if;
 window_id:=public.open_zettle_pull_window(p_tenant,p_merchant);
 if window_id is not null then
  select * into strict window_row from public.zettle_pull_windows where tenant_id=p_tenant and id=window_id;
  select cursor_after into before_cursor from public.zettle_pull_pages where tenant_id=p_tenant and window_id=window_row.id order by seq desc limit 1;
 end if;
 perform komisio_private.record_access(p_tenant,'zettle.automatic_started',run_id,jsonb_build_object('windowId',window_id));
 return jsonb_build_object('id',run_id,'windowId',window_id,'startDate',window_row.start_at,'endDate',window_row.end_at,'cursor',before_cursor,'currency',komisio_private.store_currency(p_tenant));
end $$;

create function public.finish_zettle_automatic_pull(p_tenant uuid,p_id uuid,p_outcome text) returns void
language plpgsql security definer set search_path='' as $$
declare actor uuid:=komisio_private.require_identity(); started public.access_events; outcome text; page_count integer;
begin
 perform 1 from public.tenants where id=p_tenant for update;
 if not coalesce(komisio_private.automation_allowed(p_tenant,'zettle_pull'),false) then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 if p_outcome is null or p_outcome not in ('complete','received','waiting','failed') then raise exception 'INVALID_INPUT'; end if;
 select * into started from public.access_events where tenant_id=p_tenant and target_id=p_id and action='zettle.automatic_started' and actor_id=actor order by id limit 1;
 if not found then raise exception 'REQUEST_CONFLICT'; end if;
 select purchase_count into page_count from public.zettle_pull_pages where tenant_id=p_tenant and id=p_id and created_by=actor;
 outcome:=case when page_count=0 then 'complete' when page_count>0 then 'received' when started.detail->>'windowId' is null then 'waiting' else 'failed' end;
 if p_outcome is distinct from outcome then raise exception 'REQUEST_CONFLICT'; end if;
 if exists(select 1 from public.access_events where tenant_id=p_tenant and target_id=p_id and action='zettle.automatic_finished') then return; end if;
 perform komisio_private.record_access(p_tenant,'zettle.automatic_finished',p_id,jsonb_build_object('outcome',outcome,'received',coalesce(page_count,0)));
end $$;

create function public.zettle_automatic_pull_status(p_tenant uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare started public.access_events; finished public.access_events;
begin
 perform komisio_private.require_identity();
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin') then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 select * into started from public.access_events where tenant_id=p_tenant and action='zettle.automatic_started' order by id desc limit 1;
 if not found then return null; end if;
 select * into finished from public.access_events where tenant_id=p_tenant and action='zettle.automatic_finished' and target_id=started.target_id order by id desc limit 1;
 return jsonb_build_object('id',started.target_id,'at',started.occurred_at,'outcome',coalesce(finished.detail->>'outcome','started'),'received',coalesce((finished.detail->>'received')::integer,0));
end $$;
revoke all on function public.zettle_automation_tenants(),public.prepare_zettle_automatic_pull(uuid,uuid),public.finish_zettle_automatic_pull(uuid,uuid,text),public.zettle_automatic_pull_status(uuid) from public,anon;
grant execute on function public.zettle_automation_tenants(),public.prepare_zettle_automatic_pull(uuid,uuid),public.finish_zettle_automatic_pull(uuid,uuid,text),public.zettle_automatic_pull_status(uuid) to authenticated;


create or replace function komisio_private.record_sale_core(p_tenant uuid,p_id uuid,p_provider text,p_external_id text,p_occurred_at timestamptz,p_currency text,p_lines jsonb,p_reference jsonb default '{}'::jsonb) returns uuid
language plpgsql security definer set search_path='' as $$
declare uid uuid:=komisio_private.require_identity(); prior public.sales; pol jsonb; line jsonb; facts jsonb; computed jsonb:='[]'::jsonb; total bigint:=0; n integer:=0; ext text:=trim(p_external_id); existing_lines jsonb; line_id uuid;
begin
 perform 1 from public.tenants where id=p_tenant for update;
 if not (coalesce(public.tenant_role(p_tenant),'') in ('owner','admin','staff') or coalesce(komisio_private.automation_allowed(p_tenant,'zettle_pull'),false)) then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 if p_id is null or p_provider is null or p_provider not in ('manual','zettle','shopify') or ext is null or length(ext) not between 1 and 200
  or p_occurred_at is null or not isfinite(p_occurred_at) or p_occurred_at>now()+interval '1 day' or p_currency is null
  or p_reference is null or jsonb_typeof(p_reference)<>'object' or not komisio_private.valid_sale_lines(p_lines) then raise exception 'INVALID_INPUT'; end if;
 if p_currency<>komisio_private.store_currency(p_tenant) then raise exception 'CURRENCY_MISMATCH'; end if;
 select * into prior from public.sales where id=p_id;
 if not found then select * into prior from public.sales where tenant_id=p_tenant and provider=p_provider and external_id=ext; end if;
 if prior.id is not null then
  select coalesce(jsonb_agg(jsonb_build_object('itemId',l.item_id,'priceOre',l.price_ore) order by l.line_no),'[]'::jsonb) into existing_lines from public.sale_lines l where l.tenant_id=prior.tenant_id and l.sale_id=prior.id;
  if prior.tenant_id is distinct from p_tenant or prior.provider is distinct from p_provider or prior.external_id is distinct from ext
   or prior.occurred_at is distinct from p_occurred_at or existing_lines is distinct from p_lines then
   raise exception 'SALE_CONFLICT';
  end if;
  return prior.id;
 end if;
 pol:=komisio_private.current_store_policy_core(p_tenant)->'policy';
 for line in select * from jsonb_array_elements(p_lines) loop
  n:=n+1;
  facts:=komisio_private.sale_line_facts(p_tenant,(line->>'itemId')::uuid,(line->>'priceOre')::bigint,pol);
  computed:=computed||(facts||jsonb_build_object('lineNo',n));
  total:=total+(facts->>'priceOre')::bigint;
 end loop;
 insert into public.sales(id,tenant_id,provider,external_id,currency,occurred_at,total_ore,provider_reference,recorded_by)
 values(p_id,p_tenant,p_provider,ext,p_currency,p_occurred_at,total,p_reference,uid);
 for facts in select * from jsonb_array_elements(computed) loop
  insert into public.sale_lines(tenant_id,sale_id,item_id,line_no,price_ore,ownership,commission_basis,commission_rate_percent,commission_ore,commission_vat_ore,seller_credit_ore,
   vat_mode,vat_rate_bp,vat_basis,vat_ore,agreement_version_id,seller_terms_version,store_policy_version)
  values(p_tenant,p_id,(facts->>'itemId')::uuid,(facts->>'lineNo')::integer,(facts->>'priceOre')::bigint,facts->>'ownership',facts->>'commissionBasis',(facts->>'commissionRatePercent')::numeric,
   (facts->>'commissionOre')::bigint,(facts->>'commissionVatOre')::bigint,(facts->>'sellerCreditOre')::bigint,
   facts->>'vatMode',(facts->>'vatRateBp')::integer,facts->'vatBasis',(facts->>'vatOre')::bigint,(facts->>'agreementVersionId')::uuid,(facts->>'sellerTermsVersion')::integer,(facts->>'storePolicyVersion')::integer)
  returning id into line_id;
  insert into public.item_events(tenant_id,item_id,kind,detail,actor) values(p_tenant,(facts->>'itemId')::uuid,'sold',jsonb_build_object('saleId',p_id,'lineNo',(facts->>'lineNo')::integer,'priceOre',(facts->>'priceOre')::bigint,'provider',p_provider),uid);
  if facts->>'ownership'='consignment' and (facts->>'sellerCreditOre')::bigint>0 then
   insert into public.seller_ledger_entries(id,tenant_id,seller_id,kind,amount_ore,reference_kind,reference_id,occurred_at,recorded_by)
   values(gen_random_uuid(),p_tenant,(facts->>'sellerId')::uuid,'credit_sale',(facts->>'sellerCreditOre')::bigint,'sale_line',line_id,p_occurred_at,uid);
  end if;
 end loop;
 perform komisio_private.record_access(p_tenant,'sale.recorded',p_id,jsonb_build_object('provider',p_provider,'external_id',ext,'lines',n,'total_ore',total,'currency',p_currency));
 return p_id;
end $$;


create or replace function public.record_sale(p_tenant uuid,p_id uuid,p_provider text,p_external_id text,p_occurred_at timestamptz,p_currency text,p_lines jsonb,p_reference jsonb default '{}'::jsonb) returns uuid
language plpgsql security definer set search_path='' as $$
begin
 perform komisio_private.require_identity();
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin','staff') then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 return komisio_private.record_sale_core(p_tenant,p_id,p_provider,p_external_id,p_occurred_at,p_currency,p_lines,p_reference);
end $$;
create or replace function public.record_zettle_page(p_tenant uuid,p_id uuid,p_before text,p_after text,p_purchases jsonb) returns uuid
language plpgsql security definer set search_path='' as $$
begin
 perform komisio_private.require_identity();
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin','staff') then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 return komisio_private.record_zettle_page_core(p_tenant,p_id,p_before,p_after,p_purchases);
end $$;
revoke all on function komisio_private.current_store_policy_core(uuid),komisio_private.record_sale_core(uuid,uuid,text,text,timestamptz,text,jsonb,jsonb) from public,anon,authenticated;


create or replace function komisio_private.reconcile_zettle_receipt(p_tenant uuid,p_import uuid) returns uuid language plpgsql security definer set search_path='' as $$
declare uid uuid:=komisio_private.require_identity();rev integer;receipt jsonb;result uuid;failure text;last public.zettle_receipt_outcomes;
begin
 select coalesce(max(revision),0) into rev from public.zettle_line_resolutions where tenant_id=p_tenant and import_id=p_import;
 begin
  receipt:=komisio_private.ready_zettle_purchase(p_tenant,p_import,rev);
  result:=komisio_private.record_sale_core(p_tenant,p_import,'zettle',receipt->>'externalId',(receipt->>'occurredAt')::timestamptz,receipt->>'currency',receipt->'lines',jsonb_build_object('zettleImportId',p_import));
 exception when others then
  failure:=case when sqlerrm ~ '^[A-Z_]{1,100}$' then sqlerrm else 'ZETTLE_RECORD_FAILED' end;
 end;
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
   if stored.occurred_at is distinct from (p->>'occurredAt')::timestamptz or stored.currency is distinct from p->>'currency' or stored.amount_ore is distinct from (p->>'amountOre')::bigint or stored.blocked_reason is distinct from p->>'blockedReason' or stored.lines is distinct from p->'lines' then raise exception 'ZETTLE_PURCHASE_CONFLICT';end if;
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
  perform komisio_private.reconcile_zettle_receipt(p_tenant,stored.id);
 end loop;
 insert into public.zettle_sync_runs(id,tenant_id,cursor_before,cursor_after,page,created_by) values(p_id,p_tenant,p_before,p_after,p_purchases,uid);
 perform komisio_private.record_access(p_tenant,'zettle.page_received',p_id,jsonb_build_object('purchases',jsonb_array_length(p_purchases)));
 return p_id;
end $$;

revoke all on function komisio_private.record_zettle_page_core(uuid,uuid,text,text,jsonb) from public,anon,authenticated;

create or replace function public.record_zettle_pull_page(p_tenant uuid,p_id uuid,p_window uuid,p_before text,p_after text,p_purchases jsonb) returns uuid
language plpgsql security definer set search_path='' as $$
declare uid uuid:=komisio_private.require_identity();w public.zettle_pull_windows;prior public.zettle_pull_pages;latest public.zettle_pull_pages;global_cursor text;next_global text;p jsonb;n integer;activation_cutover timestamptz;
begin
 perform 1 from public.tenants where id=p_tenant for update;
 if not (coalesce(public.tenant_role(p_tenant),'') in ('owner','admin') or coalesce(komisio_private.automation_allowed(p_tenant,'zettle_pull'),false)) then raise exception 'FORBIDDEN' using errcode='42501';end if;
 if p_id is null or p_window is null or p_purchases is null or jsonb_typeof(p_purchases)<>'array' or jsonb_array_length(p_purchases)>100 or length(p_before)>1000 or length(p_after)>1000 or p_before='' or p_after='' then raise exception 'INVALID_INPUT';end if;
 select * into prior from public.zettle_pull_pages where id=p_id;
 if found then
  if prior.tenant_id is distinct from p_tenant or prior.window_id is distinct from p_window or prior.cursor_before is distinct from p_before or prior.cursor_after is distinct from p_after or prior.created_by is distinct from uid or (select page from public.zettle_sync_runs where id=p_id) is distinct from p_purchases then raise exception 'REQUEST_CONFLICT';end if;
  return p_id;
 end if;
 select * into w from public.zettle_pull_windows where tenant_id=p_tenant and id=p_window;
 if not found then raise exception 'ZETTLE_WINDOW_INVALID';end if;
 select cutover into strict activation_cutover from public.zettle_pull_connections where tenant_id=p_tenant and merchant_id=w.merchant_id;
 select * into latest from public.zettle_pull_pages where window_id=w.id order by seq desc limit 1;
 if found and latest.purchase_count=0 then raise exception 'ZETTLE_WINDOW_COMPLETE';end if;
 if latest.cursor_after is distinct from p_before then raise exception 'ZETTLE_CURSOR_CHANGED';end if;
 n:=jsonb_array_length(p_purchases);
 if (n>0 and (p_after is null or p_after is not distinct from p_before)) or (n=0 and p_after is distinct from p_before) then raise exception 'INVALID_INPUT';end if;
 for p in select * from jsonb_array_elements(p_purchases) loop
  if not komisio_private.valid_zettle_purchase(p) then raise exception 'INVALID_INPUT';end if;
  if (p->>'occurredAt')::timestamptz<greatest(activation_cutover,w.start_at-interval '5 minutes') or (p->>'occurredAt')::timestamptz>=w.end_at+interval '5 minutes' then raise exception 'ZETTLE_WINDOW_INVALID';end if;
 end loop;
 select cursor_after into global_cursor from public.zettle_sync_runs where tenant_id=p_tenant order by seq desc limit 1;
 next_global:=case when n=0 then global_cursor else 'live:'||p_id::text end;
 perform komisio_private.record_zettle_page_core(p_tenant,p_id,global_cursor,next_global,p_purchases);
 insert into public.zettle_pull_pages(id,tenant_id,window_id,cursor_before,cursor_after,purchase_count,created_by) values(p_id,p_tenant,p_window,p_before,p_after,n,uid);
 return p_id;
end $$;

create or replace function public.open_zettle_pull_window(p_tenant uuid,p_merchant uuid) returns uuid
language plpgsql security definer set search_path='' as $$
declare actor uuid:=komisio_private.require_identity(); connection public.zettle_pull_connections; window_row public.zettle_pull_windows; start_time timestamptz; end_time timestamptz; result uuid; abandoned boolean:=false;
begin
 perform 1 from public.tenants where id=p_tenant for update;
 if not (coalesce(public.tenant_role(p_tenant),'') in ('owner','admin') or coalesce(komisio_private.automation_allowed(p_tenant,'zettle_pull'),false)) then raise exception 'FORBIDDEN' using errcode='42501';end if;
 select * into connection from public.zettle_pull_connections where tenant_id=p_tenant;
 if not found then raise exception 'ZETTLE_NOT_CONNECTED';end if;
 if connection.merchant_id is distinct from p_merchant then raise exception 'ZETTLE_WRONG_MERCHANT';end if;
 select * into window_row from public.zettle_pull_windows where tenant_id=p_tenant order by seq desc limit 1;
 if found then
  abandoned:=exists(select 1 from public.zettle_pull_window_closures where tenant_id=p_tenant and window_id=window_row.id);
  if not abandoned and not exists(select 1 from public.zettle_pull_pages where window_id=window_row.id and purchase_count=0) then return window_row.id;end if;
 end if;
 end_time:=date_trunc('milliseconds',clock_timestamp())-interval '2 minutes';
 if end_time<=coalesce(window_row.end_at,connection.cutover) then return null;end if;
 start_time:=case when abandoned then window_row.end_at else greatest(connection.cutover,coalesce(window_row.end_at-interval '5 minutes',connection.cutover)) end;
 end_time:=least(end_time,start_time+interval '1 day');
 insert into public.zettle_pull_windows(tenant_id,merchant_id,start_at,end_at,created_by) values(p_tenant,p_merchant,start_time,end_time,actor) returning id into result;
 return result;
end $$;
