-- Provider adapters produce one read-only connection observation per item.
create or replace function komisio_private.item_sync_snapshot(p_tenant uuid,p_item uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare result jsonb:='[]'; s jsonb; e public.shopify_product_exports; o public.shopify_product_outcomes;
 img public.shopify_product_images; stage text; price uuid; connected boolean; state text; current_photo jsonb; c jsonb; photo_ref text; photo_bucket text; mapped jsonb:='[]';
begin
 if exists(select 1 from public.zettle_pull_connections where tenant_id=p_tenant)
  or exists(select 1 from public.zettle_product_exports where tenant_id=p_tenant and item_id=p_item) then
  s:=komisio_private.paypal_item_snapshot(p_tenant,p_item);
  result:=result||jsonb_build_array(s||jsonb_build_object('provider','paypal','connectionId','paypal'));
 end if;
 connected:=exists(select 1 from public.shopify_connections where tenant_id=p_tenant);
 select * into e from public.shopify_product_exports where tenant_id=p_tenant and item_id=p_item order by seq desc limit 1;
 if connected or e.id is not null then
  stage:=komisio_private.item_lifecycle(p_tenant,p_item)->>'stage';
  select id into price from public.item_prices where tenant_id=p_tenant and item_id=p_item order by set_at desc,seq desc limit 1;
  select * into o from public.shopify_product_outcomes where tenant_id=p_tenant and export_id=e.id order by seq desc limit 1;
  select * into img from public.shopify_product_images where tenant_id=p_tenant and item_id=p_item;
  state:=case when stage in ('sold','ended','period_ended') then 'inactive'
   when e.id is null then 'not_sent' when e.price_id is distinct from price then 'changed'
   when o.status='failed' then 'failed'
   when o.status='synced' and (img.id is null or img.media_gid is not null) then 'synced' else 'attention' end;
  result:=result||jsonb_build_array(jsonb_build_object('provider','shopify','connectionId','shopify','itemId',p_item,'status',state,
   'productStatus',case when e.id is null then null else coalesce(o.status,'pending') end,'productAt',o.created_at,
   'stockStatus',null,'stockAt',null,
   'imageStatus',case when img.media_gid is not null then 'synced' when img.error_code is not null then 'failed' when img.id is not null then 'pending' end,
   'errorCode',coalesce(o.error_code,img.error_code),'canExport',stage in ('on_sale','markdown_due','period_ending'),'connected',connected));
 end if;
 current_photo:=komisio_private.item_photo_snapshot(p_tenant,p_item);
 select x into current_photo from jsonb_array_elements(current_photo->'photos') x where x->>'id'=current_photo->>'defaultPhotoId';
 for c in select * from jsonb_array_elements(result) loop
  if current_photo is not null and coalesce((komisio_private.sync_preference(p_tenant,c->>'provider')->>'images')::boolean,false) then
   photo_ref:=null;photo_bucket:=null;
   if c->>'provider'='paypal' then
    select source_reference,source_bucket into photo_ref,photo_bucket from public.zettle_image_intents where tenant_id=p_tenant and item_id=p_item order by seq desc limit 1;
   elsif c->>'provider'='shopify' then
    select source_reference,source_bucket into photo_ref,photo_bucket from public.shopify_product_images where tenant_id=p_tenant and item_id=p_item;
   end if;
   if photo_ref is distinct from current_photo->>'path' or photo_bucket is distinct from current_photo->>'bucket' then
    c:=c||jsonb_build_object('imageStatus',case when photo_ref is null then 'not_sent' else 'changed' end);
   end if;
   if c->>'status'='synced' and c->>'imageStatus'<>'synced' then c:=c||jsonb_build_object('status','attention');end if;
  end if;
  mapped:=mapped||jsonb_build_array(c);
 end loop;
 return mapped;
end $$;
revoke all on function komisio_private.item_sync_snapshot(uuid,uuid) from public,anon,authenticated;

