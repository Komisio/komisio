create or replace function public.store_catalogue(p_tenant uuid,p_query text,p_offset integer) returns jsonb
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
   'facts',komisio_private.catalogue_facts(p_tenant,p.id),
   'priceOre',(p.f->>'currentPriceOre')::bigint,'photo',komisio_private.catalogue_photos(p_tenant,p.id)->0
  ) order by p.accepted_at desc,p.id) from page p),'[]'::jsonb),(select count(*)::int from matching) into rows,total;
 return jsonb_build_object('currency',komisio_private.store_currency(p_tenant),'items',rows,'total',total,'offset',skip);
end $$;
notify pgrst,'reload schema';
