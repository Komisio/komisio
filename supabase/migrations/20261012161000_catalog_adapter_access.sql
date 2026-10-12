-- Existing adapter operations keep their manual roles and add only leased-item automation.

create or replace function public.enable_automation(p_tenant uuid,p_id uuid,p_scope text,p_identity_email text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare uid uuid:=komisio_private.require_identity(); prior public.automation_grants; address text:=lower(trim(p_identity_email));
begin
 perform 1 from public.tenants where id=p_tenant for update;
 if coalesce(public.tenant_role(p_tenant),'')<>'owner' then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 if p_id is null or p_scope is null or p_scope not in ('zettle_pull','fortnox_send','weekly_brief','shopify_pull','day_close','catalog_export') or address is null or address !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' or length(address)>254 then raise exception 'INVALID_INPUT'; end if;
 select * into prior from public.automation_grants where id=p_id;
 if found then
  if prior.tenant_id<>p_tenant or prior.scope<>p_scope or prior.enabled_by<>uid then raise exception 'REQUEST_CONFLICT'; end if;
  return komisio_private.automation_grant_state(prior);
 end if;
 if exists(select 1 from public.automation_grants where tenant_id=p_tenant and scope=p_scope and disabled_at is null) then raise exception 'AUTOMATION_ALREADY_ENABLED'; end if;
 insert into public.automation_grants(id,tenant_id,scope,identity_email,enabled_by) values(p_id,p_tenant,p_scope,address,uid) returning * into prior;
 perform komisio_private.record_access(p_tenant,'automation.enabled',p_id,jsonb_build_object('scope',p_scope));
 return komisio_private.automation_grant_state(prior);
end $$;

create or replace function public.prepare_zettle_product(p_tenant uuid,p_item uuid) returns uuid language plpgsql security definer set search_path='' as $$
declare uid uuid:=komisio_private.require_identity();item public.items;price public.item_prices;cfg public.zettle_catalog_configs;prior public.zettle_product_exports;pid uuid;vid uuid;body jsonb;previous jsonb;title text;mode text;vat numeric;result uuid;policy_id uuid;
begin
 perform 1 from public.tenants where id=p_tenant for update;
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin','staff') and not public.catalog_export_item_access(p_tenant,p_item) then raise exception 'FORBIDDEN' using errcode='42501';end if;
 select * into item from public.items where tenant_id=p_tenant and id=p_item;
 if not found then raise exception 'ITEM_NOT_FOUND';end if;
 select * into price from public.item_prices where tenant_id=p_tenant and item_id=p_item order by set_at desc,seq desc limit 1;
 policy_id:=(komisio_private.current_store_policy_core(p_tenant)->>'id')::uuid;
 mode:=komisio_private.sale_line_facts(p_tenant,p_item,price.price_ore,komisio_private.current_store_policy_core(p_tenant)->'policy')->>'vatMode';
 select * into cfg from public.zettle_catalog_configs where tenant_id=p_tenant order by revision desc limit 1;
 vat:=(cfg.vat_map->>mode)::numeric;
 if vat is null then raise exception 'ZETTLE_VAT_MAPPING_REQUIRED';end if;
 select * into prior from public.zettle_product_exports where tenant_id=p_tenant and item_id=p_item and price_id=price.id and config_id=cfg.id and policy_version is not distinct from policy_id order by created_at desc,id desc limit 1;
 if found then return prior.id;end if;
 select product_id,variant_id into pid,vid from public.zettle_product_exports where tenant_id=p_tenant and item_id=p_item order by created_at desc,id desc limit 1;
 pid:=coalesce(pid,extensions.uuid_generate_v1mc());vid:=coalesce(vid,extensions.uuid_generate_v1mc());
 if (select count(*) from public.items where tenant_id=p_tenant and left(id::text,8)=left(p_item::text,8))<>1 then raise exception 'ZETTLE_LABEL_AMBIGUOUS';end if;
 if item.origin_kind='inspection_draft' then
  select description into title from public.inspection_draft_revisions where tenant_id=p_tenant and draft_id=item.origin_id and revision=item.origin_revision;
 elsif item.origin_kind='reception_review' then
  select suggestions->'metadata'->'description'->>'value' into title from public.reception_reviews where tenant_id=p_tenant and session_id=item.origin_id and version=item.origin_revision;
 else title:='Item I-'||upper(left(p_item::text,8));end if;
 body:=jsonb_build_object('uuid',pid,'name',left(coalesce(nullif(title,''),'Item I-'||upper(left(p_item::text,8))),120),'externalReference','komisio:'||p_item,'vatPercentage',vat,'variants',jsonb_build_array(jsonb_build_object('uuid',vid,'sku','K-'||p_item,'barcode','I-'||upper(left(p_item::text,8)),'price',jsonb_build_object('amount',price.price_ore,'currencyId',komisio_private.store_currency(p_tenant)))));
 select e.payload into previous from public.zettle_product_exports e join public.zettle_product_outcomes o on o.tenant_id=e.tenant_id and o.export_id=e.id and o.status='synced' where e.tenant_id=p_tenant and e.item_id=p_item order by o.created_at desc limit 1;
 insert into public.zettle_product_exports(tenant_id,item_id,price_id,config_id,policy_version,product_id,variant_id,payload,previous_payload,created_by) values(p_tenant,p_item,price.id,cfg.id,policy_id,pid,vid,body,previous,uid) returning id into result;
 return result;
end $$;

create or replace function public.finish_zettle_product(p_tenant uuid,p_export uuid,p_status text,p_error text) returns uuid language plpgsql security definer set search_path='' as $$
declare uid uuid:=komisio_private.require_identity();job public.zettle_product_exports;last public.zettle_product_outcomes;result uuid;
begin
 perform 1 from public.tenants where id=p_tenant for update;
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin','staff') and not public.catalog_export_item_access(p_tenant,(select item_id from public.zettle_product_exports where tenant_id=p_tenant and id=p_export)) then raise exception 'FORBIDDEN' using errcode='42501';end if;
 if p_status is null or p_status not in ('synced','failed') or (p_status='synced' and p_error is not null) or (p_status='failed' and (p_error is null or p_error!~ '^ZETTLE_[A-Z_]{1,80}$')) then raise exception 'INVALID_INPUT';end if;
 select * into job from public.zettle_product_exports where tenant_id=p_tenant and id=p_export;
 if not found then raise exception 'ZETTLE_EXPORT_NOT_FOUND';end if;
 if p_status='synced' and public.prepare_zettle_product(p_tenant,job.item_id)<>p_export then raise exception 'ZETTLE_EXPORT_STALE';end if;
 select * into last from public.zettle_product_outcomes where tenant_id=p_tenant and export_id=p_export order by created_at desc limit 1;
 if last.status=p_status and last.error_code is not distinct from p_error then return last.id;end if;
 insert into public.zettle_product_outcomes(tenant_id,export_id,status,error_code,created_by) values(p_tenant,p_export,p_status,p_error,uid) returning id into result;
 return result;
end $$;

create or replace function public.claim_zettle_stock(p_tenant uuid,p_id uuid,p_export uuid,p_merchant uuid,p_locations jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare uid uuid:=komisio_private.require_identity(); e public.zettle_product_exports; prior public.zettle_stock_intents; k text; loc uuid[]:=array[]::uuid[];
begin
 perform 1 from public.tenants where id=p_tenant for update;
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin') and not public.catalog_export_item_access(p_tenant,(select item_id from public.zettle_product_exports where tenant_id=p_tenant and id=p_export)) then raise exception 'FORBIDDEN' using errcode='42501';end if;
 if p_id is null or p_export is null or p_merchant is null or p_locations is null or jsonb_typeof(p_locations)<>'object' or (select count(*) from jsonb_object_keys(p_locations))<>4 then raise exception 'INVALID_INPUT';end if;
 foreach k in array array['STORE','SUPPLIER','SOLD','BIN'] loop
  if p_locations->>k is null then raise exception 'INVALID_INPUT';end if;
  loc:=array_append(loc,(p_locations->>k)::uuid);
 end loop;
 if (select count(distinct x) from unnest(loc) x)<>4 then raise exception 'INVALID_INPUT';end if;
 if not exists(select 1 from public.zettle_pull_connections where tenant_id=p_tenant and merchant_id=p_merchant) then raise exception 'ZETTLE_WRONG_MERCHANT';end if;
 select * into e from public.zettle_product_exports where tenant_id=p_tenant and id=p_export;
 if not found then raise exception 'ITEM_NOT_FOUND';end if;
 if public.prepare_zettle_product(p_tenant,e.item_id) is distinct from p_export then raise exception 'ZETTLE_CONFIG_CHANGED';end if;
 select * into prior from public.zettle_stock_intents where id=p_id;
 if found and (prior.tenant_id is distinct from p_tenant or prior.item_id is distinct from e.item_id or prior.created_by is distinct from uid) then raise exception 'REQUEST_CONFLICT';end if;
 select * into prior from public.zettle_stock_intents where tenant_id=p_tenant and item_id=e.item_id;
 if found then
  if prior.merchant_id is distinct from p_merchant or prior.locations is distinct from p_locations or prior.product_id is distinct from e.product_id or prior.variant_id is distinct from e.variant_id then raise exception 'ZETTLE_INVENTORY_CONFLICT';end if;
  return jsonb_build_object('id',prior.id,'fresh',false);
 end if;
 insert into public.zettle_stock_intents(id,tenant_id,item_id,export_id,merchant_id,product_id,variant_id,locations,created_by)
 values(p_id,p_tenant,e.item_id,e.id,p_merchant,e.product_id,e.variant_id,p_locations,uid);
 return jsonb_build_object('id',p_id,'fresh',true);
end $$;

create or replace function public.finish_zettle_stock(p_tenant uuid,p_intent uuid,p_status text,p_error text) returns void
language plpgsql security definer set search_path='' as $$
declare uid uuid:=komisio_private.require_identity();last public.zettle_stock_outcomes;
begin
 perform 1 from public.tenants where id=p_tenant for update;
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin') and not public.catalog_export_item_access(p_tenant,(select item_id from public.zettle_stock_intents where tenant_id=p_tenant and id=p_intent)) then raise exception 'FORBIDDEN' using errcode='42501';end if;
 if p_status is null or p_status not in ('initialized','depleted','unknown','conflict') or (p_error is not null and p_error not in ('ZETTLE_INVENTORY_FAILED','ZETTLE_INVENTORY_CONFLICT','ZETTLE_STOCK_HELD')) then raise exception 'INVALID_INPUT';end if;
 if not exists(select 1 from public.zettle_stock_intents where tenant_id=p_tenant and id=p_intent) then raise exception 'ITEM_NOT_FOUND';end if;
 select * into last from public.zettle_stock_outcomes where tenant_id=p_tenant and intent_id=p_intent order by seq desc limit 1;
 if found and last.status=p_status and last.error_code is not distinct from p_error then return;end if;
 insert into public.zettle_stock_outcomes(tenant_id,intent_id,status,error_code,created_by) values(p_tenant,p_intent,p_status,p_error,uid);
end $$;

create or replace function public.prepare_zettle_image(p_tenant uuid,p_id uuid,p_item uuid,p_merchant uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid:=komisio_private.require_identity(); item_row public.items; export_row public.zettle_product_exports;
 prior public.zettle_image_intents; request_row public.zettle_image_intents; photo jsonb; snapshot jsonb;
 export_uuid uuid; fresh boolean:=false; previous_url text;
begin
 perform 1 from public.tenants where id=p_tenant for update;
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin') and not (public.catalog_export_item_access(p_tenant,p_item) and coalesce((komisio_private.sync_preference(p_tenant,'paypal')->>'images')::boolean,false)) then raise exception 'FORBIDDEN' using errcode='42501';end if;
 if p_id is null or p_item is null or p_merchant is null then raise exception 'INVALID_INPUT';end if;
 if not exists(select 1 from public.zettle_pull_connections where tenant_id=p_tenant and merchant_id=p_merchant) then raise exception 'ZETTLE_WRONG_MERCHANT';end if;
 select * into request_row from public.zettle_image_intents where id=p_id;
 if found and (request_row.tenant_id is distinct from p_tenant or request_row.item_id is distinct from p_item or request_row.created_by is distinct from actor) then raise exception 'REQUEST_CONFLICT';end if;
 select * into item_row from public.items where tenant_id=p_tenant and id=p_item;
 if not found then raise exception 'ITEM_NOT_FOUND';end if;
 snapshot:=komisio_private.item_photo_snapshot(p_tenant,p_item);
 select x into photo from jsonb_array_elements(snapshot->'photos') x where x->>'id'=snapshot->>'defaultPhotoId';
 if photo is null then return null;end if;
 export_uuid:=public.prepare_zettle_product(p_tenant,p_item);
 select * into export_row from public.zettle_product_exports where tenant_id=p_tenant and id=export_uuid;
 if not exists(select 1 from public.zettle_product_outcomes outcome_row join public.zettle_product_exports product_row on product_row.tenant_id=outcome_row.tenant_id and product_row.id=outcome_row.export_id where product_row.tenant_id=p_tenant and product_row.item_id=p_item and product_row.product_id=export_row.product_id and outcome_row.status='synced') then raise exception 'ZETTLE_IMAGE_PRODUCT_REQUIRED';end if;
 select * into prior from public.zettle_image_intents where tenant_id=p_tenant and item_id=p_item order by seq desc limit 1;
 if request_row.id is not null and request_row.id is distinct from prior.id then raise exception 'REQUEST_CONFLICT';end if;
 if prior.id is not null then
  if prior.merchant_id is distinct from p_merchant or prior.product_id is distinct from export_row.product_id then raise exception 'REQUEST_CONFLICT';end if;
  if prior.source_reference is distinct from photo->>'path' or prior.source_bucket is distinct from photo->>'bucket' then
   if request_row.id is not null then raise exception 'ZETTLE_CONFIG_CHANGED';end if;
   if not exists(select 1 from public.zettle_image_outcomes where tenant_id=p_tenant and intent_id=prior.id) then raise exception 'ZETTLE_IMAGE_HELD';end if;
   select image_url into previous_url from public.zettle_image_uploads where tenant_id=p_tenant and intent_id=prior.id;
   prior:=null;
  end if;
 end if;
 if prior.id is null then
  insert into public.zettle_image_intents(id,tenant_id,item_id,export_id,merchant_id,product_id,source_reference,source_bucket,previous_image_url,created_by)
  values(p_id,p_tenant,p_item,export_uuid,p_merchant,export_row.product_id,photo->>'path',photo->>'bucket',previous_url,actor) returning * into prior;
  fresh:=true;
 end if;
 return jsonb_build_object('id',prior.id,'fresh',fresh,'reference',prior.source_reference,'bucket',prior.source_bucket,'exportId',export_uuid,
  'previousUrl',prior.previous_image_url,'imageUrl',(select image_url from public.zettle_image_uploads where tenant_id=p_tenant and intent_id=prior.id));
end $$;

create or replace function public.prepare_zettle_sync_image(p_tenant uuid,p_id uuid,p_item uuid,p_merchant uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
begin
 perform 1 from public.tenants where id=p_tenant for update;
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin') and not (public.catalog_export_item_access(p_tenant,p_item) and coalesce((komisio_private.sync_preference(p_tenant,'paypal')->>'images')::boolean,false)) then raise exception 'FORBIDDEN' using errcode='42501';end if;
 if not coalesce((komisio_private.sync_preference(p_tenant,'paypal')->>'images')::boolean,false) then raise exception 'ZETTLE_IMAGES_DISABLED';end if;
 return public.prepare_zettle_image(p_tenant,p_id,p_item,p_merchant);
end $$;

create or replace function public.zettle_item_image_url(p_tenant uuid,p_item uuid) returns text
language plpgsql security definer set search_path='' as $$
begin
 perform komisio_private.require_identity();
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin','staff') and not public.catalog_export_item_access(p_tenant,p_item) then raise exception 'FORBIDDEN' using errcode='42501';end if;
 return (select u.image_url from public.zettle_image_intents i join public.zettle_image_uploads u on u.tenant_id=i.tenant_id and u.intent_id=i.id
 left join public.zettle_image_outcomes o on o.tenant_id=i.tenant_id and o.intent_id=i.id
 where i.tenant_id=p_tenant and i.item_id=p_item order by (o.intent_id is not null) desc,i.seq desc limit 1);
end $$;

create or replace function public.record_zettle_image_upload(p_tenant uuid,p_intent uuid,p_url text) returns void
language plpgsql security definer set search_path='' as $$
declare actor uuid:=komisio_private.require_identity(); prior text;
begin
 perform 1 from public.tenants where id=p_tenant for update;
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin') and not (public.catalog_export_item_access(p_tenant,(select item_id from public.zettle_image_intents where tenant_id=p_tenant and id=p_intent)) and coalesce((komisio_private.sync_preference(p_tenant,'paypal')->>'images')::boolean,false)) then raise exception 'FORBIDDEN' using errcode='42501';end if;
 if p_url is null or length(p_url)>512 or p_url !~ '^https://image[.]izettle[.]com/(product|v2/images/product)/[A-Za-z0-9_-]+([.](jpg|jpeg|png))?$' then raise exception 'INVALID_INPUT';end if;
 if not exists(select 1 from public.zettle_image_intents where tenant_id=p_tenant and id=p_intent) then raise exception 'ITEM_NOT_FOUND';end if;
 select image_url into prior from public.zettle_image_uploads where tenant_id=p_tenant and intent_id=p_intent;
 if found then
  if prior is distinct from p_url then raise exception 'REQUEST_CONFLICT';end if;
  return;
 end if;
 insert into public.zettle_image_uploads(intent_id,tenant_id,image_url,created_by) values(p_intent,p_tenant,p_url,actor);
end $$;

create or replace function public.finish_zettle_image(p_tenant uuid,p_intent uuid) returns void
language plpgsql security definer set search_path='' as $$
declare actor uuid:=komisio_private.require_identity();
begin
 perform 1 from public.tenants where id=p_tenant for update;
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin') and not (public.catalog_export_item_access(p_tenant,(select item_id from public.zettle_image_intents where tenant_id=p_tenant and id=p_intent)) and coalesce((komisio_private.sync_preference(p_tenant,'paypal')->>'images')::boolean,false)) then raise exception 'FORBIDDEN' using errcode='42501';end if;
 if not exists(select 1 from public.zettle_image_uploads where tenant_id=p_tenant and intent_id=p_intent) then raise exception 'ZETTLE_IMAGE_HELD';end if;
 insert into public.zettle_image_outcomes(intent_id,tenant_id,created_by) values(p_intent,p_tenant,actor) on conflict(intent_id) do nothing;
end $$;

create or replace function public.read_paypal_credentials(p_tenant uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare connection public.paypal_credentials;
begin
 perform komisio_private.require_identity();
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin') and not coalesce(komisio_private.automation_allowed(p_tenant,'zettle_pull'),false) and not komisio_private.catalog_allowed(p_tenant,'paypal') then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 select * into connection from public.paypal_credentials where tenant_id=p_tenant;
 if not found then return null; end if;
 return jsonb_build_object('merchantId',connection.merchant_id,'cipher',connection.cipher);
end $$;

create or replace function public.integration_sync_preferences(p_tenant uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
 if komisio_private.catalog_allowed(p_tenant,'paypal') then return jsonb_build_array(komisio_private.sync_preference(p_tenant,'paypal'));end if;
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin','staff','readonly') then raise exception 'FORBIDDEN' using errcode='42501';end if;
 return coalesce((select jsonb_agg(s) from (select komisio_private.sync_preference(p_tenant,p) s from unnest(array['paypal','shopify']) p) q where s is not null),'[]'::jsonb);
end $$;

create or replace function public.paypal_item_status(p_tenant uuid,p_items uuid[]) returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin','staff','readonly') and not coalesce(cardinality(p_items)=1 and public.catalog_export_item_access(p_tenant,p_items[1]),false) then raise exception 'FORBIDDEN' using errcode='42501';end if;
 if p_items is null or cardinality(p_items)>50 then raise exception 'INVALID_INPUT';end if;
 return coalesce((select jsonb_agg(komisio_private.paypal_item_snapshot(p_tenant,i.id) order by i.id) from public.items i where i.tenant_id=p_tenant and i.id=any(p_items)),'[]'::jsonb);
end $$;
