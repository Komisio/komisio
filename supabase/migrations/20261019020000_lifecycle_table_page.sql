-- Keep the four-argument, twenty-row contract available to older deployments.
-- The table client supplies every argument, so PostgREST resolves this overload
-- unambiguously. All facts and action permissions remain engine-derived.
create function public.lifecycle_queue_page(p_tenant uuid,p_query text,p_stage text,p_offset integer,p_sort text,p_direction text,p_limit integer) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare q text:=lower(btrim(coalesce(p_query,''))); rows jsonb; total integer; due integer;
begin
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin','staff','readonly') then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 if p_offset is null or p_offset<0 or char_length(q)>120 or p_limit is distinct from 25
  or p_sort is null or p_sort not in ('title','seller','price','stage','accepted','periodEnd')
  or p_direction is null or p_direction not in ('asc','desc') then raise exception 'INVALID_INPUT'; end if;
 if p_stage is not null and p_stage not in ('on_sale','markdown_due','period_ending','period_ended','ended','sold') then raise exception 'INVALID_INPUT'; end if;
 with candidates as materialized (
  select c.*,t.value->>'title' as title,t.value->>'category' as category,s.name as seller_name
  from public.lifecycle_queue(p_tenant,null) c
  cross join lateral (select komisio_private.item_title(p_tenant,c.item_id) value) t
  left join public.sellers s on s.tenant_id=p_tenant and s.id=c.seller_id
 ), matched as materialized (
  select * from candidates where (p_stage is null or stage=p_stage)
   and (q='' or strpos(item_id::text,q)>0 or strpos('i-'||left(item_id::text,8),q)>0 or strpos(lower(coalesce(title,'')),q)>0)
 ), ordered as (
  select *,row_number() over(order by
   case when p_direction='asc' then case p_sort when 'title' then lower(title) when 'seller' then lower(seller_name) when 'stage' then stage end end asc nulls last,
   case when p_direction='desc' then case p_sort when 'title' then lower(title) when 'seller' then lower(seller_name) when 'stage' then stage end end desc nulls last,
   case when p_sort='price' and p_direction='asc' then current_price_ore end asc nulls last,
   case when p_sort='price' and p_direction='desc' then current_price_ore end desc nulls last,
   case when p_direction='asc' then case p_sort when 'accepted' then accepted_at when 'periodEnd' then period_end end end asc nulls last,
   case when p_direction='desc' then case p_sort when 'accepted' then accepted_at when 'periodEnd' then period_end end end desc nulls last,item_id) as position
  from matched
 ), page as (select * from ordered order by position limit p_limit offset p_offset)
 select (select count(*)::int from candidates where stage='markdown_due'),
  (select count(*)::int from matched),
  coalesce((select jsonb_agg((to_jsonb(p)-'position')||jsonb_build_object(
   'collection_deadline',komisio_private.item_lifecycle(p_tenant,p.item_id)->>'collectionDeadline',
   'collection_due',coalesce((komisio_private.item_lifecycle(p_tenant,p.item_id)->>'collectionDeadline')::timestamptz<=now(),false)
  ) order by p.position) from page p),'[]'::jsonb)
 into due,total,rows;
 return jsonb_build_object('rows',rows,'total',total,'dueCount',due,'offset',p_offset,'limit',p_limit);
end $$;
revoke all on function public.lifecycle_queue_page(uuid,text,text,integer,text,text,integer) from public,anon;
grant execute on function public.lifecycle_queue_page(uuid,text,text,integer,text,text,integer) to authenticated;
