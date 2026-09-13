-- Owner-authorized deterministic POS sync; AI proposal approvals are unchanged.
create table public.zettle_catalog_configs(id uuid primary key,tenant_id uuid not null references public.tenants(id),revision integer not null,vat_map jsonb not null,created_by uuid not null references auth.users(id),created_at timestamptz not null default clock_timestamp(),unique(tenant_id,revision));
create table public.zettle_product_exports(id uuid primary key default gen_random_uuid(),tenant_id uuid not null,item_id uuid not null,price_id uuid not null references public.item_prices(id),config_id uuid not null references public.zettle_catalog_configs(id),product_id uuid not null,variant_id uuid not null,payload jsonb not null,previous_payload jsonb,created_by uuid not null references auth.users(id),created_at timestamptz not null default clock_timestamp(),unique(tenant_id,item_id,price_id,config_id),foreign key(tenant_id,item_id) references public.items(tenant_id,id),unique(tenant_id,id));
create table public.zettle_product_outcomes(id uuid primary key default gen_random_uuid(),tenant_id uuid not null,export_id uuid not null,status text not null check(status in ('synced','failed')),error_code text,created_by uuid not null references auth.users(id),created_at timestamptz not null default clock_timestamp(),foreign key(tenant_id,export_id) references public.zettle_product_exports(tenant_id,id));
create table public.zettle_receipt_outcomes(id uuid primary key default gen_random_uuid(),tenant_id uuid not null,import_id uuid not null,mapping_revision integer not null,sale_id uuid references public.sales(id),error_code text,created_by uuid not null references auth.users(id),created_at timestamptz not null default clock_timestamp(),foreign key(tenant_id,import_id) references public.zettle_imports(tenant_id,id));
create index zettle_product_item on public.zettle_product_exports(tenant_id,item_id,created_at desc);
create index zettle_product_pair on public.zettle_product_exports(tenant_id,product_id,variant_id);
create index zettle_product_result on public.zettle_product_outcomes(tenant_id,export_id,created_at desc);
create index zettle_receipt_result on public.zettle_receipt_outcomes(tenant_id,import_id,created_at desc);
alter table public.zettle_catalog_configs enable row level security;
revoke all on public.zettle_catalog_configs from anon,authenticated;
grant select on public.zettle_catalog_configs to authenticated;
create policy read_store on public.zettle_catalog_configs for select to authenticated using(public.tenant_role(tenant_id) in ('owner','admin','staff','readonly'));
create policy store_boundary on public.zettle_catalog_configs as restrictive for all to authenticated using(public.tenant_role(tenant_id) in ('owner','admin','staff','readonly')) with check(false);
create trigger immutable before update or delete on public.zettle_catalog_configs for each row execute function komisio_private.preserve_zettle();
alter table public.zettle_product_exports enable row level security;
revoke all on public.zettle_product_exports from anon,authenticated;
grant select on public.zettle_product_exports to authenticated;
create policy read_store on public.zettle_product_exports for select to authenticated using(public.tenant_role(tenant_id) in ('owner','admin','staff','readonly'));
create policy store_boundary on public.zettle_product_exports as restrictive for all to authenticated using(public.tenant_role(tenant_id) in ('owner','admin','staff','readonly')) with check(false);
create trigger immutable before update or delete on public.zettle_product_exports for each row execute function komisio_private.preserve_zettle();
alter table public.zettle_product_outcomes enable row level security;
revoke all on public.zettle_product_outcomes from anon,authenticated;
grant select on public.zettle_product_outcomes to authenticated;
create policy read_store on public.zettle_product_outcomes for select to authenticated using(public.tenant_role(tenant_id) in ('owner','admin','staff','readonly'));
create policy store_boundary on public.zettle_product_outcomes as restrictive for all to authenticated using(public.tenant_role(tenant_id) in ('owner','admin','staff','readonly')) with check(false);
create trigger immutable before update or delete on public.zettle_product_outcomes for each row execute function komisio_private.preserve_zettle();
alter table public.zettle_receipt_outcomes enable row level security;
revoke all on public.zettle_receipt_outcomes from anon,authenticated;
grant select on public.zettle_receipt_outcomes to authenticated;
create policy read_store on public.zettle_receipt_outcomes for select to authenticated using(public.tenant_role(tenant_id) in ('owner','admin','staff','readonly'));
create policy store_boundary on public.zettle_receipt_outcomes as restrictive for all to authenticated using(public.tenant_role(tenant_id) in ('owner','admin','staff','readonly')) with check(false);
create trigger immutable before update or delete on public.zettle_receipt_outcomes for each row execute function komisio_private.preserve_zettle();

