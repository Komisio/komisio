-- Items overview (P2 agent reads, Fable): every accepted item with the title and
-- category its origin holds, the derived lifecycle stage, the current price and
-- when it sold. One read for the items page and the agent's "find items"; the
-- same facts as the lifecycle queue and price evidence, never a new table.
create function public.items_overview(p_tenant uuid,p_query text,p_stage text,p_limit integer) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare q text:=coalesce(trim(p_query),''); n integer:=least(greatest(coalesce(p_limit,50),1),100); pattern text; rows jsonb; total integer;
begin
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin','staff','readonly') then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 if length(q)>120 then raise exception 'INVALID_INPUT'; end if;
 if p_stage is not null and p_stage not in ('on_sale','markdown_due','period_ending','period_ended','ended','sold') then raise exception 'INVALID_INPUT'; end if;
 pattern:='%'||replace(replace(replace(q,'\','\\'),'%','\%'),'_','\_')||'%';
 with scan as (
  select i.id,i.origin_kind,i.origin_id,i.seller_id,i.ownership,i.accepted_at,x.t->>'title' as title,x.t->>'category' as category,y.f,
   (select max(s.occurred_at) from public.sale_lines l join public.sales s on s.tenant_id=l.tenant_id and s.id=l.sale_id
     where l.tenant_id=p_tenant and l.item_id=i.id and s.status='completed'
     and not exists(select 1 from public.sale_returns r where r.tenant_id=l.tenant_id and r.sale_line_id=l.id)) as sold_at
  from public.items i
  cross join lateral (select komisio_private.item_title(p_tenant,i.id) as t) x
  cross join lateral (select komisio_private.item_lifecycle(p_tenant,i.id) as f) y
  where i.tenant_id=p_tenant
   and (q='' or coalesce(x.t->>'title','') ilike pattern or coalesce(x.t->>'category','') ilike pattern)
   and (p_stage is null or y.f->>'stage'=p_stage)
 )
 select count(*)::int,
  coalesce((select jsonb_agg(jsonb_build_object(
   'id',s.id,'originKind',s.origin_kind,'originId',s.origin_id,'sellerId',s.seller_id,'ownership',s.ownership,'acceptedAt',s.accepted_at,
   'title',s.title,'category',s.category,'stage',s.f->>'stage','periodEnd',s.f->>'periodEnd',
   'currentPriceOre',(s.f->>'currentPriceOre')::bigint,'soldAt',s.sold_at
  ) order by s.accepted_at desc,s.id) from (select * from scan order by accepted_at desc,id limit n) s),'[]'::jsonb)
 into total,rows from scan;
 return jsonb_build_object('currency',komisio_private.store_currency(p_tenant),'items',rows,'total',total,'limit',n,'query',nullif(q,''),'stage',p_stage);
end $$;
revoke all on function public.items_overview(uuid,text,text,integer) from public,anon;
grant execute on function public.items_overview(uuid,text,text,integer) to authenticated;
