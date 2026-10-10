-- Custom deterministic UUIDv8 identifiers also satisfy client UUID validation.
-- Existing immutable fee IDs remain valid references and are returned on replay.
do $$ declare definition text; old_expression text; begin
 definition:=pg_get_functiondef('komisio_private.append_consignment_fee(uuid,integer,uuid)'::regprocedure);
 old_expression:='fee_id:=md5(''consignment-fee:''||p.id::text||'':''||p_month::text)::uuid;';
 if position(old_expression in definition)=0 then raise exception 'UNEXPECTED_FEE_DEFINITION'; end if;
 definition:=replace(definition,old_expression,
  'select id into fee_id from public.consignment_fees where period_id=p.id and month_index=p_month;
   if found then return fee_id; end if;
   fee_id:=overlay(overlay(md5(''consignment-fee:''||p.id::text||'':''||p_month::text) placing ''8'' from 13 for 1) placing ''a'' from 17 for 1)::uuid;');
 execute definition;
end $$;
