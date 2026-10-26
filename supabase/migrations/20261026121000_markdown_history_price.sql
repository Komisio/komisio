-- #636: retain the actual prior price for future history without rewriting old events.
create or replace function public.apply_markdown(p_tenant uuid,p_id uuid,p_item uuid,p_step integer) returns uuid
language plpgsql security definer set search_path='' as $$
declare uid uuid:=komisio_private.require_identity(); f jsonb; percent numeric; new_price bigint;
begin
 if p_step is null or p_step<1 then raise exception 'INVALID_INPUT'; end if;
 if not komisio_private.lifecycle_guard(p_tenant,p_id,p_item,'markdown_applied',jsonb_build_object('step',p_step)) then return p_id; end if;
 f:=komisio_private.item_lifecycle(p_tenant,p_item);
 if to_jsonb(p_step) <@ (f->'appliedSteps') then raise exception 'MARKDOWN_ALREADY_APPLIED'; end if;
 if (f->>'dueStep')::integer is distinct from p_step then raise exception 'MARKDOWN_NOT_DUE'; end if;
 percent:=(f->>'duePercent')::numeric;
 -- The markdown is a share of the accepted price, never compounded on an earlier markdown.
 new_price:=greatest((f->>'acceptedPriceOre')::bigint-komisio_private.share_ore((f->>'acceptedPriceOre')::bigint,round(percent*100)::integer),1);
 insert into public.item_prices(tenant_id,item_id,price_ore,reason,set_by) values(p_tenant,p_item,new_price,'markdown',uid);
 insert into public.item_events(id,tenant_id,item_id,kind,detail,actor) values(p_id,p_tenant,p_item,'markdown_applied',jsonb_build_object('step',p_step,'percent',percent,'priceOre',new_price,'previousPriceOre',(f->>'currentPriceOre')::bigint),uid);
 perform komisio_private.record_access(p_tenant,'item.markdown',p_item,jsonb_build_object('step',p_step,'price_ore',new_price));
 return p_id;
end $$;
