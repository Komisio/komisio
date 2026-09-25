-- Keep the original capped RPC for existing clients during rollout.
create function public.bag_received_items_page(p_tenant uuid,p_bag uuid,p_offset integer) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare skip integer:=coalesce(p_offset,0); rows jsonb; total integer;
begin
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin','staff','readonly') then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 if skip<0 then raise exception 'INVALID_INPUT'; end if;
 with scan as (
  select i.id,s.id as session_id,i.accepted_at
  from public.items i join public.reception_sessions s on s.tenant_id=i.tenant_id and s.id=i.origin_id
  where i.tenant_id=p_tenant and s.tenant_id=p_tenant and s.bag_id=p_bag and i.origin_kind='reception_review'
 ), page as (select * from scan order by accepted_at desc,id limit 25 offset skip)
 select count(*)::int,coalesce((select jsonb_agg(jsonb_build_object(
  'id',p.id,'session_id',p.session_id,'title',komisio_private.item_title(p_tenant,p.id)->>'title',
  'price_ore',(select price_ore::text from public.item_prices where tenant_id=p_tenant and item_id=p.id order by seq desc limit 1),
  'photo_id',(select e->>'id' from public.reception_source_revisions r cross join lateral jsonb_array_elements(r.sources) e where r.tenant_id=p_tenant and r.session_id=p.session_id and e->>'kind'='photo' order by r.revision desc limit 1)
 ) order by p.accepted_at desc,p.id) from page p),'[]'::jsonb) into total,rows from scan;
 return jsonb_build_object('items',rows,'total',total,'offset',skip);
end $$;
revoke all on function public.bag_received_items_page(uuid,uuid,integer) from public,anon;
grant execute on function public.bag_received_items_page(uuid,uuid,integer) to authenticated;
