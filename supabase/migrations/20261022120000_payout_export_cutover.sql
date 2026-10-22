-- A downloaded historic export may already be booked outside the connector.
-- New sources must not be used to infer a safe correction of unknown history.
create function komisio_private.payout_export_history_complete(p_tenant uuid,p_date date,p_provider text) returns boolean
language sql stable set search_path='' as $$
 select not exists(
  select 1 from public.accounting_exports e
  join public.day_closes c on c.tenant_id=e.tenant_id and c.id=e.day_close_id
  join public.accounting_maps m on m.tenant_id=e.tenant_id and m.id=e.map_id
  where p_provider='fortnox' and e.tenant_id=p_tenant and c.close_date=p_date and c.payouts_paid_ore<>0
   and (not komisio_private.payout_evidence_complete(c) or not komisio_private.payout_mapping_complete(m.map))
  union all
  select 1 from public.economic_exports e
  join public.day_closes c on c.tenant_id=e.tenant_id and c.id=e.day_close_id
  join public.economic_maps m on m.tenant_id=e.tenant_id and m.id=e.map_id
  where p_provider='economic' and e.tenant_id=p_tenant and c.close_date=p_date and c.payouts_paid_ore<>0
   and (not komisio_private.payout_evidence_complete(c) or not komisio_private.payout_mapping_complete(m.map,true))
 )
$$;
revoke all on function komisio_private.payout_export_history_complete(uuid,date,text) from public,anon,authenticated;
do $$ declare definition text; begin
 definition:=pg_get_functiondef('public.export_day_close(uuid,uuid,uuid)'::regprocedure);
 -- Preserve exact request replay but do not turn a new request into a legacy export.
 if position('select e.id into existing' in definition)=0 then raise exception 'UNEXPECTED_ACCOUNTING_EXPORT'; end if;
 definition:=replace(definition,'select e.id into existing',
  'if not komisio_private.payout_export_history_complete(p_tenant,close.close_date,''fortnox'') then raise exception ''ACCOUNTING_PAYOUT_HISTORY_REVIEW''; end if; select e.id into existing');
 execute definition;
 definition:=pg_get_functiondef('komisio_private.fortnox_delta_preview(public.accounting_exports)'::regprocedure);
 if position('if reason='''' and not komisio_private.payout_evidence_complete(c)' in definition)=0 then raise exception 'UNEXPECTED_FORTNOX_PREVIEW'; end if;
 execute replace(definition,'if reason='''' and not komisio_private.payout_evidence_complete(c)',
  'if reason='''' and not komisio_private.payout_export_history_complete(e.tenant_id,c.close_date,''fortnox'') then reason:=''ACCOUNTING_PAYOUT_HISTORY_REVIEW''; end if; if reason='''' and not komisio_private.payout_evidence_complete(c)');
 definition:=pg_get_functiondef('komisio_private.economic_delta_preview(public.day_closes,public.economic_maps)'::regprocedure);
 if position('if not komisio_private.payout_evidence_complete(c)' in definition)=0 then raise exception 'UNEXPECTED_ECONOMIC_PREVIEW'; end if;
 execute replace(definition,'if not komisio_private.payout_evidence_complete(c)',
  'if not komisio_private.payout_export_history_complete(c.tenant_id,c.close_date,''economic'') or not komisio_private.payout_evidence_complete(c)');
end $$;
