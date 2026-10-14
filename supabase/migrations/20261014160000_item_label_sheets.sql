-- One snapshot for an entire intake, independent of inventory pagination.
create function public.item_label_sheet_facts(p_tenant uuid,p_bag uuid default null,p_items uuid[] default null) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare ids uuid[]; output jsonb := '[]'::jsonb; v_item uuid; stage text; skipped integer := 0;
begin
 perform komisio_private.require_identity();
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin','staff','readonly') then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 if (p_bag is null) = (p_items is null) then raise exception 'INVALID_INPUT'; end if;
 if p_bag is not null then
  if not exists(select 1 from public.bag_receipts b where b.tenant_id=p_tenant and b.id=p_bag) then raise exception 'BAG_NOT_FOUND'; end if;
  select array_agg(i.id order by i.accepted_at,i.id) into ids from public.items i
  where i.tenant_id=p_tenant and (
   (i.origin_kind='reception_review' and exists(select 1 from public.reception_sessions s where s.tenant_id=p_tenant and s.id=i.origin_id and s.bag_id=p_bag))
   or (i.origin_kind='inspection_draft' and exists(select 1 from public.inspection_draft_revisions r where r.tenant_id=p_tenant and r.draft_id=i.origin_id and r.bag_id=p_bag))
  );
 else
  if cardinality(p_items) not between 1 and 200 or array_position(p_items,null) is not null then raise exception 'INVALID_INPUT'; end if;
  select array_agg(v order by n) into ids from (select v,min(n) n from unnest(p_items) with ordinality as u(v,n) group by v) s;
 end if;
 if coalesce(cardinality(ids),0)>200 then raise exception 'TOO_MANY_ITEMS'; end if;
 foreach v_item in array coalesce(ids,array[]::uuid[]) loop
  if not exists(select 1 from public.items i where i.tenant_id=p_tenant and i.id=v_item) then raise exception 'ITEM_NOT_AVAILABLE'; end if;
  stage:=komisio_private.item_lifecycle(p_tenant,v_item)->>'stage';
  if stage in ('on_sale','markdown_due','period_ending') then
   output:=output||jsonb_build_array(public.item_label_facts(p_tenant,v_item));
  elsif p_bag is null then raise exception 'ITEM_NOT_AVAILABLE';
  else skipped:=skipped+1;
  end if;
 end loop;
 return jsonb_build_object('items',output,'skipped',skipped);
end $$;
revoke all on function public.item_label_sheet_facts(uuid,uuid,uuid[]) from public,anon;
grant execute on function public.item_label_sheet_facts(uuid,uuid,uuid[]) to authenticated;
