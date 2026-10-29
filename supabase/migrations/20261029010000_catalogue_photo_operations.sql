-- Restrict the existing temporary seller catalogue grant; staff policies remain unchanged.
-- This prevents signing/listing from outliving current visibility and item state.
create or replace function public.catalogue_photo_access(p_bucket text,p_path text) returns boolean
language plpgsql stable security definer set search_path='' as $$
declare tid uuid; ref uuid; address text;
begin
 -- Only Storage-authenticated download/info may use the catalogue grant.
 -- Storage sets this operation itself; caller headers cannot supply it.
 if storage.allow_any_operation(array['object.get_authenticated','object.get_authenticated_info']) is not true then return false; end if;
 if auth.uid() is null or not public.verified_session() then return false; end if;
 if p_bucket is null or p_bucket not in ('item-photos','reception-photos') or p_path is null
  or p_path !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(png|jpg)$' then return false; end if;
 tid:=split_part(p_path,'/',1)::uuid; ref:=split_part(p_path,'/',2)::uuid;
 select lower(trim(email)) into address from auth.users where id=auth.uid();
 if address is null or address='' or (select count(*) from public.sellers where tenant_id=tid and email<>'' and lower(trim(email))=address)<>1 then return false; end if;
 if not komisio_private.store_app_visible(tid) then return false; end if;
 return exists(
  select 1 from public.items i
  where i.tenant_id=tid
   and ((p_bucket='item-photos' and i.id=ref) or (p_bucket='reception-photos' and i.origin_kind='reception_review' and i.origin_id=ref))
   and komisio_private.catalogue_listing(tid,i.id) is not null
   and exists(select 1 from jsonb_array_elements(komisio_private.item_photo_snapshot(tid,i.id)->'photos') p where p->>'bucket'=p_bucket and p->>'path'=p_path));
end $$;
notify pgrst,'reload schema';
