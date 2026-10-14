-- Batch preparation cannot review a destination the operator has not seen.
do $$ declare source text; target text; begin
 source:=pg_get_functiondef('public.settle_payouts(uuid,uuid,jsonb,text)'::regprocedure);
 target:='perform komisio_private.transition_payout(p_tenant,komisio_private.derived_id(p_id::text||'':''||seller::text||'':approved''),payout,''approved'',note,'''');';
 if position(target in source)=0 then raise exception 'SETTLEMENT_SHAPE_CHANGED'; end if;
 source:=replace(source,target,
 'if not exists(select 1 from public.seller_bank_versions where tenant_id=p_tenant and seller_id=seller) then '||target||' end if;');
 execute source;
end $$;
