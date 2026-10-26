-- Collection grace for newly accepted day-period consignment items. Calendar
-- receipts keep their existing immutable period snapshot; historic items stay as-is.
alter function komisio_private.valid_store_policy(jsonb) rename to valid_store_policy_before_collection;
create function komisio_private.valid_store_policy(value jsonb) returns boolean
language plpgsql immutable set search_path='' as $$
begin
 if not komisio_private.valid_store_policy_before_collection(value-'collectionDays') then return false; end if;
 if not(value ? 'collectionDays') then return true; end if;
 if value ? 'consignmentPeriod' or jsonb_typeof(value->'collectionDays') is distinct from 'number' then return false; end if;
 return (value->>'collectionDays')::numeric between 0 and 365
  and (value->>'collectionDays')::numeric=trunc((value->>'collectionDays')::numeric);
end $$;
revoke all on function komisio_private.valid_store_policy(jsonb),komisio_private.valid_store_policy_before_collection(jsonb) from public,anon,authenticated;

create function komisio_private.freeze_item_collection_days() returns trigger
language plpgsql security definer set search_path='' as $$
declare policy jsonb;
begin
 if new.ownership<>'consignment' or new.terms->>'endOfPeriodAction'<>'return' then return new; end if;
 select p.policy into policy from public.store_policy_versions p
 where p.tenant_id=new.tenant_id and p.id=(new.terms->>'storePolicyId')::uuid;
 if policy ? 'collectionDays' and not(policy ? 'consignmentPeriod') then
  new.terms:=new.terms||jsonb_build_object('collectionDays',policy->'collectionDays');
 end if;
 return new;
end $$;
revoke all on function komisio_private.freeze_item_collection_days() from public,anon,authenticated;
create trigger freeze_item_collection before insert on public.items
 for each row execute function komisio_private.freeze_item_collection_days();

alter function komisio_private.item_lifecycle(uuid,uuid) rename to item_lifecycle_before_collection;
create function komisio_private.item_lifecycle(p_tenant uuid,p_item uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare facts jsonb; days integer;
begin
 facts:=komisio_private.item_lifecycle_before_collection(p_tenant,p_item);
 select (i.terms->>'collectionDays')::integer into days from public.items i
 where i.tenant_id=p_tenant and i.id=p_item and i.ownership='consignment'
 and not(i.terms ? 'consignmentPeriod') and i.terms->>'endOfPeriodAction'='return';
 if days is null then return facts; end if;
 -- The existing projection has already resolved extensions and reopening.
 return facts||jsonb_build_object('collectionDeadline',
  (((facts->>'periodEnd')::timestamptz at time zone 'Europe/Stockholm')+make_interval(days=>days)) at time zone 'Europe/Stockholm');
end $$;
revoke all on function komisio_private.item_lifecycle(uuid,uuid),komisio_private.item_lifecycle_before_collection(uuid,uuid) from public,anon,authenticated;

-- This remains a scoped current-settings summary, not a rewrite of legal text.
do $$
declare definition text; needle text:='''collectionDays'',(policy->''consignmentPeriod''->>''collectionDays'')::integer,';
begin
 definition:=pg_get_functiondef('public.my_seller_terms_summary(uuid,uuid)'::regprocedure);
 if position(needle in definition)=0 then raise exception 'UNEXPECTED_SELLER_TERMS_SUMMARY'; end if;
 execute replace(definition,needle,'''collectionDays'',case when policy ? ''consignmentPeriod'' then (policy->''consignmentPeriod''->>''collectionDays'')::integer when policy->>''endOfPeriodAction''=''return'' then (policy->>''collectionDays'')::integer end,');
end $$;
notify pgrst,'reload schema';
