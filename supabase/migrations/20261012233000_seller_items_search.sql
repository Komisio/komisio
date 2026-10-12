-- Search and sort the complete seller scope before bounded paging.
create function public.seller_workspace_items_search(
 p_tenant uuid,p_seller uuid,p_page integer default 0,p_query text default '',
 p_stage text default '',p_sort text default 'accepted',p_direction text default 'desc'
) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
 perform komisio_private.require_identity();
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin','staff','readonly') then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 if p_page is null or p_page<0 or p_page>1000000 or p_query is null or length(p_query)>120
 or p_stage is null or p_stage not in ('','on_sale','markdown_due','period_ending','period_ended','sold','ended')
 or p_sort is null or p_sort not in ('title','category','price','stage','accepted')
 or p_direction is null or p_direction not in ('asc','desc') then raise exception 'INVALID_INPUT'; end if;
 if not exists(select 1 from public.sellers where tenant_id=p_tenant and id=p_seller) then raise exception 'SELLER_NOT_FOUND'; end if;
 with facts as materialized (
   select i.id,i.accepted_at,t.f->>'title' title,t.f->>'category' category,
     l.f->>'stage' stage,(l.f->>'currentPriceOre')::bigint price,
     (select sl.price_ore from public.sale_lines sl join public.sales s on s.tenant_id=sl.tenant_id and s.id=sl.sale_id
       where sl.tenant_id=p_tenant and sl.item_id=i.id and s.status='completed'
       and not exists(select 1 from public.sale_returns r where r.tenant_id=sl.tenant_id and r.sale_line_id=sl.id)
       order by s.occurred_at desc,s.id,sl.id limit 1) sold_price
   from public.items i
   cross join lateral (select komisio_private.item_title(p_tenant,i.id) f) t
   cross join lateral (select komisio_private.item_lifecycle(p_tenant,i.id) f) l
   where i.tenant_id=p_tenant and i.seller_id=p_seller
 ), filtered as materialized (
   select *,case when stage='sold' then sold_price else price end display_price from facts
   where (p_stage='' or stage=p_stage)
   and (btrim(p_query)='' or position(lower(btrim(p_query)) in lower(coalesce(title,'')||' '||coalesce(category,'')||' I-'||left(id::text,8)))>0)
 ), numbered as (
   select *,row_number() over(order by
     case when p_direction='asc' and p_sort='title' then lower(title) end asc nulls last,
     case when p_direction='desc' and p_sort='title' then lower(title) end desc nulls last,
     case when p_direction='asc' and p_sort='category' then lower(category) end asc nulls last,
     case when p_direction='desc' and p_sort='category' then lower(category) end desc nulls last,
     case when p_direction='asc' and p_sort='stage' then stage end asc,
     case when p_direction='desc' and p_sort='stage' then stage end desc,
     case when p_direction='asc' and p_sort='price' then display_price end asc nulls last,
     case when p_direction='desc' and p_sort='price' then display_price end desc nulls last,
     case when p_direction='asc' and p_sort='accepted' then accepted_at end asc,
     case when p_direction='desc' and p_sort='accepted' then accepted_at end desc,
     id) rn from filtered
 ), count_page as (
   select count(*)::integer total,least(p_page,greatest(0,(count(*)::integer-1)/25)) page from filtered
 )
 select jsonb_build_object('total',c.total,'page',c.page,'limit',25,'items',
   (select coalesce(jsonb_agg(jsonb_build_object('id',n.id,'title',n.title,'category',n.category,
     'stage',n.stage,'acceptedAt',n.accepted_at,'priceOre',n.price,'soldPriceOre',n.sold_price) order by n.rn),'[]'::jsonb)
    from numbered n where n.rn>c.page*25 and n.rn<=(c.page+1)*25)) into result from count_page c;
 return result;
end $$;
revoke all on function public.seller_workspace_items_search(uuid,uuid,integer,text,text,text,text) from public,anon;
grant execute on function public.seller_workspace_items_search(uuid,uuid,integer,text,text,text,text) to authenticated;