create function public.publish_zettle_catalog_config(p_tenant uuid,p_id uuid,p_previous uuid,p_map jsonb) returns uuid language plpgsql security definer set search_path='' as $$
declare uid uuid:=komisio_private.require_identity();prior public.zettle_catalog_configs;latest public.zettle_catalog_configs;k text;v jsonb;
begin
 perform 1 from public.tenants where id=p_tenant for update;
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin') then raise exception 'FORBIDDEN' using errcode='42501';end if;
 if p_id is null or p_map is null or jsonb_typeof(p_map)<>'object' or p_map='{}'::jsonb then raise exception 'INVALID_INPUT';end if;
 for k,v in select * from jsonb_each(p_map) loop
  if k not in ('consignment_margin','consignment_full','consignment_business','store_margin','store_full') or jsonb_typeof(v)<>'number' or v::text!~ '^[0-9]{1,3}(\.[0-9]{1,2})?$' or v::text::numeric>100 then raise exception 'INVALID_INPUT';end if;
 end loop;
 select * into prior from public.zettle_catalog_configs where id=p_id;
 if found then
  if prior.tenant_id<>p_tenant or prior.vat_map<>p_map or prior.created_by<>uid then raise exception 'REQUEST_CONFLICT';end if;
  return p_id;
 end if;
 select * into latest from public.zettle_catalog_configs where tenant_id=p_tenant order by revision desc limit 1;
 if latest.id is distinct from p_previous then raise exception 'ZETTLE_CONFIG_CHANGED';end if;
 insert into public.zettle_catalog_configs(id,tenant_id,revision,vat_map,created_by) values(p_id,p_tenant,coalesce(latest.revision,0)+1,p_map,uid);
 return p_id;
