-- Use the existing tenant/item event index during the bounded global scan.
do $$
declare definition text; needle text:='from public.item_events where item_id=p_item';
begin
 definition:=pg_get_functiondef('komisio_private.period_notice_facts(uuid,text)'::regprocedure);
 if (length(definition)-length(replace(definition,needle,'')))/length(needle)<>3
 then raise exception 'UNEXPECTED_PERIOD_NOTICE_EVENTS'; end if;
 execute replace(definition,needle,'from public.item_events where tenant_id=item.tenant_id and item_id=p_item');
end $$;
