-- Read-only directory. Invoker rights preserve each underlying table's RLS.
create function public.purchase_search_page(p_tenant uuid,p_query text,p_status text,p_sort text,p_direction text,p_limit integer,p_offset integer) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare result jsonb;
begin
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin','staff','readonly') then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 if p_query is null or length(p_query)>120 or p_status is null or p_status not in ('all','pending','registered')
  or p_sort is null or p_sort not in ('reference','note','date','cost','price','status')
  or p_direction is null or p_direction not in ('asc','desc') or p_limit is null or p_limit not between 1 and 100
  or p_offset is null or p_offset<0 or p_offset>200000000 then raise exception 'INVALID_INPUT'; end if;
 with matches as materialized (
  select p.id,p.reference,p.supplier_note,p.purchase_price_ore,p.evidence_reference,p.margin_eligible,p.purchased_at,
   i.id as item_id,ip.price_ore as sale_price_ore
  from public.purchase_receipts p
  left join public.items i on i.tenant_id=p.tenant_id and i.origin_kind='purchase' and i.origin_id=p.id
  left join lateral (
   select price_ore from public.item_prices where tenant_id=p.tenant_id and item_id=i.id order by set_at desc,id desc limit 1
  ) ip on true
  where p.tenant_id=p_tenant
   and (p_status='all' or (p_status='pending' and i.id is null) or (p_status='registered' and i.id is not null))
   and (trim(p_query)='' or strpos(lower(p.supplier_note||' '||p.evidence_reference||' P-'||p.reference::text),lower(trim(p_query)))>0)
 ), ordered as (
  select *,row_number() over(order by
   case when p_direction='asc' then case p_sort when 'reference' then reference when 'cost' then purchase_price_ore when 'price' then sale_price_ore end end asc nulls last,
   case when p_direction='desc' then case p_sort when 'reference' then reference when 'cost' then purchase_price_ore when 'price' then sale_price_ore end end desc nulls last,
   case when p_sort='note' and p_direction='asc' then lower(supplier_note) end asc,
   case when p_sort='note' and p_direction='desc' then lower(supplier_note) end desc,
   case when p_sort='date' and p_direction='asc' then purchased_at end asc,
   case when p_sort='date' and p_direction='desc' then purchased_at end desc,
   case when p_sort='status' and p_direction='asc' then item_id is not null end asc,
   case when p_sort='status' and p_direction='desc' then item_id is not null end desc,id
  ) as position from matches
 ), page as (select * from ordered order by position limit p_limit offset p_offset)
 select jsonb_build_object('total',(select count(*) from matches),'rows',coalesce((select jsonb_agg(to_jsonb(page)-'position' order by position) from page),'[]'::jsonb)) into result;
 return result;
end $$;
revoke all on function public.purchase_search_page(uuid,text,text,text,text,integer,integer) from public,anon;
grant execute on function public.purchase_search_page(uuid,text,text,text,text,integer,integer) to authenticated;