end $$;
create function public.prepare_zettle_product(p_tenant uuid,p_item uuid) returns uuid language plpgsql security definer set search_path='' as $$
declare uid uuid:=komisio_private.require_identity();item public.items;price public.item_prices;cfg public.zettle_catalog_configs;prior public.zettle_product_exports;pid uuid;vid uuid;body jsonb;previous jsonb;title text;mode text;vat numeric;result uuid;
begin
 perform 1 from public.tenants where id=p_tenant for update;
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin','staff') then raise exception 'FORBIDDEN' using errcode='42501';end if;
 select * into item from public.items where tenant_id=p_tenant and id=p_item;
 if not found then raise exception 'ITEM_NOT_FOUND';end if;
 select * into price from public.item_prices where tenant_id=p_tenant and item_id=p_item order by set_at desc,seq desc limit 1;
 mode:=komisio_private.sale_line_facts(p_tenant,p_item,price.price_ore,public.current_store_policy(p_tenant)->'policy')->>'vatMode';
 select * into cfg from public.zettle_catalog_configs where tenant_id=p_tenant order by revision desc limit 1;
 vat:=(cfg.vat_map->>mode)::numeric;
 if vat is null then raise exception 'ZETTLE_VAT_MAPPING_REQUIRED';end if;
 select * into prior from public.zettle_product_exports where tenant_id=p_tenant and item_id=p_item and price_id=price.id and config_id=cfg.id;
 if found then return prior.id;end if;
 select product_id,variant_id into pid,vid from public.zettle_product_exports where tenant_id=p_tenant and item_id=p_item order by created_at limit 1;
 pid:=coalesce(pid,gen_random_uuid());vid:=coalesce(vid,gen_random_uuid());
 if (select count(*) from public.items where tenant_id=p_tenant and left(id::text,8)=left(p_item::text,8))<>1 then raise exception 'ZETTLE_LABEL_AMBIGUOUS';end if;
 if item.origin_kind='inspection_draft' then
  select description into title from public.inspection_draft_revisions where tenant_id=p_tenant and draft_id=item.origin_id and revision=item.origin_revision;
 elsif item.origin_kind='reception_review' then
  select suggestions->'metadata'->'description'->>'value' into title from public.reception_reviews where tenant_id=p_tenant and session_id=item.origin_id and version=item.origin_revision;
 else title:='Item I-'||upper(left(p_item::text,8));end if;
 body:=jsonb_build_object('uuid',pid,'name',left(coalesce(nullif(title,''),'Item I-'||upper(left(p_item::text,8))),120),'externalReference','komisio:'||p_item,'vatPercentage',vat,'variants',jsonb_build_array(jsonb_build_object('uuid',vid,'sku','K-'||p_item,'barcode','I-'||upper(left(p_item::text,8)),'price',jsonb_build_object('amount',price.price_ore,'currencyId','SEK'))));
 select e.payload into previous from public.zettle_product_exports e join public.zettle_product_outcomes o on o.tenant_id=e.tenant_id and o.export_id=e.id and o.status='synced' where e.tenant_id=p_tenant and e.item_id=p_item order by o.created_at desc limit 1;
 insert into public.zettle_product_exports(tenant_id,item_id,price_id,config_id,product_id,variant_id,payload,previous_payload,created_by) values(p_tenant,p_item,price.id,cfg.id,pid,vid,body,previous,uid) returning id into result;
 return result;
end $$;
create function public.finish_zettle_product(p_tenant uuid,p_export uuid,p_status text,p_error text) returns uuid language plpgsql security definer set search_path='' as $$
declare uid uuid:=komisio_private.require_identity();job public.zettle_product_exports;last public.zettle_product_outcomes;result uuid;
begin
 perform 1 from public.tenants where id=p_tenant for update;
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin','staff') then raise exception 'FORBIDDEN' using errcode='42501';end if;
 if p_status is null or p_status not in ('synced','failed') or (p_status='synced' and p_error is not null) or (p_status='failed' and (p_error is null or p_error!~ '^ZETTLE_[A-Z_]{1,80}$')) then raise exception 'INVALID_INPUT';end if;
 select * into job from public.zettle_product_exports where tenant_id=p_tenant and id=p_export;
 if not found then raise exception 'ZETTLE_EXPORT_NOT_FOUND';end if;
 if p_status='synced' and public.prepare_zettle_product(p_tenant,job.item_id)<>p_export then raise exception 'ZETTLE_EXPORT_STALE';end if;
 select * into last from public.zettle_product_outcomes where tenant_id=p_tenant and export_id=p_export order by created_at desc limit 1;
 if last.status=p_status and last.error_code is not distinct from p_error then return last.id;end if;
 insert into public.zettle_product_outcomes(tenant_id,export_id,status,error_code,created_by) values(p_tenant,p_export,p_status,p_error,uid) returning id into result;
 return result;
end $$;
create function public.zettle_catalog_candidates(p_tenant uuid) returns table(item_id uuid) language plpgsql stable security definer set search_path='' as $$
begin
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin','staff','readonly') then raise exception 'FORBIDDEN' using errcode='42501';end if;
 return query select i.id from public.items i
 join lateral(select p.id from public.item_prices p where p.tenant_id=p_tenant and p.item_id=i.id order by set_at desc,seq desc limit 1) p on true
 left join lateral(select c.id from public.zettle_catalog_configs c where c.tenant_id=p_tenant order by revision desc limit 1)c on true
 where i.tenant_id=p_tenant and not (komisio_private.item_lifecycle(p_tenant,i.id)->>'sold')::boolean and not (komisio_private.item_lifecycle(p_tenant,i.id)->>'ended')::boolean
 and not exists(select 1 from public.zettle_product_exports e join public.zettle_product_outcomes o on o.tenant_id=e.tenant_id and o.export_id=e.id and o.status='synced' where e.tenant_id=p_tenant and e.item_id=i.id and e.price_id=p.id and e.config_id=c.id)
 order by i.accepted_at,i.id limit 20;
