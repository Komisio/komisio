-- Add a sorted directory read without replacing the old connector/API signature.
create function public.sellers_overview_sorted_page(p_tenant uuid,p_query text,p_limit integer,p_offset integer,p_sort text,p_direction text) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare q text:=coalesce(trim(p_query),''); n integer:=least(greatest(coalesce(p_limit,50),1),100); result jsonb;
begin
 perform komisio_private.require_identity();
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin','staff','readonly') then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 if p_offset is null or p_offset<0 or length(q)>120 or p_sort is null or p_sort not in ('name','items','sold','available','reserved') or p_direction is null or p_direction not in ('asc','desc') then raise exception 'INVALID_INPUT'; end if;
 -- Only compute the requested sort key before paging; full balance projections remain page-bounded.
 with matching as materialized (
 select s.id,s.name,case p_sort
  when 'items' then (select count(*) from public.items i where i.tenant_id=p_tenant and i.seller_id=s.id)
  when 'sold' then (select count(distinct l.item_id) from public.sale_lines l join public.sales sa on sa.tenant_id=l.tenant_id and sa.id=l.sale_id
     where l.tenant_id=p_tenant and sa.status='completed' and l.item_id in (select i.id from public.items i where i.tenant_id=p_tenant and i.seller_id=s.id)
     and not exists(select 1 from public.sale_returns r where r.tenant_id=p_tenant and r.sale_line_id=l.id))
  when 'available' then (komisio_private.seller_balance_facts(p_tenant,s.id)->>'availableOre')::numeric
  when 'reserved' then (komisio_private.seller_balance_facts(p_tenant,s.id)->>'reservedOre')::numeric
 end as metric
 from public.sellers s where s.tenant_id=p_tenant and komisio_private.seller_search_matches(s.name,s.email,s.phone,s.profile,q)
 ), ranked as (
 select *,row_number() over(order by
  case when p_sort='name' and p_direction='asc' then name end asc,
  case when p_sort='name' and p_direction='desc' then name end desc,
  case when p_direction='asc' then metric end asc,
  case when p_direction='desc' then metric end desc,
  name,id) as ordinal from matching
 ), page as (select * from ranked order by ordinal limit n offset p_offset), projected as (
 select page.ordinal,jsonb_build_object(
   'id',s.id,'name',s.name,'contact',coalesce(nullif(s.email,''),s.phone),'createdAt',s.created_at,'email',s.email,'phone',s.phone,'city',coalesce(s.profile->>'city',''),
   'itemsTotal',(select count(*)::int from public.items i where i.tenant_id=p_tenant and i.seller_id=s.id),
   'itemsSold',(select count(distinct l.item_id)::int from public.sale_lines l join public.sales sa on sa.tenant_id=l.tenant_id and sa.id=l.sale_id
     where l.tenant_id=p_tenant and sa.status='completed' and l.item_id in (select i.id from public.items i where i.tenant_id=p_tenant and i.seller_id=s.id)
     and not exists(select 1 from public.sale_returns r where r.tenant_id=p_tenant and r.sale_line_id=l.id)),
   'availableOre',(b.facts->>'availableOre')::bigint,'reservedOre',(b.facts->>'reservedOre')::bigint,'creditedOre',(b.facts->>'creditedOre')::bigint
) as facts from page
 join public.sellers s on s.tenant_id=p_tenant and s.id=page.id
 cross join lateral (select komisio_private.seller_balance_facts(p_tenant,s.id) as facts) b
 )
 select jsonb_build_object('sellers',coalesce((select jsonb_agg(facts order by ordinal) from projected),'[]'::jsonb),'total',(select count(*) from matching),'limit',n,'offset',p_offset) into result;
 return result;
end $$;
revoke all on function public.sellers_overview_sorted_page(uuid,text,integer,integer,text,text) from public,anon;
grant execute on function public.sellers_overview_sorted_page(uuid,text,integer,integer,text,text) to authenticated;
