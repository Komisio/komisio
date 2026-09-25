-- Preserve contact matching and balance facts while making every seller reachable.
create function public.sellers_overview_page(p_tenant uuid,p_query text,p_limit integer,p_offset integer) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare q text:=coalesce(trim(p_query),''); n integer:=least(greatest(coalesce(p_limit,50),1),100); rows jsonb; total integer; skip integer:=coalesce(p_offset,0);
begin
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin','staff','readonly') then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 if skip<0 then raise exception 'INVALID_INPUT'; end if;
 if length(q)>120 then raise exception 'INVALID_INPUT'; end if;
 select count(*)::int into total from public.sellers s where s.tenant_id=p_tenant and komisio_private.seller_search_matches(s.name,s.email,s.phone,s.profile,q);
 select coalesce(jsonb_agg(jsonb_build_object(
   'id',s.id,'name',s.name,'contact',coalesce(nullif(s.email,''),s.phone),'createdAt',s.created_at,'email',s.email,'phone',s.phone,'city',coalesce(s.profile->>'city',''),
   'itemsTotal',(select count(*)::int from public.items i where i.tenant_id=p_tenant and i.seller_id=s.id),
   'itemsSold',(select count(distinct l.item_id)::int from public.sale_lines l join public.sales sa on sa.tenant_id=l.tenant_id and sa.id=l.sale_id
     where l.tenant_id=p_tenant and sa.status='completed' and l.item_id in (select i.id from public.items i where i.tenant_id=p_tenant and i.seller_id=s.id)
     and not exists(select 1 from public.sale_returns r where r.tenant_id=p_tenant and r.sale_line_id=l.id)),
   'availableOre',(b.facts->>'availableOre')::bigint,'reservedOre',(b.facts->>'reservedOre')::bigint,'creditedOre',(b.facts->>'creditedOre')::bigint
  ) order by s.name,s.id),'[]'::jsonb) into rows
 from (select * from public.sellers s where s.tenant_id=p_tenant and komisio_private.seller_search_matches(s.name,s.email,s.phone,s.profile,q) order by s.name,s.id limit n offset skip) s
 cross join lateral (select komisio_private.seller_balance_facts(p_tenant,s.id) as facts) b;
 return jsonb_build_object('sellers',rows,'total',total,'limit',n,'offset',skip);
end $$;

revoke all on function public.sellers_overview_page(uuid,text,integer,integer) from public,anon;
grant execute on function public.sellers_overview_page(uuid,text,integer,integer) to authenticated;
create or replace function public.sellers_overview(p_tenant uuid,p_query text,p_limit integer) returns jsonb
language sql stable security invoker set search_path='' as $$
 select public.sellers_overview_page(p_tenant,p_query,p_limit,0)-'offset'
$$;