end $$;
create function komisio_private.reconcile_zettle_receipt(p_tenant uuid,p_import uuid) returns uuid language plpgsql security definer set search_path='' as $$
declare uid uuid:=komisio_private.require_identity();rev integer;receipt jsonb;result uuid;failure text;last public.zettle_receipt_outcomes;
begin
 select coalesce(max(revision),0) into rev from public.zettle_line_resolutions where tenant_id=p_tenant and import_id=p_import;
 begin
  receipt:=komisio_private.ready_zettle_purchase(p_tenant,p_import,rev);
  result:=public.record_sale(p_tenant,p_import,'zettle',receipt->>'externalId',(receipt->>'occurredAt')::timestamptz,'SEK',receipt->'lines',jsonb_build_object('zettleImportId',p_import));
 exception when others then
  failure:=case when sqlerrm ~ '^[A-Z_]{1,100}$' then sqlerrm else 'ZETTLE_RECORD_FAILED' end;
 end;
 select * into last from public.zettle_receipt_outcomes where tenant_id=p_tenant and import_id=p_import order by created_at desc limit 1;
 if last.mapping_revision=rev and last.sale_id is not distinct from result and last.error_code is not distinct from failure then return result;end if;
 insert into public.zettle_receipt_outcomes(tenant_id,import_id,mapping_revision,sale_id,error_code,created_by) values(p_tenant,p_import,rev,result,failure,uid);
 return result;
end $$;
create function public.reconcile_zettle_receipt(p_tenant uuid,p_import uuid) returns uuid language plpgsql security definer set search_path='' as $$
begin
 perform komisio_private.require_identity();perform 1 from public.tenants where id=p_tenant for update;
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin','staff') then raise exception 'FORBIDDEN' using errcode='42501';end if;
 if not exists(select 1 from public.zettle_imports where tenant_id=p_tenant and id=p_import) then raise exception 'ZETTLE_IMPORT_NOT_FOUND';end if;
 return komisio_private.reconcile_zettle_receipt(p_tenant,p_import);
end $$;
revoke all on function komisio_private.reconcile_zettle_receipt(uuid,uuid) from public,anon,authenticated;
revoke all on function public.publish_zettle_catalog_config(uuid,uuid,uuid,jsonb) from public,anon;
grant execute on function public.publish_zettle_catalog_config(uuid,uuid,uuid,jsonb) to authenticated;
revoke all on function public.prepare_zettle_product(uuid,uuid) from public,anon;
grant execute on function public.prepare_zettle_product(uuid,uuid) to authenticated;
revoke all on function public.finish_zettle_product(uuid,uuid,text,text) from public,anon;
grant execute on function public.finish_zettle_product(uuid,uuid,text,text) to authenticated;
revoke all on function public.zettle_catalog_candidates(uuid) from public,anon;
grant execute on function public.zettle_catalog_candidates(uuid) to authenticated;
revoke all on function public.reconcile_zettle_receipt(uuid,uuid) from public,anon;
grant execute on function public.reconcile_zettle_receipt(uuid,uuid) to authenticated;
create or replace function komisio_private.valid_zettle_purchase(p jsonb) returns boolean language plpgsql immutable set search_path='' as $$
declare line jsonb;n integer:=0;total numeric:=0;
begin
 if p is null or jsonb_typeof(p)<>'object' or not(p ?& array['externalId','occurredAt','currency','amountOre','blockedReason','lines']) or (p-array['externalId','occurredAt','currency','amountOre','blockedReason','lines'])<>'{}'::jsonb then return false;end if;
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
  if (line ? 'productUuid' and line->'productUuid'<>'null'::jsonb and (jsonb_typeof(line->'productUuid')<>'string' or (line->>'productUuid')!~ '^[0-9a-f-]{36}$')) or (line ? 'variantUuid' and line->'variantUuid'<>'null'::jsonb and (jsonb_typeof(line->'variantUuid')<>'string' or (line->>'variantUuid')!~ '^[0-9a-f-]{36}$')) then return false;end if;
  total:=total+(line->>'priceOre')::numeric;
  if p->'blockedReason'='null'::jsonb and (line->>'priceOre')::numeric<=0 then return false;end if;
 end loop;
 if p->'blockedReason'='null'::jsonb and (p->>'currency'<>'SEK' or total<>(p->>'amountOre')::numeric or total<=0) then return false;end if;
 return true;
