alter table public.zettle_image_intents add column source_bucket text not null default 'reception-photos' check(source_bucket in ('reception-photos','item-photos'));
alter table public.zettle_image_intents add column previous_image_url text;
alter table public.zettle_image_intents add column seq bigint generated always as identity;
alter table public.zettle_image_intents drop constraint zettle_image_intents_tenant_id_item_id_key;
create index zettle_image_intents_latest on public.zettle_image_intents(tenant_id,item_id,seq desc);
create or replace function public.prepare_zettle_image(p_tenant uuid,p_id uuid,p_item uuid,p_merchant uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid:=komisio_private.require_identity(); item_row public.items; export_row public.zettle_product_exports;
 prior public.zettle_image_intents; request_row public.zettle_image_intents; photo jsonb; snapshot jsonb;
 export_uuid uuid; fresh boolean:=false; previous_url text;
begin
 perform 1 from public.tenants where id=p_tenant for update;
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin') then raise exception 'FORBIDDEN' using errcode='42501';end if;
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

-- Product-sync callers must recheck the account's preference before every transport.
create function public.prepare_zettle_sync_image(p_tenant uuid,p_id uuid,p_item uuid,p_merchant uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
begin
 perform 1 from public.tenants where id=p_tenant for update;
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin') then raise exception 'FORBIDDEN' using errcode='42501';end if;
 if not coalesce((komisio_private.sync_preference(p_tenant,'paypal')->>'images')::boolean,false) then raise exception 'ZETTLE_IMAGES_DISABLED';end if;
 return public.prepare_zettle_image(p_tenant,p_id,p_item,p_merchant);
end $$;
revoke all on function public.prepare_zettle_sync_image(uuid,uuid,uuid,uuid) from public,anon;
grant execute on function public.prepare_zettle_sync_image(uuid,uuid,uuid,uuid) to authenticated;

create or replace function public.zettle_item_image_url(p_tenant uuid,p_item uuid) returns text
language plpgsql security definer set search_path='' as $$
begin
 perform komisio_private.require_identity();
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin','staff') then raise exception 'FORBIDDEN' using errcode='42501';end if;
 return (select u.image_url from public.zettle_image_intents i join public.zettle_image_uploads u on u.tenant_id=i.tenant_id and u.intent_id=i.id
 left join public.zettle_image_outcomes o on o.tenant_id=i.tenant_id and o.intent_id=i.id
 where i.tenant_id=p_tenant and i.item_id=p_item order by (o.intent_id is not null) desc,i.seq desc limit 1);
end $$;
create or replace function public.zettle_image_status(p_tenant uuid) returns table(item_id uuid,status text)
language plpgsql security definer set search_path='' as $$
begin
 perform komisio_private.require_identity();
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin','staff') then raise exception 'FORBIDDEN' using errcode='42501';end if;
 return query select i.item_id,case when o.intent_id is not null then 'synced' when u.intent_id is not null then 'uploaded' else 'held' end
 from (select distinct on (ii.item_id) * from public.zettle_image_intents ii where ii.tenant_id=p_tenant order by ii.item_id,ii.seq desc) i
 left join public.zettle_image_uploads u on u.tenant_id=i.tenant_id and u.intent_id=i.id
 left join public.zettle_image_outcomes o on o.tenant_id=i.tenant_id and o.intent_id=i.id order by i.seq desc limit 50;
end $$;
-- Recorded POS observations. Called only after tenant authorization.
create or replace function komisio_private.paypal_item_snapshot(p_tenant uuid,p_item uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare e public.zettle_product_exports; o public.zettle_product_outcomes;
 s public.zettle_stock_outcomes; img text; state text; stage text; price_id uuid; config_id uuid; policy_id uuid;
begin
 stage:=komisio_private.item_lifecycle(p_tenant,p_item)->>'stage';
 select id into price_id from public.item_prices where tenant_id=p_tenant and item_id=p_item order by set_at desc,seq desc limit 1;
 select id into config_id from public.zettle_catalog_configs where tenant_id=p_tenant order by revision desc limit 1;
 policy_id:=(komisio_private.current_store_policy_core(p_tenant)->>'id')::uuid;
 select * into e from public.zettle_product_exports where tenant_id=p_tenant and item_id=p_item order by created_at desc,id desc limit 1;
 select * into o from public.zettle_product_outcomes where tenant_id=p_tenant and export_id=e.id order by created_at desc,id desc limit 1;
 select so.* into s from public.zettle_stock_intents si join public.zettle_stock_outcomes so on so.tenant_id=si.tenant_id and so.intent_id=si.id where si.tenant_id=p_tenant and si.item_id=p_item order by so.seq desc limit 1;
 select case when io.intent_id is not null then 'synced' when iu.intent_id is not null then 'uploaded' else 'held' end into img
 from public.zettle_image_intents ii
 left join public.zettle_image_uploads iu on iu.tenant_id=ii.tenant_id and iu.intent_id=ii.id
 left join public.zettle_image_outcomes io on io.tenant_id=ii.tenant_id and io.intent_id=ii.id
 where ii.tenant_id=p_tenant and ii.item_id=p_item order by ii.seq desc limit 1;
 state:=case
  when stage in ('sold','ended','period_ended') then 'inactive'
  when e.id is null then 'not_sent'
  when e.price_id is distinct from price_id or e.config_id is distinct from config_id or e.policy_version is distinct from policy_id then 'changed'
  when o.status='failed' then 'failed'
  when o.status='synced' and s.status='initialized' then 'synced'
  else 'attention' end;
 return jsonb_build_object('itemId',p_item,'status',state,'productStatus',o.status,'productAt',o.created_at,
  'stockStatus',s.status,'stockAt',s.created_at,'imageStatus',img,'errorCode',coalesce(o.error_code,s.error_code),
  'canExport',stage in ('on_sale','markdown_due','period_ending'),
  'connected',exists(select 1 from public.zettle_pull_connections where tenant_id=p_tenant));
end $$;
revoke all on function komisio_private.paypal_item_snapshot(uuid,uuid) from public,anon,authenticated;

