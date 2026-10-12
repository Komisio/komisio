alter table public.shopify_product_images add column source_bucket text not null default 'reception-photos' check(source_bucket in ('reception-photos','item-photos'));
create or replace function public.prepare_shopify_image(p_tenant uuid,p_id uuid,p_item uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid:=komisio_private.require_identity(); item_row public.items; prior public.shopify_product_images; selected_photo jsonb; snapshot jsonb; gid text; fresh boolean:=false;
begin
 perform 1 from public.tenants where id=p_tenant for update;
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin') then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 if p_id is null or p_item is null then raise exception 'INVALID_INPUT'; end if;
 select * into item_row from public.items where tenant_id=p_tenant and id=p_item;
 if not found then raise exception 'ITEM_NOT_FOUND'; end if;
 snapshot:=komisio_private.item_photo_snapshot(p_tenant,p_item);
 select x into selected_photo from jsonb_array_elements(snapshot->'photos') x where x->>'id'=snapshot->>'defaultPhotoId';
 if selected_photo is null then return null;end if;
 select o.product_gid into gid from public.shopify_product_outcomes o join public.shopify_product_exports e on e.tenant_id=o.tenant_id and e.id=o.export_id
  where o.tenant_id=p_tenant and e.item_id=p_item and o.status='synced' order by o.seq desc limit 1;
 if gid is null then raise exception 'SHOPIFY_IMAGE_PRODUCT_REQUIRED'; end if;
 select * into prior from public.shopify_product_images where tenant_id=p_tenant and item_id=p_item;
 if not found then
  insert into public.shopify_product_images(id,tenant_id,item_id,product_gid,source_reference,source_bucket,created_by) values(p_id,p_tenant,p_item,gid,selected_photo->>'path',selected_photo->>'bucket',actor) returning * into prior;
  fresh:=true;
 elsif prior.source_reference is distinct from selected_photo->>'path' or prior.source_bucket is distinct from selected_photo->>'bucket' then
  raise exception 'SHOPIFY_IMAGE_SOURCE_CHANGED';
 elsif prior.product_gid<>gid then
  raise exception 'SHOPIFY_IMAGE_PRODUCT_CHANGED';
 end if;
 return jsonb_build_object('id',prior.id,'fresh',fresh,'reference',prior.source_reference,'bucket',prior.source_bucket,'productGid',prior.product_gid,'mediaGid',prior.media_gid);
end $$;


create function public.prepare_shopify_sync_image(p_tenant uuid,p_id uuid,p_item uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
begin
 perform 1 from public.tenants where id=p_tenant for update;
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin') then raise exception 'FORBIDDEN' using errcode='42501';end if;
 if not coalesce((komisio_private.sync_preference(p_tenant,'shopify')->>'images')::boolean,false) then raise exception 'SHOPIFY_IMAGES_DISABLED';end if;
 return public.prepare_shopify_image(p_tenant,p_id,p_item);
end $$;
revoke all on function public.prepare_shopify_sync_image(uuid,uuid,uuid) from public,anon;
grant execute on function public.prepare_shopify_sync_image(uuid,uuid,uuid) to authenticated;
