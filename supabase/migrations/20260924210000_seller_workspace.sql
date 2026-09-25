-- Staff seller workspace: bounded, seller-scoped inventory with existing lifecycle facts.
create function public.seller_workspace_items(p_tenant uuid,p_seller uuid,p_page integer default 0) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare rows jsonb; total integer;
begin
 perform komisio_private.require_identity();
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin','staff','readonly') then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 if p_page is null or p_page<0 or p_page>1000000 then raise exception 'INVALID_INPUT'; end if;
 if not exists(select 1 from public.sellers where tenant_id=p_tenant and id=p_seller) then raise exception 'SELLER_NOT_FOUND'; end if;
 select count(*)::int into total from public.items where tenant_id=p_tenant and seller_id=p_seller;
 select coalesce(jsonb_agg(jsonb_build_object('id',i.id,'title',t.f->>'title','category',t.f->>'category',
 'stage',l.f->>'stage','acceptedAt',i.accepted_at,'priceOre',(l.f->>'currentPriceOre')::bigint) order by i.accepted_at desc,i.id),'[]'::jsonb)
 into rows from (select id,accepted_at from public.items where tenant_id=p_tenant and seller_id=p_seller order by accepted_at desc,id limit 25 offset p_page*25) i
 cross join lateral (select komisio_private.item_title(p_tenant,i.id) f) t
 cross join lateral (select komisio_private.item_lifecycle(p_tenant,i.id) f) l;
 return jsonb_build_object('items',rows,'total',total,'page',p_page,'limit',25);
end $$;
revoke all on function public.seller_workspace_items(uuid,uuid,integer) from public,anon;
grant execute on function public.seller_workspace_items(uuid,uuid,integer) to authenticated;
