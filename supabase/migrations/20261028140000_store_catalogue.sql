-- Store catalogue for the mobile app (S10, S11): a signed-in seller of a store
-- that shows itself in the app reads the items currently for sale there. Only
-- the title, current price, a fixed set of descriptive facts and the item's
-- current photos are exposed: never the seller, terms, commission, payout,
-- cost, history or staff notes. Same lifecycle and photo projections as the
-- staff and seller reads; nothing new is computed.

-- The caller's one seller account in the store, matched by verified email as
-- in my_seller_accounts. Ambiguous or missing accounts are refused.
create function komisio_private.require_store_seller(p_tenant uuid) returns uuid
language plpgsql stable security definer set search_path='' as $$
declare uid uuid:=komisio_private.require_identity(); address text; found_ids uuid[];
begin
 select lower(trim(email)) into address from auth.users where id=uid;
 select array_agg(id) into found_ids from public.sellers where tenant_id=p_tenant and email<>'' and lower(trim(email))=address;
 if address is null or address='' or coalesce(cardinality(found_ids),0)<>1 then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 return found_ids[1];
end $$;

create function komisio_private.store_app_visible(p_tenant uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select coalesce((select s.visible from public.store_app_visibility_settings s where s.tenant_id=p_tenant order by s.version desc limit 1),false)
$$;

-- Lifecycle facts of an item for sale, or null. Consignment items are for sale
-- in the active stages; store-owned items until sold or ended, as in the stock
-- report. An item without a price is never listed.
create function komisio_private.catalogue_listing(p_tenant uuid,p_item uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare f jsonb:=komisio_private.item_lifecycle(p_tenant,p_item);
begin
 if (f->>'sold')::boolean or (f->>'ended')::boolean or f->>'currentPriceOre' is null then return null; end if;
 if f->>'ownership'='consignment' and f->>'stage' not in ('on_sale','markdown_due','period_ending') then return null; end if;
 return f;
end $$;

-- Descriptive facts the catalogue may show, in a fixed order. Choice values
-- carry the store's item-language label, as in item titles.
create function komisio_private.catalogue_facts(p_tenant uuid,p_item uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare attrs jsonb:=komisio_private.item_attributes(p_tenant,p_item); lang text; facts jsonb:='[]'; token text; val text; def public.attribute_definitions;
begin
 lang:=coalesce(komisio_private.current_store_policy_core(p_tenant)->'policy'->>'itemLanguage','sv');
 foreach token in array array['category','brand','size','color','material','condition'] loop
  select nullif(trim(a->>'value'),'') into val from jsonb_array_elements(attrs) a where a->>'slug'=token limit 1;
  continue when val is null;
  select * into def from public.attribute_definitions where slug=token and (tenant_id=p_tenant or tenant_id is null) order by (tenant_id is not null) desc,version desc limit 1;
  if def.data_type='choice' then
   val:=coalesce((select coalesce(c->'labels'->>lang,c->'labels'->>'en',val) from jsonb_array_elements(def.choices) c where c->>'id'=val limit 1),val);
  end if;
  facts:=facts||jsonb_build_array(jsonb_build_object('slug',token,'value',val));
 end loop;
 return facts;
end $$;

-- Current photos, the default first, as storage references the caller can
-- download under catalogue_photo_access.
create function komisio_private.catalogue_photos(p_tenant uuid,p_item uuid) returns jsonb
language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(jsonb_build_object('id',p->>'id','bucket',p->>'bucket','path',p->>'path')
  order by (p->>'id' is not distinct from s->>'defaultPhotoId') desc,n),'[]'::jsonb)
 from (select komisio_private.item_photo_snapshot(p_tenant,p_item) as s) x
 cross join lateral jsonb_array_elements(x.s->'photos') with ordinality as e(p,n)
$$;

create function public.store_catalogue(p_tenant uuid,p_query text,p_offset integer) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare rows jsonb; total integer; q text:=lower(btrim(coalesce(p_query,''))); skip integer:=coalesce(p_offset,0);
begin
 perform komisio_private.require_store_seller(p_tenant);
 if not komisio_private.store_app_visible(p_tenant) then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 if skip<0 or skip>100000 or char_length(q)>120 then raise exception 'INVALID_INPUT'; end if;
 with listed as materialized (
  select i.id,i.accepted_at,l.f from public.items i
  cross join lateral (select komisio_private.catalogue_listing(p_tenant,i.id) as f) l
  where i.tenant_id=p_tenant and l.f is not null
 ), titled as materialized (
  select x.*,komisio_private.item_title(p_tenant,x.id) as t from listed x
 ), matching as materialized (
  select * from titled where q='' or strpos(lower(coalesce(t->>'title','')),q)>0 or strpos(lower(coalesce(t->>'category','')),q)>0
 ), page as materialized (select * from matching order by accepted_at desc,id limit 30 offset skip)
 select coalesce((select jsonb_agg(jsonb_build_object(
   'id',p.id,'title',p.t->>'title','category',p.t->>'category',
   'priceOre',(p.f->>'currentPriceOre')::bigint,'photo',komisio_private.catalogue_photos(p_tenant,p.id)->0
  ) order by p.accepted_at desc,p.id) from page p),'[]'::jsonb),(select count(*)::int from matching) into rows,total;
 return jsonb_build_object('currency',komisio_private.store_currency(p_tenant),'items',rows,'total',total,'offset',skip);
end $$;

create function public.store_catalogue_item(p_tenant uuid,p_item uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare f jsonb; t jsonb;
begin
 perform komisio_private.require_store_seller(p_tenant);
 if not komisio_private.store_app_visible(p_tenant) then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 if p_item is null or not exists(select 1 from public.items where tenant_id=p_tenant and id=p_item) then raise exception 'ITEM_NOT_FOUND'; end if;
 f:=komisio_private.catalogue_listing(p_tenant,p_item);
 if f is null then raise exception 'ITEM_NOT_FOUND'; end if;
 t:=komisio_private.item_title(p_tenant,p_item);
 return jsonb_build_object('id',p_item,'title',t->>'title','currency',komisio_private.store_currency(p_tenant),
  'priceOre',(f->>'currentPriceOre')::bigint,'facts',komisio_private.catalogue_facts(p_tenant,p_item),
  'photos',komisio_private.catalogue_photos(p_tenant,p_item));
end $$;

-- Storage hook: a seller of a visible store may download a photo only while it
-- is one of the current photos of an item for sale in that store. Never raises.
create function public.catalogue_photo_access(p_bucket text,p_path text) returns boolean
language plpgsql stable security definer set search_path='' as $$
declare tid uuid; ref uuid; address text;
begin
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

alter policy item_photo_read on storage.objects using(bucket_id='item-photos' and (public.item_photo_access(name,false) or public.catalogue_photo_access(bucket_id,name)));
alter policy item_photo_read_boundary on storage.objects using(bucket_id<>'item-photos' or public.item_photo_access(name,false) or public.catalogue_photo_access(bucket_id,name));
alter policy reception_photo_read on storage.objects using(bucket_id='reception-photos' and (public.reception_photo_access(name,false) or public.catalogue_photo_access(bucket_id,name)));
alter policy reception_photo_read_boundary on storage.objects using(bucket_id<>'reception-photos' or public.reception_photo_access(name,false) or public.catalogue_photo_access(bucket_id,name));

revoke all on function komisio_private.require_store_seller(uuid),komisio_private.store_app_visible(uuid),komisio_private.catalogue_listing(uuid,uuid),
 komisio_private.catalogue_facts(uuid,uuid),komisio_private.catalogue_photos(uuid,uuid) from public,anon,authenticated;
revoke all on function public.store_catalogue(uuid,text,integer),public.store_catalogue_item(uuid,uuid) from public,anon,authenticated;
grant execute on function public.store_catalogue(uuid,text,integer),public.store_catalogue_item(uuid,uuid) to authenticated;
revoke all on function public.catalogue_photo_access(text,text) from public;
grant execute on function public.catalogue_photo_access(text,text) to anon,authenticated;
notify pgrst,'reload schema';
