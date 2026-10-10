-- Recording completed manual transfers, never initiating a bank payment.
create unique index payout_confirmation_identity on public.access_events(tenant_id,target_id)
 where action='payout.payments_confirmed';

create function public.confirm_payout_payments(p_tenant uuid,p_id uuid,p_currency text,p_payments jsonb) returns uuid
language plpgsql security definer set search_path='' as $$
declare actor uuid:=komisio_private.require_identity(); entry jsonb; canonical jsonb:='[]'; detail jsonb;
 prior public.access_events; payout public.payouts; payout_id uuid; amount bigint; reference text;
begin
 perform 1 from public.tenants where id=p_tenant for update;
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin','staff') then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 if p_id is null or p_currency is null or p_currency !~ '^[A-Z]{3}$' or p_payments is null or jsonb_typeof(p_payments)<>'array' then raise exception 'INVALID_INPUT'; end if;
 if jsonb_array_length(p_payments) not between 1 and 50 then raise exception 'INVALID_INPUT'; end if;
 for entry in select value from jsonb_array_elements(p_payments) loop
  if jsonb_typeof(entry)<>'object' then raise exception 'INVALID_INPUT'; end if;
  if array(select jsonb_object_keys(entry) order by 1)<>array['amountOre','payoutId','reference']
   or jsonb_typeof(entry->'payoutId') is distinct from 'string'
   or jsonb_typeof(entry->'amountOre') is distinct from 'number'
   or (entry->>'amountOre') !~ '^[1-9][0-9]{0,10}$'
   or jsonb_typeof(entry->'reference') is distinct from 'string' then raise exception 'INVALID_INPUT'; end if;
  payout_id:=(entry->>'payoutId')::uuid;
  amount:=(entry->>'amountOre')::bigint;
  reference:=trim(entry->>'reference');
  if length(reference) not between 1 and 200 then raise exception 'INVALID_INPUT'; end if;
  canonical:=canonical||jsonb_build_array(jsonb_build_object('payoutId',payout_id,'amountOre',amount,'reference',reference));
 end loop;
 if (select count(distinct value->>'payoutId') from jsonb_array_elements(canonical))<>jsonb_array_length(canonical) then raise exception 'INVALID_INPUT'; end if;
 select jsonb_agg(value order by value->>'payoutId') into canonical from jsonb_array_elements(canonical);
 detail:=jsonb_build_object('currency',p_currency,'payments',canonical);
 select * into prior from public.access_events where tenant_id=p_tenant and target_id=p_id and action='payout.payments_confirmed';
 if found then
  if prior.actor_id is distinct from actor or prior.detail is distinct from detail then raise exception 'REQUEST_CONFLICT'; end if;
  return p_id;
 end if;
 if komisio_private.store_currency(p_tenant) is distinct from p_currency then raise exception 'PAYOUT_CHANGED'; end if;
 -- Validate the complete snapshot before any transition. The tenant lock also
 -- serializes individual payment/rejection commands and competing batches.
 for entry in select value from jsonb_array_elements(canonical) loop
  select * into payout from public.payouts where tenant_id=p_tenant and id=(entry->>'payoutId')::uuid;
  if not found or payout.status<>'approved' or payout.rail<>'manual'
   or payout.currency is distinct from p_currency or payout.amount_ore is distinct from (entry->>'amountOre')::bigint then raise exception 'PAYOUT_CHANGED'; end if;
 end loop;
 for entry in select value from jsonb_array_elements(canonical) loop
  perform public.mark_payout_paid(p_tenant,gen_random_uuid(),(entry->>'payoutId')::uuid,entry->>'reference','');
 end loop;
 perform komisio_private.record_access(p_tenant,'payout.payments_confirmed',p_id,detail);
 return p_id;
exception when invalid_text_representation or numeric_value_out_of_range then raise exception 'INVALID_INPUT';
end $$;
revoke all on function public.confirm_payout_payments(uuid,uuid,text,jsonb) from public,anon;
grant execute on function public.confirm_payout_payments(uuid,uuid,text,jsonb) to authenticated;
