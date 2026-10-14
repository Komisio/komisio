-- Descriptive links accompany immutable ledger amounts; no ledger is rewritten.
create function komisio_private.ledger_item_details(p_tenant uuid,p_kind text,p_reference uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare line public.sale_lines;
begin
 if p_kind='sale_line' then select * into line from public.sale_lines where tenant_id=p_tenant and id=p_reference;
 elsif p_kind='sale_return' then select l.* into line from public.sale_returns r join public.sale_lines l on l.tenant_id=r.tenant_id and l.id=r.sale_line_id where r.tenant_id=p_tenant and r.id=p_reference;
 else return null;
 end if;
 if line.id is null then return null; end if;
 return jsonb_build_object('itemId',line.item_id,'reference','I-'||upper(left(line.item_id::text,8)),
  'title',komisio_private.item_title(p_tenant,line.item_id)->>'title',
  'salePriceOre',line.price_ore::text,'storeShareOre',(line.price_ore-line.seller_credit_ore)::text,'sellerShareOre',line.seller_credit_ore::text);
end $$;
revoke all on function komisio_private.ledger_item_details(uuid,text,uuid) from public,anon,authenticated;

do $$ declare source text; begin
 source:=pg_get_functiondef('public.seller_ledger_history_page(uuid,uuid,integer)'::regprocedure);
 if position('select e.id,e.kind' in source)=0 then raise exception 'LEDGER_PAGE_SHAPE_CHANGED'; end if;
 source:=replace(source,'select e.id,e.kind','select komisio_private.ledger_item_details(p_tenant,e.reference_kind,e.reference_id) as "itemDetails",e.id,e.kind');
 execute source;
 source:=pg_get_functiondef('public.seller_ledger_page(uuid,uuid)'::regprocedure);
 if position('select e.id,e.kind' in source)=0 then raise exception 'RECENT_LEDGER_SHAPE_CHANGED'; end if;
 source:=replace(source,'select e.id,e.kind','select komisio_private.ledger_item_details(p_tenant,e.reference_kind,e.reference_id) as "itemDetails",e.id,e.kind');
 execute source;
 source:=pg_get_functiondef('public.my_seller_economy(uuid,uuid)'::regprocedure);
 if position('select id,kind,amount_ore,reference_kind,reference_id,occurred_at' in source)=0 then raise exception 'SELLER_ECONOMY_SHAPE_CHANGED'; end if;
 source:=replace(source,'select id,kind,amount_ore,reference_kind,reference_id,occurred_at','select komisio_private.ledger_item_details(p_tenant,reference_kind,reference_id) as "itemDetails",id,kind,amount_ore,reference_kind,reference_id,occurred_at');
 execute source;
end $$;
