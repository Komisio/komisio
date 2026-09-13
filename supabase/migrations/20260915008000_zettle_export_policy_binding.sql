-- Bind jobs to the engine policy revision; old snapshots remain immutable.
alter table public.zettle_product_exports add column policy_version uuid;
alter table public.zettle_product_exports drop constraint zettle_product_exports_tenant_id_item_id_price_id_config_id_key;
create unique index zettle_export_snapshot on public.zettle_product_exports(tenant_id,item_id,price_id,config_id,policy_version) nulls not distinct;
create or replace function public.prepare_zettle_product(p_tenant uuid,p_item uuid) returns uuid language plpgsql security definer set search_path='' as $$
declare uid uuid:=komisio_private.require_identity();item public.items;price public.item_prices;cfg public.zettle_catalog_configs;prior public.zettle_product_exports;pid uuid;vid uuid;body jsonb;previous jsonb;title text;mode text;vat numeric;result uuid;policy_id uuid;
begin
 perform 1 from public.tenants where id=p_tenant for update;
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin','staff') then raise exception 'FORBIDDEN' using errcode='42501';end if;
 select * into item from public.items where tenant_id=p_tenant and id=p_item;
 if not found then raise exception 'ITEM_NOT_FOUND';end if;
 select * into price from public.item_prices where tenant_id=p_tenant and item_id=p_item order by set_at desc,seq desc limit 1;
 policy_id:=(public.current_store_policy(p_tenant)->>'id')::uuid;
 mode:=komisio_private.sale_line_facts(p_tenant,p_item,price.price_ore,public.current_store_policy(p_tenant)->'policy')->>'vatMode';
 select * into cfg from public.zettle_catalog_configs where tenant_id=p_tenant order by revision desc limit 1;
 vat:=(cfg.vat_map->>mode)::numeric;
 if vat is null then raise exception 'ZETTLE_VAT_MAPPING_REQUIRED';end if;
 select * into prior from public.zettle_product_exports where tenant_id=p_tenant and item_id=p_item and price_id=price.id and config_id=cfg.id and policy_version is not distinct from policy_id;
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
 insert into public.zettle_product_exports(tenant_id,item_id,price_id,config_id,policy_version,product_id,variant_id,payload,previous_payload,created_by) values(p_tenant,p_item,price.id,cfg.id,policy_id,pid,vid,body,previous,uid) returning id into result;
 return result;
end $$;
create or replace function public.zettle_catalog_candidates(p_tenant uuid) returns table(item_id uuid) language plpgsql stable security definer set search_path='' as $$
begin
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin','staff','readonly') then raise exception 'FORBIDDEN' using errcode='42501';end if;
 return query select i.id from public.items i
 join lateral(select p.id from public.item_prices p where p.tenant_id=p_tenant and p.item_id=i.id order by set_at desc,seq desc limit 1) p on true
 left join lateral(select c.id from public.zettle_catalog_configs c where c.tenant_id=p_tenant order by revision desc limit 1)c on true
 where i.tenant_id=p_tenant and not (komisio_private.item_lifecycle(p_tenant,i.id)->>'sold')::boolean and not (komisio_private.item_lifecycle(p_tenant,i.id)->>'ended')::boolean
 and not exists(select 1 from public.zettle_product_exports e join public.zettle_product_outcomes o on o.tenant_id=e.tenant_id and o.export_id=e.id and o.status='synced' where e.tenant_id=p_tenant and e.item_id=i.id and e.price_id=p.id and e.config_id=c.id and e.policy_version is not distinct from (public.current_store_policy(p_tenant)->>'id')::uuid)
 order by i.accepted_at,i.id limit 20;
end $$;
create or replace function public.publish_zettle_catalog_config(p_tenant uuid,p_id uuid,p_previous uuid,p_map jsonb) returns uuid language plpgsql security definer set search_path='' as $$
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
  if prior.tenant_id<>p_tenant or prior.vat_map<>p_map or prior.created_by<>uid or p_previous is distinct from (select c.id from public.zettle_catalog_configs c where c.tenant_id=p_tenant and c.revision=prior.revision-1) then raise exception 'REQUEST_CONFLICT';end if;
  return p_id;
 end if;
 select * into latest from public.zettle_catalog_configs where tenant_id=p_tenant order by revision desc limit 1;
 if latest.id is distinct from p_previous then raise exception 'ZETTLE_CONFIG_CHANGED';end if;
 insert into public.zettle_catalog_configs(id,tenant_id,revision,vat_map,created_by) values(p_id,p_tenant,coalesce(latest.revision,0)+1,p_map,uid);
 return p_id;
end $$;
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
  if (line ? 'productUuid' and line->'productUuid'<>'null'::jsonb and (jsonb_typeof(line->'productUuid')<>'string' or (line->>'productUuid')!~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')) or (line ? 'variantUuid' and line->'variantUuid'<>'null'::jsonb and (jsonb_typeof(line->'variantUuid')<>'string' or (line->>'variantUuid')!~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')) then return false;end if;
  total:=total+(line->>'priceOre')::numeric;
  if p->'blockedReason'='null'::jsonb and (line->>'priceOre')::numeric<=0 then return false;end if;
 end loop;
 if p->'blockedReason'='null'::jsonb and (p->>'currency'<>'SEK' or total<>(p->>'amountOre')::numeric or total<=0) then return false;end if;
 return true;
exception when others then return false;
end $$;

