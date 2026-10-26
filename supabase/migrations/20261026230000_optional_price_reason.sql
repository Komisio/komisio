-- Optional human price notes do not change price, role or immutable audit rules.
do $$ declare definition text;
begin
 definition:=pg_get_functiondef('public.set_item_price(uuid,uuid,uuid,bigint,text)'::regprocedure);
 if position('length(note) not between 1 and 500' in definition)=0 then raise exception 'UNEXPECTED_PRICE_DEFINITION'; end if;
 execute replace(definition,'length(note) not between 1 and 500','length(note)>500');
 definition:=pg_get_functiondef('komisio_private.validate_lifecycle_batch_operation(jsonb)'::regprocedure);
 if position('kind<>''end'' and length(reason)=0' in definition)=0 then raise exception 'UNEXPECTED_BATCH_DEFINITION'; end if;
 execute replace(definition,'kind<>''end'' and length(reason)=0','kind=''extend'' and length(reason)=0');
end $$;

create function public.set_item_price_checked(p_tenant uuid,p_id uuid,p_item uuid,p_price_ore bigint,p_reason text,p_expected_ore bigint) returns uuid
language plpgsql security definer set search_path='' as $$
declare note text:=trim(coalesce(p_reason,'')); f jsonb;
begin
 if p_price_ore is null or p_price_ore not between 1 and 99999999999 or length(note)>500 or p_expected_ore is null or p_expected_ore not between 1 and 99999999999 then raise exception 'INVALID_INPUT'; end if;
 -- Guard authenticates, checks membership, locks the tenant and binds replay to actor/item/payload.
 if not komisio_private.lifecycle_guard(p_tenant,p_id,p_item,'price_set',jsonb_build_object('priceOre',p_price_ore,'reason',note)) then
  if (select (detail->>'previousPriceOre')::bigint from public.item_events where id=p_id) is distinct from p_expected_ore then raise exception 'REQUEST_CONFLICT'; end if;
  return p_id;
 end if;
 f:=komisio_private.item_lifecycle(p_tenant,p_item);
 if (f->>'currentPriceOre')::bigint is distinct from p_expected_ore then raise exception 'ITEM_PRICE_CHANGED'; end if;
 return public.set_item_price(p_tenant,p_id,p_item,p_price_ore,note);
end $$;
revoke all on function public.set_item_price_checked(uuid,uuid,uuid,bigint,text,bigint) from public,anon;
grant execute on function public.set_item_price_checked(uuid,uuid,uuid,bigint,text,bigint) to authenticated;
notify pgrst,'reload schema';
