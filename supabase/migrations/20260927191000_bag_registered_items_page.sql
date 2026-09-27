-- A new RPC preserves the quick-only response contract of older clients.
create function public.bag_registered_items_page(p_tenant uuid,p_bag uuid,p_offset integer) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare skip integer:=coalesce(p_offset,0); rows jsonb; total integer;
begin
 perform komisio_private.require_identity();
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin','staff','readonly') then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 if skip<0 then raise exception 'INVALID_INPUT'; end if;
 if not exists(select 1 from public.bag_receipts where tenant_id=p_tenant and id=p_bag) then raise exception 'BAG_NOT_FOUND'; end if;
 with scan as (
  select i.id,s.id as session_id,i.accepted_at
  from public.reception_sessions s join public.items i on i.tenant_id=s.tenant_id and i.origin_kind='reception_review' and i.origin_id=s.id
  where s.tenant_id=p_tenant and s.bag_id=p_bag
  union all
  select i.id,null::uuid as session_id,i.accepted_at
  from public.inspection_current d join public.items i on i.tenant_id=d.tenant_id and i.origin_kind='inspection_draft' and i.origin_id=d.draft_id
  where d.tenant_id=p_tenant and d.bag_id=p_bag
 ), page as (select * from scan order by accepted_at desc,id limit 25 offset skip)
 select count(*)::int,coalesce((select jsonb_agg(jsonb_build_object(
  'id',p.id,'session_id',p.session_id,'title',komisio_private.item_title(p_tenant,p.id)->>'title',
  'price_ore',(select price_ore::text from public.item_prices where tenant_id=p_tenant and item_id=p.id order by seq desc limit 1),
  'photo_id',(select e->>'id' from public.reception_source_revisions r cross join lateral jsonb_array_elements(r.sources) e where r.tenant_id=p_tenant and r.session_id=p.session_id and e->>'kind'='photo' order by r.revision desc,e->>'id' limit 1)
 ) order by p.accepted_at desc,p.id) from page p),'[]'::jsonb) into total,rows from scan;
 return jsonb_build_object('items',rows,'total',total,'offset',skip);
end $$;
revoke all on function public.bag_registered_items_page(uuid,uuid,integer) from public,anon;
grant execute on function public.bag_registered_items_page(uuid,uuid,integer) to authenticated;
