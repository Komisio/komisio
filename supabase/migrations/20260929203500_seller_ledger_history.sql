-- Complete staff history without altering the legacy newest-50 contract.
create function public.seller_ledger_history_page(p_tenant uuid,p_seller uuid,p_page integer default 0) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare rows jsonb; total integer; current_page integer;
begin
 perform komisio_private.require_identity();
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin','staff','readonly') then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 if p_page is null or p_page<0 or p_page>1000000 then raise exception 'INVALID_INPUT'; end if;
 if not exists(select 1 from public.sellers where tenant_id=p_tenant and id=p_seller) then raise exception 'SELLER_NOT_FOUND'; end if;
 select count(*)::int into total from public.seller_ledger_entries where tenant_id=p_tenant and seller_id=p_seller;
 current_page:=least(p_page,greatest(0,(total-1)/50));
 select coalesce(jsonb_agg(to_jsonb(r) order by r.occurred_at desc,r.id),'[]'::jsonb) into rows from (
  select e.id,e.kind,e.amount_ore,e.reference_kind,e.reference_id,e.reason,e.occurred_at
  from public.seller_ledger_entries e where e.tenant_id=p_tenant and e.seller_id=p_seller
  order by e.occurred_at desc,e.id limit 50 offset current_page*50
 ) r;
 return jsonb_build_object('items',rows,'total',total,'page',current_page,'limit',50);
end $$;
revoke all on function public.seller_ledger_history_page(uuid,uuid,integer) from public,anon;
grant execute on function public.seller_ledger_history_page(uuid,uuid,integer) to authenticated;
