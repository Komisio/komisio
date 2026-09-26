-- A complete printed reference selects exactly one announcement; ordinary text remains literal.
create or replace function public.handover_queue_page(p_tenant uuid,p_query text default '',p_status text default 'all',p_offset integer default 0) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare rows jsonb; total integer; q text:=lower(btrim(coalesce(p_query,''))); skip integer:=coalesce(p_offset,0);
begin
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin','staff','readonly') then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 if skip<0 or char_length(q)>120 or p_status is null or p_status not in ('all','open','received','cancelled') then raise exception 'INVALID_INPUT'; end if;
 with matching as materialized (
  select h.*,s.name as seller_name from public.seller_handovers h
  join public.sellers s on s.tenant_id=h.tenant_id and s.id=h.seller_id
  where h.tenant_id=p_tenant and (p_status='all' or h.status=p_status)
   and (q='' or case when q ~ '^h-[0-9]+
 ), page as (
  select * from matching order by (status='open') desc,created_at desc,id limit 25 offset skip
 )
 select coalesce(jsonb_agg(jsonb_build_object(
  'id',h.id,'reference','H-'||h.reference,'sellerId',h.seller_id,'sellerName',h.seller_name,
  'kind',h.kind,'estimatedItems',h.estimated_items,'note',h.note,'status',h.status,
  'createdAt',h.created_at,'receivedAt',h.received_at,'bagId',h.received_bag_id
 ) order by (h.status='open') desc,h.created_at desc,h.id),'[]'::jsonb),
 (select count(*)::int from matching) into rows,total from page h;
 return jsonb_build_object('handovers',rows,'total',total,'offset',skip);
end $$;
revoke all on function public.handover_queue_page(uuid,text,text,integer) from public,anon;
grant execute on function public.handover_queue_page(uuid,text,text,integer) to authenticated;
 then 'h-'||h.reference=q
    else strpos(lower(s.name),q)>0 or strpos('h-'||h.reference,q)>0 end)
 ), page as (
  select * from matching order by (status='open') desc,created_at desc,id limit 25 offset skip
 )
 select coalesce(jsonb_agg(jsonb_build_object(
  'id',h.id,'reference','H-'||h.reference,'sellerId',h.seller_id,'sellerName',h.seller_name,
  'kind',h.kind,'estimatedItems',h.estimated_items,'note',h.note,'status',h.status,
  'createdAt',h.created_at,'receivedAt',h.received_at,'bagId',h.received_bag_id
 ) order by (h.status='open') desc,h.created_at desc,h.id),'[]'::jsonb),
 (select count(*)::int from matching) into rows,total from page h;
 return jsonb_build_object('handovers',rows,'total',total,'offset',skip);
end $$;
revoke all on function public.handover_queue_page(uuid,text,text,integer) from public,anon;
grant execute on function public.handover_queue_page(uuid,text,text,integer) to authenticated;
