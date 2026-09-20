create function public.sale_item_search(p_tenant uuid,p_query text) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare q text:=lower(trim(coalesce(p_query,'')));
begin
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin','staff') then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 if length(q)>120 then raise exception 'INVALID_INPUT'; end if;
 if length(q)<2 then return '[]'::jsonb; end if;
 return coalesce((select jsonb_agg(to_jsonb(r)) from (
  select i.id,coalesce(t.title,'I-'||upper(left(i.id::text,8))) as title,p.price_ore::text as "priceOre"
  from public.items i
  cross join lateral (select komisio_private.item_title(p_tenant,i.id)->>'title' as title) t
  cross join lateral (select price_ore from public.item_prices where tenant_id=p_tenant and item_id=i.id order by seq desc limit 1) p
  where i.tenant_id=p_tenant
   and (strpos(lower(coalesce(t.title,'')),q)>0 or lower(i.id::text)=q or lower('I-'||left(i.id::text,8))=q or lower(left(i.id::text,8))=q)
   and not exists(select 1 from public.item_events e where e.tenant_id=p_tenant and e.item_id=i.id and e.kind='period_ended')
   and not exists(select 1 from public.sale_lines l join public.sales s on s.tenant_id=l.tenant_id and s.id=l.sale_id where l.tenant_id=p_tenant and l.item_id=i.id and s.status='completed' and not exists(select 1 from public.sale_returns r where r.tenant_id=p_tenant and r.sale_line_id=l.id))
  order by i.accepted_at desc,i.id limit 21
 ) r),'[]'::jsonb);
end $$;
revoke all on function public.sale_item_search(uuid,text) from public,anon;
grant execute on function public.sale_item_search(uuid,text) to authenticated;
