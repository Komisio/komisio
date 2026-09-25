-- Ordinary browser labels share the inventory's authoritative descriptive facts.
create function public.item_label_facts(p_tenant uuid,p_item uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare title jsonb; facts jsonb;
begin
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin','staff','readonly') then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 if not exists(select 1 from public.items where tenant_id=p_tenant and id=p_item) then return null; end if;
 title:=komisio_private.item_title(p_tenant,p_item);
 facts:=komisio_private.item_lifecycle(p_tenant,p_item);
 return jsonb_build_object('id',p_item,'reference','I-'||upper(left(p_item::text,8)),
  'title',title->>'title','priceOre',facts->>'currentPriceOre','currency',komisio_private.store_currency(p_tenant));
end $$;
revoke all on function public.item_label_facts(uuid,uuid) from public,anon;
grant execute on function public.item_label_facts(uuid,uuid) to authenticated;

