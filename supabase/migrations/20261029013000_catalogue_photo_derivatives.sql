-- Reception originals remain internal. Catalogue readers use the existing
-- reduced, metadata-free JPEG only; legacy photos without it are omitted.
create or replace function komisio_private.catalogue_photos(p_tenant uuid,p_item uuid) returns jsonb
language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(jsonb_build_object('id',p->>'id','bucket',safe.bucket,'path',safe.path)
  order by (p->>'id' is not distinct from s->>'defaultPhotoId') desc,n),'[]'::jsonb)
 from (select komisio_private.item_photo_snapshot(p_tenant,p_item) as s) x
 cross join lateral jsonb_array_elements(x.s->'photos') with ordinality as e(p,n)
 cross join lateral (
  select case when p->>'bucket'='reception-photos' then 'seller-reception-photos' else p->>'bucket' end as bucket,
   case when p->>'bucket'='reception-photos' then p_tenant::text||'/'||split_part(p->>'path','/',2)||'/'||(p->>'id')||'.jpg' else p->>'path' end as path
 ) safe
 where p->>'bucket'='item-photos'
  or (p->>'bucket'='reception-photos' and exists(select 1 from storage.objects o where o.bucket_id=safe.bucket and o.name=safe.path))
$$;

create or replace function public.catalogue_photo_access(p_bucket text,p_path text) returns boolean
language plpgsql stable security definer set search_path='' as $$
declare tid uuid; ref uuid; address text;
begin
 -- Preserve the operation boundary introduced by #723, including CDN info.
 if storage.allow_any_operation(array['object.get_authenticated','object.get_authenticated_info']) is not true then return false; end if;
 if auth.uid() is null or not public.verified_session() then return false; end if;
 if p_bucket is null or p_bucket not in ('item-photos','seller-reception-photos') or p_path is null
  or p_path !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(png|jpg)$' then return false; end if;
 if p_bucket='seller-reception-photos' and p_path not like '%.jpg' then return false; end if;
 tid:=split_part(p_path,'/',1)::uuid; ref:=split_part(p_path,'/',2)::uuid;
 select lower(trim(email)) into address from auth.users where id=auth.uid();
 if address is null or address='' or (select count(*) from public.sellers where tenant_id=tid and email<>'' and lower(trim(email))=address)<>1 then return false; end if;
 if not komisio_private.store_app_visible(tid) then return false; end if;
 return exists(
  select 1 from public.items i
  where i.tenant_id=tid
   and ((p_bucket='item-photos' and i.id=ref) or (p_bucket='seller-reception-photos' and i.origin_kind='reception_review' and i.origin_id=ref))
   and komisio_private.catalogue_listing(tid,i.id) is not null
   and exists(select 1 from jsonb_array_elements(komisio_private.catalogue_photos(tid,i.id)) p where p->>'bucket'=p_bucket and p->>'path'=p_path));
end $$;

-- Remove the catalogue grant from original reception bytes entirely.
alter policy reception_photo_read on storage.objects using(bucket_id='reception-photos' and public.reception_photo_access(name,false));
alter policy reception_photo_read_boundary on storage.objects using(bucket_id<>'reception-photos' or public.reception_photo_access(name,false));

-- Existing staff and recipient/capability access stays independent. Catalogue
-- access is limited to the exact current derivative of a listed item.
alter policy seller_photo_read on storage.objects using(bucket_id='seller-reception-photos' and (public.reception_photo_access(name,false) or public.seller_reception_photo_access(name) or public.catalogue_photo_access(bucket_id,name)));
alter policy seller_photo_read_boundary on storage.objects using(bucket_id<>'seller-reception-photos' or public.reception_photo_access(name,false) or public.seller_reception_photo_access(name) or public.catalogue_photo_access(bucket_id,name));
notify pgrst,'reload schema';