exception when others then return false;
end $$;

create or replace function public.record_zettle_page(p_tenant uuid,p_id uuid,p_before text,p_after text,p_purchases jsonb) returns uuid
language plpgsql security definer set search_path='' as $$
declare uid uuid:=komisio_private.require_identity();prior public.zettle_sync_runs;latest text;p jsonb;stored public.zettle_imports;line jsonb;matches uuid[];rev integer;
begin
 perform 1 from public.tenants where id=p_tenant for update;
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin','staff') then raise exception 'FORBIDDEN' using errcode='42501';end if;
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
create or replace function public.resolve_zettle_line(p_tenant uuid,p_id uuid,p_import uuid,p_line integer,p_expected integer,p_item uuid) returns uuid
language plpgsql security definer set search_path='' as $$
declare uid uuid:=komisio_private.require_identity();prior public.zettle_line_resolutions;receipt public.zettle_imports;latest integer;
begin
 perform 1 from public.tenants where id=p_tenant for update;
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin','staff') then raise exception 'FORBIDDEN' using errcode='42501';end if;
 if p_id is null or p_import is null or p_line is null or p_expected is null or p_expected<0 or p_expected>=999999999 or p_item is null then raise exception 'INVALID_INPUT';end if;
 select * into prior from public.zettle_line_resolutions where id=p_id;
 if found then
  if prior.tenant_id is distinct from p_tenant or prior.import_id is distinct from p_import or prior.line_no is distinct from p_line or prior.revision is distinct from p_expected+1 or prior.item_id is distinct from p_item or prior.created_by is distinct from uid then raise exception 'REQUEST_CONFLICT';end if;
  return p_id;
 end if;
 select * into receipt from public.zettle_imports where tenant_id=p_tenant and id=p_import;
 if not found or p_line<1 or p_line>jsonb_array_length(receipt.lines) then raise exception 'ZETTLE_IMPORT_NOT_FOUND';end if;
 if exists(select 1 from public.sales where tenant_id=p_tenant and provider='zettle' and external_id=receipt.external_id::text) then raise exception 'ZETTLE_ALREADY_RECORDED';end if;
 if not exists(select 1 from public.items where tenant_id=p_tenant and id=p_item) then raise exception 'ITEM_NOT_FOUND';end if;
 select coalesce(max(revision),0) into latest from public.zettle_line_resolutions where import_id=p_import;
 if latest<>p_expected then raise exception 'ZETTLE_MATCH_CHANGED';end if;
 insert into public.zettle_line_resolutions(id,tenant_id,import_id,line_no,item_id,revision,source,created_by) values(p_id,p_tenant,p_import,p_line,p_item,latest+1,'staff',uid);
 perform komisio_private.reconcile_zettle_receipt(p_tenant,p_import);
 perform komisio_private.record_access(p_tenant,'zettle.line_resolved',p_import,jsonb_build_object('line',p_line,'revision',latest+1));
 return p_id;
end $$;
