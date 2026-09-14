-- Sellers list: one read for the sellers page. Per seller the contact, how
-- many items the store holds for them, how many are sold (and not
-- returned), and the balance facts the seller page already shows. Any
-- member reads; nothing is written.
create function public.sellers_overview(p_tenant uuid,p_query text,p_limit integer) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare q text:=coalesce(trim(p_query),''); n integer:=least(greatest(coalesce(p_limit,50),1),100); rows jsonb; total integer;
begin
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin','staff','readonly') then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 if length(q)>120 then raise exception 'INVALID_INPUT'; end if;
 select count(*)::int into total from public.sellers s where s.tenant_id=p_tenant and (q='' or s.name ilike '%'||replace(replace(replace(q,'\','\\'),'%','\%'),'_','\_')||'%');
 select coalesce(jsonb_agg(jsonb_build_object(
   'id',s.id,'name',s.name,'contact',coalesce(nullif(s.email,''),s.phone),'createdAt',s.created_at,
   'itemsTotal',(select count(*)::int from public.items i where i.tenant_id=p_tenant and i.seller_id=s.id),
   'itemsSold',(select count(distinct l.item_id)::int from public.sale_lines l join public.sales sa on sa.tenant_id=l.tenant_id and sa.id=l.sale_id
     where l.tenant_id=p_tenant and sa.status='completed' and l.item_id in (select i.id from public.items i where i.tenant_id=p_tenant and i.seller_id=s.id)
     and not exists(select 1 from public.sale_returns r where r.tenant_id=p_tenant and r.sale_line_id=l.id)),
   'availableOre',(b.facts->>'availableOre')::bigint,'reservedOre',(b.facts->>'reservedOre')::bigint,'creditedOre',(b.facts->>'creditedOre')::bigint
  ) order by s.name,s.id),'[]'::jsonb) into rows
 from (select * from public.sellers s where s.tenant_id=p_tenant and (q='' or s.name ilike '%'||replace(replace(replace(q,'\','\\'),'%','\%'),'_','\_')||'%') order by s.name,s.id limit n) s
 cross join lateral (select komisio_private.seller_balance_facts(p_tenant,s.id) as facts) b;
 return jsonb_build_object('sellers',rows,'total',total,'limit',n);
end $$;
revoke all on function public.sellers_overview(uuid,text,integer) from public,anon;
grant execute on function public.sellers_overview(uuid,text,integer) to authenticated;
